import assert from "node:assert/strict";
import test from "node:test";
import WebSocket from "ws";
import { buildApp } from "../src/app.ts";
import { normalizeLanInterfaces } from "../src/network.ts";

test("network discovery and QR invitations use an allow-listed LAN origin", async (t) => {
  process.env.NODE_ENV = "test";
  const networkInterfaces = normalizeLanInterfaces([{ name: "en0", address: "192.168.40.12" }], "http", 4173);
  const app = await buildApp({ serveWeb: false, port: 4173, networkInterfaces });
  t.after(() => app.close());

  const network = await app.inject({ method: "GET", url: "/api/network" });
  assert.equal(network.statusCode, 200);
  assert.equal(network.headers["cache-control"], "no-store");
  assert.equal(network.json().preferredOrigin, "http://192.168.40.12:4173");

  const created = await app.inject({ method: "POST", url: "/api/rooms", payload: { displayName: "Mac A", deviceCategory: "laptop" } });
  const room = created.json();
  const qr = await app.inject({
    method: "GET",
    url: `/api/rooms/${room.roomId}/qr?invite=${encodeURIComponent(room.inviteSecret)}`,
    headers: { host: "localhost:4173" },
  });
  assert.equal(qr.statusCode, 200);
  assert.equal(qr.headers["x-hopnet-invitation-origin"], "http://192.168.40.12:4173");
  assert.match(qr.body, /<svg/);

  const rejected = await app.inject({
    method: "GET",
    url: `/api/rooms/${room.roomId}/qr?invite=${encodeURIComponent(room.inviteSecret)}&origin=${encodeURIComponent("http://attacker.invalid:4173")}`,
  });
  assert.equal(rejected.statusCode, 400);
  assert.equal(rejected.json().error, "INVALID_PUBLIC_ORIGIN");
});

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

test("participant sessions cannot author the overlay topology", async (t) => {
  process.env.NODE_ENV = "test";
  const app = await buildApp({ serveWeb: false });
  await app.listen({ host: "127.0.0.1", port: 0 });
  t.after(() => app.close());
  const created = await app.inject({ method: "POST", url: "/api/rooms", payload: { displayName: "Host", deviceCategory: "laptop" } });
  const room = created.json();
  const requested = await app.inject({ method: "POST", url: `/api/rooms/${room.roomId}/join`, payload: { displayName: "Peer", deviceCategory: "phone", inviteSecret: room.inviteSecret } });
  const join = requested.json();
  await app.inject({ method: "POST", url: `/api/rooms/${room.roomId}/approve`, headers: { authorization: `Bearer ${room.hostToken}` }, payload: { requestId: join.requestId } });
  const claimed = await app.inject({ method: "GET", url: `/api/rooms/${room.roomId}/join/${join.requestId}`, headers: { "x-hopnet-claim": join.claimToken } });
  const participantToken = claimed.json().sessionToken;
  const address = app.server.address();
  assert.ok(address && typeof address === "object");
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/signal?token=${participantToken}`);
  await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  const response = new Promise<Record<string, unknown>>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for topology authorization response.")), 2_000);
    socket.on("message", (raw) => {
      const value = JSON.parse(raw.toString()) as Record<string, unknown>;
      if (value.type === "error") {
        clearTimeout(timeout);
        resolve(value);
      }
    });
  });
  socket.send(JSON.stringify({ type: "set-topology", edges: [] }));
  const error = await response;
  assert.equal(error.code, "HOST_AUTH_REQUIRED");
  const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()));
  socket.close();
  await closed;
});
