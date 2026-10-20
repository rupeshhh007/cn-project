import type { TransferDataPacket } from "@hopnet/protocol";
import { base64ToBytes, bytesToBase64 } from "@hopnet/transfer";

// Hop-local forwarding fields change at every relay; all endpoint-owned fields,
// including the full route, chunk digest, consent and result, are authenticated.
function signedBytes(packet: TransferDataPacket): Uint8Array<ArrayBuffer> {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)])) : value;
  const { signature: _signature, hopIndex: _hopIndex, nextHop: _nextHop, ttl: _ttl, ...immutable } = packet;
  return new TextEncoder().encode(JSON.stringify(canonical(immutable)));
}

export async function createReceiptIdentity() {
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  const publicKey = bytesToBase64(new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey)));
  return { publicKey, sign: async (packet: TransferDataPacket): Promise<TransferDataPacket> => ({ ...packet, signature: bytesToBase64(new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.privateKey, signedBytes(packet)))) }) };
}

const imported = new Map<string, Promise<CryptoKey>>();
export async function verifyTransferPacket(publicKey: string | undefined, packet: TransferDataPacket): Promise<boolean> {
  if (!publicKey || !packet.signature || !crypto.subtle) return false;
  try {
    if (!imported.has(publicKey)) {
      if (imported.size >= 32) imported.delete(imported.keys().next().value!);
      const raw = new Uint8Array(base64ToBytes(publicKey));
      imported.set(publicKey, crypto.subtle.importKey("raw", raw, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]));
    }
    return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, await imported.get(publicKey)!, new Uint8Array(base64ToBytes(packet.signature)), signedBytes(packet));
  } catch { return false; }
}
