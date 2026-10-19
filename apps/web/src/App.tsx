import { useEffect, useRef, useState } from "react";
import { PROTOCOL_VERSION, serverSocketMessageSchema, type DataPacket, type DeviceCategory, type OverlayLink, type Peer, type TopologyEdge, type TransferDataPacket } from "@hopnet/protocol";
import { canonicalEdge, selectPath, twoNodeDisjointPaths, type GraphEdge, type RouteStrategy } from "@hopnet/routing";
import { PeerManager, type LinkState } from "./lib/peer-manager.ts";
import { createUuid } from "./lib/id.ts";
import { TransferManager, type TransferView } from "./lib/transfer-manager.ts";
import { RoomSurface, type NetworkEvent } from "./components/RoomSurface.tsx";

type Credentials = { roomId: string; inviteSecret: string; hostToken?: string; peer: Peer; sessionToken: string };
type JoinRequest = { requestId: string; displayName: string; deviceCategory: DeviceCategory };
type EventItem = NetworkEvent;
export type NetworkInfo = {
  protocol: "http" | "https";
  port: number;
  interfaces: Array<{ id: string; name: string; address: string; origin: string; kind: "private" | "link-local" | "other"; recommended: boolean }>;
  preferredOrigin: string | null;
  localOrigin: string;
  secure: boolean;
  currentOriginHint: string;
};

const query = new URLSearchParams(location.search);
const invitedRoom = query.get("room") ?? "";
const invitedSecret = query.get("invite") ?? "";

function App() {
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [links, setLinks] = useState<Record<string, LinkState>>({});
  const [topologyEdges, setTopologyEdges] = useState<TopologyEdge[]>([]);
  const [observedLinks, setObservedLinks] = useState<OverlayLink[]>([]);
  const [routeStrategy, setRouteStrategy] = useState<RouteStrategy>("minimum-hops");
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [selectedPeerId, setSelectedPeerId] = useState<string>();
  const [coordinatorState, setCoordinatorState] = useState("offline");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [joinPending, setJoinPending] = useState(false);
  const [transfers, setTransfers] = useState<TransferView[]>([]);
  const [networkInfo, setNetworkInfo] = useState<NetworkInfo>();
  const [invitationOrigin, setInvitationOrigin] = useState(location.origin);
  const socketRef = useRef<WebSocket | undefined>(undefined);
  const managerRef = useRef<PeerManager | undefined>(undefined);
  const peersRef = useRef<Peer[]>([]);
  const topologyRef = useRef<TopologyEdge[]>([]);
  const graphRef = useRef<GraphEdge[]>([]);
  const routeStrategyRef = useRef<RouteStrategy>(routeStrategy);
  const transferManagerRef = useRef<TransferManager | undefined>(undefined);
  const seenPacketsRef = useRef(new Map<string, number>());

  useEffect(() => { peersRef.current = peers; }, [peers]);
  useEffect(() => { topologyRef.current = topologyEdges; }, [topologyEdges]);
  useEffect(() => {
    graphRef.current = observedLinks
      .filter((link) => link.state === "direct" && topologyEdges.some((edge) => canonicalEdge(edge.a, edge.b) === canonicalEdge(link.a, link.b)))
      .map((link) => ({ a: link.a, b: link.b, metrics: { rttMs: link.rttMs, measuredAt: link.updatedAt } }));
  }, [observedLinks, topologyEdges]);
  useEffect(() => { routeStrategyRef.current = routeStrategy; }, [routeStrategy]);
  useEffect(() => {
    let active = true;
    void fetch("/api/network", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Network discovery failed.");
        return response.json() as Promise<NetworkInfo>;
      })
      .then((info) => {
        if (!active) return;
        setNetworkInfo(info);
        if (!invitedRoom && info.preferredOrigin) setInvitationOrigin(info.preferredOrigin);
      })
      .catch(() => { if (active) setError("HOPNET could not discover a LAN invitation address."); });
    return () => { active = false; };
  }, []);

  const addEvent = (title: string, detail: string, provenance: EventItem["provenance"] = "REAL") => {
    setEvents((current) => [{ id: createUuid(), at: new Date(), title, detail, provenance }, ...current].slice(0, 30));
  };

  useEffect(() => {
    if (!credentials) return;
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${location.host}/signal?token=${encodeURIComponent(credentials.sessionToken)}`);
    socketRef.current = socket;
    const syncTopology = (nextEdges: TopologyEdge[], knownPeers: Peer[]) => {
      setTopologyEdges(nextEdges);
      topologyRef.current = nextEdges;
      const adjacent = new Set(nextEdges.flatMap((edge) => edge.a === credentials.peer.id ? [edge.b] : edge.b === credentials.peer.id ? [edge.a] : []));
      for (const peer of knownPeers) {
        if (peer.id === credentials.peer.id) continue;
        if (adjacent.has(peer.id) && peer.coordinatorConnected) manager.ensure(peer.id);
        if (!adjacent.has(peer.id)) manager.close(peer.id);
      }
    };
    let transferManager: TransferManager;
    const manager = new PeerManager(
      credentials.peer.id,
      (targetPeerId, signal) => socket.send(JSON.stringify({ type: "signal", targetPeerId, signal })),
      (state) => {
        setLinks((current) => ({ ...current, [state.peerId]: state }));
        if (socket.readyState === WebSocket.OPEN && state.state !== "new") {
          socket.send(JSON.stringify({ type: "link-state", peerId: state.peerId, state: state.state, rttMs: state.rttMs }));
        }
      },
      (peerId, packet) => onDataPacket(peerId, packet),
    );
    managerRef.current = manager;
    transferManager = new TransferManager({
      selfPeerId: credentials.peer.id,
      getPaths: (destinationPeerId) => twoNodeDisjointPaths(peersRef.current.map((peer) => peer.id), graphRef.current, credentials.peer.id, destinationPeerId, routeStrategyRef.current),
      isPermittedEdge: (a, b) => topologyRef.current.some((edge) => canonicalEdge(edge.a, edge.b) === canonicalEdge(a, b)),
      send: (nextHop, packet) => manager.sendPacketAsync(nextHop, packet),
      onUpdate: (transfer) => setTransfers((current) => [transfer, ...current.filter((item) => item.id !== transfer.id)].slice(0, 12)),
      onEvent: (title, detail) => addEvent(title, detail),
    });
    transferManagerRef.current = transferManager;
    const onDataPacket = (peerId: string, packet: DataPacket) => {
      const source = peersRef.current.find((peer) => peer.id === peerId)?.displayName ?? `peer …${peerId.slice(-5)}`;
      if (isTransferPacket(packet)) {
        void transferManager.handle(peerId, packet).catch((cause) => addEvent("Transfer forwarding failed", cause instanceof Error ? cause.message : "Unknown transfer error", "INFERRED"));
        return;
      }
      if (packet.kind === "pong") addEvent("Direct echo returned", `${source} replied over RTCDataChannel`);
      if (packet.kind === "message") addEvent(`Message from ${source}`, packet.body);
      if (packet.kind === "message-ack") addEvent("Message acknowledged", `${source} confirmed application receipt`);
      if (packet.kind !== "routed-message" && packet.kind !== "route-receipt") return;
      const now = Date.now();
      for (const [key, seenAt] of seenPacketsRef.current) if (now - seenAt > 60_000) seenPacketsRef.current.delete(key);
      const duplicateKey = `${packet.kind}:${packet.routeId}:${packet.hopIndex}`;
      if (seenPacketsRef.current.has(duplicateKey)) return;
      seenPacketsRef.current.set(duplicateKey, now);
      if (packet.ttl < 1 || packet.path[packet.hopIndex] !== credentials.peer.id || packet.nextHop !== credentials.peer.id) {
        addEvent("Route packet rejected", "Hop, next-hop, or TTL invariant failed", "INFERRED");
        return;
      }
      if (packet.destinationPeerId === credentials.peer.id) {
        if (packet.kind === "routed-message") {
          addEvent("Routed message delivered", `${packet.path.length - 1} hops · ${packet.body}`);
          const reverse = [...packet.path].reverse();
          manager.sendPacket(reverse[1], {
            protocolVersion: PROTOCOL_VERSION,
            kind: "route-receipt",
            messageId: packet.messageId,
            sourcePeerId: credentials.peer.id,
            destinationPeerId: packet.sourcePeerId,
            routeId: packet.routeId,
            nextHop: reverse[1],
            path: reverse,
            hopIndex: 1,
            ttl: reverse.length + 2,
            createdAt: Date.now(),
            status: "delivered",
          });
        } else {
          addEvent("Route receipt returned", `${packet.path.length - 1} hops · destination confirmed delivery`);
        }
        return;
      }
      const nextHop = packet.path[packet.hopIndex + 1];
      if (!nextHop || packet.ttl <= 1 || !topologyRef.current.some((edge) => canonicalEdge(edge.a, edge.b) === canonicalEdge(credentials.peer.id, nextHop))) {
        addEvent("Route forwarding stopped", "No permitted next hop or TTL exhausted", "INFERRED");
        return;
      }
      manager.sendPacket(nextHop, { ...packet, nextHop, hopIndex: packet.hopIndex + 1, ttl: packet.ttl - 1 });
      addEvent("Payload forwarded", `${source} → ${peersRef.current.find((peer) => peer.id === nextHop)?.displayName ?? "next hop"}`);
    };
    socket.onopen = () => { setCoordinatorState("connected"); addEvent("Coordinator connected", "Authenticated signaling socket is open"); };
    socket.onclose = () => setCoordinatorState("disconnected");
    socket.onerror = () => setError("The coordinator connection failed.");
    socket.onmessage = ({ data }) => {
      let json: unknown;
      try { json = JSON.parse(data); } catch { return; }
      const parsed = serverSocketMessageSchema.safeParse(json);
      if (!parsed.success) return;
      const item = parsed.data;
      if (item.type === "room-snapshot") {
        setPeers(item.peers);
        peersRef.current = item.peers;
        setObservedLinks(item.links);
        syncTopology(item.edges, item.peers);
      } else if (item.type === "peer-joined") {
        setPeers((current) => [...current.filter((peer) => peer.id !== item.peer.id), item.peer]);
        peersRef.current = [...peersRef.current.filter((peer) => peer.id !== item.peer.id), item.peer];
        if (topologyRef.current.some((edge) => (edge.a === credentials.peer.id && edge.b === item.peer.id) || (edge.b === credentials.peer.id && edge.a === item.peer.id))) manager.ensure(item.peer.id);
        addEvent("Peer joined", `${item.peer.displayName} is connected to the coordinator`);
      } else if (item.type === "peer-left") {
        setPeers((current) => current.map((peer) => peer.id === item.peerId ? { ...peer, coordinatorConnected: false } : peer));
        addEvent("Signaling disconnected", "The peer left the coordinator; an established data channel may remain active");
      } else if (item.type === "signal") {
        void manager.receiveSignal(item.sourcePeerId, item.signal);
      } else if (item.type === "topology-updated") {
        syncTopology(item.edges, peersRef.current);
        addEvent("Overlay topology changed", `${item.edges.length} permitted links · operator control`, "EMULATED");
      } else if (item.type === "link-state-updated") {
        setObservedLinks((current) => [...current.filter((link) => canonicalEdge(link.a, link.b) !== canonicalEdge(item.link.a, item.link.b)), item.link]);
      } else if (item.type === "join-requested") {
        setJoinRequests((current) => [...current.filter((request) => request.requestId !== item.requestId), item]);
      } else if (item.type === "relay-data") {
        addEvent("Fallback relay received", item.payload);
      } else if (item.type === "error") {
        setError(item.message);
      }
    };
    return () => { socket.close(); manager.closeAll(); transferManagerRef.current = undefined; };
  }, [credentials]);

  const remotePeers = peers.filter((peer) => peer.id !== credentials?.peer.id);
  const selectedPeer = remotePeers.find((peer) => peer.id === selectedPeerId) ?? remotePeers[0];
  const selectedLink = selectedPeer ? links[selectedPeer.id] : undefined;
  const activeGraphEdges: GraphEdge[] = observedLinks
    .filter((link) => link.state === "direct" && topologyEdges.some((edge) => canonicalEdge(edge.a, edge.b) === canonicalEdge(link.a, link.b)))
    .map((link) => ({ a: link.a, b: link.b, metrics: { rttMs: link.rttMs, measuredAt: link.updatedAt } }));
  let selectedRoute: string[] | undefined;
  if (credentials && selectedPeer) {
    try { selectedRoute = selectPath(peers.map((peer) => peer.id), activeGraphEdges, credentials.peer.id, selectedPeer.id, routeStrategy); } catch { selectedRoute = undefined; }
  }
  const createRoom = async (displayName: string, deviceCategory: DeviceCategory) => {
    setError("");
    const response = await fetch("/api/rooms", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ displayName, deviceCategory }) });
    if (!response.ok) throw new Error("Could not create the room.");
    setCredentials(await response.json());
  };

  const joinRoom = async (displayName: string, deviceCategory: DeviceCategory) => {
    setError("");
    const response = await fetch(`/api/rooms/${encodeURIComponent(invitedRoom)}/join`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ displayName, deviceCategory, inviteSecret: invitedSecret }) });
    if (!response.ok) throw new Error("This invitation is invalid or expired.");
    const requested = await response.json();
    setJoinPending(true);
    addEvent("Admission requested", "Waiting for the room host to approve this device");
    const timer = window.setInterval(async () => {
      const status = await fetch(`/api/rooms/${encodeURIComponent(invitedRoom)}/join/${encodeURIComponent(requested.requestId)}`, { headers: { "x-hopnet-claim": requested.claimToken } });
      if (!status.ok) return;
      const result = await status.json();
      if (result.status === "approved") {
        window.clearInterval(timer);
        setJoinPending(false);
        setCredentials({ roomId: invitedRoom, inviteSecret: invitedSecret, peer: result.peer, sessionToken: result.sessionToken });
      }
    }, 1200);
  };

  const approve = async (requestId: string) => {
    if (!credentials?.hostToken) return;
    const response = await fetch(`/api/rooms/${credentials.roomId}/approve`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${credentials.hostToken}` }, body: JSON.stringify({ requestId }) });
    if (!response.ok) return setError("Admission approval failed.");
    setJoinRequests((current) => current.filter((request) => request.requestId !== requestId));
    addEvent("Peer admitted", "Host approval created a short-lived authenticated peer session");
  };

  const ping = () => {
    if (!selectedPeer) return;
    try { managerRef.current?.ping(selectedPeer.id); addEvent("Direct ping sent", `RTCDataChannel → ${selectedPeer.displayName}`); } catch (cause) { setError(cause instanceof Error ? cause.message : "Ping failed"); }
  };

  const sendMessage = () => {
    if (!credentials || !selectedPeer || !message.trim()) return;
    try {
      if (!selectedRoute) throw new Error("No established overlay route is available.");
      if (selectedRoute.length === 2) {
        managerRef.current?.sendMessage(selectedPeer.id, message.trim());
        addEvent("Message sent on direct channel", `${selectedPeer.displayName}: ${message.trim()}`);
      } else {
        const routeId = createUuid();
        managerRef.current?.sendPacket(selectedRoute[1], {
          protocolVersion: PROTOCOL_VERSION,
          kind: "routed-message",
          messageId: createUuid(),
          sourcePeerId: credentials.peer.id,
          destinationPeerId: selectedPeer.id,
          routeId,
          nextHop: selectedRoute[1],
          path: selectedRoute,
          hopIndex: 1,
          ttl: selectedRoute.length + 2,
          createdAt: Date.now(),
          payloadType: "text",
          body: message.trim(),
        });
        addEvent("Routed message sent", selectedRoute.map((peerId) => peers.find((peer) => peer.id === peerId)?.displayName ?? peerId).join(" → "));
      }
      setMessage("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Message failed"); }
  };

  const relayFallback = () => {
    if (!selectedPeer || !message.trim() || socketRef.current?.readyState !== WebSocket.OPEN) return;
    socketRef.current.send(JSON.stringify({ type: "relay-data", targetPeerId: selectedPeer.id, payload: message.trim() }));
    addEvent("Explicit fallback used", `${selectedPeer.displayName}: coordinator relayed payload`);
    setMessage("");
  };

  const toggleTopologyEdge = (a: string, b: string) => {
    if (socketRef.current?.readyState !== WebSocket.OPEN) return;
    const key = canonicalEdge(a, b);
    const exists = topologyEdges.some((edge) => canonicalEdge(edge.a, edge.b) === key);
    const next = exists ? topologyEdges.filter((edge) => canonicalEdge(edge.a, edge.b) !== key) : [...topologyEdges, { a, b }];
    socketRef.current.send(JSON.stringify({ type: "set-topology", edges: next }));
  };

  const offerFile = async (file: File) => {
    if (!selectedPeer) return;
    setError("");
    try { await transferManagerRef.current?.offer(file, selectedPeer.id); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "File offer failed."); }
  };

  const respondToTransfer = async (transferId: string, accepted: boolean) => {
    setError("");
    try { await transferManagerRef.current?.respond(transferId, accepted); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Transfer response failed."); }
  };

  if (!credentials) return <Entry invited={Boolean(invitedRoom && invitedSecret)} pending={joinPending} networkInfo={networkInfo} onCreate={createRoom} onJoin={joinRoom} error={error} />;

  const inviteUrl = `${invitationOrigin}/?room=${encodeURIComponent(credentials.roomId)}&invite=${encodeURIComponent(credentials.inviteSecret)}`;
  const inviteQrUrl = `/api/rooms/${credentials.roomId}/qr?invite=${encodeURIComponent(credentials.inviteSecret)}&origin=${encodeURIComponent(invitationOrigin)}`;
  return <RoomSurface self={credentials.peer} peers={peers} links={links} observedLinks={observedLinks} topologyEdges={topologyEdges} selectedPeer={selectedPeer} selectedLink={selectedLink} selectedRoute={selectedRoute} routeStrategy={routeStrategy} events={events} transfers={transfers} coordinatorState={coordinatorState} networkInfo={networkInfo} invitationOrigin={invitationOrigin} inviteUrl={inviteUrl} inviteQrUrl={inviteQrUrl} joinRequests={joinRequests} message={message} error={error} onInvitationOrigin={setInvitationOrigin} onSelectPeer={(id) => setSelectedPeerId(id || undefined)} onApprove={(id) => void approve(id)} onToggleEdge={toggleTopologyEdge} onRouteStrategy={setRouteStrategy} onMessage={setMessage} onSend={sendMessage} onFile={offerFile} onTransferResponse={respondToTransfer} onPing={ping} onFallback={relayFallback} onClearError={() => setError("")} />;
}

function isTransferPacket(packet: DataPacket): packet is TransferDataPacket {
  return packet.kind === "transfer-offer" || packet.kind === "transfer-response" || packet.kind === "transfer-chunk" || packet.kind === "transfer-chunk-ack" || packet.kind === "transfer-complete";
}

function Entry({ invited, pending, networkInfo, onCreate, onJoin, error }: { invited: boolean; pending: boolean; networkInfo?: NetworkInfo; onCreate: (name: string, category: DeviceCategory) => Promise<void>; onJoin: (name: string, category: DeviceCategory) => Promise<void>; error: string }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<DeviceCategory>(/iPhone|Android/i.test(navigator.userAgent) ? "phone" : "laptop");
  const [busy, setBusy] = useState(false);
  const title = invited ? "Step into the room." : "A network you can touch.";
  const submit = async () => { if (!name.trim() || pending) return; setBusy(true); try { await (invited ? onJoin(name.trim(), category) : onCreate(name.trim(), category)); } finally { setBusy(false); } };
  return <main className="entry-shell">
    <header className="entry-brand">HOPNET <span>The Network You Can Touch</span></header>
    <section className="entry-copy"><h1>{title}</h1><p>Real devices. Direct data channels. Routes you can see, test, and break safely.</p></section>
    <section className="entry-panel">
      <span className="technical-label">{invited ? "INVITED PARTICIPANT" : "LOCAL ROOM HOST"}</span>
      <label>Device name<input autoFocus value={name} maxLength={40} onChange={(event) => setName(event.target.value)} placeholder={category === "phone" ? "Rupesh’s phone" : "Lab MacBook"} /></label>
      <label>Device type<select value={category} onChange={(event) => setCategory(event.target.value as DeviceCategory)}><option value="laptop">Laptop</option><option value="phone">Phone</option><option value="tablet">Tablet</option><option value="other">Other</option></select></label>
      <button className="primary-button" disabled={!name.trim() || busy || pending} onClick={() => void submit()}>{pending ? "Waiting for host approval…" : busy ? "Connecting…" : invited ? "Request to join" : "Create private room"}</button>
      <div className="entry-network"><i className={window.isSecureContext ? "secure" : "warning"}/><span>{invited ? `Coordinator ${location.host}` : networkInfo?.preferredOrigin ? `Invites use ${new URL(networkInfo.preferredOrigin).host}` : "Discovering your LAN address…"}<small>{window.isSecureContext ? "Secure browser context" : "Trusted HTTPS required for verified file transfer"}</small></span></div>
      <p className="entry-note">Only devices you approve can enter. HOPNET does not scan your LAN.</p>
      {error && <p className="error-text">{error}</p>}
    </section>
  </main>;
}

export default App;
