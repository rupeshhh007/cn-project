import assert from "node:assert/strict";
import test from "node:test";
import { clientSocketMessageSchema, dataPacketSchema, safeDisplayName } from "../src/index.ts";

test("rejects oversized explicit relay payloads", () => {
  const result = clientSocketMessageSchema.safeParse({
    type: "relay-data",
    targetPeerId: "peer-12345678",
    payload: "x".repeat(65_537),
  });
  assert.equal(result.success, false);
});

test("rejects data packets from a different protocol version", () => {
  const result = dataPacketSchema.safeParse({
    protocolVersion: 2,
    kind: "ping",
    messageId: crypto.randomUUID(),
    sentAt: 1,
  });
  assert.equal(result.success, false);
});

test("accepts application delivery acknowledgements", () => {
  const result = dataPacketSchema.safeParse({
    protocolVersion: 1,
    kind: "message-ack",
    messageId: crypto.randomUUID(),
    receivedAt: Date.now(),
  });
  assert.equal(result.success, true);
});

test("validates transfer chunk size, hash, and bounded encoding fields", () => {
  const valid = {
    protocolVersion: 1,
    kind: "transfer-chunk",
    transferId: crypto.randomUUID(),
    sourcePeerId: "peer-source-123",
    destinationPeerId: "peer-destination-456",
    routeId: crypto.randomUUID(),
    nextHop: "peer-relay-789",
    path: ["peer-source-123", "peer-relay-789", "peer-destination-456"],
    hopIndex: 1,
    ttl: 5,
    createdAt: Date.now(),
    chunkIndex: 0,
    byteLength: 3,
    chunkHash: "a".repeat(64),
    bytes: "YWJj",
  };
  assert.equal(dataPacketSchema.safeParse(valid).success, true);
  assert.equal(dataPacketSchema.safeParse({ ...valid, bytes: "x".repeat(22_001) }).success, false);
  assert.equal(dataPacketSchema.safeParse({ ...valid, chunkHash: "nope" }).success, false);
});

test("sanitizes untrusted display labels", () => {
  assert.equal(safeDisplayName("  <Phone>\nA  "), "PhoneA");
});
