import { z } from "zod";

export const PROTOCOL_VERSION = 1 as const;
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

export const deviceCategorySchema = z.enum(["laptop", "phone", "tablet", "other"]);
export type DeviceCategory = z.infer<typeof deviceCategorySchema>;

export const peerSchema = z.object({
  id: z.string().min(8).max(80),
  displayName: z.string().min(1).max(40),
  deviceCategory: deviceCategorySchema,
  role: z.enum(["host", "participant"]),
  coordinatorConnected: z.boolean(),
  joinedAt: z.string().datetime(),
});
export type Peer = z.infer<typeof peerSchema>;

export const topologyEdgeSchema = z.object({
  a: z.string().min(8).max(80),
  b: z.string().min(8).max(80),
});
export type TopologyEdge = z.infer<typeof topologyEdgeSchema>;

export const overlayLinkSchema = topologyEdgeSchema.extend({
  state: z.enum(["connecting", "direct", "degraded", "closed"]),
  reportedByPeerId: z.string(),
  rttMs: z.number().nonnegative().optional(),
  updatedAt: z.number().finite(),
});
export type OverlayLink = z.infer<typeof overlayLinkSchema>;

const rtcSignalSchema = z.object({
  description: z
    .object({ type: z.enum(["offer", "answer", "pranswer", "rollback"]), sdp: z.string().optional() })
    .optional(),
  candidate: z
    .object({
      candidate: z.string(),
      sdpMid: z.string().nullable().optional(),
      sdpMLineIndex: z.number().int().nullable().optional(),
      usernameFragment: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});
export type RtcSignal = z.infer<typeof rtcSignalSchema>;

export const clientSocketMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("signal"), targetPeerId: z.string(), signal: rtcSignalSchema }),
  z.object({
    type: z.literal("relay-data"),
    targetPeerId: z.string(),
    payload: z.string().max(65_536),
  }),
  z.object({ type: z.literal("heartbeat"), sentAt: z.number().finite() }),
  z.object({ type: z.literal("set-topology"), edges: z.array(topologyEdgeSchema).max(20) }),
  z.object({
    type: z.literal("link-state"),
    peerId: z.string(),
    state: z.enum(["connecting", "direct", "degraded", "closed"]),
    rttMs: z.number().nonnegative().optional(),
  }),
]);
export type ClientSocketMessage = z.infer<typeof clientSocketMessageSchema>;

export const serverSocketMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("room-snapshot"), selfPeerId: z.string(), peers: z.array(peerSchema), edges: z.array(topologyEdgeSchema), links: z.array(overlayLinkSchema) }),
  z.object({ type: z.literal("peer-joined"), peer: peerSchema }),
  z.object({ type: z.literal("peer-left"), peerId: z.string() }),
  z.object({ type: z.literal("join-requested"), requestId: z.string(), displayName: z.string(), deviceCategory: deviceCategorySchema }),
  z.object({ type: z.literal("signal"), sourcePeerId: z.string(), signal: rtcSignalSchema }),
  z.object({ type: z.literal("relay-data"), sourcePeerId: z.string(), payload: z.string() }),
  z.object({ type: z.literal("heartbeat-ack"), sentAt: z.number(), coordinatorAt: z.number() }),
  z.object({ type: z.literal("topology-updated"), edges: z.array(topologyEdgeSchema), changedByPeerId: z.string() }),
  z.object({ type: z.literal("link-state-updated"), link: overlayLinkSchema }),
  z.object({ type: z.literal("error"), code: z.string(), message: z.string() }),
]);
export type ServerSocketMessage = z.infer<typeof serverSocketMessageSchema>;

export const dataPacketSchema = z.discriminatedUnion("kind", [
  z.object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    kind: z.literal("ping"),
    messageId: z.string().uuid(),
    sentAt: z.number().finite(),
  }),
  z.object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    kind: z.literal("pong"),
    messageId: z.string().uuid(),
    sentAt: z.number().finite(),
    echoedAt: z.number().finite(),
  }),
  z.object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    kind: z.literal("message"),
    messageId: z.string().uuid(),
    sentAt: z.number().finite(),
    body: z.string().min(1).max(8_192),
  }),
  z.object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    kind: z.literal("message-ack"),
    messageId: z.string().uuid(),
    receivedAt: z.number().finite(),
  }),
  z.object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    kind: z.literal("routed-message"),
    messageId: z.string().uuid(),
    sourcePeerId: z.string(),
    destinationPeerId: z.string(),
    routeId: z.string().uuid(),
    nextHop: z.string(),
    path: z.array(z.string()).min(2).max(8),
    hopIndex: z.number().int().min(1).max(7),
    ttl: z.number().int().min(1).max(16),
    createdAt: z.number().finite(),
    payloadType: z.literal("text"),
    body: z.string().min(1).max(8_192),
  }),
  z.object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    kind: z.literal("route-receipt"),
    messageId: z.string().uuid(),
    sourcePeerId: z.string(),
    destinationPeerId: z.string(),
    routeId: z.string().uuid(),
    nextHop: z.string(),
    path: z.array(z.string()).min(2).max(8),
    hopIndex: z.number().int().min(1).max(7),
    ttl: z.number().int().min(1).max(16),
    createdAt: z.number().finite(),
    status: z.literal("delivered"),
  }),
  z.object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    kind: z.literal("transfer-offer"),
    transferId: z.string().uuid(),
    sourcePeerId: z.string(),
    destinationPeerId: z.string(),
    routeId: z.string().uuid(),
    nextHop: z.string(),
    path: z.array(z.string()).min(2).max(8),
    hopIndex: z.number().int().min(1).max(7),
    ttl: z.number().int().min(1).max(16),
    createdAt: z.number().finite(),
    manifest: z.object({
      name: z.string().min(1).max(180),
      mime: z.string().max(120),
      size: z.number().int().min(1).max(32 * 1024 * 1024),
      chunkSize: z.number().int().min(1).max(16 * 1024),
      chunkCount: z.number().int().min(1).max(2_731),
      fileHash: sha256Schema,
      chunkHashes: z.array(sha256Schema).min(1).max(2_731),
    }),
  }),
  z.object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    kind: z.literal("transfer-response"),
    transferId: z.string().uuid(),
    sourcePeerId: z.string(),
    destinationPeerId: z.string(),
    routeId: z.string().uuid(),
    nextHop: z.string(),
    path: z.array(z.string()).min(2).max(8),
    hopIndex: z.number().int().min(1).max(7),
    ttl: z.number().int().min(1).max(16),
    createdAt: z.number().finite(),
    accepted: z.boolean(),
    reason: z.string().max(160).optional(),
  }),
  z.object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    kind: z.literal("transfer-chunk"),
    transferId: z.string().uuid(),
    sourcePeerId: z.string(),
    destinationPeerId: z.string(),
    routeId: z.string().uuid(),
    nextHop: z.string(),
    path: z.array(z.string()).min(2).max(8),
    hopIndex: z.number().int().min(1).max(7),
    ttl: z.number().int().min(1).max(16),
    createdAt: z.number().finite(),
    chunkIndex: z.number().int().min(0).max(2_730),
    byteLength: z.number().int().min(1).max(16 * 1024),
    chunkHash: sha256Schema,
    bytes: z.string().min(1).max(22_000),
  }),
  z.object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    kind: z.literal("transfer-chunk-ack"),
    transferId: z.string().uuid(),
    sourcePeerId: z.string(),
    destinationPeerId: z.string(),
    routeId: z.string().uuid(),
    nextHop: z.string(),
    path: z.array(z.string()).min(2).max(8),
    hopIndex: z.number().int().min(1).max(7),
    ttl: z.number().int().min(1).max(16),
    createdAt: z.number().finite(),
    chunkIndex: z.number().int().min(0).max(2_730),
    receivedAt: z.number().finite(),
  }),
  z.object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    kind: z.literal("transfer-complete"),
    transferId: z.string().uuid(),
    sourcePeerId: z.string(),
    destinationPeerId: z.string(),
    routeId: z.string().uuid(),
    nextHop: z.string(),
    path: z.array(z.string()).min(2).max(8),
    hopIndex: z.number().int().min(1).max(7),
    ttl: z.number().int().min(1).max(16),
    createdAt: z.number().finite(),
    status: z.enum(["verified", "rejected"]),
    verifiedHash: sha256Schema.optional(),
    receivedBytes: z.number().int().nonnegative().max(32 * 1024 * 1024),
    completedAt: z.number().finite(),
    reason: z.string().max(160).optional(),
  }),
]);
export type DataPacket = z.infer<typeof dataPacketSchema>;
export type TransferDataPacket = Extract<DataPacket, { kind: `transfer-${string}` }>;

export function safeDisplayName(value: string): string {
  return value.replace(/[\u0000-\u001F\u007F<>]/g, "").trim().slice(0, 40);
}
