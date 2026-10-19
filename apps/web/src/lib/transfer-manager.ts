import { PROTOCOL_VERSION, type TransferDataPacket } from "@hopnet/protocol";
import { TransferAssembler, base64ToBytes, bytesToBase64, createManifest, type TransferManifest } from "@hopnet/transfer";
import { createUuid } from "./id.ts";

export type TransferStatus = "preparing" | "offered" | "awaiting-acceptance" | "transferring" | "verifying" | "verified" | "declined" | "failed";

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
};

type Outbound = {
  view: TransferView;
  manifest?: TransferManifest;
  chunks?: Uint8Array[];
  acknowledged: Set<number>;
  attempts: Map<number, number>;
  sentAt: Map<number, number>;
  running: boolean;
};

type Inbound = {
  view: TransferView;
  manifest: TransferManifest;
  assembler: TransferAssembler;
  accepted: boolean;
  offerPath: string[];
  lastPath: string[];
};

type Dependencies = {
  selfPeerId: string;
  getPaths: (destinationPeerId: string) => string[][];
  isPermittedEdge: (a: string, b: string) => boolean;
  send: (nextHop: string, packet: TransferDataPacket) => Promise<void>;
  onUpdate: (transfer: TransferView) => void;
  onEvent: (title: string, detail: string) => void;
};

const RETRY_AFTER_MS = 1_400;
const MAX_ATTEMPTS = 8;
const TRANSFER_TIMEOUT_MS = 90_000;

export class TransferManager {
  private readonly outbound = new Map<string, Outbound>();
  private readonly inbound = new Map<string, Inbound>();

  constructor(private readonly dependencies: Dependencies) {}

  async offer(file: File, destinationPeerId: string): Promise<string> {
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
    };
    const transfer: Outbound = { view, acknowledged: new Set(), attempts: new Map(), sentAt: new Map(), running: false };
    this.outbound.set(transferId, transfer);
    this.emit(view);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { manifest, chunks } = await createManifest(file.name, file.type, bytes);
      const paths = this.validPaths(destinationPeerId);
      transfer.manifest = manifest;
      transfer.chunks = chunks;
      transfer.view = { ...view, fileName: manifest.name, mime: manifest.mime, size: manifest.size, totalChunks: manifest.chunkCount, status: "offered", paths };
      this.emit(transfer.view);
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
    const transfer = this.inbound.get(transferId);
    if (!transfer || transfer.view.status !== "awaiting-acceptance") throw new Error("This transfer offer is no longer pending.");
    transfer.accepted = accepted;
    transfer.view = { ...transfer.view, status: accepted ? "transferring" : "declined" };
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
    if (packet.kind === "transfer-offer") return this.receiveOffer(packet);
    if (packet.kind === "transfer-response") return this.receiveResponse(packet);
    if (packet.kind === "transfer-chunk") return this.receiveChunk(packet);
    if (packet.kind === "transfer-chunk-ack") return this.receiveAck(packet);
    if (packet.kind === "transfer-complete") return this.receiveComplete(packet);
  }

  private receiveOffer(packet: Extract<TransferDataPacket, { kind: "transfer-offer" }>): void {
    if (this.inbound.has(packet.transferId)) return;
    try {
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
      };
      this.inbound.set(packet.transferId, { view, manifest: packet.manifest, assembler, accepted: false, offerPath: packet.path, lastPath: packet.path });
      this.emit(view);
      this.dependencies.onEvent("Incoming file offer", `${packet.manifest.name} · ${formatBytes(packet.manifest.size)} · consent required`);
    } catch (error) {
      this.dependencies.onEvent("File offer rejected", errorMessage(error));
    }
  }

  private receiveResponse(packet: Extract<TransferDataPacket, { kind: "transfer-response" }>): void {
    const transfer = this.outbound.get(packet.transferId);
    if (!transfer || transfer.view.peerId !== packet.sourcePeerId || transfer.view.status !== "offered") return;
    if (!packet.accepted) {
      transfer.view = { ...transfer.view, status: "declined", error: packet.reason ?? "Receiver declined the transfer." };
      this.emit(transfer.view);
      this.dependencies.onEvent("File offer declined", transfer.view.fileName);
      return;
    }
    transfer.view = { ...transfer.view, status: "transferring" };
    this.emit(transfer.view);
    this.dependencies.onEvent("Verified transfer started", `${transfer.view.fileName} · receiver accepted`);
    void this.pump(transfer);
  }

  private async receiveChunk(packet: Extract<TransferDataPacket, { kind: "transfer-chunk" }>): Promise<void> {
    const transfer = this.inbound.get(packet.transferId);
    if (!transfer || !transfer.accepted || packet.sourcePeerId !== transfer.view.peerId) return;
    try {
      const bytes = base64ToBytes(packet.bytes);
      if (bytes.byteLength !== packet.byteLength) throw new Error("Encoded chunk length is invalid.");
      await transfer.assembler.add(packet.chunkIndex, bytes, packet.chunkHash);
      transfer.lastPath = packet.path;
      transfer.view = {
        ...transfer.view,
        acknowledgedChunks: transfer.assembler.receivedCount,
        acknowledgedBytes: transfer.assembler.bytesReceived,
        paths: mergePath(transfer.view.paths, packet.path),
      };
      this.emit(transfer.view);
      await this.sendChunkAck(transfer, packet);
      if (transfer.assembler.complete && transfer.view.status !== "verifying" && transfer.view.status !== "verified") await this.finishInbound(transfer);
    } catch (error) {
      transfer.view = { ...transfer.view, status: "failed", error: errorMessage(error) };
      this.emit(transfer.view);
      await this.sendCompletion(transfer, "rejected", undefined, errorMessage(error));
    }
  }

  private receiveAck(packet: Extract<TransferDataPacket, { kind: "transfer-chunk-ack" }>): void {
    const transfer = this.outbound.get(packet.transferId);
    if (!transfer?.manifest || transfer.view.status === "verified" || packet.sourcePeerId !== transfer.view.peerId || packet.chunkIndex >= transfer.manifest.chunkCount) return;
    transfer.acknowledged.add(packet.chunkIndex);
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
    if (!transfer?.manifest || packet.sourcePeerId !== transfer.view.peerId) return;
    const verified = packet.status === "verified" && packet.verifiedHash === transfer.manifest.fileHash && packet.receivedBytes === transfer.manifest.size;
    if (verified) for (let index = 0; index < transfer.manifest.chunkCount; index += 1) transfer.acknowledged.add(index);
    transfer.view = {
      ...transfer.view,
      status: verified ? "verified" : "failed",
      acknowledgedChunks: verified ? transfer.manifest.chunkCount : transfer.acknowledged.size,
      acknowledgedBytes: verified ? transfer.manifest.size : acknowledgedBytes(transfer.manifest, transfer.acknowledged),
      verifiedHash: verified ? packet.verifiedHash : undefined,
      error: verified ? undefined : packet.reason ?? "Receiver did not verify the file.",
    };
    this.emit(transfer.view);
    this.dependencies.onEvent(verified ? "File integrity verified" : "File verification failed", verified ? `${transfer.view.fileName} · receiver SHA-256 matched` : transfer.view.error!);
  }

  private async pump(transfer: Outbound): Promise<void> {
    if (transfer.running || !transfer.manifest || !transfer.chunks) return;
    transfer.running = true;
    const startedAt = Date.now();
    try {
      while (transfer.acknowledged.size < transfer.manifest.chunkCount) {
        if (Date.now() - startedAt > TRANSFER_TIMEOUT_MS) throw new Error("Transfer timed out before all receiver acknowledgements arrived.");
        let paths: string[][];
        try {
          paths = this.validPaths(transfer.view.peerId);
        } catch {
          await delay(250);
          continue;
        }
        const due = transfer.chunks.map((_, index) => index).filter((index) => !transfer.acknowledged.has(index) && Date.now() - (transfer.sentAt.get(index) ?? 0) >= RETRY_AFTER_MS).slice(0, 8);
        if (!due.length) { await delay(100); continue; }
        for (const index of due) {
          const attempts = (transfer.attempts.get(index) ?? 0) + 1;
          if (attempts > MAX_ATTEMPTS) throw new Error(`Chunk ${index} exceeded the recovery retry limit.`);
          const path = paths[(index + attempts - 1) % paths.length]!;
          if (attempts > 1) {
            transfer.view = { ...transfer.view, recoveryCount: transfer.view.recoveryCount + 1 };
            this.dependencies.onEvent("Missing chunk retried", `Chunk ${index + 1} · attempt ${attempts}`);
          }
          transfer.attempts.set(index, attempts);
          transfer.sentAt.set(index, Date.now());
          transfer.view = { ...transfer.view, paths: mergePath(transfer.view.paths, path) };
          const chunk = transfer.chunks[index]!;
          try {
            await this.sendAlong(path, {
              protocolVersion: PROTOCOL_VERSION,
              kind: "transfer-chunk",
              transferId: transfer.view.id,
              sourcePeerId: this.dependencies.selfPeerId,
              destinationPeerId: transfer.view.peerId,
              routeId: createUuid(),
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
            transfer.sentAt.set(index, Date.now() - RETRY_AFTER_MS + 500);
          }
        }
        this.emit(transfer.view);
        await delay(12);
      }
      if (transfer.view.status === "verified") return;
      transfer.view = { ...transfer.view, status: "verifying", acknowledgedBytes: transfer.manifest.size };
      this.emit(transfer.view);
      this.dependencies.onEvent("All chunks acknowledged", `${transfer.view.fileName} · waiting for whole-file SHA-256`);
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
      const blob = new Blob([new Uint8Array(bytes)], { type: transfer.manifest.mime || "application/octet-stream" });
      transfer.view = { ...transfer.view, status: "verified", verifiedHash: hash, downloadUrl: URL.createObjectURL(blob), acknowledgedBytes: transfer.manifest.size };
      this.emit(transfer.view);
      await this.sendCompletion(transfer, "verified", hash);
      this.dependencies.onEvent("File integrity verified", `${transfer.view.fileName} · SHA-256 matched · ready to save`);
    } catch (error) {
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
      routeId: createUuid(),
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
    this.dependencies.onEvent("Transfer packet forwarded", `${packet.kind.replace("transfer-", "")} · chunk ${"chunkIndex" in packet ? packet.chunkIndex + 1 : "control"}`);
  }

  private validHop(fromPeerId: string, packet: TransferDataPacket): boolean {
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
    await this.dependencies.send(nextHop, packet);
  }

  private failOutbound(transfer: Outbound, error: unknown): void {
    transfer.view = { ...transfer.view, status: "failed", error: errorMessage(error) };
    this.emit(transfer.view);
    this.dependencies.onEvent("File transfer failed", transfer.view.error!);
  }

  private emit(view: TransferView): void { this.dependencies.onUpdate({ ...view, paths: view.paths.map((path) => [...path]) }); }
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
function delay(milliseconds: number): Promise<void> { return new Promise((resolve) => window.setTimeout(resolve, milliseconds)); }
