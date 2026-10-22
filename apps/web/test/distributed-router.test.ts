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
  const statuses: Record<string, Array<{ id:string; status:string }>> = Object.fromEntries(nodes.map((id) => [id,[]]));
  const routers = new Map<string, DistributedRouter>();
  for (const id of nodes) routers.set(id, new DistributedRouter({ self: id, peers: () => nodes, now: () => time, send: (to, packet) => queue.push({ from: id, to, packet: structuredClone(packet) }), update: () => {}, event: (event) => events[id]!.push(event), deliver: (packet) => delivered[id]!.push(packet), messageStatus:(messageId,status) => statuses[id]!.push({id:messageId,status}) }));
  const flush = () => { let count = 0; while (queue.length) { assert.ok(count++ < 10000, "control flood must terminate"); const item = queue.shift()!; routers.get(item.to)!.handle(item.from, item.packet); } };
  const link = (a: string, b: string, open: boolean) => { routers.get(a)!.setLink(b, open); routers.get(b)!.setLink(a, open); flush(); };
  const tick = (ms = 1000) => { time += ms; for (const r of routers.values()) r.tick(); flush(); };
  return { routers, queue, delivered, events, statuses, flush, link, tick, advance: (ms:number) => { time += ms; }, now: () => time };
}

test("authoritative incarnation reset accepts a restarted LSA but rejects old high-sequence floods",() => {
  let generation=0;
  const router=new DistributedRouter({self:A,peers:()=>[A,B],generation:(id)=>id===B ? generation:0,now:()=>100,send:()=>{},update:()=>{},event:()=>{},deliver:()=>{}});
  router.setLink(B,true);
  const lsa:Extract<DataPacket,{kind:"router-control"}>={kind:"router-control",protocolVersion:1,type:"lsa",origin:B,generation:0,sequence:500,ttl:8,ageMs:0,neighbors:[{id:A,rttMs:1}]};
  router.handle(B,lsa);assert.equal(router.snapshot().lsdb.find((row)=>row.origin===B)?.sequence,500);
  generation=1;router.resetPeer(B);router.setLink(B,true);
  router.handle(B,{...lsa,generation:1,sequence:1});
  assert.equal(router.snapshot().lsdb.find((row)=>row.origin===B)?.sequence,1);
  router.handle(B,{...lsa,sequence:501});
  assert.equal(router.snapshot().lsdb.find((row)=>row.origin===B)?.sequence,1);
  assert.ok(router.snapshot().counters.dropped>0);
  router.dispose();
});

test("endpoint reload fails its pending messages; relay restart preserves alternate-route recovery",() => {
  const n=network();for(const [a,b] of [[A,B],[A,C],[B,D],[C,D]]) n.link(a!,b!,true);n.tick();
  const id=n.routers.get(A)!.sendMessage(D,"pending during relay restart");
  n.queue.length=0;n.routers.get(A)!.resetPeer(B);n.link(B,D,false);n.tick(1500);
  assert.deepEqual(n.statuses[A],[{id,status:"delivered"}]);
  const second=n.routers.get(A)!.sendMessage(D,"endpoint restart is not silent replay");n.queue.length=0;
  n.routers.get(A)!.resetPeer(D);n.tick(1500);
  assert.deepEqual(n.statuses[A]![1],{id:second,status:"failed"});
});

test("a delayed datagram from before an endpoint reload cannot be delivered in the fresh incarnation",() => {
  let generation=0,delivered=0;
  const router=new DistributedRouter({self:B,peers:()=>[A,B],generation:(id)=>id===B ? generation:0,send:()=>{},update:()=>{},event:()=>{},deliver:()=>{delivered++;}});
  router.setLink(A,true);
  const packet:Extract<DataPacket,{kind:"router-data"}>={kind:"router-data",protocolVersion:1,packetId:crypto.randomUUID(),messageId:crypto.randomUUID(),source:A,destination:B,sourceGeneration:0,destinationGeneration:0,sequence:1,ttl:8,trace:[A],purpose:"message",body:"queued before reload"};
  generation=1;router.handle(A,packet);assert.equal(delivered,0);
  router.handle(A,{...packet,destinationGeneration:1});assert.equal(delivered,1);
  router.dispose();
});

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

test("an in-flight message retries on a new local route after its first relay disappears", () => {
  const n = network(); for (const [a,b] of [[A,B],[A,C],[B,D],[C,D]]) n.link(a!,b!,true); n.tick();
  const id = n.routers.get(A)!.sendMessage(D,"recover the same logical message");
  const first = n.queue.shift()!; assert.equal(first.to,B);
  // The first transmission entered the failed relay, but never forwarded.
  n.link(A,B,false); n.link(B,D,false);
  n.tick(1500);
  assert.equal(n.delivered[D]!.length,1);
  assert.deepEqual(n.delivered[D]![0]!.trace,[A,C,D]);
  assert.deepEqual(n.statuses[A],[{id,status:"delivered"}]);
  assert.ok(n.events[A]!.some((event) => event.type === "message-retry"));
});

test("lost ACK retry re-ACKs the receiver's tombstone without delivering twice", () => {
  const n = network(); n.link(A,B,true);
  const id = n.routers.get(A)!.sendMessage(B,"one conversation bubble");
  const first = n.queue.shift()!; n.routers.get(B)!.handle(A,first.packet);
  const ack = n.queue.shift()!; assert.equal(ack.packet.kind,"router-data"); // intentionally lose it
  n.tick(1500);
  assert.equal(n.delivered[B]!.length,1);
  assert.deepEqual(n.statuses[A],[{id,status:"delivered"}]);
  // Even an ACK duplicate with a fresh packet ID cannot deliver twice.
  if (ack.packet.kind === "router-data") n.routers.get(A)!.handle(B,{ ...ack.packet,packetId:crypto.randomUUID() });
  assert.equal(n.delivered[A]!.length,1);
});

test("ACK deadline is terminal, late/wrong ACKs cannot succeed, and pending messages are bounded", () => {
  const n = network(); n.link(A,B,true);
  const id = n.routers.get(A)!.sendMessage(B,"unconfirmed");
  const first = n.queue.shift()!;
  if (first.packet.kind !== "router-data") throw new Error("missing message");
  const ack: Datagram = { ...first.packet,packetId:crypto.randomUUID(),source:B,destination:A,trace:[B],purpose:"ack",body:"" };
  n.routers.get(A)!.handle(B,{ ...ack,sequence:ack.sequence+1000 });
  assert.equal(n.statuses[A]!.length,0);
  n.advance(30001); n.routers.get(A)!.tick(); n.queue.length=0;
  n.routers.get(A)!.handle(B,ack);
  assert.deepEqual(n.statuses[A],[{id,status:"failed"}]);
  assert.throws(() => n.routers.get(A)!.sendMessage(B,"reuse",id),/cannot be reused/);
  // Restore hellos after clock advancement, then saturate the pending bound.
  n.link(A,B,false); n.link(A,B,true);
  for(let index=0;index<32;index++) n.routers.get(A)!.sendMessage(B,`pending ${index}`);
  assert.throws(() => n.routers.get(A)!.sendMessage(B,"overflow"),/At most 32/);
  n.queue.length=0; n.advance(30001); n.routers.get(A)!.tick(); n.queue.length=0;
  assert.equal(n.statuses[A]!.filter((s) => s.status === "failed").length,33);
});

test("logical delivery tombstones survive packet-cache expiry and reject changed-content reuse", () => {
  const n=network(); n.link(A,B,true); n.routers.get(A)!.sendMessage(B,"one body");
  const first=n.queue.shift()!; n.routers.get(B)!.handle(A,first.packet); n.queue.length=0;
  n.advance(61000); n.routers.get(B)!.tick(); n.queue.length=0;
  if(first.packet.kind !== "router-data") throw new Error("missing message");
  n.routers.get(B)!.handle(A,{ ...first.packet,packetId:crypto.randomUUID() });
  assert.equal(n.delivered[B]!.length,1);
  n.queue.length=0;
  n.routers.get(B)!.handle(A,{ ...first.packet,packetId:crypto.randomUUID(),body:"different" });
  assert.equal(n.delivered[B]!.length,1);
  assert.equal(n.queue.length,0);
  assert.ok(n.events[B]!.some((event) => event.detail.includes("different content")));
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
