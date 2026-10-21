import { routerObservationSchema, type DataPacket } from "@hopnet/protocol";
import { canonicalEdge, edgeCost, selectPath, type GraphEdge, type RouteStrategy } from "@hopnet/routing";
import { createUuid } from "./id.ts";

type Control = Extract<DataPacket, { kind: "router-control" }>;
export type Datagram = Extract<DataPacket, { kind: "router-data" }>;
export type Neighbor = { id: string; channelOpen: boolean; active: boolean; lastHello: number; rttMs: number };
export type Advertisement = { origin: string; sequence: number; receivedAt: number; expiresAt: number; neighbors: Array<{ id: string; rttMs: number }> };
export type ForwardingEntry = { destination: string; nextHop: string; path: string[]; cost: number };
export type RouterEvent = { type: string; detail: string; path?: string[]; packetId?: string; origin?: string };
export type RouterSnapshot = {
  id: string; observedAt: number; strategy: RouteStrategy; digest: string;
  receivedLocallyAt?: number;
  neighbors: Neighbor[]; lsdb: Advertisement[]; table: ForwardingEntry[];
  counters: { helloSent: number; helloReceived: number; lsaSent: number; lsaReceived: number; duplicates: number; recomputations: number; forwarded: number; received: number; dropped: number; controlBytes: number };
  convergence: { startedAt: number; lastChangeAt: number; settledAt?: number; agreementAt?: number; before: ForwardingEntry[]; after: ForwardingEntry[] } | null;
};

type Dependencies = {
  self: string; peers: () => string[]; send: (peer: string, packet: DataPacket) => void;
  update: (snapshot: RouterSnapshot, reports: RouterSnapshot[]) => void;
  event: (event: RouterEvent) => void; deliver: (packet: Datagram) => void;
  now?: () => number;
};

const HELLO_INTERVAL = 1000, DEAD_INTERVAL = 4500, REFRESH_INTERVAL = 6000, MAX_AGE = 18000;

/** A bounded, cooperative link-state overlay. The coordinator is NOT its LSDB.
 * All control packets and reports traverse authorized, open RTCDataChannels.
 * Monotonic times are local; a remote report is never a synchronized clock.
 */
export class DistributedRouter {
  private neighbors = new Map<string, Neighbor>();
  private database = new Map<string, Advertisement>();
  private highestSequence = new Map<string, number>();
  private reports = new Map<string, { value: RouterSnapshot; receivedAt: number; sequence: number }>();
  private seen = new Map<string, number>();
  private pending = new Map<string, number>();
  private table: ForwardingEntry[] = [];
  private strategy: RouteStrategy = "minimum-hops";
  private sequence = 0;
  private helloSequence = 0;
  private reportSequence = 0;
  private lastHello = -Infinity;
  private lastLsa = -Infinity;
  private lastReport = -Infinity;
  private digest = "";
  private convergence: RouterSnapshot["convergence"] = null;
  private counters: RouterSnapshot["counters"] = { helloSent: 0, helloReceived: 0, lsaSent: 0, lsaReceived: 0, duplicates: 0, recomputations: 0, forwarded: 0, received: 0, dropped: 0, controlBytes: 0 };
  private timer?: ReturnType<typeof setInterval>;
  private lastUpdate = -Infinity;
  private now: () => number;

  constructor(private readonly dependencies: Dependencies) {
    this.now = dependencies.now ?? (() => performance.now());
    this.originate();
  }

  start() { this.timer ??= setInterval(() => this.tick(), 250); }
  dispose() { clearInterval(this.timer); this.timer = undefined; }
  setStrategy(strategy: RouteStrategy) { if (this.strategy !== strategy) { this.strategy = strategy; this.recompute(true); this.publish(); } }

  setLink(id: string, open: boolean) {
    const old = this.neighbors.get(id);
    if (old?.channelOpen === open) return;
    if (!open) {
      if (!old) return;
      old.channelOpen = false; old.active = false;
      this.event("neighbor-down", `${id} channel closed`, [this.dependencies.self, id]);
      this.originate(); this.publish(); return;
    }
    this.neighbors.set(id, { id, channelOpen: true, active: false, lastHello: this.now(), rttMs: 500 });
    this.hello(id);
    this.publish();
  }

  tick() {
    const now = this.now();
    for (const neighbor of this.neighbors.values()) {
      if (neighbor.active && now - neighbor.lastHello > DEAD_INTERVAL) {
        neighbor.active = false;
        this.event("neighbor-down", `${neighbor.id} missed hello deadline`, [this.dependencies.self, neighbor.id]);
        this.originate();
      }
    }
    if (now - this.lastHello >= HELLO_INTERVAL) {
      this.lastHello = now;
      for (const neighbor of this.neighbors.values()) if (neighbor.channelOpen) this.hello(neighbor.id);
    }
    let expired = false;
    for (const [id, lsa] of this.database) if (id !== this.dependencies.self && lsa.expiresAt <= now) { this.database.delete(id); expired = true; this.event("lsa-expired", `${id} exceeded maximum age`); }
    if (expired) this.recompute();
    for (const [key, expires] of this.seen) if (expires <= now) this.seen.delete(key);
    for (const [key, sent] of this.pending) if (now - sent > DEAD_INTERVAL) this.pending.delete(key);
    if (now - this.lastLsa >= REFRESH_INTERVAL) this.originate();
    if (this.convergence && !this.convergence.settledAt && now - this.convergence.lastChangeAt >= 1000) {
      this.convergence.settledAt = now;
      this.event("local-converged", `Local forwarding table stable for 1000 ms; observation window ${(now - this.convergence.startedAt).toFixed(1)} ms`);
    }
    if (this.convergence?.settledAt && !this.convergence.agreementAt && this.table.every((row) => {
      const report = this.reports.get(row.destination);
      return report && now - report.receivedAt < MAX_AGE && report.value.digest === this.digest;
    })) {
      this.convergence.agreementAt = now;
      this.event("component-converged", `${this.table.length + 1} reachable routers report the same graph; observer window ${(now - this.convergence.startedAt).toFixed(1)} ms. Unreachable peers are not covered.`);
    }
    if (now - this.lastReport >= 3000) this.publish();
    if (now - this.lastUpdate >= 500) this.update();
  }

  handle(from: string, packet: DataPacket): boolean {
    if (packet.kind !== "router-control" && packet.kind !== "router-data") return false;
    if (!this.neighbors.get(from)?.channelOpen || !this.dependencies.peers().includes(from)) { this.drop("unbound ingress", [from]); return true; }
    if (packet.kind === "router-data") { this.receiveData(from, packet); return true; }
    const now = this.now();
    if (packet.type === "hello" || packet.type === "hello-ack") {
      if (packet.origin !== from) { this.drop("hello origin does not match channel"); return true; }
      const neighbor = this.neighbors.get(from)!;
      if (packet.type === "hello-ack") {
        const key = `${from}:${packet.sequence}`, sent = this.pending.get(key);
        if (sent === undefined) return true;
        this.pending.delete(key);
        // A delayed ACK after browser suspension cannot prove current liveness.
        if (now - sent > DEAD_INTERVAL) return true;
        neighbor.rttMs = Math.max(.1, now - sent);
      } else {
        this.counters.helloReceived++;
        this.event("hello-received", `Hello ${packet.sequence} from ${from}`, [from, this.dependencies.self]);
        this.send(from, this.control("hello-ack", packet.sequence));
      }
      neighbor.lastHello = now;
      if (!neighbor.active) {
        neighbor.active = true;
        this.event("neighbor-up", `${from} exchanged a real hello`, [this.dependencies.self, from]);
        this.originate();
        for (const lsa of this.database.values()) if (lsa.origin !== this.dependencies.self) this.send(from, this.lsaPacket(lsa));
        this.publish();
      }
      return true;
    }
    if (!this.dependencies.peers().includes(packet.origin) || packet.origin === this.dependencies.self || packet.ageMs >= MAX_AGE) return true;
    if (packet.type === "lsa") {
      if (!packet.neighbors || new Set(packet.neighbors.map((n) => n.id)).size !== packet.neighbors.length || packet.neighbors.some((n) => n.id === packet.origin || !this.dependencies.peers().includes(n.id))) { this.drop("invalid LSA neighbors"); return true; }
      if ((this.highestSequence.get(packet.origin) ?? -1) >= packet.sequence) { this.counters.duplicates++; return true; }
      this.highestSequence.set(packet.origin, packet.sequence);
      this.database.set(packet.origin, { origin: packet.origin, sequence: packet.sequence, receivedAt: now, expiresAt: now + MAX_AGE - packet.ageMs, neighbors: packet.neighbors });
      this.counters.lsaReceived++;
      this.event("lsa-received", `LSA ${packet.sequence} from ${packet.origin} via ${from}`, [from, this.dependencies.self], packet.origin);
      this.recompute(); this.flood(packet, from); this.update();
    } else if (packet.type === "report") {
      const old = this.reports.get(packet.origin);
      if (old && old.sequence >= packet.sequence) { this.counters.duplicates++; return true; }
      // Reports are observation-only: never feed another router's table into SPF.
      try {
        const parsed = routerObservationSchema.safeParse(JSON.parse(packet.report ?? ""));
        if (!parsed.success || parsed.data.id !== packet.origin) { this.drop("invalid observation report"); return true; }
        const value = parsed.data;
        this.reports.set(packet.origin, { value, receivedAt: now, sequence: packet.sequence });
        this.flood(packet, from); this.update();
      } catch { this.drop("invalid observation report"); }
    }
    return true;
  }

  sendMessage(destination: string, body: string, messageId = createUuid()) {
    if (!body.trim() || body.length > 8192) throw new Error("A routed message requires 1–8192 characters.");
    const packet: Datagram = { kind: "router-data", protocolVersion: 1, packetId: createUuid(), messageId, source: this.dependencies.self, destination, sequence: ++this.helloSequence, ttl: 8, trace: [this.dependencies.self], purpose: "message", body };
    this.forward(packet); return messageId;
  }

  graph(): GraphEdge[] {
    const edges: GraphEdge[] = [], known = this.dependencies.peers();
    for (const lsa of this.database.values()) for (const n of lsa.neighbors) {
      if (lsa.origin >= n.id || !known.includes(lsa.origin) || !known.includes(n.id)) continue;
      const reverse = this.database.get(n.id)?.neighbors.find((other) => other.id === lsa.origin);
      if (!reverse) continue;
      const localId = lsa.origin === this.dependencies.self ? n.id : n.id === this.dependencies.self ? lsa.origin : undefined;
      if (localId && !this.neighbors.get(localId)?.active) continue;
      edges.push({ a: lsa.origin, b: n.id, metrics: { rttMs: (n.rttMs + reverse.rttMs) / 2, measuredAt: Date.now() } });
    }
    return edges.sort((a, b) => canonicalEdge(a.a, a.b).localeCompare(canonicalEdge(b.a, b.b)));
  }

  snapshot(): RouterSnapshot {
    return structuredClone({ id: this.dependencies.self, observedAt: this.now(), strategy: this.strategy, digest: this.digest, neighbors: [...this.neighbors.values()], lsdb: [...this.database.values()], table: this.table, counters: this.counters, convergence: this.convergence });
  }

  private receiveData(from: string, packet: Datagram) {
    if (packet.trace.at(-1) !== from || packet.trace[0] !== packet.source || packet.trace.includes(this.dependencies.self) || new Set(packet.trace).size !== packet.trace.length || !this.dependencies.peers().includes(packet.source) || !this.dependencies.peers().includes(packet.destination)) { this.drop("trace or endpoint invariant", packet.trace); return; }
    const key = `${packet.source}:${packet.packetId}`;
    if (this.seen.has(key)) { this.counters.duplicates++; this.event("packet-duplicate", packet.packetId); return; }
    if (this.seen.size >= 4096) this.seen.delete(this.seen.keys().next().value!);
    this.seen.set(key, this.now() + 60000);
    const trace = [...packet.trace, this.dependencies.self];
    if (packet.destination === this.dependencies.self) {
      this.counters.received++;
      this.event(packet.purpose === "ack" ? "delivery-ack" : "packet-delivered", `${packet.messageId} reached destination`, trace);
      this.dependencies.deliver({ ...packet, trace });
      if (packet.purpose === "message") {
        try { this.forward({ ...packet, packetId: createUuid(), source: this.dependencies.self, destination: packet.source, purpose: "ack", body: "", trace: [this.dependencies.self], ttl: 8 }); }
        catch { this.drop("destination received payload but ACK has no return route", trace); }
      }
    } else if (packet.ttl <= 1 || trace.length >= 8) this.drop("TTL exhausted", trace);
    else {
      try { this.forward({ ...packet, ttl: packet.ttl - 1, trace }); this.counters.forwarded++; }
      catch (cause) { this.drop(cause instanceof Error ? cause.message : "forward failed", trace); }
    }
    this.update();
  }

  private forward(packet: Datagram) {
    const route = this.table.find((row) => row.destination === packet.destination);
    if (!route || !this.neighbors.get(route.nextHop)?.active) throw new Error("No distributed forwarding-table route is established.");
    if (packet.trace.includes(route.nextHop)) throw new Error("Forwarding loop suppressed.");
    this.dependencies.send(route.nextHop, packet);
    this.event("packet-forward", `Local table: ${packet.destination} → next hop ${route.nextHop}`, [...packet.trace, route.nextHop]);
  }

  private originate() {
    this.lastLsa = this.now();
    const lsa: Advertisement = { origin: this.dependencies.self, sequence: ++this.sequence, receivedAt: this.now(), expiresAt: this.now() + MAX_AGE, neighbors: [...this.neighbors.values()].filter((n) => n.active).map((n) => ({ id: n.id, rttMs: Math.round(n.rttMs) })).sort((a, b) => a.id.localeCompare(b.id)) };
    this.database.set(lsa.origin, lsa); this.counters.lsaSent++;
    this.event("lsa-originated", `LSA ${lsa.sequence}: ${lsa.neighbors.length} direct neighbors`);
    this.recompute(); this.flood(this.lsaPacket(lsa));
  }

  private recompute(force = false) {
    const graph = this.graph();
    const digest = JSON.stringify(graph.map((e) => [e.a, e.b, this.strategy === "minimum-hops" ? 1 : Math.round(e.metrics!.rttMs! / 10) * 10]));
    if (!force && this.digest === digest) return;
    const before = this.table;
    this.digest = digest; this.table = [];
    for (const destination of this.dependencies.peers()) {
      if (destination === this.dependencies.self) continue;
      try {
        const path = selectPath(this.dependencies.peers(), graph, this.dependencies.self, destination, this.strategy);
        this.table.push({ destination, nextHop: path[1]!, path, cost: path.slice(1).reduce((sum, id, i) => { const edge = graph.find((e) => canonicalEdge(e.a, e.b) === canonicalEdge(path[i]!, id))!; return sum + (this.strategy === "minimum-hops" ? 1 : edgeCost(edge, this.strategy)); }, 0) });
      } catch { /* A partition creates an absent route, never a fabricated row. */ }
    }
    this.counters.recomputations++;
    const now = this.now();
    this.convergence = { startedAt: this.convergence && !this.convergence.settledAt ? this.convergence.startedAt : now, lastChangeAt: now, before: this.convergence && !this.convergence.settledAt ? this.convergence.before : before, after: this.table };
    this.event("route-recompute", `${this.table.length} reachable destinations; local SPF #${this.counters.recomputations}`);
    this.update();
  }

  private control(type: Control["type"], sequence: number): Control { return { kind: "router-control", protocolVersion: 1, type, origin: this.dependencies.self, sequence, ttl: 8, ageMs: 0 }; }
  private lsaPacket(lsa: Advertisement): Control { return { ...this.control("lsa", lsa.sequence), origin: lsa.origin, neighbors: lsa.neighbors, ageMs: Math.max(0, MAX_AGE - (lsa.expiresAt - this.now())) }; }
  private hello(id: string) { const seq = ++this.helloSequence; this.pending.set(`${id}:${seq}`, this.now()); this.counters.helloSent++; this.send(id, this.control("hello", seq)); }
  private send(to: string, packet: Control) { try { this.dependencies.send(to, packet); this.counters.controlBytes += new TextEncoder().encode(JSON.stringify(packet)).length; } catch { /* Closed-channel callbacks or hello deadline withdraw the link. */ } }
  private flood(packet: Control, except?: string) { if (packet.ttl <= 1) return; for (const n of this.neighbors.values()) if (n.active && n.id !== except) this.send(n.id, { ...packet, ttl: packet.ttl - 1 }); }
  private publish() {
    this.lastReport = this.now();
    this.flood({ ...this.control("report", ++this.reportSequence), report: JSON.stringify(this.snapshot()) }); this.update();
  }
  private update() { this.lastUpdate = this.now(); this.dependencies.update(this.snapshot(), [...this.reports.values()].filter((r) => this.now() - r.receivedAt < MAX_AGE).map((r) => ({ ...r.value, receivedLocallyAt: r.receivedAt }))); }
  private drop(reason: string, path?: string[]) { this.counters.dropped++; this.event("packet-drop", reason, path); }
  private event(type: string, detail: string, path?: string[], origin = this.dependencies.self) { this.dependencies.event({ type, detail, path, origin }); }
}
