import test from "node:test";
import assert from "node:assert/strict";
import { readSession,saveSession,readAdmission,saveAdmission,joinAttempt,clearAdmission,forgetSession } from "../src/lib/room-session.ts";

function storage() {
  const values=new Map<string,string>();
  return {getItem:(key:string)=>values.get(key) ?? null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);},key:(index:number)=>[...values.keys()][index] ?? null,clear:()=>values.clear(),get length(){return values.size;}} satisfies Storage;
}
test("tab storage whitelists the minimum session capability, never private keys, invitations or host tokens",() => {
  const store=storage();
  const value={version:1 as const,roomId:"room_abcdefghijk",peerId:"peer_abcdefghijk",sessionToken:"a".repeat(32),hostToken:"forbidden",inviteSecret:"forbidden",privateKey:"forbidden"};
  assert.equal(saveSession(value,store),true);
  assert.doesNotMatch(store.getItem("hopnet.tab-session.v1")!,/forbidden|privateKey|hostToken|inviteSecret/);
  assert.equal(readSession(store)?.peerId,value.peerId);
  store.setItem("hopnet.tab-session.v1","{corrupt");assert.equal(readSession(store),undefined);
  store.setItem("hopnet.tab-session.v1",JSON.stringify({...value,sessionToken:"invalid"}));assert.equal(readSession(store),undefined);
});
test("pending claims survive reload only within their bounded waiting deadline",() => {
  const store=storage();const claim={roomId:"room_abcdefghijk",requestId:"join_abcdefghijk",claimToken:"a".repeat(32),startedAt:Date.now()};
  saveAdmission(claim,store);assert.deepEqual(readAdmission(store),claim);
  saveAdmission({...claim,startedAt:Date.now()-16*60_000},store);assert.equal(readAdmission(store),undefined);
  saveAdmission({...claim,startedAt:Date.now()+60_000},store);assert.equal(readAdmission(store),undefined);
});

test("privacy-policy denial of the sessionStorage getter is a safe non-persistent fallback",()=>{
  const original=Object.getOwnPropertyDescriptor(globalThis,"sessionStorage");
  Object.defineProperty(globalThis,"sessionStorage",{configurable:true,get(){throw new Error("Storage denied");}});
  try {
    assert.equal(readSession(),undefined);assert.equal(readAdmission(),undefined);
    assert.equal(saveSession({version:1,roomId:"room_abcdefghijk",peerId:"peer_abcdefghijk",sessionToken:"a".repeat(32)}),false);
    assert.doesNotThrow(()=>saveAdmission({roomId:"room_abcdefghijk",requestId:"join_abcdefghijk",claimToken:"a".repeat(32),startedAt:Date.now()}));
    assert.ok(/^[0-9a-f-]{36}$/i.test(joinAttempt("room_abcdefghijk")));
    assert.doesNotThrow(()=>clearAdmission());
    assert.doesNotThrow(()=>forgetSession());
  } finally {if(original) Object.defineProperty(globalThis,"sessionStorage",original);else Reflect.deleteProperty(globalThis,"sessionStorage");}
});
