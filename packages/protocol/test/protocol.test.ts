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

test("sanitizes untrusted display labels", () => {
  assert.equal(safeDisplayName("  <Phone>\nA  "), "PhoneA");
});
