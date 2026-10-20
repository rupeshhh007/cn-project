import { dataPacketSchema, PROTOCOL_VERSION, type DataPacket, type RtcSignal } from "@hopnet/protocol";
import { createUuid } from "./id.ts";

export type LinkState = {
  peerId: string;
  state: "new" | "connecting" | "direct" | "degraded" | "closed";
  channelState: RTCDataChannelState | "none";
  rttMs?: number;
  candidateType?: string;
  bytesSent: number;
  bytesReceived: number;
  error?: string;
};

type ManagedPeer = {
  pc: RTCPeerConnection;
  channel?: RTCDataChannel;
  makingOffer: boolean;
  ignoreOffer: boolean;
  polite: boolean;
  state: LinkState;
  pendingPings: Map<string, number>;
  lastByteUpdate?: number;
};

export class PeerManager {
  private peers = new Map<string, ManagedPeer>();

  constructor(
    private readonly selfPeerId: string,
    private readonly signal: (targetPeerId: string, signal: RtcSignal) => void,
    private readonly onState: (state: LinkState) => void,
    private readonly onMessage: (peerId: string, packet: DataPacket) => void,
  ) {}

  ensure(remotePeerId: string): void {
    if (remotePeerId === this.selfPeerId || this.peers.has(remotePeerId)) return;
    const pc = new RTCPeerConnection({ iceServers: [] });
    const state: LinkState = { peerId: remotePeerId, state: "new", channelState: "none", bytesSent: 0, bytesReceived: 0 };
    const managed: ManagedPeer = {
      pc,
      makingOffer: false,
      ignoreOffer: false,
      polite: this.selfPeerId.localeCompare(remotePeerId) > 0,
      state,
      pendingPings: new Map(),
    };
    this.peers.set(remotePeerId, managed);
    this.emit(managed, { state: "connecting" });

    pc.onicecandidate = ({ candidate }) => {
      if (!candidate) return;
      const json = candidate.toJSON();
      if (!json.candidate) return;
      this.signal(remotePeerId, { candidate: { ...json, candidate: json.candidate } });
    };
    pc.onconnectionstatechange = () => {
      const next = pc.connectionState === "connected" && managed.channel?.readyState === "open" ? "direct" : pc.connectionState === "failed" || pc.connectionState === "disconnected" ? "degraded" : pc.connectionState === "closed" ? "closed" : "connecting";
      this.emit(managed, { state: next, error: pc.connectionState === "failed" ? "ICE connection failed" : undefined });
      if (next === "direct") void this.inspectCandidate(managed);
    };
    pc.ondatachannel = ({ channel }) => this.bindChannel(remotePeerId, managed, channel);
    pc.onnegotiationneeded = async () => {
      try {
        managed.makingOffer = true;
        await pc.setLocalDescription();
        if (pc.localDescription) this.signal(remotePeerId, { description: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
      } catch (error) {
        this.emit(managed, { state: "degraded", error: error instanceof Error ? error.message : "Negotiation failed" });
      } finally {
        managed.makingOffer = false;
      }
    };

    if (this.selfPeerId.localeCompare(remotePeerId) < 0) this.bindChannel(remotePeerId, managed, pc.createDataChannel("hopnet-control", { ordered: true }));
  }

  async receiveSignal(remotePeerId: string, signal: RtcSignal): Promise<void> {
    this.ensure(remotePeerId);
    const managed = this.peers.get(remotePeerId)!;
    const { pc } = managed;
    try {
      if (signal.description) {
        const description = signal.description as RTCSessionDescriptionInit;
        const collision = description.type === "offer" && (managed.makingOffer || pc.signalingState !== "stable");
        managed.ignoreOffer = !managed.polite && collision;
        if (managed.ignoreOffer) return;
        await pc.setRemoteDescription(description);
        if (description.type === "offer") {
          await pc.setLocalDescription();
          if (pc.localDescription) this.signal(remotePeerId, { description: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
        }
      } else if (signal.candidate && !managed.ignoreOffer) {
        await pc.addIceCandidate(signal.candidate as RTCIceCandidateInit);
      }
    } catch (error) {
      this.emit(managed, { state: "degraded", error: error instanceof Error ? error.message : "Signal handling failed" });
    }
  }

  ping(remotePeerId: string): string {
    const messageId = createUuid();
    const managed = this.requireOpen(remotePeerId);
    managed.pendingPings.set(messageId, performance.now());
    this.send(remotePeerId, { protocolVersion: PROTOCOL_VERSION, kind: "ping", messageId, sentAt: performance.timeOrigin + performance.now() });
    return messageId;
  }

  sendMessage(remotePeerId: string, body: string): void {
    this.send(remotePeerId, { protocolVersion: PROTOCOL_VERSION, kind: "message", messageId: createUuid(), sentAt: Date.now(), body });
  }

  sendPacket(remotePeerId: string, packet: DataPacket): void {
    this.send(remotePeerId, packet);
  }

  async sendPacketAsync(remotePeerId: string, packet: DataPacket): Promise<void> {
    const managed = this.requireOpen(remotePeerId);
    await this.waitForWritable(managed);
    this.send(remotePeerId, packet);
  }

  close(remotePeerId: string): void {
    const managed = this.peers.get(remotePeerId);
    managed?.channel?.close();
    managed?.pc.close();
    this.peers.delete(remotePeerId);
  }

  closeAll(): void {
    for (const peerId of this.peers.keys()) this.close(peerId);
  }

  private send(remotePeerId: string, packet: DataPacket): void {
    const managed = this.requireOpen(remotePeerId);
    const payload = JSON.stringify(packet);
    managed.channel!.send(payload);
    this.emit(managed, { bytesSent: managed.state.bytesSent + new TextEncoder().encode(payload).byteLength });
  }

  private requireOpen(remotePeerId: string): ManagedPeer {
    const managed = this.peers.get(remotePeerId);
    if (!managed?.channel || managed.channel.readyState !== "open") throw new Error("Direct WebRTC channel is not open.");
    return managed;
  }

  private bindChannel(remotePeerId: string, managed: ManagedPeer, channel: RTCDataChannel): void {
    managed.channel = channel;
    channel.binaryType = "arraybuffer";
    channel.bufferedAmountLowThreshold = 64 * 1024;
    channel.onopen = () => { this.emit(managed, { state: "direct", channelState: channel.readyState }); void this.inspectCandidate(managed); };
    channel.onclose = () => this.emit(managed, { state: "closed", channelState: channel.readyState });
    channel.onerror = () => this.emit(managed, { state: "degraded", channelState: channel.readyState, error: "DataChannel error" });
    channel.onmessage = ({ data }) => {
      if (typeof data !== "string") return;
      if (data.length > 96 * 1024) return;
      this.emit(managed, { bytesReceived: managed.state.bytesReceived + new TextEncoder().encode(data).byteLength });
      let value: unknown;
      try { value = JSON.parse(data); } catch { return; }
      const parsed = dataPacketSchema.safeParse(value);
      if (!parsed.success) return;
      const packet = parsed.data;
      if (packet.kind === "ping") {
        this.send(remotePeerId, { protocolVersion: PROTOCOL_VERSION, kind: "pong", messageId: packet.messageId, sentAt: packet.sentAt, echoedAt: Date.now() });
      } else if (packet.kind === "message") {
        this.send(remotePeerId, { protocolVersion: PROTOCOL_VERSION, kind: "message-ack", messageId: packet.messageId, receivedAt: Date.now() });
      } else if (packet.kind === "pong") {
        const started = managed.pendingPings.get(packet.messageId);
        if (started !== undefined) {
          managed.pendingPings.delete(packet.messageId);
          this.emit(managed, { rttMs: Math.round((performance.now() - started) * 10) / 10 });
        }
      }
      this.onMessage(remotePeerId, packet);
    };
  }

  private async waitForWritable(managed: ManagedPeer): Promise<void> {
    const channel = managed.channel;
    if (!channel || channel.readyState !== "open") throw new Error("Direct WebRTC channel is not open.");
    if (channel.bufferedAmount < 256 * 1024) return;
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error("WebRTC send queue remained congested."));
      }, 5_000);
      const cleanup = () => {
        window.clearTimeout(timeout);
        channel.removeEventListener("bufferedamountlow", ready);
        channel.removeEventListener("close", closed);
      };
      const closed = () => { cleanup(); reject(new Error("Direct WebRTC channel closed while waiting for backpressure.")); };
      const ready = () => {
        cleanup();
        resolve();
      };
      channel.addEventListener("bufferedamountlow", ready, { once: true });
      channel.addEventListener("close", closed, { once: true });
      // The queue may drain between the initial check and listener registration.
      if (channel.readyState !== "open") {
        window.clearTimeout(timeout);
        channel.removeEventListener("bufferedamountlow", ready);
        reject(new Error("Direct WebRTC channel closed while waiting for backpressure."));
      } else if (channel.bufferedAmount < 256 * 1024) {
        ready();
      }
    });
  }

  private emit(managed: ManagedPeer, patch: Partial<LinkState>): void {
    managed.state = { ...managed.state, ...patch, channelState: managed.channel?.readyState ?? managed.state.channelState };
    if (Object.keys(patch).every((key) => key === "bytesSent" || key === "bytesReceived")) {
      if (performance.now() - (managed.lastByteUpdate ?? 0) < 200) return;
      managed.lastByteUpdate = performance.now();
    }
    this.onState({ ...managed.state });
  }

  private async inspectCandidate(managed: ManagedPeer): Promise<void> {
    const stats = await managed.pc.getStats();
    let pair: RTCStats | undefined;
    stats.forEach((report) => { if (report.type === "candidate-pair" && report.state === "succeeded" && (report.nominated || !pair)) pair = report; });
    if (!pair) return;
    const local = stats.get((pair as RTCStats & { localCandidateId?: string }).localCandidateId ?? "") as (RTCStats & { candidateType?: string }) | undefined;
    const remote = stats.get((pair as RTCStats & { remoteCandidateId?: string }).remoteCandidateId ?? "") as (RTCStats & { candidateType?: string }) | undefined;
    this.emit(managed, { candidateType: [local?.candidateType, remote?.candidateType].filter(Boolean).join(" ↔ ") || "candidate pair selected" });
  }
}
