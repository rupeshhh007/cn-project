import { z } from "zod";

export const PROTOCOL_VERSION = 1 as const;

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
]);
export type ClientSocketMessage = z.infer<typeof clientSocketMessageSchema>;

export const serverSocketMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("room-snapshot"), selfPeerId: z.string(), peers: z.array(peerSchema) }),
  z.object({ type: z.literal("peer-joined"), peer: peerSchema }),
  z.object({ type: z.literal("peer-left"), peerId: z.string() }),
  z.object({ type: z.literal("join-requested"), requestId: z.string(), displayName: z.string(), deviceCategory: deviceCategorySchema }),
  z.object({ type: z.literal("signal"), sourcePeerId: z.string(), signal: rtcSignalSchema }),
  z.object({ type: z.literal("relay-data"), sourcePeerId: z.string(), payload: z.string() }),
  z.object({ type: z.literal("heartbeat-ack"), sentAt: z.number(), coordinatorAt: z.number() }),
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
]);
export type DataPacket = z.infer<typeof dataPacketSchema>;

export function safeDisplayName(value: string): string {
  return value.replace(/[\u0000-\u001F\u007F<>]/g, "").trim().slice(0, 40);
}
