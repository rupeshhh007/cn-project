import type { OverlayLink, Peer, TopologyEdge } from "@hopnet/protocol";
import type { TransferView } from "./transfer-manager.ts";

export type NetworkEvent = {
  id: string; at: Date; monotonicMs: number; type: string; title: string; detail: string;
  provenance: "REAL" | "EMULATED" | "INFERRED";
  transferId?: string; experimentId?: string; path?: string[]; chunkIndex?: number;
  snapshot: { peers: Pick<Peer, "id" | "displayName" | "deviceCategory" | "coordinatorConnected">[]; edges: TopologyEdge[]; links: OverlayLink[] };
};

export type ExperimentConfig = { preset: "direct-overlay" | "single-multipath" | "relay-recovery"; mode: "direct" | "single-overlay" | "multipath"; strategy: string; peerId: string };
export type Experiment = ExperimentConfig & { id: string; transferId?: string; createdAt: number; faultAt?: number; failedPeerId?: string; error?: string; result?: TransferView };

export function experimentResult(experiment: Experiment, transfer?: TransferView) {
  const events = transfer?.history ?? [];
  const first = (type: string) => events.find((event) => event.type === type)?.at;
  const faultDetection = events.find((event) => event.type === "path-unavailable" && event.at >= (experiment.faultAt ?? Infinity))?.at;
  const recovered = events.find((event) => event.type === "receiver-ack" && event.at >= (faultDetection ?? Infinity))?.at;
  const delta = (end?: number, start?: number) => end !== undefined && start !== undefined ? Math.max(0, end - start) : null;
  const elapsed = delta(transfer?.completedAt, transfer?.startedAt);
  const acknowledgements = transfer?.pathStats?.reduce((sum, path) => sum + path.acknowledgedChunks, 0) ?? 0;
  return {
    schemaVersion: 1, provenance: "LOCAL BROWSER OBSERVATIONS", experiment,
    status: transfer?.status ?? (experiment.error ? "failed" : "preparing"),
    payloadBytes: transfer?.size ?? 0, chunkCount: transfer?.totalChunks ?? 0,
    receiverAcknowledgedBytes: transfer?.acknowledgedBytes ?? 0, receiverAcknowledgedChunks: transfer?.acknowledgedChunks ?? 0,
    individuallyObservedChunkAcks: acknowledgements,
    attempts: transfer?.pathStats?.reduce((sum, path) => sum + path.attemptedChunks, 0) ?? 0,
    retries: transfer?.pathStats?.reduce((sum, path) => sum + path.retries, 0) ?? 0,
    elapsedMs: elapsed, payloadBytesPerSecond: elapsed && transfer?.status === "verified" ? transfer.size / (elapsed / 1000) : null,
    failureDetectionMs: delta(faultDetection, experiment.faultAt), recoveryMs: delta(recovered, experiment.faultAt),
    observedAckGapMs: experiment.faultAt === undefined ? null : (() => {
      const last = events.filter((event) => event.type === "receiver-ack" && event.at <= experiment.faultAt!).at(-1)?.at;
      return delta(recovered, last);
    })(),
    offeredAtMs: first("offer") ?? null, acceptedAtMs: first("accepted") ?? null,
    completedAtMs: transfer?.completedAt ?? null, verifiedHash: transfer?.verifiedHash ?? null,
    pathStats: transfer?.pathStats ?? [], pathHistory: events, error: transfer?.error ?? experiment.error ?? null,
    limitations: "Sender-local monotonic time. ACK latency includes forwarding, hashing and browser scheduling. Fault timing is an application-level command, not physical Wi-Fi failure. Receiver byte evidence is reported by its authenticated overlay receipt; remote wall clocks are not subtracted.",
  };
}

export function resultsCsv(rows: ReturnType<typeof experimentResult>[]): string {
  const keys = ["status", "payloadBytes", "chunkCount", "receiverAcknowledgedBytes", "receiverAcknowledgedChunks", "attempts", "retries", "elapsedMs", "payloadBytesPerSecond", "failureDetectionMs", "recoveryMs", "observedAckGapMs", "verifiedHash"] as const;
  const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return [ ["experimentId", "preset", "mode", "strategy", ...keys].map(escape).join(","), ...rows.map((row) => [row.experiment.id, row.experiment.preset, row.experiment.mode, row.experiment.strategy, ...keys.map((key) => row[key])].map(escape).join(",")) ].join("\r\n");
}

export function exportFile(name: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
