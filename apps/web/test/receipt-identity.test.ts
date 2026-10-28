import assert from "node:assert/strict";
import test from "node:test";
import { dataPacketSchema, type TransferDataPacket } from "@hopnet/protocol";
import { createReceiptIdentity, verifyTransferPacket } from "../src/lib/receipt-identity.ts";

test("a relay cannot forge or modify an endpoint receipt; forwarding fields may change", async () => {
  const receiver = await createReceiptIdentity(); const relay = await createReceiptIdentity();
  const packet: TransferDataPacket = { protocolVersion: 1, kind: "transfer-complete", transferId: crypto.randomUUID(), routeId: crypto.randomUUID(), sourcePeerId: "receiver", destinationPeerId: "sender", path: ["receiver", "relay", "sender"], nextHop: "relay", hopIndex: 1, ttl: 5, createdAt: 100, status: "verified", verifiedHash: "a".repeat(64), receivedBytes: 100, completedAt: 110 };
  const signed = await receiver.sign(packet);
  const parsed = dataPacketSchema.parse(signed) as TransferDataPacket;
  assert.equal(await verifyTransferPacket(receiver.publicKey, parsed), true);
  assert.equal(await verifyTransferPacket(receiver.publicKey, { ...parsed, hopIndex: 2, nextHop: "sender", ttl: 4 }), true);
  assert.equal(await verifyTransferPacket(relay.publicKey, parsed), false);
  assert.equal(await verifyTransferPacket(receiver.publicKey, { ...parsed, sourcePeerId: "relay" }), false);
  assert.equal(await verifyTransferPacket(receiver.publicKey, { ...parsed, path: ["receiver", "evil", "sender"] }), false);
  assert.equal(await verifyTransferPacket(receiver.publicKey, { ...packet, status: "rejected" }), false);
});
