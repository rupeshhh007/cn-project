import { useEffect, useRef, useState } from "react";
import { PROTOCOL_VERSION, serverSocketMessageSchema, type DataPacket, type DeviceCategory, type OverlayLink, type Peer, type TopologyEdge, type TransferDataPacket } from "@hopnet/protocol";
import { canonicalEdge, selectPath, type GraphEdge, type RouteStrategy } from "@hopnet/routing";
import { PeerManager, type LinkState } from "./lib/peer-manager.ts";
import { createUuid } from "./lib/id.ts";
import { TransferManager, type TransferView } from "./lib/transfer-manager.ts";
import { RoomSurface } from "./components/RoomSurface.tsx";
import type { Experiment, ExperimentConfig, NetworkEvent } from "./lib/evidence.ts";
import { createReceiptIdentity, verifyTransferPacket } from "./lib/receipt-identity.ts";
import { transferPaths } from "./lib/experiment-paths.ts";
import { DistributedRouter, type RouterSnapshot } from "./lib/distributed-router.ts";
import {type Credentials,claimTabLease,readSession,saveSession,forgetSession,readAdmission,saveAdmission,clearAdmission,joinAttempt,type PendingAdmission} from "./lib/room-session.ts";

export type ConversationMessage = { id: string; peerId: string; direction: "incoming" | "outgoing"; body: string; at: number; status: "sent" | "delivered" | "failed" };

type JoinRequest = { requestId: string; displayName: string; deviceCategory: DeviceCategory; expiresAt?: number };
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
  const [recoveryNotice,setRecoveryNotice]=useState("");
  const [recoveryState,setRecoveryState]=useState("checking");
  const [pendingAdmission,setPendingAdmission]=useState<PendingAdmission>();
  const joinKeyRef=useRef(joinAttempt(invitedRoom));
  const adoptSession=async (value:Credentials) => {
    await claimTabLease(value.peer.id);
    const stored=saveSession({version:1,roomId:value.roomId,peerId:value.peer.id,sessionToken:value.sessionToken});
    if(!stored) setRecoveryNotice("Tab storage is unavailable; reloading will require admission again.");
    clearAdmission(); setPendingAdmission(undefined); setJoinPending(false);
    peersRef.current=[];setPeers([]);setLinks({});setTopologyEdges([]);setObservedLinks([]);setRoutingGraph([]);setRouterReports([]);setConversations([]);setEvents([]);setTransfers([]);setExperiments([]);setFaultedEdges({});setJoinRequests([]);
    receiptIdentityRef.current=undefined;
    history.replaceState(null,"",location.pathname); setCredentials(value); setRecoveryState("ready");
  };
  const resumeSession=async (manual=false,isActive=()=>true) => {
    const saved=readSession();
    if(!saved || invitedRoom && invitedRoom!==saved.roomId) { setRecoveryState("ready"); return; }
    if(!navigator.locks && !manual) { setRecoveryState("manual"); setRecoveryNotice("Resume replaces any previous connection for this session. Do not reuse a cloned tab as an independent device."); return; }
    setRecoveryState("restoring");
    try {
      await claimTabLease(saved.peerId); if(!isActive()) return;
      saved.attemptId ??= createUuid(); saveSession(saved);
      const response=await fetch(`/api/rooms/${encodeURIComponent(saved.roomId)}/resume`,{method:"POST",headers:{authorization:`Bearer ${saved.sessionToken}`,"content-type":"application/json"},body:JSON.stringify({attemptId:saved.attemptId}),cache:"no-store",signal:AbortSignal.timeout(8000)});
      if(!isActive()) return;
      if(response.status===401 || response.status===404) { forgetSession(); setRecoveryNotice("Session expired: the coordinator no longer recognizes this room. Create a new room or open a fresh invitation."); setRecoveryState("ready"); return; }
      if(!response.ok) throw new Error("The coordinator could not restore this session. Retry when it is reachable.");
      await adoptSession(await response.json());
      setRecoveryNotice("Session restored. Reload cleared history and interrupted active transfers. Channels and routes are learned afresh.");
    } catch(cause) { if(isActive()) { setRecoveryState("retry"); setRecoveryNotice(cause instanceof Error ? cause.message:"Session recovery unavailable."); } }
  };
  useEffect(() => {
    let active=true;
    const waiting=readAdmission(); if(waiting) {setPendingAdmission(waiting);setJoinPending(true);}
    void resumeSession(false,()=>active);
    return () => {active=false;};
  },[]);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [links, setLinks] = useState<Record<string, LinkState>>({});
  const [topologyEdges, setTopologyEdges] = useState<TopologyEdge[]>([]);
  const [faultedEdges, setFaultedEdges] = useState<Record<string, TopologyEdge[]>>({});
  const [observedLinks, setObservedLinks] = useState<OverlayLink[]>([]);
  const [routeStrategy, setRouteStrategy] = useState<RouteStrategy>("minimum-hops");
  const [routerState, setRouterState] = useState<RouterSnapshot>();
  const [routerReports, setRouterReports] = useState<RouterSnapshot[]>([]);
  const [routingGraph, setRoutingGraph] = useState<GraphEdge[]>([]);
  const routerRef = useRef<DistributedRouter | undefined>(undefined);
  const routerObservationRef = useRef<RouterSnapshot | undefined>(undefined);
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [conversations, setConversations] = useState<ConversationMessage[]>([]);
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const experimentRef = useRef<Experiment | undefined>(undefined);
  const observedRef = useRef<OverlayLink[]>([]);
  const receiptIdentityRef = useRef<ReturnType<typeof createReceiptIdentity> | undefined>(undefined);
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
  useEffect(() => { routeStrategyRef.current = routeStrategy; routerRef.current?.setStrategy(routeStrategy); }, [routeStrategy]);
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

  const addEvent = (title: string, detail: string, provenance: EventItem["provenance"] = "REAL", metadata: Partial<EventItem> = {}) => {
    // File events share the latest immutable routing observation instead of
    // cloning the complete LSDB for every chunk. Its observedAt remains explicit.
    // Router-generated events capture their exact current control-plane state.
    const observation = metadata.routerId ? routerRef.current?.snapshot() : routerObservationRef.current;
    const event: EventItem = { id: createUuid(), at: new Date(), monotonicMs: performance.now(), type: title.toLowerCase().replaceAll(" ", "-"), title, detail, provenance, snapshot: { peers: peersRef.current.map(({ id, displayName, deviceCategory, coordinatorConnected }) => ({ id, displayName, deviceCategory, coordinatorConnected })), edges: topologyRef.current.map((edge) => ({ ...edge })), links: observedRef.current.map((link) => ({ ...link })), router: observation }, ...metadata };
    setEvents((current) => [event, ...current].slice(0, 2048));
  };

  useEffect(() => {
    if (!credentials) return;
    if (window.isSecureContext && crypto.subtle) receiptIdentityRef.current ??= createReceiptIdentity();
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    let socket: WebSocket;
    let stopped = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let reconnectAttempt = 0;
    let replaced = false;
    let lastHeartbeat = performance.now();
    const syncTopology = (nextEdges: TopologyEdge[], knownPeers: Peer[]) => {
      setTopologyEdges(nextEdges);
      topologyRef.current = nextEdges;
      const permitted = new Set(nextEdges.map((edge) => canonicalEdge(edge.a, edge.b)));
      observedRef.current = observedRef.current.filter((link) => permitted.has(canonicalEdge(link.a, link.b)));
      setObservedLinks(observedRef.current);
      const adjacent = new Set(nextEdges.flatMap((edge) => edge.a === credentials.peer.id ? [edge.b] : edge.b === credentials.peer.id ? [edge.a] : []));
      for (const peer of knownPeers) {
        if (peer.id === credentials.peer.id) continue;
        if (adjacent.has(peer.id) && peer.coordinatorConnected && socket?.readyState === WebSocket.OPEN) manager.ensure(peer.id);
        if (!adjacent.has(peer.id)) manager.close(peer.id);
      }
    };
    let transferManager: TransferManager;
    let router: DistributedRouter | undefined;
    const reportedStates = new Map<string, string>();
    const manager = new PeerManager(
      credentials.peer.id,
      (targetPeerId, signal) => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "signal", targetPeerId, signal })); },
      (state) => {
        router?.setLink(state.peerId, state.state === "direct");
        setLinks((current) => ({ ...current, [state.peerId]: state }));
        const signature = `${state.state}:${state.rttMs}`;
        if (socket?.readyState === WebSocket.OPEN && state.state !== "new" && reportedStates.get(state.peerId) !== signature && topologyRef.current.some((edge) => canonicalEdge(edge.a, edge.b) === canonicalEdge(credentials.peer.id, state.peerId))) {
          reportedStates.set(state.peerId, signature);
          socket.send(JSON.stringify({ type: "link-state", peerId: state.peerId, state: state.state, rttMs: state.rttMs }));
        }
      },
      (peerId, packet) => onDataPacket(peerId, packet),
    );
    managerRef.current = manager;
    router = new DistributedRouter({
      self: credentials.peer.id,
      generation: (id) => peersRef.current.find((peer) => peer.id === id)?.generation ?? (id === credentials.peer.id ? credentials.peer.generation ?? 0 : 0),
      peers: () => peersRef.current.map((peer) => peer.id),
      send: (id, packet) => manager.sendPacket(id, packet),
      update: (state, reports) => {
        routerObservationRef.current = state;
        setRouterState(state); setRouterReports(reports);
        graphRef.current = router?.graph() ?? [];
        setRoutingGraph(graphRef.current);
      },
      event: (event) => {
        addEvent(event.type.replaceAll("-", " "), event.detail, "REAL", { type: event.type, path: event.path, routerId: credentials.peer.id, controlOrigin: event.origin, plane: event.type.startsWith("packet") || event.type.startsWith("message-") || event.type === "delivery-ack" ? "data" : "control" });
        if (event.type === "packet-forward" && event.path && event.path.length > 2) addEvent("Payload forwarded", "Distributed local forwarding-table decision", "REAL", { path: event.path });
      },
      messageStatus: (id, status) => setConversations((current) => current.map((item) => item.id === id && item.direction === "outgoing" && item.status === "sent" ? { ...item,status } : item)),
      deliver: (packet) => {
        const source = peersRef.current.find((peer) => peer.id === packet.source)?.displayName ?? "peer";
        if (packet.purpose === "message") {
          addEvent(packet.trace.length > 2 ? "Routed message delivered" : `Message from ${source}`, packet.body, "REAL", { path: packet.trace, plane: "data" });
          setConversations((current) => current.some((item) => item.id === packet.messageId && item.peerId === packet.source) ? current : [...current, { id: packet.messageId, peerId: packet.source, direction: "incoming", body: packet.body, at: Date.now(), status: "delivered" }].slice(-300) as ConversationMessage[]);
        } else {
          addEvent("Message acknowledged", `${source} confirmed application receipt`, "REAL", { path: packet.trace, plane: "data" });
          if (packet.trace.length > 2) addEvent("Route receipt returned", "Receiver acknowledgement returned using local forwarding tables", "REAL", { path: packet.trace });
        }
      },
    });
    routerRef.current = router; router.start();
    transferManager = new TransferManager({
      selfPeerId: credentials.peer.id,
      canOfferTo: (peerId) => Boolean(peersRef.current.find((peer) => peer.id === peerId)?.receiptPublicKey),
      sign: async (packet) => {
        const identity = await receiptIdentityRef.current;
        if (!identity) throw new Error("Trusted HTTPS is required for signed transfer receipts.");
        return identity.sign(packet);
      },
      verify: (packet) => verifyTransferPacket(peersRef.current.find((peer) => peer.id === packet.sourcePeerId)?.receiptPublicKey, packet),
      getPaths: (destinationPeerId) => {
        const experiment = experimentRef.current?.peerId === destinationPeerId ? experimentRef.current : undefined;
        return transferPaths(peersRef.current.map((peer) => peer.id), graphRef.current, credentials.peer.id, destinationPeerId, (experiment?.strategy as RouteStrategy) ?? routeStrategyRef.current, experiment?.mode);
      },
      isPathAvailable: (path) => path.slice(1).every((id, index) => graphRef.current.some((edge) => canonicalEdge(edge.a, edge.b) === canonicalEdge(path[index]!, id))),
      isPermittedEdge: (a, b) => topologyRef.current.some((edge) => canonicalEdge(edge.a, edge.b) === canonicalEdge(a, b)),
      send: (nextHop, packet) => manager.sendPacketAsync(nextHop, packet),
      onUpdate: (transfer) => {
        setTransfers((current) => [transfer, ...current.filter((item) => item.id !== transfer.id)].slice(0, 12));
        if (["verified", "failed", "declined", "cancelled"].includes(transfer.status)) {
          setExperiments((current) => current.map((item) => item.transferId === transfer.id ? { ...item, result: { ...transfer, downloadUrl: undefined } } : item));
          if (experimentRef.current?.transferId === transfer.id) experimentRef.current = undefined;
        }
      },
      onEvent: (title, detail) => addEvent(title, detail),
      onProtocolEvent: (event) => addEvent(event.type.replaceAll("-", " "), event.detail ?? "Observed by this browser", "REAL", { type: event.type, plane: "data", transferId: event.transferId, path: event.path, chunkIndex: event.chunkIndex, experimentId: experimentRef.current?.id }),
    });
    transferManagerRef.current = transferManager;
    const onDataPacket = (peerId: string, packet: DataPacket) => {
      if (router?.handle(peerId, packet)) return;
      const source = peersRef.current.find((peer) => peer.id === peerId)?.displayName ?? `peer …${peerId.slice(-5)}`;
      if (isTransferPacket(packet)) {
        void transferManager.handle(peerId, packet).catch((cause) => addEvent("Transfer forwarding failed", cause instanceof Error ? cause.message : "Unknown transfer error", "INFERRED"));
        return;
      }
      if (packet.kind === "pong") addEvent("Direct echo returned", `${source} replied over RTCDataChannel`);
      if (packet.kind === "message") {
        addEvent(`Message from ${source}`, packet.body);
        setConversations((current) => current.some((item) => item.id === packet.messageId) ? current : [...current, { id: packet.messageId, peerId, direction: "incoming", body: packet.body, at: Date.now(), status: "delivered" }].slice(-300) as ConversationMessage[]);
      }
      if (packet.kind === "message-ack") {
        addEvent("Legacy acknowledgement observed", `${source}: legacy receipts cannot complete distributed messages.`);
      }
      if (packet.kind !== "routed-message" && packet.kind !== "route-receipt") return;
      const now = Date.now();
      for (const [key, seenAt] of seenPacketsRef.current) if (now - seenAt > 60_000) seenPacketsRef.current.delete(key);
      const duplicateKey = `${packet.kind}:${packet.routeId}:${packet.hopIndex}`;
      if (seenPacketsRef.current.has(duplicateKey)) return;
      seenPacketsRef.current.set(duplicateKey, now);
      if (packet.ttl < 1 || packet.path[packet.hopIndex] !== credentials.peer.id || packet.nextHop !== credentials.peer.id || packet.path[packet.hopIndex - 1] !== peerId || packet.path[0] !== packet.sourcePeerId || packet.path.at(-1) !== packet.destinationPeerId || new Set(packet.path).size !== packet.path.length || !topologyRef.current.some((edge) => canonicalEdge(edge.a, edge.b) === canonicalEdge(peerId, credentials.peer.id))) {
        addEvent("Route packet rejected", "Hop, next-hop, or TTL invariant failed", "INFERRED");
        return;
      }
      if (packet.destinationPeerId === credentials.peer.id) {
        if (packet.kind === "routed-message") {
          addEvent("Routed message delivered", `${packet.path.length - 1} hops · ${packet.body}`);
          setConversations((current) => current.some((item) => item.id === packet.messageId) ? current : [...current, { id: packet.messageId, peerId: packet.sourcePeerId, direction: "incoming", body: packet.body, at: Date.now(), status: "delivered" }].slice(-300) as ConversationMessage[]);
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
          addEvent("Legacy route receipt observed", "Distributed message success requires a matching pending ACK attempt.");
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
    const restarted = (peer: Peer) => {
      const previous = peersRef.current.find((item) => item.id === peer.id);
      if (previous && (previous.generation ?? 0) !== (peer.generation ?? 0)) {
        peersRef.current = peersRef.current.map((item) => item.id === peer.id ? peer : item);
        manager.close(peer.id); router?.resetPeer(peer.id); transferManager.peerRestarted(peer.id);
        addEvent("Peer session restarted", `${peer.displayName}: fresh channels, keys and routing incarnation required`);
      }
    };
    const connect = () => {
      if (stopped) return;
      socket = new WebSocket(`${protocol}//${location.host}/signal?token=${encodeURIComponent(credentials.sessionToken)}`);
      const currentSocket = socket;
      socketRef.current = socket;
      setCoordinatorState("connecting");
    socket.onopen = () => {
      if (stopped || socket !== currentSocket) return;
      reconnectAttempt = 0; reportedStates.clear(); lastHeartbeat=performance.now();
      setCoordinatorState("connected"); addEvent("Coordinator connected", "Authenticated signaling socket is open");
      void receiptIdentityRef.current?.then((identity) => { if (!stopped && currentSocket.readyState === WebSocket.OPEN) currentSocket.send(JSON.stringify({ type: "publish-receipt-key", publicKey: identity.publicKey })); }).catch(() => setError("Secure transfer identity could not initialize. Check trusted HTTPS and reload."));
    };
    socket.onclose = ({ code }) => {
      if (stopped || socket !== currentSocket) return;
      setCoordinatorState("disconnected");
      if (code === 4001) { replaced=true; setError("This session was replaced by another connection. Existing channels may remain active; reload to reclaim this tab's session."); return; }
      reconnectTimer = setTimeout(() => {
        void fetch(`/api/rooms/${credentials.roomId}/session`, {headers:{authorization:`Bearer ${credentials.sessionToken}`},cache:"no-store",signal:AbortSignal.timeout(8000)})
          .then((response) => {
            if (stopped) return;
            if (response.status === 401 || response.status === 404) {
              forgetSession(); setRecoveryNotice("Session expired or coordinator restarted. Open a fresh invitation or create a new room."); setCredentials(null); return;
            }
            connect();
          }).catch(() => { if (!stopped) connect(); });
      }, Math.min(15_000, 750 * 2 ** Math.min(reconnectAttempt++, 5)));
    };
    socket.onerror = () => { if (!stopped && socket === currentSocket) setCoordinatorState("reconnecting"); };
    socket.onmessage = ({ data }) => {
      if (stopped || socket !== currentSocket) return;
      let json: unknown;
      try { json = JSON.parse(data); } catch { return; }
      const parsed = serverSocketMessageSchema.safeParse(json);
      if (!parsed.success) return;
      const item = parsed.data;
      if (item.type === "heartbeat-ack") { lastHeartbeat=performance.now();
      } else if (item.type === "peer-key-updated") {
        peersRef.current = peersRef.current.map((peer) => peer.id === item.peerId ? { ...peer, receiptPublicKey: item.publicKey } : peer);
        setPeers(peersRef.current);
      } else if (item.type === "room-snapshot") {
        for (const peer of item.peers) restarted(peer);
        setPeers(item.peers);
        peersRef.current = item.peers;
        setObservedLinks(item.links);
        observedRef.current = item.links;
        syncTopology(item.edges, item.peers);
        addEvent("Room snapshot received", "Coordinator membership and permitted topology observed");
      } else if (item.type === "peer-restarted" || item.type === "peer-joined") {
        restarted(item.peer);
        peersRef.current = [...peersRef.current.filter((peer) => peer.id !== item.peer.id), item.peer];
        setPeers(peersRef.current);
        if (item.peer.coordinatorConnected && topologyRef.current.some((edge) => (edge.a === credentials.peer.id && edge.b === item.peer.id) || (edge.b === credentials.peer.id && edge.a === item.peer.id))) manager.ensure(item.peer.id);
        if(item.type === "peer-joined") addEvent("Peer joined", `${item.peer.displayName} is connected to the coordinator`);
      } else if (item.type === "peer-left") {
        peersRef.current = peersRef.current.map((peer) => peer.id === item.peerId ? { ...peer, coordinatorConnected: false } : peer);
        setPeers(peersRef.current);
        addEvent("Signaling disconnected", "The peer left the coordinator; an established data channel may remain active");
      } else if (item.type === "signal") {
        if (topologyRef.current.some((edge) => canonicalEdge(edge.a, edge.b) === canonicalEdge(credentials.peer.id, item.sourcePeerId))) void manager.receiveSignal(item.sourcePeerId, item.signal);
      } else if (item.type === "topology-updated") {
        syncTopology(item.edges, peersRef.current);
        addEvent("Overlay topology changed", `${item.edges.length} permitted links · operator control`, "EMULATED");
      } else if (item.type === "link-state-updated") {
        observedRef.current = [...observedRef.current.filter((link) => canonicalEdge(link.a, link.b) !== canonicalEdge(item.link.a, item.link.b)), item.link];
        setObservedLinks((current) => [...current.filter((link) => canonicalEdge(link.a, link.b) !== canonicalEdge(item.link.a, item.link.b)), item.link]);
        addEvent("WebRTC link changed", item.link.state, "REAL", { path: [item.link.a, item.link.b] });
      } else if (item.type === "join-requested") {
        setJoinRequests((current) => [...current.filter((request) => request.requestId !== item.requestId), item]);
      } else if (item.type === "pending-requests") {
        setJoinRequests(item.requests);
      } else if (item.type === "relay-data") {
        addEvent("Fallback relay received", item.payload);
      } else if (item.type === "error") {
        setError(item.message);
      }
    };
    };
    connect();
    const heartbeat=setInterval(() => {
      if(socket.readyState!==WebSocket.OPEN) return;
      if(performance.now()-lastHeartbeat>30_000) {socket.close(4000,"Heartbeat deadline exceeded");return;}
      socket.send(JSON.stringify({type:"heartbeat",sentAt:Date.now()}));
    },10_000);
    const reconcile=setInterval(() => {if(socket.readyState===WebSocket.OPEN) syncTopology(topologyRef.current,peersRef.current);},5000);
    const wake = () => { if (!stopped && !replaced && socket.readyState === WebSocket.CLOSED) {clearTimeout(reconnectTimer);connect();} };
    window.addEventListener("online",wake);
    return () => { stopped = true; clearInterval(reconcile); clearInterval(heartbeat); clearTimeout(reconnectTimer); window.removeEventListener("online",wake); router?.dispose(); routerRef.current = undefined; socket.close(); manager.closeAll(); transferManager.dispose(); transferManagerRef.current = undefined; };
  }, [credentials]);

  const remotePeers = peers.filter((peer) => peer.id !== credentials?.peer.id);
  const selectedPeer = selectedPeerId === "" ? undefined : remotePeers.find((peer) => peer.id === selectedPeerId) ?? remotePeers[0];
  const selectedLink = selectedPeer ? links[selectedPeer.id] : undefined;
  const activeGraphEdges: GraphEdge[] = routingGraph;
  let selectedRoute: string[] | undefined;
  if (credentials && selectedPeer) {
    try { selectedRoute = selectPath(peers.map((peer) => peer.id), activeGraphEdges, credentials.peer.id, selectedPeer.id, routeStrategy); } catch { selectedRoute = undefined; }
  }
  const createRoom = async (displayName: string, deviceCategory: DeviceCategory) => {
    setError("");
    const response = await fetch("/api/rooms", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ displayName, deviceCategory }) });
    if (!response.ok) throw new Error("Could not create the room.");
    await adoptSession(await response.json());
  };

  const joinRoom = async (displayName: string, deviceCategory: DeviceCategory) => {
    setError("");
    const response = await fetch(`/api/rooms/${encodeURIComponent(invitedRoom)}/join`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ displayName, deviceCategory, inviteSecret: invitedSecret, requestKey: joinKeyRef.current }) });
    if (!response.ok) throw new Error("This invitation is invalid or expired.");
    const requested = await response.json();
    setJoinPending(true);
    addEvent("Admission requested", "Waiting for the room host to approve this device");
    const waiting = {roomId:invitedRoom,requestId:requested.requestId,claimToken:requested.claimToken,startedAt:Date.now()};
    saveAdmission(waiting); setPendingAdmission(waiting);
  };

  useEffect(() => {
    if (!pendingAdmission || credentials) return;
    let stopped=false;
    let timer:ReturnType<typeof setTimeout>;
    const controller=new AbortController();
    const finish=(notice:string) => {clearAdmission();setPendingAdmission(undefined);setJoinPending(false);joinKeyRef.current=createUuid();setError(notice);};
    const poll=async () => {
      if (Date.now()-pendingAdmission.startedAt>=15*60_000) {finish("Admission expired. Request a new invitation from the host.");return;}
      try {
        const response=await fetch(`/api/rooms/${encodeURIComponent(pendingAdmission.roomId)}/join/${encodeURIComponent(pendingAdmission.requestId)}`,{headers:{"x-hopnet-claim":pendingAdmission.claimToken},cache:"no-store",signal:AbortSignal.any([controller.signal,AbortSignal.timeout(8000)])});
        if(stopped) return;
        if(response.status===404 || response.status===401 || response.status===403) {finish("Admission expired or invalid. Request to join again.");return;}
        if(!response.ok) throw new Error("Coordinator unreachable. Retrying admission until its 15-minute deadline.");
        const result=await response.json();
        if(result.status==="rejected") {finish("The host declined this request. You may request admission again.");return;}
        if(result.status==="approved") {await adoptSession({roomId:pendingAdmission.roomId,inviteSecret:invitedSecret,peer:result.peer,sessionToken:result.sessionToken});setError("");return;}
        setError("");
      } catch(cause) {if(stopped) return;setError(cause instanceof Error ? cause.message:"Coordinator unreachable; retrying admission.");}
      if(!stopped) timer=setTimeout(() => void poll(),1200);
    };
    void poll();
    return () => {stopped=true;controller.abort();clearTimeout(timer);};
  },[pendingAdmission,credentials]);

  const approve = async (requestId: string) => {
    if (!credentials?.hostToken) return;
    setError("");
    try {
    const response = await fetch(`/api/rooms/${credentials.roomId}/approve`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${credentials.hostToken}` }, body: JSON.stringify({ requestId }) });
    if (!response.ok) {
      const failure = await response.json().catch(() => ({})) as { message?: string };
      return setError(failure.message ?? "Admission approval failed.");
    }
    setJoinRequests((current) => current.filter((request) => request.requestId !== requestId));
    addEvent("Peer admitted", "Host approval created a short-lived authenticated peer session");
    } catch {setError("Admission could not reach the coordinator. Retry after signaling reconnects; the request remains pending.");}
  };

  const ping = () => {
    if (!selectedPeer) return;
    try { managerRef.current?.ping(selectedPeer.id); addEvent("Direct ping sent", `RTCDataChannel → ${selectedPeer.displayName}`); } catch (cause) { setError(cause instanceof Error ? cause.message : "Ping failed"); }
  };

  const sendMessage = () => {
    if (!credentials || !selectedPeer || !message.trim()) return;
    try {
      if (!selectedRoute) throw new Error("No established overlay route is available.");
      const messageId = createUuid();
      if (!routerRef.current) throw new Error("Distributed router is not initialized.");
      routerRef.current.sendMessage(selectedPeer.id, message.trim(), messageId);
      addEvent(selectedRoute.length === 2 ? "Message sent on direct channel" : "Routed message sent", "Each hop selects its own next hop from its local LSDB; packet-forward events record actual traversal.", "REAL", { plane: "data" });
      setConversations((current) => [...current, { id: messageId, peerId: selectedPeer.id, direction: "outgoing", body: message.trim(), at: Date.now(), status: "sent" }].slice(-300) as ConversationMessage[]);
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
    if (experimentRef.current) { setError("Complete or cancel the active experiment before sending another file."); return; }
    setError("");
    try { await transferManagerRef.current?.offer(file, selectedPeer.id); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "File offer failed."); }
  };

  const respondToTransfer = async (transferId: string, accepted: boolean) => {
    setError("");
    try { await transferManagerRef.current?.respond(transferId, accepted); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Transfer response failed."); }
  };

  const startExperiment = async (config: ExperimentConfig, file: File) => {
    if (credentials?.peer.role !== "host" || !transferManagerRef.current) return;
    if (experimentRef.current) { setError("Complete or cancel the active trial before starting another."); return; }
    const experiment: Experiment = { ...config, strategy: routeStrategy, id: createUuid(), createdAt: performance.now() };
    experimentRef.current = experiment;
    setExperiments((current) => [experiment, ...current].slice(0, 12));
    try {
      const paths = transferPaths(peers.map((peer) => peer.id), activeGraphEdges, credentials.peer.id, config.peerId, routeStrategy, config.mode);
      if (config.mode === "multipath" && paths.length < 2) throw new Error("This trial requires two established, internally disjoint relay routes. Permit and establish the four diamond links first.");
      if (config.mode === "direct" && !activeGraphEdges.some((edge) => canonicalEdge(edge.a, edge.b) === canonicalEdge(credentials.peer.id, config.peerId))) throw new Error("Establish a direct WebRTC link before starting a direct trial.");
      const transferId = await transferManagerRef.current.offer(file, config.peerId);
      experiment.transferId = transferId;
      setExperiments((current) => current.map((item) => item.id === experiment.id ? { ...experiment } : item));
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : "Experiment failed.";
      setError(reason); experimentRef.current = undefined;
      setExperiments((current) => current.map((item) => item.id === experiment.id ? { ...item, error: reason } : item));
    }
  };

  const faultRelay = (peerId: string) => {
    if (credentials?.peer.role !== "host" || peerId === credentials.peer.id || socketRef.current?.readyState !== WebSocket.OPEN) return;
    const removed = topologyEdges.filter((edge) => edge.a === peerId || edge.b === peerId);
    if (removed.length) setFaultedEdges((current) => ({ ...current, [peerId]: removed }));
    const experiment = experimentRef.current;
    if (experiment) {
      experiment.faultAt = performance.now(); experiment.failedPeerId = peerId;
      setExperiments((current) => current.map((item) => item.id === experiment.id ? { ...experiment } : item));
    }
    addEvent("Controlled relay failure requested", "Host removed the relay's permitted links; physical Wi-Fi is unchanged.", "EMULATED", { experimentId: experiment?.id });
    socketRef.current.send(JSON.stringify({ type: "set-topology", edges: topologyEdges.filter((edge) => edge.a !== peerId && edge.b !== peerId) }));
  };

  const restoreRelay = (peerId: string) => {
    if (credentials?.peer.role !== "host" || socketRef.current?.readyState !== WebSocket.OPEN) return;
    const online = new Set(peers.filter((peer) => peer.coordinatorConnected).map((peer) => peer.id));
    if (!online.has(peerId)) { setError("Restore signaling in the relay tab before restoring its links. Reload resumes a valid session without new admission."); return; }
    const restored = new Map(topologyEdges.map((edge) => [canonicalEdge(edge.a, edge.b), edge]));
    for (const edge of faultedEdges[peerId] ?? []) if (online.has(edge.a) && online.has(edge.b)) restored.set(canonicalEdge(edge.a, edge.b), edge);
    if (restored.size > 20) { setError("Restoring these links would exceed the 20-link classroom limit. Remove another permitted link first."); return; }
    socketRef.current.send(JSON.stringify({ type: "set-topology", edges: [...restored.values()] }));
    setFaultedEdges((current) => { const next = { ...current }; delete next[peerId]; return next; });
    addEvent("Controlled relay restoration requested", "Saved permitted links restored; channels must renegotiate and exchange hellos before becoming routes.", "EMULATED");
  };

  const cancelTransfer = async (id: string) => {
    try { await transferManagerRef.current?.cancel(id); } catch (cause) { setError(cause instanceof Error ? cause.message : "Cancellation could not reach the other peer."); }
  };

  const reject = async (requestId:string) => {
    if(!credentials?.hostToken) return;
    try {
      const response=await fetch(`/api/rooms/${credentials.roomId}/reject`,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${credentials.hostToken}`},body:JSON.stringify({requestId})});
      if(!response.ok) throw new Error("Request expired or already admitted. Reopen the invitation panel.");
      setJoinRequests((current) => current.filter((request) => request.requestId!==requestId));
    } catch(cause) {setError(cause instanceof Error ? cause.message:"Admission rejection failed.");}
  };
  const recovery = <section className="session-recovery" role="status">{recoveryNotice}{credentials && recoveryNotice && <button aria-label="Dismiss recovery notice" onClick={() => setRecoveryNotice("")}>×</button>}{["manual","retry"].includes(recoveryState) && <><button onClick={() => void resumeSession(true)}>Resume session</button><button onClick={() => {forgetSession();setRecoveryState("ready");setRecoveryNotice("Saved session forgotten. Existing membership was not revoked.");}}>Forget saved session</button></>}</section>;
  if (!credentials) return <>{recovery}<Entry invited={Boolean(invitedRoom && invitedSecret)} pending={joinPending || recoveryState==="checking" || recoveryState==="restoring"} networkInfo={networkInfo} onCreate={createRoom} onJoin={joinRoom} error={error} /></>;

  const inviteUrl = `${invitationOrigin}/?room=${encodeURIComponent(credentials.roomId)}&invite=${encodeURIComponent(credentials.inviteSecret)}`;
  const inviteQrUrl = `/api/rooms/${credentials.roomId}/qr?invite=${encodeURIComponent(credentials.inviteSecret)}&origin=${encodeURIComponent(invitationOrigin)}`;
  return <>{recovery}<RoomSurface onReject={(id) => void reject(id)} routingGraph={routingGraph} routerState={routerState} routerReports={routerReports} self={credentials.peer} peers={peers} links={links} observedLinks={observedLinks} topologyEdges={topologyEdges} selectedPeer={selectedPeer} selectedLink={selectedLink} selectedRoute={selectedRoute} routeStrategy={routeStrategy} events={events} transfers={transfers} coordinatorState={coordinatorState} networkInfo={networkInfo} invitationOrigin={invitationOrigin} inviteUrl={inviteUrl} inviteQrUrl={inviteQrUrl} joinRequests={joinRequests} message={message} error={error} onInvitationOrigin={setInvitationOrigin} onSelectPeer={(id) => setSelectedPeerId(id)} onApprove={(id) => void approve(id)} onToggleEdge={toggleTopologyEdge} onRouteStrategy={setRouteStrategy} onMessage={setMessage} onSend={sendMessage} onFile={offerFile} onTransferResponse={respondToTransfer} onPing={ping} onFallback={relayFallback} onClearError={() => setError("")} conversations={conversations} experiments={experiments} onExperiment={startExperiment} onFault={faultRelay} onRestore={restoreRelay} restorablePeers={Object.keys(faultedEdges)} onCancelTransfer={cancelTransfer} /></>;
}

function isTransferPacket(packet: DataPacket): packet is TransferDataPacket {
  return packet.kind === "transfer-offer" || packet.kind === "transfer-response" || packet.kind === "transfer-chunk" || packet.kind === "transfer-chunk-ack" || packet.kind === "transfer-complete" || packet.kind === "transfer-cancel";
}

function Entry({ invited, pending, networkInfo, onCreate, onJoin, error }: { invited: boolean; pending: boolean; networkInfo?: NetworkInfo; onCreate: (name: string, category: DeviceCategory) => Promise<void>; onJoin: (name: string, category: DeviceCategory) => Promise<void>; error: string }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<DeviceCategory>(/iPhone|Android/i.test(navigator.userAgent) ? "phone" : "laptop");
  const [busy, setBusy] = useState(false);
  const [submitError,setSubmitError]=useState("");
  const title = invited ? "Step into the room." : "A network you can touch.";
  const submit = async () => { if (!name.trim() || pending) return; setBusy(true);setSubmitError(""); try { await (invited ? onJoin(name.trim(), category) : onCreate(name.trim(), category)); } catch(cause) {setSubmitError(cause instanceof Error ? cause.message:"Connection unavailable. Please retry.");} finally { setBusy(false); } };
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
      {submitError && <p className="error-text" role="alert">{submitError}</p>}
    </section>
  </main>;
}

export default App;
