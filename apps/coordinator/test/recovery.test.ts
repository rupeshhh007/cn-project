import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { buildApp } from "../src/app.ts";

async function fixture(t: {after: (fn:()=>Promise<unknown>)=>void}) {
  process.env.NODE_ENV="test";
  const app=await buildApp({serveWeb:false});
  await app.listen({host:"127.0.0.1",port:0});
  const sockets:WebSocket[]=[];
  t.after(async () => {for(const socket of sockets) socket.terminate();await app.close();});
  const address=app.server.address(); assert.ok(address && typeof address!=="string");
  const room=(await app.inject({method:"POST",url:"/api/rooms",payload:{displayName:"Host",deviceCategory:"laptop"}})).json();
  const headers={authorization:`Bearer ${room.hostToken}`};
  const connect=async (token:string) => {
    const socket=new WebSocket(`ws://127.0.0.1:${address.port}/signal?token=${token}`);
    sockets.push(socket);
    const messages:Array<Record<string,any>>=[];
    socket.on("message",(raw) => messages.push(JSON.parse(raw.toString())));
    await new Promise<void>((resolve,reject) => {socket.once("open",resolve);socket.once("error",reject);});
    return {socket,messages};
  };
  const join=async (requestKey=randomUUID()) => (await app.inject({method:"POST",url:`/api/rooms/${room.roomId}/join`,payload:{displayName:"Phone",deviceCategory:"phone",inviteSecret:room.inviteSecret,requestKey}})).json();
  const approve=async (requestId:string) => app.inject({method:"POST",url:`/api/rooms/${room.roomId}/approve`,headers,payload:{requestId}});
  const claim=async (join:{requestId:string;claimToken:string}) => (await app.inject({method:"GET",url:`/api/rooms/${room.roomId}/join/${join.requestId}`,headers:{"x-hopnet-claim":join.claimToken}})).json();
  return {app,room,headers,connect,join,approve,claim};
}
async function until(predicate:()=>boolean) {
  const deadline=Date.now()+2500;
  while(!predicate()) {assert.ok(Date.now()<deadline,"Expected authenticated socket state");await new Promise((r) => setTimeout(r,10));}
}

test("host reconnect receives authoritative missed admissions; participants never receive claim secrets",async (t) => {
  const f=await fixture(t);
  const first=await f.connect(f.room.sessionToken);
  first.socket.close(); await until(() => first.socket.readyState===WebSocket.CLOSED);
  const join=await f.join();
  const host=await f.connect(f.room.sessionToken);
  await until(() => host.messages.some((m) => m.type==="pending-requests" && m.requests.length===1));
  const snapshot=host.messages.find((m) => m.type==="pending-requests")!;
  assert.equal(snapshot.requests[0].requestId,join.requestId);
  assert.doesNotMatch(JSON.stringify(snapshot),/claimToken|hostToken|inviteSecret|sessionToken/);
  const pending=await f.app.inject({url:`/api/rooms/${f.room.roomId}/pending`,headers:f.headers});
  assert.equal(pending.headers["cache-control"],"no-store");
  assert.equal(pending.json().requests.length,1);
  assert.equal((await f.approve(join.requestId)).statusCode,200);
  assert.equal((await f.approve(join.requestId)).statusCode,200,"duplicate approval is idempotent");
  const claimed=await f.claim(join);
  const participant=await f.connect(claimed.sessionToken);
  const another=await f.join();
  await until(() => host.messages.some((m) => m.type==="pending-requests" && m.requests[0]?.requestId===another.requestId));
  assert.equal(participant.messages.some((m) => m.type==="pending-requests" || m.type==="join-requested"),false);
  assert.equal((await f.app.inject({url:`/api/rooms/${f.room.roomId}/pending`,headers:{authorization:`Bearer ${claimed.sessionToken}`}})).statusCode,403);
  const rejected=await f.app.inject({method:"POST",url:`/api/rooms/${f.room.roomId}/reject`,headers:f.headers,payload:{requestId:another.requestId}});
  assert.equal(rejected.statusCode,200);assert.equal((await f.claim(another)).status,"rejected");
  assert.equal((await f.approve(another.requestId)).statusCode,409);
});

test("join retries deduplicate, rejected requests do not exhaust pending capacity, and expiry is authoritative",async (t) => {
  const f=await fixture(t); const key=randomUUID();
  const first=await f.join(key);
  for(let i=0;i<25;i++) assert.deepEqual(await f.join(key),first);
  assert.equal((await f.app.inject({url:`/api/rooms/${f.room.roomId}/pending`,headers:f.headers})).json().requests.length,1);
  for(let i=0;i<25;i++) {
    const join=await f.join();
    assert.ok(join.requestId);
    await f.app.inject({method:"POST",url:`/api/rooms/${f.room.roomId}/reject`,headers:f.headers,payload:{requestId:join.requestId}});
  }
  const realNow=Date.now(); t.mock.method(Date,"now",()=>realNow+16*60_000);
  assert.equal((await f.app.inject({url:`/api/rooms/${f.room.roomId}/pending`,headers:f.headers})).json().requests.length,0);
  assert.equal((await f.app.inject({url:`/api/rooms/${f.room.roomId}/join/${first.requestId}`,headers:{"x-hopnet-claim":first.claimToken}})).statusCode,404);
  assert.ok((await f.join()).requestId);
});

test("authorized reload rotates incarnation/key without admission or revoked-edge restoration; stale close cannot replace new socket",async (t) => {
  const f=await fixture(t);const join=await f.join();await f.approve(join.requestId);const peer=await f.claim(join);
  const old=await f.connect(peer.sessionToken);
  // Revoke the initial star edge before reload.
  const host=await f.connect(f.room.sessionToken);
  host.socket.send(JSON.stringify({type:"set-topology",edges:[]}));
  await until(() => old.messages.some((m) => m.type==="topology-updated" && m.edges.length===0));
  const payload={attemptId:randomUUID()};
  const headers={authorization:`Bearer ${peer.sessionToken}`};
  const resume=await f.app.inject({method:"POST",url:`/api/rooms/${f.room.roomId}/resume`,headers,payload});
  assert.equal(resume.statusCode,200);const restored=resume.json();
  assert.equal(restored.peer.id,peer.peer.id);assert.equal(restored.peer.generation,1);
  assert.equal(restored.peer.receiptPublicKey,undefined);assert.equal(restored.hostToken,undefined);
  assert.equal((await f.app.inject({method:"POST",url:`/api/rooms/${f.room.roomId}/resume`,headers,payload})).json().peer.generation,1);
  const current=await f.connect(peer.sessionToken);
  await until(() => old.socket.readyState===WebSocket.CLOSED && current.messages.some((m) => m.type==="room-snapshot"));
  assert.equal(current.messages.find((m) => m.type==="room-snapshot")!.edges.length,0);
  const replacement=await f.connect(peer.sessionToken);
  await until(() => current.socket.readyState===WebSocket.CLOSED);
  replacement.socket.send(JSON.stringify({type:"heartbeat",sentAt:123}));
  await until(() => replacement.messages.some((m) => m.type==="heartbeat-ack"));
  assert.equal((await f.app.inject({url:`/api/rooms/${f.room.roomId}/session`,headers})).json().peer.coordinatorConnected,true);
  assert.equal((await f.app.inject({method:"POST",url:`/api/rooms/${f.room.roomId}/resume`,payload,headers:{authorization:"Bearer invalid"}})).statusCode,401);
  const hostResume=(await f.app.inject({method:"POST",url:`/api/rooms/${f.room.roomId}/resume`,payload:{attemptId:randomUUID()},headers:{authorization:`Bearer ${f.room.sessionToken}`}})).json();
  assert.equal(hostResume.hostToken,f.room.hostToken);
});
