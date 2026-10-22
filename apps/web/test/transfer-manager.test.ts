import assert from "node:assert/strict";
import test from "node:test";
import type { TransferDataPacket } from "@hopnet/protocol";
import { TransferManager, type TransferView } from "../src/lib/transfer-manager.ts";
import { experimentResult, resultsCsv } from "../src/lib/evidence.ts";
import { createReceiptIdentity, verifyTransferPacket } from "../src/lib/receipt-identity.ts";

async function waitFor(predicate: () => boolean, timeout = 5000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeout) throw new Error("Protocol condition was not reached.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function pair(intercept?: (packet: TransferDataPacket) => boolean, identities?: Record<string, Awaited<ReturnType<typeof createReceiptIdentity>>>) {
  const views = new Map<string, TransferView>();
  const packets: TransferDataPacket[] = [];
  let available = true;
  let sender: TransferManager, receiver: TransferManager;
  const options = (self: string, other: string) => ({
    selfPeerId: self, getPaths: () => available ? [[self, other]] : [], isPermittedEdge: () => true,
    sign: async (packet: TransferDataPacket) => identities ? identities[self]!.sign(packet) : packet,
    verify: async (packet: TransferDataPacket) => identities ? verifyTransferPacket(identities[other]!.publicKey,packet) : true, canOfferTo: () => true, isPathAvailable: () => available,
    onUpdate: (view: TransferView) => views.set(`${self}:${view.id}`, view), onEvent: () => {},
    send: async (_next: string, packet: TransferDataPacket) => {
      packets.push(packet);
      if (intercept?.(packet)) return;
      await (self === "A" ? receiver : sender).handle(self, packet);
    },
  });
  sender = new TransferManager(options("A", "B")); receiver = new TransferManager(options("B", "A"));
  return { sender, receiver, views, packets, setAvailable: (value: boolean) => { available = value; }, close: () => { sender.dispose(); receiver.dispose(); } };
}

test("a lost completion receipt is recovered by an idempotent final-chunk probe", async (t) => {
  let drop = true;
  const network = pair((packet) => packet.kind === "transfer-complete" && drop && !(drop = false));
  t.after(network.close);
  const id = await network.sender.offer(new File(["actual test bytes"], "receipt.txt"), "B");
  await network.receiver.respond(id, true);
  await waitFor(() => network.views.get(`A:${id}`)?.status === "verified");
  assert.equal(network.views.get(`A:${id}`)?.acknowledgedChunks, 1);
  assert.equal(network.views.get(`B:${id}`)?.duplicateChunks, 1);
  assert.equal(network.packets.filter((packet) => packet.kind === "transfer-chunk").length, 2);
});

test("receiver capacity rejection is signed, releases the sender slot, and sends no chunks", async (t) => {
  const identities = { A:await createReceiptIdentity(),B:await createReceiptIdentity() };
  const network = pair((packet) => packet.kind === "transfer-cancel",identities); t.after(network.close);
  // Lost cancel notifications leave two receiver offers pending while the
  // sender correctly releases its own slots.
  const held: string[] = [];
  for (let index=0;index<2;index++) {
    const id = await network.sender.offer(new File(["held"],`held-${index}.txt`),"B"); held.push(id);
    await network.sender.cancel(id);
  }
  for (let index=0;index<3;index++) {
    const id = await network.sender.offer(new File(["rejected"],"capacity.txt"),"B");
    await waitFor(() => network.views.get(`A:${id}`)?.status === "declined");
    const response = network.packets.find((p) => p.kind === "transfer-response" && p.transferId === id)!;
    assert.equal(await verifyTransferPacket(identities.B.publicKey,response),true);
    assert.match(network.views.get(`A:${id}`)!.error!,/two active/);
  }
  assert.equal(network.packets.some((p) => p.kind === "transfer-chunk"),false);
  assert.equal(network.views.get(`B:${held[0]}`)?.status,"awaiting-acceptance");
});

test("authenticated offer preparation errors return an authenticated decline", async (t) => {
  const identities={ A:await createReceiptIdentity(),B:await createReceiptIdentity() };
  const network=pair((packet) => packet.kind === "transfer-offer",identities); t.after(network.close);
  const id=await network.sender.offer(new File(["bad metadata"],"metadata.txt"),"B");
  const offer=network.packets.find((p) => p.kind === "transfer-offer")!;
  if(offer.kind !== "transfer-offer") throw new Error("missing offer");
  await network.receiver.handle("A",await identities.A.sign({ ...offer,manifest:{ ...offer.manifest,chunkCount:2 } }));
  await waitFor(() => network.views.get(`A:${id}`)?.status === "declined");
  const decline=network.packets.find((p) => p.kind === "transfer-response")!;
  assert.equal(await verifyTransferPacket(identities.B.publicKey,decline),true);
  assert.match(network.views.get(`A:${id}`)!.error!,/chunk count/);
  assert.equal(network.views.has(`B:${id}`),false);
});

test("a failed remote cancellation send does not reject or reopen local cancellation", async (t) => {
  const network=pair((packet) => { if(packet.kind === "transfer-cancel") throw new Error("channel closed while signing"); return false; }); t.after(network.close);
  const id=await network.sender.offer(new File(["cancel"],"cancel-send.txt"),"B");
  await assert.doesNotReject(network.sender.cancel(id));
  assert.equal(network.views.get(`A:${id}`)?.status,"cancelled");
  assert.match(network.views.get(`A:${id}`)!.error!,/notification unavailable/);
});

test("outbound preparation cannot reopen an offer cancelled while reading file bytes", async (t) => {
  const network=pair(); t.after(network.close);
  let release!:(bytes:ArrayBuffer) => void;
  const file=new File(["preparing"],"preparing.txt");
  t.mock.method(file,"arrayBuffer",() => new Promise<ArrayBuffer>((resolve) => { release=resolve; }));
  const offering=network.sender.offer(file,"B");
  const preparing=[...network.views.values()].find((view) => view.status === "preparing")!;
  await network.sender.cancel(preparing.id);
  release(new TextEncoder().encode("preparing").buffer);
  await offering;
  assert.equal(network.views.get(`A:${preparing.id}`)?.status,"cancelled");
  assert.equal(network.packets.some((packet) => packet.kind === "transfer-offer"),false);
});

for (const side of ["sender","receiver"] as const) test(`${side} cancellation succeeds without a route and is terminal after route restoration`, async (t) => {
  const network = pair(); t.after(network.close);
  const id = await network.sender.offer(new File(["cancel despite partition"],"partition.txt"),"B");
  network.setAvailable(false);
  await assert.doesNotReject(network[side].cancel(id));
  const local = side === "sender" ? "A" : "B";
  assert.equal(network.views.get(`${local}:${id}`)?.status,"cancelled");
  assert.match(network.views.get(`${local}:${id}`)!.error!,/Cancelled locally.*notification unavailable/);
  network.setAvailable(true);
  await network[side].cancel(id);
  assert.equal(network.views.get(`${local}:${id}`)?.status,"cancelled");
  // Slot release is local; the other endpoint is deliberately not claimed cancelled.
  assert.equal(network.views.get(`${local === "A" ? "B" : "A"}:${id}`)?.status,local === "A" ? "awaiting-acceptance" : "offered");
  const next = await network.sender.offer(new File(["next"],"next.txt"),"B");
  assert.ok(next);
});

test("duplicate and unbound acknowledgements cannot inflate receiver-confirmed bytes", async (t) => {
  const network = pair((packet) => packet.kind === "transfer-chunk-ack" || packet.kind === "transfer-complete"); t.after(network.close);
  const id = await network.sender.offer(new File([new Uint8Array(65536)], "dedup.bin"), "B");
  await network.receiver.respond(id, true);
  await waitFor(() => network.packets.some((packet) => packet.kind === "transfer-complete"));
  const ack = network.packets.find((packet) => packet.kind === "transfer-chunk-ack")!;
  await network.sender.handle("B", { ...ack, routeId: crypto.randomUUID() });
  assert.equal(network.views.get(`A:${id}`)?.acknowledgedChunks, 0);
  await network.sender.handle("B", ack);
  await network.sender.handle("B", ack);
  await waitFor(() => network.views.get(`A:${id}`)?.acknowledgedChunks === 1);
  assert.equal(network.views.get(`A:${id}`)?.acknowledgedBytes, 32768);
  await network.sender.handle("B", network.packets.find((packet) => packet.kind === "transfer-complete")!);
  assert.equal(network.views.get(`A:${id}`)?.acknowledgedBytes, 65536);
  assert.equal(network.views.get(`A:${id}`)?.pathStats?.[0]?.acknowledgedChunks, 1);
});

for (const side of ["sender", "receiver"] as const) test(`${side} cancellation reaches the other endpoint and suppresses later completion`, async (t) => {
  const network = pair(); t.after(network.close);
  const id = await network.sender.offer(new File(["cancel me"], "cancel.txt"), "B");
  await network[side].cancel(id);
  assert.equal(network.views.get(`A:${id}`)?.status, "cancelled");
  assert.equal(network.views.get(`B:${id}`)?.status, "cancelled");
  await assert.rejects(network.receiver.respond(id, true), /no longer pending/);
});

test("declined consent schedules no payload chunks", async (t) => {
  const network = pair(); t.after(network.close);
  const id = await network.sender.offer(new File(["private"], "decline.txt"), "B");
  await network.receiver.respond(id, false);
  assert.equal(network.views.get(`A:${id}`)?.status, "declined");
  assert.equal(network.packets.filter((packet) => packet.kind === "transfer-chunk").length, 0);
});

test("cancellation during asynchronous chunk hashing cannot reopen the receiver", async (t) => {
  const network = pair(); t.after(network.close);
  const id = await network.sender.offer(new File(["cancel during hashing"], "race.txt"), "B");
  const original = crypto.subtle.digest.bind(crypto.subtle);
  let release!: (value: ArrayBuffer) => void;
  let blocked = false;
  const digest = new Promise<ArrayBuffer>((resolve) => { release = resolve; });
  t.mock.method(crypto.subtle, "digest", () => { blocked = true; return digest; });
  await network.receiver.respond(id, true);
  await waitFor(() => blocked);
  await network.receiver.cancel(id);
  release(await original("SHA-256", new TextEncoder().encode("cancel during hashing")));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(network.views.get(`B:${id}`)?.status, "cancelled");
  assert.equal(network.packets.some((packet) => packet.kind === "transfer-complete"), false);
});

test("an unavailable alternate route fails after bounded lack of receiver progress", async (t) => {
  let clock = 1000;
  t.mock.method(performance, "now", () => clock);
  const network = pair((packet) => packet.kind === "transfer-chunk"); t.after(network.close);
  const id = await network.sender.offer(new File(["no acknowledgement"], "unavailable.txt"), "B");
  await network.receiver.respond(id, true);
  network.setAvailable(false);
  clock += 60_001;
  await waitFor(() => network.views.get(`A:${id}`)?.status === "failed");
  assert.match(network.views.get(`A:${id}`)!.error!, /No receiver progress/);
});

test("an insecure receiving browser declines before accepting or scheduling chunks", async (t) => {
  const network = pair((packet) => packet.kind === "transfer-offer"); t.after(network.close);
  const id = await network.sender.offer(new File(["secure only"], "secure.txt"), "B");
  Object.defineProperty(globalThis, "window", { value: { isSecureContext: false }, configurable: true });
  t.after(() => Reflect.deleteProperty(globalThis, "window"));
  await network.receiver.handle("A", network.packets[0]!);
  await waitFor(() => network.views.get(`A:${id}`)?.status === "declined");
  assert.equal(network.views.get(`A:${id}`)?.status, "declined");
  assert.match(network.views.get(`A:${id}`)!.error!, /trusted HTTPS/);
  assert.equal(network.packets.filter((packet) => packet.kind === "transfer-chunk").length, 0);
});

test("experiment exports preserve null measurements instead of invented results", () => {
  const row = experimentResult({ id: "trial", preset: "relay-recovery", mode: "multipath", strategy: "adaptive", peerId: "B", createdAt: 10 });
  assert.equal(row.elapsedMs, null); assert.equal(row.recoveryMs, null);
  assert.match(resultsCsv([row]), /"trial","relay-recovery","multipath","adaptive"/);
  assert.doesNotMatch(resultsCsv([row]), /NaN|undefined/);
});
