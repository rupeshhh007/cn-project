import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.ts";

test("room admission requires both invitation and host authorization", async (t) => {
  process.env.NODE_ENV = "test";
  const app = await buildApp({ serveWeb: false });
  t.after(() => app.close());
  const created = await app.inject({ method: "POST", url: "/api/rooms", payload: { displayName: "Mac A", deviceCategory: "laptop" } });
  assert.equal(created.statusCode, 201);
  const room = created.json();

  const deniedJoin = await app.inject({ method: "POST", url: `/api/rooms/${room.roomId}/join`, payload: { displayName: "Phone A", deviceCategory: "phone", inviteSecret: "wrong-secret" } });
  assert.equal(deniedJoin.statusCode, 404);

  const requested = await app.inject({ method: "POST", url: `/api/rooms/${room.roomId}/join`, payload: { displayName: "Phone A", deviceCategory: "phone", inviteSecret: room.inviteSecret } });
  assert.equal(requested.statusCode, 202);
  const join = requested.json();

  const deniedApproval = await app.inject({ method: "POST", url: `/api/rooms/${room.roomId}/approve`, payload: { requestId: join.requestId } });
  assert.equal(deniedApproval.statusCode, 403);

  const approved = await app.inject({ method: "POST", url: `/api/rooms/${room.roomId}/approve`, headers: { authorization: `Bearer ${room.hostToken}` }, payload: { requestId: join.requestId } });
  assert.equal(approved.statusCode, 200);

  const claimed = await app.inject({ method: "GET", url: `/api/rooms/${room.roomId}/join/${join.requestId}`, headers: { "x-hopnet-claim": join.claimToken } });
  assert.equal(claimed.statusCode, 200);
  assert.equal(claimed.json().status, "approved");
  assert.ok(claimed.json().sessionToken);
});
