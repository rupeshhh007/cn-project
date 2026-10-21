import test from "node:test";
import assert from "node:assert/strict";
import type { DataPacket } from "@hopnet/protocol";
import { DistributedRouter, type Datagram, type RouterEvent } from "../src/lib/distributed-router.ts";

const A = "router-A", B = "router-B", C = "router-C", D = "router-D";
function network() {
  let time = 100;
  const nodes = [A, B, C, D];
  const queue: Array<{ from: string; to: string; packet: DataPacket }> = [];
  const events: Record<string, RouterEvent[]> = Object.fromEntries(nodes.map((id) => [id, []]));
  const delivered: Record<string, Datagram[]> = Object.fromEntries(nodes.map((id) => [id, []]));
  const routers = new Map<string, DistributedRouter>();
  for (const id of nodes) routers.set(id, new DistributedRouter({ self: id, peers: () => nodes, now: () => time, send: (to, packet) => queue.push({ from: id, to, packet: structuredClone(packet) }), update: () => {}, event: (event) => events[id]!.push(event), deliver: (packet) => delivered[id]!.push(packet) }));
  const flush = () => { let count = 0; while (queue.length) { assert.ok(count++ < 10000, "control flood must terminate"); const item = queue.shift()!; routers.get(item.to)!.handle(item.from, item.packet); } };
  const link = (a: string, b: string, open: boolean) => { routers.get(a)!.setLink(b, open); routers.get(b)!.setLink(a, open); flush(); };
  const tick = (ms = 1000) => { time += ms; for (const r of routers.values()) r.tick(); flush(); };
  return { routers, queue, delivered, events, flush, link, tick, advance: (ms:number) => { time += ms; }, now: () => time };
}

test("hello exchanges originate LSAs, flood a diamond, and independently compute all next hops", () => {
  const n = network();
  for (const [a,b] of [[A,B],[A,C],[B,D],[C,D]]) n.link(a!,b!,true);
  n.tick();
  for (const router of n.routers.values()) {
    assert.equal(router.snapshot().lsdb.length, 4);
    assert.equal(router.snapshot().table.length, 3);
    assert.ok(router.snapshot().counters.helloReceived > 0);
  }
  assert.equal(n.routers.get(A)!.snapshot().table.find((r) => r.destination === D)!.nextHop, B);
  n.routers.get(A)!.sendMessage(D, "real local-table forwarding"); n.flush();
  assert.deepEqual(n.delivered[D]![0]!.trace, [A,B,D]);
  assert.equal(n.delivered[A]![0]!.purpose, "ack");
  assert.equal(n.routers.get(B)!.snapshot().counters.forwarded, 2);
});

test("a flooded withdrawal recomputes tables and messages reroute without a coordinator graph", () => {
  const n = network(); for (const [a,b] of [[A,B],[A,C],[B,D],[C,D]]) n.link(a!,b!,true); n.tick();
  n.link(B,D,false); n.tick(1500);
  assert.deepEqual(n.routers.get(A)!.snapshot().table.find((r) => r.destination === D)!.path, [A,C,D]);
  n.routers.get(A)!.sendMessage(D,"after failure"); n.flush();
  assert.deepEqual(n.delivered[D]![0]!.trace,[A,C,D]);
  assert.ok(n.events[A]!.some((e) => e.type === "route-recompute"));
  n.tick(3000); n.tick(1500);
  assert.ok(n.routers.get(A)!.snapshot().convergence?.agreementAt);
});

test("hello timeouts withdraw neighbors even if the DataChannel still appears open", () => {
  const n = network(); n.link(A,B,true); n.tick();
  // Lose control traffic, not the channel-open callback.
  n.queue.length = 0;
  n.routers.get(A)!.tick(); n.queue.length = 0;
  n.tick(5000); // queued packets may revive B, but timeout must have been recorded.
  assert.ok(n.events[A]!.some((e) => e.type === "neighbor-down" && e.detail.includes("deadline")));
});

test("partition is explicit, expired LSAs cannot be resurrected by replay, reports do not enter SPF", () => {
  const n = network(); n.link(A,B,true); n.link(B,D,true); n.tick();
  const lsa = n.routers.get(A)!.snapshot().lsdb.find((l) => l.origin === D)!;
  n.link(B,D,false); n.tick(20000);
  assert.throws(() => n.routers.get(A)!.sendMessage(D,"no route"), /No distributed/);
  n.routers.get(A)!.handle(B,{ kind:"router-control",protocolVersion:1,type:"lsa",origin:D,sequence:lsa.sequence,ttl:8,ageMs:0,neighbors:lsa.neighbors });
  assert.equal(n.routers.get(A)!.snapshot().lsdb.some((l) => l.origin === D),false);
  const before = n.routers.get(A)!.snapshot().table;
  n.routers.get(A)!.handle(B,{ kind:"router-control",protocolVersion:1,type:"report",origin:B,sequence:999,ttl:8,ageMs:0,report:'{"id":"router-B","table":[]}' });
  assert.deepEqual(n.routers.get(A)!.snapshot().table,before);
});

test("duplicate datagrams and trace/TTL loops cannot produce duplicate delivery", () => {
  const n = network(); n.link(A,B,true); n.link(B,D,true); n.tick();
  n.routers.get(A)!.sendMessage(D,"once");
  const first = structuredClone(n.queue[0]!); n.queue.push(first); n.flush();
  assert.equal(n.delivered[D]!.length,1);
  assert.ok(n.routers.get(B)!.snapshot().counters.duplicates > 0);
  n.routers.get(A)!.sendMessage(D,"expired"); const pending = n.queue.shift()!;
  if (pending.packet.kind === "router-data") pending.packet.ttl = 1;
  n.routers.get(B)!.handle(A,pending.packet); n.flush();
  assert.equal(n.delivered[D]!.length,1);
  assert.ok(n.events[B]!.some((e) => e.type === "packet-drop"));
});

test("latency SPF uses flooded link measurements rather than a centrally assigned path", () => {
  const n = network(); for (const [a,b] of [[A,B],[A,C],[B,D],[C,D]]) n.link(a!,b!,true); n.tick();
  const router = n.routers.get(A)!;
  for (const [origin, neighbors] of [
    [B, [{ id:A,rttMs:200 },{ id:D,rttMs:200 }]],
    [C, [{ id:A,rttMs:1 },{ id:D,rttMs:1 }]],
    [D, [{ id:B,rttMs:200 },{ id:C,rttMs:1 }]]
  ] as const) router.handle(B, { kind:"router-control",protocolVersion:1,type:"lsa",origin,sequence:10000,ttl:8,ageMs:0,neighbors:[...neighbors] });
  assert.equal(router.snapshot().table.find((row) => row.destination === D)?.nextHop,B);
  router.setStrategy("lowest-latency");
  assert.deepEqual(router.snapshot().table.find((row) => row.destination === D)?.path,[A,C,D]);
  router.sendMessage(D,"latency-selected"); n.flush();
  assert.deepEqual(n.delivered[D]![0]?.trace,[A,C,D]);
});

test("a suspended browser cannot revive a probing neighbor with an expired hello ACK", () => {
  const n = network(); n.link(A,B,true); n.link(A,B,false);
  n.routers.get(A)!.setLink(B,true);
  const hello = n.queue.find((item) => item.from === A && item.packet.kind === "router-control" && item.packet.type === "hello")!.packet;
  assert.equal(hello.kind,"router-control");
  if (hello.kind !== "router-control") throw new Error("missing hello");
  n.queue.length = 0; n.advance(5000);
  n.routers.get(A)!.handle(B,{ ...hello,type:"hello-ack",origin:B });
  assert.equal(n.routers.get(A)!.snapshot().neighbors.find((neighbor) => neighbor.id === B)?.active,false);
});
