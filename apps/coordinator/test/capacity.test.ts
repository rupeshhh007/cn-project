import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.ts";

test("public classroom room creation is bounded instead of growing session maps indefinitely",async (t)=>{
  process.env.NODE_ENV="test";
  const app=await buildApp({serveWeb:false});t.after(()=>app.close());
  for(let index=0;index<128;index++) assert.equal((await app.inject({method:"POST",url:"/api/rooms",payload:{displayName:`Room ${index}`,deviceCategory:"laptop"}})).statusCode,201);
  const overflow=await app.inject({method:"POST",url:"/api/rooms",payload:{displayName:"Over capacity",deviceCategory:"laptop"}});
  assert.equal(overflow.statusCode,503);assert.equal(overflow.json().error,"ROOM_CAPACITY");
});
