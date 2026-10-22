import { PROTOCOL_VERSION, type TransferDataPacket } from "@hopnet/protocol";
import { TransferAssembler, base64ToBytes, bytesToBase64, createManifest, type TransferManifest } from "@hopnet/transfer";
import { createUuid } from "./id.ts";

export type TransferStatus = "preparing" | "offered" | "awaiting-acceptance" | "transferring" | "verifying" | "verified" | "declined" | "failed" | "cancelled";

export type PathAccounting = { path: string[]; attemptedChunks: number; acknowledgedChunks: number; deliveredBytes: number; retries: number; failures: number; rttMs?: number };
export type TransferEvent = { type: string; transferId: string; at: number; path?: string[]; chunkIndex?: number; detail?: string };

export type TransferView = {
  id: string;
  direction: "send" | "receive";
  peerId: string;
  fileName: string;
  mime: string;
  size: number;
  status: TransferStatus;
  acknowledgedChunks: number;
  totalChunks: number;
  acknowledgedBytes: number;
  paths: string[][];
  recoveryCount: number;
  verifiedHash?: string;
  downloadUrl?: string;
  error?: string;
  pathStats?: PathAccounting[];
  history?: TransferEvent[];
  startedAt?: number;
  completedAt?: number;
  duplicateChunks?: number;
};

type Outbound = {
  view: TransferView;
  manifest?: TransferManifest;
  chunks?: Uint8Array[];
  acknowledged: Set<number>;
  attempts: Map<number, number>;
  sentAt: Map<number, number>;
  running: boolean;
  sends: Map<string, { index: number; path: string[]; at: number }>;
  lastRoute: Map<number, string>;
  progressAt: number;
  srtt?: number;
  variance: number;
};

type Inbound = {
  view: TransferView;
  manifest: TransferManifest;
  assembler: TransferAssembler;
  accepted: boolean;
  offerPath: string[];
  lastPath: string[];
  queue: Promise<void>;
  progressAt: number;
};

type Dependencies = {
  selfPeerId: string;
  getPaths: (destinationPeerId: string) => string[][];
  isPermittedEdge: (a: string, b: string) => boolean;
  send: (nextHop: string, packet: TransferDataPacket) => Promise<void>;
  onUpdate: (transfer: TransferView) => void;
  onEvent: (title: string, detail: string) => void;
  onProtocolEvent?: (event: TransferEvent) => void;
  sign: (packet: TransferDataPacket) => Promise<TransferDataPacket>;
  verify: (packet: TransferDataPacket) => Promise<boolean>;
  canOfferTo: (peerId: string) => boolean;
  isPathAvailable: (path: string[]) => boolean;
};

const MAX_ATTEMPTS = 8;
const MAX_IN_FLIGHT_CHUNKS = 8;
const NO_PROGRESS_TIMEOUT_MS = 60_000;
const TRANSFER_TIMEOUT_MS = 15 * 60_000;
const terminal = (status: TransferStatus) => ["verified", "failed", "declined", "cancelled"].includes(status);

function canVerifyWithWebCrypto(): boolean {
  return (typeof window === "undefined" || window.isSecureContext) && typeof crypto !== "undefined" && Boolean(crypto.subtle);
}

const SECURE_FILE_ERROR = "Verified file transfers require trusted HTTPS on both devices. Open the HOPNET LAN HTTPS URL and trust its local CA certificate first.";

export class TransferManager {
  private readonly outbound = new Map<string, Outbound>();
  private readonly inbound = new Map<string, Inbound>();
  private disposed = false;
  private readonly pendingViews = new Map<string, TransferView>();
  private updateTimer?: ReturnType<typeof setTimeout>;
  private readonly cleanupTimer: ReturnType<typeof setInterval>;

  constructor(private readonly dependencies: Dependencies) {
    this.cleanupTimer = setInterval(() => {
      for (const transfer of this.inbound.values()) {
        if (transfer.view.status !== "transferring") continue;
        if (performance.now() - transfer.progressAt <= NO_PROGRESS_TIMEOUT_MS && performance.now() - (transfer.view.startedAt ?? performance.now()) <= TRANSFER_TIMEOUT_MS) continue;
        transfer.accepted = false;
        transfer.view = { ...transfer.view, status: "failed", error: "No sender progress for 60 seconds or the transfer resource deadline expired. Restore a route and start a new accepted transfer." };
        this.record(transfer.view, "receiver-timeout"); this.emit(transfer.view);
        void this.sendCompletion(transfer, "rejected", undefined, "Receiver timed out waiting for file data.").catch(() => undefined);
      }
    }, 5_000);
  }

  async offer(file: File, destinationPeerId: string): Promise<string> {
    if (!canVerifyWithWebCrypto()) throw new Error(SECURE_FILE_ERROR);
    if (!this.dependencies.canOfferTo(destinationPeerId)) throw new Error("The receiver has no verified-transfer identity yet. Open trusted HTTPS on that device and wait for its secure session to initialize.");
    if (file.size < 1 || file.size > 32 * 1024 * 1024) throw new Error("Choose a file between 1 byte and 32 MiB.");
    this.reserve();
    const transferId = createUuid();
    const view: TransferView = {
      id: transferId,
      direction: "send",
      peerId: destinationPeerId,
      fileName: file.name,
      mime: file.type,
      size: file.size,
      status: "preparing",
      acknowledgedChunks: 0,
      totalChunks: 0,
      acknowledgedBytes: 0,
      paths: [],
      recoveryCount: 0,
      pathStats: [], history: [],
    };
    const transfer: Outbound = { view, acknowledged: new Set(), attempts: new Map(), sentAt: new Map(), running: false, sends: new Map(), lastRoute: new Map(), progressAt: performance.now(), variance: 0 };
    this.outbound.set(transferId, transfer);
    this.emit(view);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { manifest, chunks } = await createManifest(file.name, file.type, bytes);
      if (this.disposed || terminal(transfer.view.status)) return transferId;
      const paths = this.validPaths(destinationPeerId);
      transfer.manifest = manifest;
      transfer.chunks = chunks;
      transfer.view = { ...view, fileName: manifest.name, mime: manifest.mime, size: manifest.size, totalChunks: manifest.chunkCount, status: "offered", paths };
      this.emit(transfer.view);
      this.record(transfer.view, "offer", paths[0]);
      await this.sendAlong(paths[0]!, {
        protocolVersion: PROTOCOL_VERSION,
        kind: "transfer-offer",
        transferId,
        sourcePeerId: this.dependencies.selfPeerId,
        destinationPeerId,
        routeId: createUuid(),
        nextHop: paths[0]![1]!,
        path: paths[0]!,
        hopIndex: 1,
        ttl: paths[0]!.length + 2,
        createdAt: Date.now(),
        manifest,
      });
      this.dependencies.onEvent("File offer sent", `${manifest.name} · ${formatBytes(manifest.size)} · awaiting receiver consent`);
      return transferId;
    } catch (error) {
      this.failOutbound(transfer, error);
      throw error;
    }
  }

  async respond(transferId: string, accepted: boolean): Promise<void> {
    if (accepted && !canVerifyWithWebCrypto()) throw new Error(SECURE_FILE_ERROR);
    const transfer = this.inbound.get(transferId);
    if (!transfer || transfer.view.status !== "awaiting-acceptance") throw new Error("This transfer offer is no longer pending.");
    transfer.accepted = accepted;
    transfer.progressAt = performance.now();
    transfer.view = { ...transfer.view, status: accepted ? "transferring" : "declined", startedAt: accepted ? performance.now() : undefined };
    this.record(transfer.view, accepted ? "consent-accepted" : "consent-declined");
    this.emit(transfer.view);
    const reverse = [...transfer.offerPath].reverse();
    await this.sendAlong(reverse, {
      protocolVersion: PROTOCOL_VERSION,
      kind: "transfer-response",
      transferId,
      sourcePeerId: this.dependencies.selfPeerId,
      destinationPeerId: transfer.view.peerId,
      routeId: createUuid(),
      nextHop: reverse[1]!,
      path: reverse,
      hopIndex: 1,
      ttl: reverse.length + 2,
      createdAt: Date.now(),
      accepted,
      reason: accepted ? undefined : "Receiver declined the file offer.",
    });
    this.dependencies.onEvent(accepted ? "File offer accepted" : "File offer declined", transfer.view.fileName);
  }

  async handle(fromPeerId: string, packet: TransferDataPacket): Promise<void> {
    if (!this.validHop(fromPeerId, packet)) {
      this.dependencies.onEvent("Transfer packet rejected", "Route, next-hop, or permitted-edge validation failed");
      return;
    }
    if (packet.destinationPeerId !== this.dependencies.selfPeerId) {
      await this.forward(packet);
      return;
    }
    if (!await this.dependencies.verify(packet)) {
      this.dependencies.onEvent("Transfer signature rejected", "Endpoint signature did not match the coordinator-bound peer identity.");
      return;
    }
    if (packet.kind === "transfer-offer") return this.receiveOffer(packet);
    if (packet.kind === "transfer-response") return this.receiveResponse(packet);
    if (packet.kind === "transfer-chunk") {
      const transfer = this.inbound.get(packet.transferId);
      if (!transfer) return;
      // Serialize hashing and assembly: RTC message callbacks can overlap across
      // channels while Web Crypto yields, including duplicate final chunks.
      transfer.queue = transfer.queue.then(() => this.receiveChunk(packet));
      return transfer.queue;
    }
    if (packet.kind === "transfer-chunk-ack") return this.receiveAck(packet);
    if (packet.kind === "transfer-complete") return this.receiveComplete(packet);
    if (packet.kind === "transfer-cancel") {
      const transfer = this.outbound.get(packet.transferId) ?? this.inbound.get(packet.transferId);
      if (transfer && transfer.view.peerId === packet.sourcePeerId && !terminal(transfer.view.status)) {
        transfer.view = { ...transfer.view, status: "cancelled", error: "Cancelled by the other device." };
        if ("accepted" in transfer) { transfer.accepted = false; transfer.assembler.discard(); }
        else { transfer.chunks = undefined; transfer.sends.clear(); transfer.lastRoute.clear(); transfer.sentAt.clear(); transfer.attempts.clear(); }
        this.record(transfer.view, "cancelled");
        this.emit(transfer.view);
      }
    }
  }

  private receiveOffer(packet: Extract<TransferDataPacket, { kind: "transfer-offer" }>): void {
    if (this.inbound.has(packet.transferId)) return;
    if (!canVerifyWithWebCrypto()) {
      this.declineOffer(packet, SECURE_FILE_ERROR);
      return;
    }
    try {
      this.reserve();
      const assembler = new TransferAssembler(packet.manifest);
      const view: TransferView = {
        id: packet.transferId,
        direction: "receive",
        peerId: packet.sourcePeerId,
        fileName: packet.manifest.name,
        mime: packet.manifest.mime,
        size: packet.manifest.size,
        status: "awaiting-acceptance",
        acknowledgedChunks: 0,
        totalChunks: packet.manifest.chunkCount,
        acknowledgedBytes: 0,
        paths: [packet.path],
        recoveryCount: 0,
        pathStats: [], history: [], duplicateChunks: 0,
      };
      this.inbound.set(packet.transferId, { view, manifest: packet.manifest, assembler, accepted: false, offerPath: packet.path, lastPath: packet.path, queue: Promise.resolve(), progressAt: performance.now() });
      this.record(view, "offer-received", packet.path);
      this.emit(view);
      this.dependencies.onEvent("Incoming file offer", `${packet.manifest.name} · ${formatBytes(packet.manifest.size)} · consent required`);
    } catch (error) {
      const partial = this.inbound.get(packet.transferId);
      if (partial) {
        partial.accepted = false;
        partial.assembler.discard();
        partial.view = { ...partial.view, status: "declined", error: errorMessage(error) };
        this.emit(partial.view);
      }
      this.declineOffer(packet, errorMessage(error));
    }
  }

  private declineOffer(packet: Extract<TransferDataPacket, { kind: "transfer-offer" }>, reason: string): void {
    this.dependencies.onEvent("File offer rejected", reason);
    const reverse = [...packet.path].reverse();
    void this.sendAlong(reverse, {
      protocolVersion: PROTOCOL_VERSION, kind: "transfer-response", transferId: packet.transferId,
      sourcePeerId: this.dependencies.selfPeerId, destinationPeerId: packet.sourcePeerId,
      routeId: createUuid(), nextHop: reverse[1]!, path: reverse, hopIndex: 1,
      ttl: reverse.length + 2, createdAt: Date.now(), accepted: false, reason: reason.slice(0, 160),
    }).catch((error: unknown) => this.dependencies.onEvent("File offer rejection notification unavailable", errorMessage(error)));
  }

  private receiveResponse(packet: Extract<TransferDataPacket, { kind: "transfer-response" }>): void {
    const transfer = this.outbound.get(packet.transferId);
    if (!transfer || transfer.view.peerId !== packet.sourcePeerId || transfer.view.status !== "offered") return;
    if (!packet.accepted) {
      transfer.view = { ...transfer.view, status: "declined", error: packet.reason ?? "Receiver declined the transfer." };
      transfer.chunks = undefined;
      transfer.sends.clear(); transfer.lastRoute.clear();
      this.emit(transfer.view);
      this.dependencies.onEvent("File offer declined", transfer.view.fileName);
      return;
    }
    transfer.progressAt = performance.now();
    transfer.view = { ...transfer.view, status: "transferring", startedAt: performance.now() };
    this.record(transfer.view, "accepted");
    this.emit(transfer.view);
    this.dependencies.onEvent("Verified transfer started", `${transfer.view.fileName} · receiver accepted`);
    void this.pump(transfer);
  }

  private async receiveChunk(packet: Extract<TransferDataPacket, { kind: "transfer-chunk" }>): Promise<void> {
    const transfer = this.inbound.get(packet.transferId);
    if (!transfer || !transfer.accepted || packet.sourcePeerId !== transfer.view.peerId || ["failed", "cancelled"].includes(transfer.view.status)) return;
    try {
      const bytes = base64ToBytes(packet.bytes);
      if (bytes.byteLength !== packet.byteLength) throw new Error("Encoded chunk length is invalid.");
      const result = await transfer.assembler.add(packet.chunkIndex, bytes, packet.chunkHash);
      if (this.disposed || !transfer.accepted || terminal(transfer.view.status) && transfer.view.status !== "verified") return;
      transfer.progressAt = performance.now();
      transfer.lastPath = packet.path;
      transfer.view = {
        ...transfer.view,
        acknowledgedChunks: transfer.assembler.receivedCount,
        acknowledgedBytes: transfer.assembler.bytesReceived,
        paths: mergePath(transfer.view.paths, packet.path),
        duplicateChunks: (transfer.view.duplicateChunks ?? 0) + Number(result === "duplicate"),
      };
      this.record(transfer.view, result === "duplicate" ? "duplicate-chunk" : "chunk-received", packet.path, packet.chunkIndex);
      this.emit(transfer.view);
      // A failed reverse path must not turn a correctly stored chunk into a
      // rejected file. The sender can retry it over a surviving route.
      await this.sendChunkAck(transfer, packet).catch(() => undefined);
      if (transfer.view.status === "verified") {
        await this.sendCompletion(transfer, "verified", transfer.view.verifiedHash).catch(() => undefined);
        return;
      }
      if (transfer.assembler.complete && transfer.view.status !== "verifying") await this.finishInbound(transfer);
    } catch (error) {
      if (this.disposed || terminal(transfer.view.status)) return;
      transfer.view = { ...transfer.view, status: "failed", error: errorMessage(error) };
      this.emit(transfer.view);
      await this.sendCompletion(transfer, "rejected", undefined, errorMessage(error));
    }
  }

  private receiveAck(packet: Extract<TransferDataPacket, { kind: "transfer-chunk-ack" }>): void {
    const transfer = this.outbound.get(packet.transferId);
    if (!transfer?.manifest || terminal(transfer.view.status) || packet.sourcePeerId !== transfer.view.peerId || packet.chunkIndex >= transfer.manifest.chunkCount) return;
    const sent = transfer.sends.get(packet.routeId);
    if (!sent || sent.index !== packet.chunkIndex || packet.path.join() !== [...sent.path].reverse().join() || transfer.acknowledged.has(packet.chunkIndex)) return;
    const elapsed = performance.now() - sent.at;
    const stats = this.stats(transfer.view, sent.path);
    stats.acknowledgedChunks += 1;
    stats.deliveredBytes += transfer.chunks![packet.chunkIndex]!.byteLength;
    stats.rttMs = elapsed;
    // Karn's rule: do not estimate RTT from retransmitted chunks.
    if (transfer.attempts.get(packet.chunkIndex) === 1) {
      transfer.variance = transfer.srtt === undefined ? elapsed / 2 : .75 * transfer.variance + .25 * Math.abs(transfer.srtt - elapsed);
      transfer.srtt = transfer.srtt === undefined ? elapsed : .875 * transfer.srtt + .125 * elapsed;
    }
    transfer.progressAt = performance.now();
    transfer.acknowledged.add(packet.chunkIndex);
    this.record(transfer.view, "receiver-ack", sent.path, packet.chunkIndex);
    transfer.view = {
      ...transfer.view,
      acknowledgedChunks: transfer.acknowledged.size,
      acknowledgedBytes: acknowledgedBytes(transfer.manifest, transfer.acknowledged),
      paths: mergePath(transfer.view.paths, [...packet.path].reverse()),
    };
    this.emit(transfer.view);
  }

  private receiveComplete(packet: Extract<TransferDataPacket, { kind: "transfer-complete" }>): void {
    const transfer = this.outbound.get(packet.transferId);
    if (!transfer?.manifest || terminal(transfer.view.status) || packet.sourcePeerId !== transfer.view.peerId || transfer.view.status === "offered") return;
    const verified = packet.status === "verified" && packet.verifiedHash === transfer.manifest.fileHash && packet.receivedBytes === transfer.manifest.size;
    if (verified) for (let index = 0; index < transfer.manifest.chunkCount; index += 1) transfer.acknowledged.add(index);
    transfer.view = {
      ...transfer.view,
      status: verified ? "verified" : "failed",
      acknowledgedChunks: verified ? transfer.manifest.chunkCount : transfer.acknowledged.size,
      acknowledgedBytes: verified ? transfer.manifest.size : acknowledgedBytes(transfer.manifest, transfer.acknowledged),
      verifiedHash: verified ? packet.verifiedHash : undefined,
      error: verified ? undefined : packet.reason ?? "Receiver did not verify the file.",
      completedAt: performance.now(),
    };
    this.record(transfer.view, verified ? "verified" : "rejected", [...packet.path].reverse());
    transfer.chunks = undefined;
    this.emit(transfer.view);
    this.dependencies.onEvent(verified ? "File integrity verified" : "File verification failed", verified ? `${transfer.view.fileName} · receiver SHA-256 matched` : transfer.view.error!);
  }

  private async pump(transfer: Outbound): Promise<void> {
    if (transfer.running || !transfer.manifest || !transfer.chunks) return;
    transfer.running = true;
    const startedAt = performance.now();
    try {
      while (!terminal(transfer.view.status) && !this.disposed) {
        if (performance.now() - startedAt > TRANSFER_TIMEOUT_MS) throw new Error("Transfer exceeded its 15-minute resource limit.");
        if (performance.now() - transfer.progressAt > NO_PROGRESS_TIMEOUT_MS) throw new Error("No receiver progress for 60 seconds. No usable alternate route or receiver response remains.");
        let paths: string[][];
        try {
          paths = this.validPaths(transfer.view.peerId);
        } catch {
          for (const stats of transfer.view.pathStats ?? []) if (stats.failures === 0) { stats.failures += 1; this.record(transfer.view, "path-unavailable", stats.path); }
          await delay(250);
          continue;
        }
        const now = performance.now();
        for (const stats of transfer.view.pathStats ?? []) {
          if (!this.dependencies.isPathAvailable(stats.path) && stats.failures === 0) {
            stats.failures += 1;
            this.record(transfer.view, "path-unavailable", stats.path);
            this.dependencies.onEvent("Transfer path unavailable", "Continuing over established alternate routes");
          }
        }
        const retryAfter = (index: number) => Math.min(30_000, Math.max(3_000, (transfer.srtt ?? 750) + 4 * transfer.variance) * 2 ** Math.max(0, (transfer.attempts.get(index) ?? 1) - 1));
        const routeLost = (index: number) => {
          const route = transfer.sends.get(transfer.lastRoute.get(index) ?? "");
          return route && !this.dependencies.isPathAvailable(route.path);
        };
        const inFlight = transfer.chunks.reduce((count, _, index) => {
          const sentAt = transfer.sentAt.get(index);
          return count + Number(!transfer.acknowledged.has(index) && sentAt !== undefined && !routeLost(index) && now - sentAt < retryAfter(index));
        }, 0);
        const availableSlots = Math.max(0, MAX_IN_FLIGHT_CHUNKS - inFlight);
        const due = transfer.chunks.map((_, index) => index).filter((index) => !transfer.acknowledged.has(index) && (!transfer.sentAt.has(index) || routeLost(index) || now - transfer.sentAt.get(index)! >= retryAfter(index))).slice(0, availableSlots);
        if (transfer.acknowledged.size === transfer.manifest.chunkCount) {
          if (transfer.view.status !== "verifying") {
            transfer.view = { ...transfer.view, status: "verifying" };
            this.emit(transfer.view);
          }
          // Probe with only the last chunk if its completion receipt was lost.
          // A verified receiver responds idempotently with the stored digest.
          const last = transfer.manifest.chunkCount - 1;
          if (now - transfer.sentAt.get(last)! >= retryAfter(last)) due.push(last);
        }
        if (!due.length) { await delay(100); continue; }
        for (const index of due) {
          if (terminal(transfer.view.status) || this.disposed) return;
          const attempts = (transfer.attempts.get(index) ?? 0) + 1;
          if (attempts > MAX_ATTEMPTS) throw new Error(`Chunk ${index} exceeded the recovery retry limit.`);
          const path = paths[(index + attempts - 1) % paths.length]!;
          const stats = this.stats(transfer.view, path);
          stats.attemptedChunks += 1;
          stats.retries += Number(attempts > 1);
          if (attempts > 1) {
            transfer.view = { ...transfer.view, recoveryCount: transfer.view.recoveryCount + 1 };
            this.dependencies.onEvent("Missing chunk retried", `Chunk ${index + 1} · attempt ${attempts}`);
          }
          transfer.attempts.set(index, attempts);
          const routeId = createUuid();
          transfer.sentAt.set(index, performance.now());
          transfer.sends.set(routeId, { index, path, at: performance.now() });
          transfer.lastRoute.set(index, routeId);
          this.record(transfer.view, attempts > 1 ? "retry-scheduled" : "chunk-scheduled", path, index);
          transfer.view = { ...transfer.view, paths: mergePath(transfer.view.paths, path) };
          const chunk = transfer.chunks[index]!;
          try {
            await this.sendAlong(path, {
              protocolVersion: PROTOCOL_VERSION,
              kind: "transfer-chunk",
              transferId: transfer.view.id,
              sourcePeerId: this.dependencies.selfPeerId,
              destinationPeerId: transfer.view.peerId,
              routeId,
              nextHop: path[1]!,
              path,
              hopIndex: 1,
              ttl: path.length + 2,
              createdAt: Date.now(),
              chunkIndex: index,
              byteLength: chunk.byteLength,
              chunkHash: transfer.manifest.chunkHashes[index]!,
              bytes: bytesToBase64(chunk),
            });
          } catch {
            // Wait for topology updates or the bounded RTO, never spin sends.
            this.record(transfer.view, "send-failed", path, index);
          }
        }
        this.emit(transfer.view);
        await delay(12);
      }
    } catch (error) {
      this.failOutbound(transfer, error);
    } finally {
      transfer.running = false;
    }
  }

  private async finishInbound(transfer: Inbound): Promise<void> {
    transfer.view = { ...transfer.view, status: "verifying" };
    this.emit(transfer.view);
    try {
      const { bytes, hash } = await transfer.assembler.assemble();
      if (this.disposed || !transfer.accepted || transfer.view.status !== "verifying") return;
      const blob = new Blob([new Uint8Array(bytes)], { type: transfer.manifest.mime || "application/octet-stream" });
      transfer.view = { ...transfer.view, status: "verified", verifiedHash: hash, downloadUrl: URL.createObjectURL(blob), acknowledgedBytes: transfer.manifest.size, completedAt: performance.now() };
      this.record(transfer.view, "verified", transfer.lastPath);
      this.emit(transfer.view);
      await this.sendCompletion(transfer, "verified", hash).catch(() => undefined);
      this.dependencies.onEvent("File integrity verified", `${transfer.view.fileName} · SHA-256 matched · ready to save`);
    } catch (error) {
      if (this.disposed || terminal(transfer.view.status)) return;
      transfer.view = { ...transfer.view, status: "failed", error: errorMessage(error) };
      this.emit(transfer.view);
      await this.sendCompletion(transfer, "rejected", undefined, errorMessage(error));
    }
  }

  private async sendChunkAck(transfer: Inbound, packet: Extract<TransferDataPacket, { kind: "transfer-chunk" }>): Promise<void> {
    const reverse = [...packet.path].reverse();
    await this.sendAlong(reverse, {
      protocolVersion: PROTOCOL_VERSION,
      kind: "transfer-chunk-ack",
      transferId: packet.transferId,
      sourcePeerId: this.dependencies.selfPeerId,
      destinationPeerId: transfer.view.peerId,
      routeId: packet.routeId,
      nextHop: reverse[1]!,
      path: reverse,
      hopIndex: 1,
      ttl: reverse.length + 2,
      createdAt: Date.now(),
      chunkIndex: packet.chunkIndex,
      receivedAt: Date.now(),
    });
  }

  private async sendCompletion(transfer: Inbound, status: "verified" | "rejected", verifiedHash?: string, reason?: string): Promise<void> {
    const reverse = [...transfer.lastPath].reverse();
    await this.sendAlong(reverse, {
      protocolVersion: PROTOCOL_VERSION,
      kind: "transfer-complete",
      transferId: transfer.view.id,
      sourcePeerId: this.dependencies.selfPeerId,
      destinationPeerId: transfer.view.peerId,
      routeId: createUuid(),
      nextHop: reverse[1]!,
      path: reverse,
      hopIndex: 1,
      ttl: reverse.length + 2,
      createdAt: Date.now(),
      status,
      verifiedHash,
      receivedBytes: transfer.assembler.bytesReceived,
      completedAt: Date.now(),
      reason,
    });
  }

  private async forward(packet: TransferDataPacket): Promise<void> {
    const nextHop = packet.path[packet.hopIndex + 1];
    if (!nextHop || packet.ttl <= 1 || !this.dependencies.isPermittedEdge(this.dependencies.selfPeerId, nextHop)) throw new Error("No permitted next hop remains for this transfer packet.");
    await this.dependencies.send(nextHop, { ...packet, nextHop, hopIndex: packet.hopIndex + 1, ttl: packet.ttl - 1 } as TransferDataPacket);
    this.dependencies.onProtocolEvent?.({ type: "packet-forwarded", transferId: packet.transferId, at: performance.now(), path: packet.path, chunkIndex: "chunkIndex" in packet ? packet.chunkIndex : undefined, detail: packet.kind });
    this.dependencies.onEvent("Transfer packet forwarded", `${packet.kind.replace("transfer-", "")} · chunk ${"chunkIndex" in packet ? packet.chunkIndex + 1 : "control"}`);
  }

  private validHop(fromPeerId: string, packet: TransferDataPacket): boolean {
    if (this.disposed || packet.ttl < 1 || packet.hopIndex !== packet.path.indexOf(this.dependencies.selfPeerId)) return false;
    if (packet.path[0] !== packet.sourcePeerId || packet.path.at(-1) !== packet.destinationPeerId) return false;
    if (new Set(packet.path).size !== packet.path.length) return false;
    if (packet.path[packet.hopIndex] !== this.dependencies.selfPeerId || packet.nextHop !== this.dependencies.selfPeerId) return false;
    return packet.path[packet.hopIndex - 1] === fromPeerId && this.dependencies.isPermittedEdge(fromPeerId, this.dependencies.selfPeerId);
  }

  private validPaths(destinationPeerId: string): string[][] {
    const paths = this.dependencies.getPaths(destinationPeerId).filter((path) => path[0] === this.dependencies.selfPeerId && path.at(-1) === destinationPeerId && path.length >= 2 && path.length <= 8);
    if (!paths.length) throw new Error("No established WebRTC route is available for this transfer.");
    return paths.slice(0, 2);
  }

  private async sendAlong(path: string[], packet: TransferDataPacket): Promise<void> {
    const nextHop = path[1];
    if (!nextHop || !this.dependencies.isPermittedEdge(this.dependencies.selfPeerId, nextHop)) throw new Error("The first transfer hop is unavailable.");
    await this.dependencies.send(nextHop, await this.dependencies.sign(packet));
  }

  private failOutbound(transfer: Outbound, error: unknown): void {
    if (terminal(transfer.view.status) || this.disposed) return;
    transfer.view = { ...transfer.view, status: "failed", error: errorMessage(error) };
    this.record(transfer.view, "failed");
    transfer.chunks = undefined;
    this.emit(transfer.view);
    this.dependencies.onEvent("File transfer failed", transfer.view.error!);
  }

  private stats(view: TransferView, path: string[]): PathAccounting {
    view.pathStats ??= [];
    let stats = view.pathStats.find((item) => item.path.join() === path.join());
    if (!stats) { stats = { path: [...path], attemptedChunks: 0, acknowledgedChunks: 0, deliveredBytes: 0, retries: 0, failures: 0 }; view.pathStats.push(stats); }
    return stats;
  }

  private record(view: TransferView, type: string, path?: string[], chunkIndex?: number): void {
    const event: TransferEvent = { type, transferId: view.id, at: performance.now(), path, chunkIndex };
    view.history = [...(view.history ?? []), event].slice(-4096);
    this.dependencies.onProtocolEvent?.(event);
  }

  private reserve(): void {
    const all = [...this.outbound.values(), ...this.inbound.values()];
    if (this.disposed || all.filter((item) => !terminal(item.view.status)).length >= 2) throw new Error("At most two active transfers are allowed on this device.");
    for (const item of all.filter((item) => terminal(item.view.status)).slice(0, Math.max(0, all.length - 10))) {
      if (item.view.downloadUrl) URL.revokeObjectURL(item.view.downloadUrl);
      this.inbound.delete(item.view.id); this.outbound.delete(item.view.id);
    }
  }

  async cancel(transferId: string): Promise<void> {
    const transfer = this.outbound.get(transferId) ?? this.inbound.get(transferId);
    if (!transfer || terminal(transfer.view.status)) return;
    transfer.view = { ...transfer.view, status: "cancelled", error: "Cancelled on this device." };
    if ("accepted" in transfer) { transfer.accepted = false; transfer.assembler.discard(); }
    else { transfer.chunks = undefined; transfer.sends.clear(); transfer.lastRoute.clear(); transfer.sentAt.clear(); transfer.attempts.clear(); }
    this.record(transfer.view, "cancelled"); this.emit(transfer.view);
    try {
      const path = this.validPaths(transfer.view.peerId)[0]!;
      await this.sendAlong(path, { protocolVersion: PROTOCOL_VERSION, kind: "transfer-cancel", transferId, sourcePeerId: this.dependencies.selfPeerId, destinationPeerId: transfer.view.peerId, routeId: createUuid(), nextHop: path[1]!, path, hopIndex: 1, ttl: path.length + 2, createdAt: Date.now() });
    } catch (error) {
      transfer.view = { ...transfer.view, error: "Cancelled locally. Remote notification unavailable; cancel on the other device too if it is still waiting." };
      this.record(transfer.view, "cancel-notification-unavailable"); this.emit(transfer.view);
      this.dependencies.onEvent("Cancellation notification unavailable", errorMessage(error));
    }
  }

  dispose(): void {
    this.disposed = true;
    clearInterval(this.cleanupTimer);
    clearTimeout(this.updateTimer);
    this.pendingViews.clear();
    for (const item of this.inbound.values()) if (item.view.downloadUrl) URL.revokeObjectURL(item.view.downloadUrl);
    this.inbound.clear(); this.outbound.clear();
  }

  private emit(view: TransferView): void {
    if (this.disposed) return;
    if (view.status !== "transferring") {
      this.pendingViews.delete(view.id);
      this.dependencies.onUpdate(structuredClone(view));
      return;
    }
    this.pendingViews.set(view.id, view);
    if (this.updateTimer !== undefined) return;
    this.updateTimer = setTimeout(() => {
      this.updateTimer = undefined;
      for (const pending of this.pendingViews.values()) this.dependencies.onUpdate(structuredClone(pending));
      this.pendingViews.clear();
    }, 100);
  }
}

function mergePath(paths: string[][], path: string[]): string[][] {
  const key = path.join("\u0000");
  return paths.some((item) => item.join("\u0000") === key) ? paths : [...paths, [...path]];
}

function acknowledgedBytes(manifest: TransferManifest, indexes: Set<number>): number {
  let total = 0;
  for (const index of indexes) total += index === manifest.chunkCount - 1 ? manifest.size - manifest.chunkSize * index : manifest.chunkSize;
  return total;
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : "Unknown transfer error."; }
function delay(milliseconds: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
