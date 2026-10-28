import test from "node:test";
import assert from "node:assert/strict";
import { dataPacketSchema, type DataPacket } from "@hopnet/protocol";
import { DistributedRouter, type RoutePulse, type Datagram } from "../src/lib/distributed-router.ts";

const A = "router-A", B = "router-B", C = "router-C", D = "router-D";
function network() {
  let now = 100, generation = 0, failData = false;
  const queue: Array<{ from: string; to: string; packet: DataPacket }> = [];
  const pulses: RoutePulse[] = [], delivered: Datagram[] = [];
  const routers = new Map<string, DistributedRouter>();
  for (const id of [A,B,C,D]) routers.set(id, new DistributedRouter({
    self: id, peers: () => [A,B,C,D], generation: (peer) => peer === D ? generation : 0, now: () => now,
    send: (to,packet) => { if (failData && packet.kind === "router-data") throw new Error("Actual send failure"); queue.push({from:id,to,packet:structuredClone(packet)}); }, update: () => {}, event: () => {},
    deliver: (packet) => delivered.push(packet), pulse: (view) => pulses.push(structuredClone(view)),
  }));
  const step = () => { const item = queue.shift()!; routers.get(item.to)!.handle(item.from,dataPacketSchema.parse(item.packet)); return item; };
  const flush = () => { let count=0; while(queue.length) {assert.ok(count++<10000,"Flood must terminate");step();} };
  const link = (a:string,b:string,open:boolean) => {routers.get(a)!.setLink(b,open);routers.get(b)!.setLink(a,open);flush();};
  const advance = (ms:number) => {now+=ms;};
  const tick = (ms:number) => {advance(ms);for(const router of routers.values()) router.tick();flush();};
  return {routers,queue,pulses,delivered,step,flush,link,advance,tick,setSendFailure:()=>{failData=true;},reloadDestination:()=>{generation++;routers.get(A)!.resetPeer(D);},close:()=>{for(const router of routers.values()) router.dispose();}};
}

test("a route pulse crosses real forwarding decisions, reports both trails, and never becomes chat",(t)=>{
  const n=network();t.after(n.close);
  n.link(A,B,true);n.link(B,D,true);
  const id=n.routers.get(A)!.sendPulse(D);
  assert.equal(n.pulses[0]?.status,"pending");assert.equal(n.pulses[0]?.roundTripMs,undefined);
  n.advance(7);n.flush();
  const received=n.pulses.at(-1)!;
  assert.equal(received.id,id);assert.equal(received.status,"received");assert.equal(received.roundTripMs,7);
  assert.deepEqual(received.outboundPath,[A,B,D]);assert.deepEqual(received.returnPath,[D,B,A]);
  assert.equal(n.delivered.length,0);assert.equal(n.routers.get(B)!.snapshot().counters.forwarded,2);
});

test("unmatched, malformed and late probe receipts never complete a pulse or a chat message",(t)=>{
  const n=network();t.after(n.close);n.link(A,B,true);n.link(B,D,true);
  n.routers.get(A)!.sendPulse(D);n.step();n.step(); // arrive at D, leaving its receipt queued
  const receipt=n.queue.shift()!;assert.equal(receipt.packet.kind,"router-data");
  const packet=receipt.packet as Datagram;
  for(const changed of [{sequence:packet.sequence+1},{probePath:[A,C,D]},{probePath:[A,B,A,D]},{probePath:[A,"unknown-router",D]},{body:"not diagnostic"},{sourceGeneration:99}]) {
    n.routers.get(B)!.handle(D,{...packet,...changed,packetId:crypto.randomUUID()});n.flush();
  }
  assert.equal(n.pulses.at(-1)?.status,"pending");assert.equal(n.delivered.length,0);
  n.advance(8001);n.routers.get(A)!.tick();n.queue.length=0;
  n.routers.get(B)!.handle(D,{...packet,packetId:crypto.randomUUID()});n.flush();
  assert.equal(n.pulses.at(-1)?.status,"failed");assert.equal(n.pulses.some((view)=>view.status==="received"),false);
});

test("a duplicate receipt cannot generate two results and pulse traffic is bounded and manual",(t)=>{
  const n=network();t.after(n.close);n.link(A,B,true);
  n.routers.get(A)!.sendPulse(B);
  assert.throws(()=>n.routers.get(A)!.sendPulse(B),/already in flight/);
  n.step();const receipt=n.queue.shift()!;
  n.routers.get(A)!.handle(B,receipt.packet);
  n.routers.get(A)!.handle(B,{...receipt.packet,packetId:crypto.randomUUID()} as Datagram);
  assert.equal(n.pulses.filter((view)=>view.status==="received").length,1);
  assert.throws(()=>n.routers.get(A)!.sendPulse(B),/one second/);
  n.tick(1000);assert.equal(n.queue.filter((item)=>item.packet.kind==="router-data").length,0,"No background probes");
  n.link(A,B,false);assert.throws(()=>n.routers.get(A)!.sendPulse(B),/No established route/);
});

test("a second pulse follows the surviving diamond branch after a relay disappears",(t)=>{
  const n=network();t.after(n.close);for(const [a,b] of [[A,B],[A,C],[B,D],[C,D]]) n.link(a!,b!,true);
  n.routers.get(A)!.sendPulse(D);n.flush();assert.deepEqual(n.pulses.at(-1)?.outboundPath,[A,B,D]);
  n.link(A,B,false);n.link(B,D,false);n.tick(1000);
  n.routers.get(A)!.sendPulse(D);n.flush();assert.deepEqual(n.pulses.at(-1)?.outboundPath,[A,C,D]);
});

test("endpoint restart, missing return route, dispose and send failure are honest terminal outcomes",(t)=>{
  const n=network();t.after(n.close);n.link(A,B,true);n.link(B,D,true);
  n.routers.get(A)!.sendPulse(D);n.queue.length=0;n.reloadDestination();
  assert.equal(n.pulses.at(-1)?.status,"failed");assert.match(n.pulses.at(-1)?.error ?? "",/restarted/);
  n.routers.get(B)!.sendPulse(A);n.queue.length=0;n.routers.get(B)!.dispose();
  assert.equal(n.pulses.at(-1)?.status,"failed");assert.match(n.pulses.at(-1)?.error ?? "",/session ended/);
  assert.throws(()=>n.routers.get(B)!.sendPulse(A),/stopped/);
  n.advance(1000);n.setSendFailure();n.routers.get(A)!.sendPulse(B);
  assert.equal(n.pulses.at(-1)?.status,"failed");assert.match(n.pulses.at(-1)?.error ?? "",/before transmission/);
});

test("an arrived pulse without a return path times out instead of claiming receiver success",(t)=>{
  const n=network();t.after(n.close);n.link(A,B,true);n.link(B,D,true);
  n.routers.get(A)!.sendPulse(D);n.step();const request=n.queue.shift()!;
  n.link(D,B,false);n.queue.length=0;
  // Reopen only ingress without fresh bidirectional Hellos: no return route.
  n.routers.get(D)!.setLink(B,true);n.queue.length=0;
  n.routers.get(D)!.handle(B,request.packet);n.flush();
  assert.equal(n.pulses.at(-1)?.status,"pending");
  n.advance(8001);n.routers.get(A)!.tick();n.queue.length=0;
  assert.equal(n.pulses.at(-1)?.status,"failed");assert.equal(n.pulses.at(-1)?.roundTripMs,undefined);
});
