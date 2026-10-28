import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import QRCode from "qrcode";
import { WebSocket, WebSocketServer } from "ws";
import { z } from "zod";
import {
  MAX_ROOM_PEERS,
  clientSocketMessageSchema,
  deviceCategorySchema,
  safeDisplayName,
  type Peer,
  type OverlayLink,
  type ServerSocketMessage,
  type TopologyEdge,
} from "@hopnet/protocol";
import { buildInvitationUrl, createNetworkConfig, discoverLanInterfaces, selectPublicOrigin, type LanInterface } from "./network.ts";

const createRoomSchema = z.object({
  displayName: z.string().min(1).max(80),
  deviceCategory: deviceCategorySchema,
});
const joinRoomSchema = createRoomSchema.extend({ inviteSecret: z.string().min(8).max(100), requestKey:z.string().uuid().optional() });
const approveSchema = z.object({ requestId: z.string().min(8) });

type Session = { token: string; peer: Peer; socket?: WebSocket; lastResumeId?:string };
type JoinRequest = {
  id: string;
  claimToken: string;
  displayName: string;
  deviceCategory: z.infer<typeof deviceCategorySchema>;
  createdAt: number;
  status: "pending" | "approved" | "rejected";
  session?: Session;
  requestKey?: string;
};
type Room = {
  id: string;
  inviteSecret: string;
  hostToken: string;
  createdAt: number;
  sessions: Map<string, Session>;
  joins: Map<string, JoinRequest>;
  edges: TopologyEdge[];
  links: Map<string, OverlayLink>;
  linkReports: Map<string, Map<string, { state: OverlayLink["state"]; rttMs?: number }>>;
};

const rooms = new Map<string, Room>();
const tokenIndex = new Map<string, { room: Room; session: Session }>();
const roomTtlMs = 12 * 60 * 60 * 1_000;
const joinTtlMs = 15 * 60_000;

function pendingRequests(room:Room) {
  return [...room.joins.values()].filter((join) => join.status === "pending").map((join) => ({ requestId:join.id,displayName:join.displayName,deviceCategory:join.deviceCategory,expiresAt:join.createdAt+joinTtlMs }));
}
function syncAdmissions(room:Room) {
  for (const join of room.joins.values()) if(Date.now()-join.createdAt>=joinTtlMs) room.joins.delete(join.id);
  const rejected=[...room.joins.values()].filter((join) => join.status === "rejected");
  for(const join of rejected.slice(0,Math.max(0,rejected.length-20))) room.joins.delete(join.id);
  const host=[...room.sessions.values()].find((session) => session.peer.role === "host");
  send(host?.socket,{ type:"pending-requests",requests:pendingRequests(room) });
}

const id = (prefix: string) => `${prefix}_${crypto.randomBytes(9).toString("base64url")}`;
const secret = () => crypto.randomBytes(24).toString("base64url");

function secretsEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function edgeKey(edge: TopologyEdge): string {
  return edge.a < edge.b ? `${edge.a}\u0000${edge.b}` : `${edge.b}\u0000${edge.a}`;
}

function publicPeer(session: Session): Peer {
  return { ...session.peer, coordinatorConnected: session.socket?.readyState === WebSocket.OPEN };
}

function send(socket: WebSocket | undefined, message: ServerSocketMessage): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function broadcast(room: Room, message: ServerSocketMessage, exceptPeerId?: string): void {
  for (const session of room.sessions.values()) {
    if (session.peer.id !== exceptPeerId) send(session.socket, message);
  }
}

function bearer(value: string | string[] | undefined): string | undefined {
  if (typeof value !== "string" || !value.startsWith("Bearer ")) return undefined;
  return value.slice(7);
}

export type BuildOptions = { serveWeb?: boolean; port?: number; networkInterfaces?: LanInterface[]; publicOrigin?: string };

export function requestLogFields(request: { method?: string; url?: string; ip?: string }) {
  return { method: request.method, url: request.url?.split("?")[0], remoteAddress: request.ip };
}

export async function buildApp(options: BuildOptions = {}): Promise<FastifyInstance> {
  const certPath = process.env.HOPNET_TLS_CERT;
  const keyPath = process.env.HOPNET_TLS_KEY;
  const https = certPath && keyPath ? { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) } : undefined;
  const protocol = https ? "https" : "http";
  const configuredPort = options.port ?? Number(process.env.PORT ?? 4173);
  const network = createNetworkConfig(protocol, configuredPort, options.networkInterfaces ?? discoverLanInterfaces(protocol, configuredPort), options.publicOrigin ?? process.env.HOPNET_PUBLIC_ORIGIN ?? process.env.RENDER_EXTERNAL_URL);
  // Fastify's overloads cannot express a server that is selected between HTTP and
  // HTTPS at runtime. The returned API remains the common FastifyInstance surface.
  const app = Fastify({ logger: process.env.NODE_ENV === "test" ? false : { serializers: { req: requestLogFields } }, bodyLimit: 96 * 1024, ...(https ? { https } : {}) } as never) as unknown as FastifyInstance;
  app.addHook("onRequest",async (request,reply) => { if(request.url.startsWith("/api/rooms")) reply.header("cache-control","no-store"); });
  const authenticated = (request: { headers:{ authorization?:string }; params:unknown }) => {
    const indexed=tokenIndex.get(bearer(request.headers.authorization) ?? "");
    return indexed?.room.id === (request.params as {roomId:string}).roomId ? indexed : undefined;
  };
  app.get("/api/rooms/:roomId/session",async (request,reply) => {
    const indexed=authenticated(request);
    if(!indexed) return reply.code(401).send({error:"SESSION_EXPIRED"});
    return {peer:publicPeer(indexed.session)};
  });
  app.post("/api/rooms/:roomId/resume",async (request,reply) => {
    const indexed=authenticated(request);
    const parsed=z.object({attemptId:z.string().uuid()}).safeParse(request.body);
    if(!indexed) return reply.code(401).send({error:"SESSION_EXPIRED"});
    if(!parsed.success) return reply.code(400).send({error:"INVALID_REQUEST"});
    const {room,session}=indexed;
    if(session.lastResumeId !== parsed.data.attemptId) {
      session.lastResumeId=parsed.data.attemptId;
      const old=session.socket; session.socket=undefined; old?.close(4001,"Session restarted");
      session.peer={...session.peer,generation:(session.peer.generation ?? 0)+1,receiptPublicKey:undefined};
      for(const [key,link] of room.links) if(link.a===session.peer.id || link.b===session.peer.id) {
        room.linkReports.delete(key); room.links.delete(key);
        broadcast(room,{type:"link-state-updated",link:{...link,state:"closed",rttMs:undefined,updatedAt:Date.now()}});
      }
      broadcast(room,{type:"peer-restarted",peer:publicPeer(session)});
    }
    return {roomId:room.id,inviteSecret:room.inviteSecret,hostToken:session.peer.role === "host" ? room.hostToken:undefined,peer:publicPeer(session),sessionToken:session.token};
  });
  app.get("/api/rooms/:roomId/pending",async (request,reply) => {
    const room=rooms.get((request.params as {roomId:string}).roomId);
    if(!room || bearer(request.headers.authorization)!==room.hostToken) return reply.code(403).send({error:"HOST_AUTH_REQUIRED"});
    syncAdmissions(room); return {requests:pendingRequests(room)};
  });
  app.post("/api/rooms/:roomId/reject",async (request,reply) => {
    const room=rooms.get((request.params as {roomId:string}).roomId);
    if(!room || bearer(request.headers.authorization)!==room.hostToken) return reply.code(403).send({error:"HOST_AUTH_REQUIRED"});
    syncAdmissions(room);
    const parsed=approveSchema.safeParse(request.body);
    const join=parsed.success ? room.joins.get(parsed.data.requestId):undefined;
    if(!join || join.status==="approved") return reply.code(409).send({error:"REQUEST_NO_LONGER_PENDING"});
    join.status="rejected"; syncAdmissions(room); return {status:"rejected"};
  });

  app.get("/api/health", async () => ({ status: "ok", service: "hopnet-coordinator", rooms: rooms.size }));
  app.get("/api/network", async (_request, reply) => reply.header("cache-control", "no-store").send({
    ...network,
    currentOriginHint: network.mode === "hosted" ? "Public HTTPS coordinator. Use this same address on all peers; WebRTC still requires a reachable peer network." : "Use the selected LAN origin on other devices; localhost is reachable only from this computer.",
  }));

  app.post("/api/rooms", async (request, reply) => {
    const parsed = createRoomSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_REQUEST" });
    if (rooms.size >= 128) return reply.code(503).send({ error: "ROOM_CAPACITY", message: "This classroom coordinator has reached its room limit. Retry later." });
    const roomId = id("room");
    const hostPeerId = id("peer");
    const session: Session = {
      token: secret(),
      peer: {
        id: hostPeerId,
        displayName: safeDisplayName(parsed.data.displayName),
        deviceCategory: parsed.data.deviceCategory,
        role: "host",
        coordinatorConnected: false,
        joinedAt: new Date().toISOString(),
      },
    };
    const room: Room = {
      id: roomId,
      inviteSecret: secret(),
      hostToken: secret(),
      createdAt: Date.now(),
      sessions: new Map([[hostPeerId, session]]),
      joins: new Map(),
      edges: [],
      linkReports: new Map(),
      links: new Map(),
    };
    rooms.set(roomId, room);
    tokenIndex.set(session.token, { room, session });
    return reply.code(201).send({
      roomId,
      inviteSecret: room.inviteSecret,
      hostToken: room.hostToken,
      peer: session.peer,
      sessionToken: session.token,
    });
  });

  app.post("/api/rooms/:roomId/join", async (request, reply) => {
    const room = rooms.get((request.params as { roomId: string }).roomId);
    const parsed = joinRoomSchema.safeParse(request.body);
    if (!room || !parsed.success || !secretsEqual(parsed.data.inviteSecret, room.inviteSecret)) {
      return reply.code(404).send({ error: "ROOM_NOT_FOUND" });
    }
    syncAdmissions(room);
    const previous=parsed.data.requestKey ? [...room.joins.values()].find((join) => join.requestKey===parsed.data.requestKey):undefined;
    if(previous) return reply.code(202).send({requestId:previous.id,claimToken:previous.claimToken,status:previous.status});
    if (pendingRequests(room).length >= 20) return reply.code(429).send({ error: "TOO_MANY_JOIN_REQUESTS" });
    const join: JoinRequest = {
      id: id("join"),
      claimToken: secret(),
      displayName: safeDisplayName(parsed.data.displayName),
      deviceCategory: parsed.data.deviceCategory,
      createdAt: Date.now(),
      status: "pending",
      requestKey:parsed.data.requestKey,
    };
    room.joins.set(join.id, join);
    const host = [...room.sessions.values()].find((item) => item.peer.role === "host");
    send(host?.socket, { type: "join-requested", requestId: join.id, displayName: join.displayName, deviceCategory: join.deviceCategory });
    syncAdmissions(room);
    return reply.code(202).send({ requestId: join.id, claimToken: join.claimToken, status: join.status });
  });

  app.get("/api/rooms/:roomId/join/:requestId", async (request, reply) => {
    const { roomId, requestId } = request.params as { roomId: string; requestId: string };
    const room = rooms.get(roomId);
    if(room) syncAdmissions(room);
    const join = room?.joins.get(requestId);
    const claimToken = request.headers["x-hopnet-claim"];
    if (!join || claimToken !== join.claimToken) return reply.code(404).send({ error: "JOIN_NOT_FOUND" });
    if (join.status !== "approved" || !join.session) return { status: join.status };
    return { status: "approved", peer: join.session.peer, sessionToken: join.session.token };
  });

  app.post("/api/rooms/:roomId/approve", async (request, reply) => {
    const room = rooms.get((request.params as { roomId: string }).roomId);
    const parsed = approveSchema.safeParse(request.body);
    const token = bearer(request.headers.authorization);
    if (!room || token !== room.hostToken) return reply.code(403).send({ error: "HOST_AUTH_REQUIRED" });
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_REQUEST" });
    syncAdmissions(room);
    const join = room.joins.get(parsed.data.requestId);
    if(join?.status === "approved" && join.session) return {status:"approved",peer:join.session.peer};
    if (!join || join.status !== "pending") return reply.code(409).send({ error:"REQUEST_NO_LONGER_PENDING",message:"This request expired or is no longer pending." });
    if (room.sessions.size >= MAX_ROOM_PEERS) return reply.code(409).send({ error: "ROOM_CAPACITY", message: `This classroom room supports up to ${MAX_ROOM_PEERS} admitted peers, including the host. Create another room for a new session.` });
    const peerId = id("peer");
    const session: Session = {
      token: secret(),
      peer: {
        id: peerId,
        displayName: join.displayName,
        deviceCategory: join.deviceCategory,
        role: "participant",
        coordinatorConnected: false,
        joinedAt: new Date().toISOString(),
      },
    };
    join.status = "approved";
    join.session = session;
    room.sessions.set(peerId, session);
    syncAdmissions(room);
    tokenIndex.set(session.token, { room, session });
    const host = [...room.sessions.values()].find((item) => item.peer.role === "host")!;
    room.edges.push({ a: host.peer.id, b: peerId });
    broadcast(room, { type: "topology-updated", edges: room.edges, changedByPeerId: host.peer.id });
    return { status: "approved", peer: session.peer };
  });

  app.get("/api/rooms/:roomId/qr", async (request, reply) => {
    const room = rooms.get((request.params as { roomId: string }).roomId);
    const { invite, origin } = request.query as { invite?: string; origin?: string };
    if (!room || invite !== room.inviteSecret) return reply.code(404).send({ error: "ROOM_NOT_FOUND" });
    const selectedOrigin = selectPublicOrigin(network, origin);
    if (!selectedOrigin) return reply.code(400).send({ error: "INVALID_PUBLIC_ORIGIN", message: "Choose one of the coordinator's detected LAN addresses." });
    const joinUrl = buildInvitationUrl(selectedOrigin, room.id, room.inviteSecret);
    const svg = await QRCode.toString(joinUrl, { type: "svg", margin: 1, color: { dark: "#171C29", light: "#0000" } });
    return reply.header("cache-control", "no-store").header("x-hopnet-invitation-origin", selectedOrigin).type("image/svg+xml").send(svg);
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 96 * 1024 });
  app.server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (url.pathname !== "/signal") return socket.destroy();
    const indexed = tokenIndex.get(url.searchParams.get("token") ?? "");
    if (!indexed) return socket.destroy();
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws, indexed));
  });

  wss.on("connection", (socket: WebSocket, indexed: { room: Room; session: Session }) => {
    const { room, session } = indexed;
    if (session.socket?.readyState === WebSocket.OPEN) session.socket.close(4001, "Replaced by a newer connection");
    session.socket = socket;
    send(socket, { type: "room-snapshot", selfPeerId: session.peer.id, peers: [...room.sessions.values()].map(publicPeer), edges: room.edges, links: [...room.links.values()] });
    broadcast(room, { type: "peer-joined", peer: publicPeer(session) }, session.peer.id);

    socket.on("message", (raw) => {
      if(session.socket !== socket) return;
      const rawBytes = Array.isArray(raw) ? raw.reduce((total, item) => total + item.byteLength, 0) : raw.byteLength;
      if (rawBytes > 96 * 1024) return socket.close(1009, "Message too large");
      let json: unknown;
      try { json = JSON.parse(raw.toString()); } catch { return send(socket, { type: "error", code: "INVALID_JSON", message: "Message must be JSON." }); }
      const parsed = clientSocketMessageSchema.safeParse(json);
      if (!parsed.success) return send(socket, { type: "error", code: "INVALID_MESSAGE", message: "Message does not match protocol." });
      if (parsed.data.type === "publish-receipt-key") {
        if (session.peer.receiptPublicKey && session.peer.receiptPublicKey !== parsed.data.publicKey) return send(socket, { type: "error", code: "KEY_ALREADY_BOUND", message: "This session already has a receipt identity. Rejoin to create a new one." });
        session.peer.receiptPublicKey = parsed.data.publicKey;
        broadcast(room, { type: "peer-key-updated", peerId: session.peer.id, publicKey: parsed.data.publicKey });
        return;
      }
      if (parsed.data.type === "heartbeat") {
        return send(socket, { type: "heartbeat-ack", sentAt: parsed.data.sentAt, coordinatorAt: Date.now() });
      }
      if (parsed.data.type === "set-topology") {
        if (session.peer.role !== "host") return send(socket, { type: "error", code: "HOST_AUTH_REQUIRED", message: "Only the room host can change the overlay topology." });
        const seen = new Set<string>();
        for (const edge of parsed.data.edges) {
          const key = edgeKey(edge);
          if (edge.a === edge.b || seen.has(key) || !room.sessions.has(edge.a) || !room.sessions.has(edge.b)) {
            return send(socket, { type: "error", code: "INVALID_TOPOLOGY", message: "Topology contains an invalid or duplicate edge." });
          }
          seen.add(key);
        }
        room.edges = parsed.data.edges;
        const permitted = new Set(room.edges.map(edgeKey));
        for (const key of room.links.keys()) if (!permitted.has(key)) { room.links.delete(key); room.linkReports.delete(key); }
        broadcast(room, { type: "topology-updated", edges: room.edges, changedByPeerId: session.peer.id });
        return;
      }
      if (parsed.data.type === "link-state") {
        const candidate: TopologyEdge = { a: session.peer.id, b: parsed.data.peerId };
        const key = edgeKey(candidate);
        if (!room.edges.some((edge) => edgeKey(edge) === key)) {
          // Remote close notifications may race the topology broadcast. They
          // cannot create a link and are expected after host revocation.
          if (parsed.data.state === "closed" || parsed.data.state === "degraded") return;
          return send(socket, { type: "error", code: "UNPERMITTED_LINK", message: "Link state does not belong to the permitted overlay." });
        }
        const reports = room.linkReports.get(key) ?? new Map<string, { state: OverlayLink["state"]; rttMs?: number }>();
        reports.set(session.peer.id, { state: parsed.data.state, rttMs: parsed.data.rttMs });
        room.linkReports.set(key, reports);
        const states = [reports.get(candidate.a)?.state, reports.get(candidate.b)?.state];
        const state: OverlayLink["state"] = states.every((value) => value === "direct") ? "direct" : states.includes("closed") ? "closed" : states.includes("degraded") ? "degraded" : "connecting";
        const measured = [...reports.values()].flatMap((report) => report.rttMs === undefined ? [] : [report.rttMs]);
        const link: OverlayLink = {
          a: candidate.a < candidate.b ? candidate.a : candidate.b,
          b: candidate.a < candidate.b ? candidate.b : candidate.a,
          state,
          reportedByPeerId: session.peer.id,
          rttMs: measured.length ? measured.reduce((sum, value) => sum + value, 0) / measured.length : undefined,
          updatedAt: Date.now(),
        };
        room.links.set(key, link);
        broadcast(room, { type: "link-state-updated", link });
        return;
      }
      const target = room.sessions.get(parsed.data.targetPeerId);
      if (!target?.socket || target.socket.readyState !== WebSocket.OPEN) {
        return send(socket, { type: "error", code: "PEER_UNAVAILABLE", message: "Target peer is not connected to the coordinator." });
      }
      if (parsed.data.type === "signal") {
        const targetPeerId = parsed.data.targetPeerId;
        if (!room.edges.some((edge) => edgeKey(edge) === edgeKey({ a: session.peer.id, b: targetPeerId }))) return send(socket, { type: "error", code: "UNPERMITTED_LINK", message: "Signaling requires a host-permitted overlay link." });
        send(target.socket, { type: "signal", sourcePeerId: session.peer.id, signal: parsed.data.signal });
      } else {
        send(target.socket, { type: "relay-data", sourcePeerId: session.peer.id, payload: parsed.data.payload });
      }
    });

    if(session.peer.role === "host") syncAdmissions(room);

    socket.on("close", () => {
      if (session.socket !== socket) return;
      session.socket = undefined;
      broadcast(room, { type: "peer-left", peerId: session.peer.id }, session.peer.id);
    });
  });

  app.addHook("onClose", async () => wss.close());

  if (options.serveWeb !== false) {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const webRoot = path.resolve(here, "../../web/dist");
    if (fs.existsSync(webRoot)) {
      await app.register(fastifyStatic, { root: webRoot, wildcard: false });
      app.setNotFoundHandler((request, reply) => {
        if (request.url.startsWith("/api/") || request.url.startsWith("/signal")) return reply.code(404).send({ error: "NOT_FOUND" });
        return reply.sendFile("index.html");
      });
    }
  }

  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [roomId, room] of rooms) {
      syncAdmissions(room);
      if (now - room.createdAt > roomTtlMs && [...room.sessions.values()].every((item) => !item.socket)) {
        for (const session of room.sessions.values()) tokenIndex.delete(session.token);
        rooms.delete(roomId);
      }
    }
  }, 60_000).unref();
  app.addHook("onClose", async () => clearInterval(cleanup));
  return app;
}
