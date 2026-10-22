import type { Peer } from "@hopnet/protocol";
import { createUuid } from "./id.ts";

export type Credentials={roomId:string;inviteSecret:string;hostToken?:string;peer:Peer;sessionToken:string};
export type StoredSession={version:1;roomId:string;peerId:string;sessionToken:string;attemptId?:string};
export type PendingAdmission={roomId:string;requestId:string;claimToken:string;startedAt:number};
const SESSION="hopnet.tab-session.v1", JOIN="hopnet.tab-admission.v1";
const JOIN_ATTEMPT="hopnet.tab-join-attempt.v1";
export function joinAttempt(roomId:string):string {
  try {
    const old=JSON.parse(sessionStorage.getItem(JOIN_ATTEMPT) ?? "null");
    if(old?.roomId===roomId && /^[\da-f-]{36}$/i.test(old.key) && Date.now()-old.at<15*60_000 && Date.now()>=old.at) return old.key;
    const key=createUuid();sessionStorage.setItem(JOIN_ATTEMPT,JSON.stringify({roomId,key,at:Date.now()}));return key;
  } catch {return createUuid();}
}

export function readSession(storage?:Storage):StoredSession|undefined {
  try {
    storage ??= sessionStorage;
    const value=JSON.parse(storage.getItem(SESSION) ?? "null");
    if(value?.version===1 && /^room_[\w-]{8,70}$/.test(value.roomId) && /^peer_[\w-]{8,70}$/.test(value.peerId) && typeof value.sessionToken==="string" && /^[\w-]{16,100}$/.test(value.sessionToken) && (value.attemptId===undefined || /^[\da-f-]{36}$/i.test(value.attemptId))) return value;
    storage.removeItem(SESSION);
  } catch { /* Corrupt or blocked storage is not authenticated state. */ }
}
export function saveSession(value:StoredSession,storage?:Storage):boolean {
  try { (storage ?? sessionStorage).setItem(SESSION,JSON.stringify({version:1,roomId:value.roomId,peerId:value.peerId,sessionToken:value.sessionToken,attemptId:value.attemptId})); return true; } catch { return false; }
}
export function saveAdmission(value:PendingAdmission,storage?:Storage) {
  try { (storage ?? sessionStorage).setItem(JOIN,JSON.stringify(value)); } catch { /* Polling remains usable without refresh persistence. */ }
}
export function readAdmission(storage?:Storage):PendingAdmission|undefined {
  try {
    storage ??= sessionStorage;
    const value=JSON.parse(storage.getItem(JOIN) ?? "null");
    if(/^room_[\w-]{8,70}$/.test(value?.roomId) && /^join_[\w-]{8,70}$/.test(value?.requestId) && typeof value?.claimToken==="string" && /^[\w-]{16,100}$/.test(value.claimToken) && Number.isFinite(value.startedAt) && Date.now()>=value.startedAt && Date.now()-value.startedAt<15*60_000) return value;
    storage.removeItem(JOIN);
  } catch { /* Do not trust unavailable storage. */ }
}
export function clearAdmission() { try { sessionStorage.removeItem(JOIN); sessionStorage.removeItem(JOIN_ATTEMPT); } catch {} }
export function forgetSession() { try { sessionStorage.removeItem(SESSION); } catch {} releaseTabLease(); }

// One lease per document, including React StrictMode's effect replay. Locks are
// released by browser document destruction; no key/token enters a lock name.
let leasePeer:string|undefined, lease:Promise<void>|undefined, release:(()=>void)|undefined;
export function releaseTabLease() { release?.(); release=undefined; lease=undefined; leasePeer=undefined; }
export function claimTabLease(peerId:string):Promise<void> {
  if(!navigator.locks) return Promise.resolve();
  if(leasePeer===peerId && lease) return lease;
  releaseTabLease(); leasePeer=peerId;
  lease=new Promise<void>((resolve,reject) => {
    void navigator.locks.request(`hopnet-session:${peerId}`,{ifAvailable:true},async (lock) => {
      if(!lock) { reject(new Error("This session is already open in another tab. Return to that tab, or use a fresh invitation for an independent peer.")); return; }
      await new Promise<void>((unlock) => { release=unlock; resolve(); });
    }).catch(() => reject(new Error("Session ownership could not be established.")));
  });
  const claimed=lease;
  void claimed.catch(() => {if(lease===claimed) {lease=undefined;leasePeer=undefined;}});
  return claimed;
}
