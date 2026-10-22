import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { DeviceCategory, OverlayLink, Peer, TopologyEdge } from "@hopnet/protocol";
import { canonicalEdge, type GraphEdge, type RouteStrategy } from "@hopnet/routing";
import type { LinkState } from "../lib/peer-manager.ts";
import type { TransferView } from "../lib/transfer-manager.ts";
import type { NetworkInfo } from "../App.tsx";
import type { ConversationMessage } from "../App.tsx";
import type { Experiment, ExperimentConfig, NetworkEvent } from "../lib/evidence.ts";
import { Conversation, LabWorkspace, ReplayWorkspace, SendWorkspace } from "./Studio.tsx";
import { deviceAsset } from "../lib/device-assets.ts";
import { RoutingWorkspace } from "./RoutingWorkspace.tsx";
import type { RouterSnapshot } from "../lib/distributed-router.ts";

export type Props = {
  routerState?: RouterSnapshot;
  routerReports: RouterSnapshot[];
  routingGraph: GraphEdge[];
  self: Peer;
  peers: Peer[];
  links: Record<string, LinkState>;
  observedLinks: OverlayLink[];
  topologyEdges: TopologyEdge[];
  selectedPeer?: Peer;
  selectedLink?: LinkState;
  selectedRoute?: string[];
  routeStrategy: RouteStrategy;
  events: NetworkEvent[];
  transfers: TransferView[];
  coordinatorState: string;
  networkInfo?: NetworkInfo;
  invitationOrigin: string;
  inviteUrl: string;
  inviteQrUrl: string;
  joinRequests: Array<{ requestId: string; displayName: string; deviceCategory: DeviceCategory }>;
  message: string;
  error: string;
  onInvitationOrigin: (origin: string) => void;
  onSelectPeer: (peerId: string) => void;
  onApprove: (requestId: string) => void;
  onReject: (requestId: string) => void;
  onToggleEdge: (a: string, b: string) => void;
  onRouteStrategy: (strategy: RouteStrategy) => void;
  onMessage: (message: string) => void;
  onSend: () => void;
  onFile: (file: File) => Promise<void>;
  onTransferResponse: (transferId: string, accepted: boolean) => Promise<void>;
  onPing: () => void;
  onFallback: () => void;
  onClearError: () => void;
  conversations: ConversationMessage[];
  experiments: Experiment[];
  onExperiment: (config: ExperimentConfig, file: File) => Promise<void>;
  onFault: (peerId: string) => void;
  onRestore: (peerId: string) => void;
  restorablePeers: string[];
  onCancelTransfer: (id: string) => Promise<void>;
};

type View = "space" | "routing" | "send" | "lab" | "replay";
type Point = { x: number; y: number };

const positions: Point[] = [
  { x: 16, y: 48 },
  { x: 59, y: 23 },
  { x: 81, y: 56 },
  { x: 68, y: 80 },
  { x: 31, y: 80 },
  { x: 17, y: 31 },
];

export function RoomSurface(props: Props) {
  const [mobile, setMobile] = useState(() => window.matchMedia("(max-width: 680px)").matches);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 680px)");
    const update = () => setMobile(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return mobile ? <MobileRoom {...props} /> : <DesktopRoom {...props} />;
}

function DesktopRoom(props: Props) {
  const boardRef = useRef<HTMLElement>(null);
  const [boardSize, setBoardSize] = useState({ width: 1000, height: 620 });
  const [view, setView] = useState<View>("space");
  useEffect(() => {
    if (view !== "space" || !boardRef.current) return;
    const observer = new ResizeObserver(([entry]) => { if (entry) setBoardSize({ width: entry.contentRect.width, height: entry.contentRect.height }); });
    observer.observe(boardRef.current);
    return () => observer.disconnect();
  }, [view]);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [invitationOpen,setInvitationOpen]=useState(false);
  const orderedPeers = useMemo(() => [props.self, ...props.peers.filter((peer) => peer.id !== props.self.id)], [props.peers, props.self]);
  const pointByPeer = new Map(orderedPeers.map((peer, index) => [peer.id, positions[index % positions.length]]));
  const routeEdges = new Set((props.selectedRoute ?? []).slice(1).map((id, index) => canonicalEdge(props.selectedRoute![index], id)));
  const liveEdges = new Set(props.observedLinks.filter((link) => link.state === "direct").map((link) => canonicalEdge(link.a, link.b)));
  const reachable = new Set([props.self.id]);
  for (let pass = 0; pass < orderedPeers.length; pass += 1) for (const edge of props.routingGraph) {
    if (reachable.has(edge.a) || reachable.has(edge.b)) { reachable.add(edge.a); reachable.add(edge.b); }
  }
  const panelOpen = Boolean(props.selectedPeer) || view === "lab";
  const showInvite = props.self.role === "host" && (orderedPeers.length === 1 || props.joinRequests.length > 0 || invitationOpen);

  const chooseView = (next: View) => {
    setView(next);
    if (next === "send") window.setTimeout(() => document.querySelector<HTMLInputElement>(".conversation-main .premium-composer input:not([type=file])")?.focus(), 120);
  };

  return <main className={`hopnet-shell desktop-room ${view === "replay" ? "replay-active" : ""}`}>
    <Atmosphere />
    <header className="top-bar">
      <div className="wordmark"><strong>HOPNET</strong><i /><span>The Network You Can Touch</span></div>
      <Navigation active={view} onSelect={chooseView} />
      {props.self.role === "host" && <button className="soft-button invitation-toggle" onClick={() => {setInvitationOpen(true);chooseView("space");}}>Room invitation{props.joinRequests.length ? ` (${props.joinRequests.length})` : ""}</button>}
      <button className={`status-orb ${props.coordinatorState}`} onClick={() => chooseView("lab")} aria-label={`Coordinator ${props.coordinatorState}`}><span /><span /></button>
    </header>

    {view === "space" ? <><motion.section className={`hero-command ${orderedPeers.length > 1 ? "compact" : ""}`} initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .65, ease: [0.16, 1, 0.3, 1] }}>
      <h1>Touch a device. See the route.</h1>
      <p><i />{orderedPeers.length} admitted · {orderedPeers.filter((peer) => peer.id === props.self.id ? props.coordinatorState === "connected" : peer.coordinatorConnected).length} signaling connected <span /> {Object.values(props.links).filter((link) => link.state === "direct").length ? "Direct WebRTC" : "Awaiting a peer"}</p>
    </motion.section>

    <section ref={boardRef} className={`spatial-board ${panelOpen ? "with-panel" : ""}`} aria-label="Live network peers">
      <div className="tabletop" />
      <svg className="network-lines" viewBox={`0 0 ${boardSize.width} ${boardSize.height}`} aria-hidden="true">
        <defs><filter id="routeGlow"><feGaussianBlur stdDeviation="4" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
        {props.topologyEdges.map((edge) => {
          const a = pointByPeer.get(edge.a); const b = pointByPeer.get(edge.b);
          if (!a || !b) return null;
          const key = canonicalEdge(edge.a, edge.b);
          const route = routeEdges.has(key); const live = liveEdges.has(key);
          const pulse = props.events.find((event) => ["lsa-received", "packet-forward"].includes(event.type) && performance.now() - event.monotonicMs < 1000 && (event.path?.length ?? 0) >= 2 && canonicalEdge(event.path!.at(-2)!, event.path!.at(-1)!) === key);
          return <g key={key} className={route ? "route-line" : live ? "live-line" : "planned-line"}>
            <path d={curve(a, b, boardSize)} />
            {pulse && <circle key={pulse.id} r="4" className={pulse.plane === "control" ? "control-pulse" : "data-pulse"} fill={pulse.plane === "control" ? "#9c8fff" : "#b9ffff"}><animateMotion dur=".7s" repeatCount="1" path={pulse.path?.at(-2) === edge.a ? curve(a, b, boardSize) : curve(b, a, boardSize)}/></circle>}
          </g>;
        })}
      </svg>
      {orderedPeers.slice(0, positions.length).map((peer, index) => {
        const state = peer.id === props.self.id ? "new" : props.links[peer.id]?.state === "direct" ? "direct" : reachable.has(peer.id) ? "overlay" : props.links[peer.id]?.state ?? "new";
        return <SpatialDevice key={peer.id} peer={peer} self={peer.id === props.self.id} point={positions[index]} state={state} selected={props.selectedPeer?.id === peer.id} onClick={() => props.onSelectPeer(peer.id)} />;
      })}
      {orderedPeers.length === 1 && <div className="room-ready"><span>Your room is ready.</span><p>Invite a physical device. It appears here after you approve it.</p></div>}
    </section>

    <div className="room-panel-layer">
      {showInvite ? <motion.aside key="room" className="room-panel glass-panel" initial={{ opacity: 0, x: -24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }}>
        <div className="panel-heading"><span>PRIVATE LAN ROOM</span><button aria-label="Close room invitation" onClick={() => setInvitationOpen(false)}>×</button></div>
        <img src={props.inviteQrUrl} alt="QR code to join this HOPNET room" />
        <strong>Bring another device into the space.</strong>
        {props.networkInfo?.interfaces.length ? <label className="invitation-origin">Invitation address<select aria-label="Invitation address" value={props.invitationOrigin} onChange={(event) => props.onInvitationOrigin(event.target.value)}>{props.networkInfo.interfaces.map((item) => <option key={item.id} value={item.origin}>{item.address} · {item.name}{item.recommended ? " · recommended" : ""}</option>)}</select></label> : null}
        <button className="soft-button" onClick={() => { void navigator.clipboard?.writeText(props.inviteUrl).then(() => { setInviteCopied(true); setCopyError(""); window.setTimeout(() => setInviteCopied(false), 1600); }).catch(() => setCopyError("Clipboard unavailable. Use trusted HTTPS or scan the room QR.")); if (!navigator.clipboard) setCopyError("Clipboard requires trusted HTTPS. Scan the room QR instead."); }}>{inviteCopied ? "Invitation copied" : "Copy invitation"}</button>
        {copyError && <p className="session-note" role="alert">{copyError}</p>}
        <NetworkDoctor {...props} />
        <TransferShelf compact transfers={props.transfers} peers={props.peers} self={props.self} onResponse={props.onTransferResponse} />
        {props.joinRequests.map((request) => <div className="admission" key={request.requestId}><span>{request.displayName}<small>{request.deviceCategory} requests entry</small></span><button onClick={() => props.onApprove(request.requestId)}>Admit</button><button onClick={() => props.onReject(request.requestId)}>Reject</button></div>)}
        {orderedPeers.length > 1 && <Topology peers={orderedPeers} edges={props.topologyEdges} onToggle={props.onToggleEdge} />}
      </motion.aside> : props.selectedPeer ? <motion.aside key={props.selectedPeer.id} className="peer-inspector" initial={{ opacity: 0, x: 28, scale: .96 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: 28 }} transition={{ type: "spring", stiffness: 340, damping: 30 }}>
        <div className="inspector-top"><DeviceAsset category={props.selectedPeer.deviceCategory} /><div><h2>{props.selectedPeer.displayName}</h2><p><i />{props.selectedPeer.coordinatorConnected ? "Signaling connected" : "Signaling disconnected"}</p></div><button aria-label="Close peer inspector" onClick={() => props.onSelectPeer("")}>×</button></div>
        <button className="inspector-action" onClick={() => chooseView("routing")}>Inspect distributed routing tables</button>
        <div className="inspector-section">
          <InfoRow icon="swap" label={props.selectedLink?.state === "direct" ? "Direct WebRTC" : props.selectedRoute ? `${props.selectedRoute.length - 1}-hop overlay` : "Route unavailable"} value={props.selectedLink?.state === "direct" ? props.selectedLink.candidateType ?? "Candidate selected" : props.selectedRoute ? "Established overlay links" : "No usable path"} />
          <InfoRow icon="clock" label={props.selectedLink?.state === "direct" && performance.now()-(props.selectedLink.measuredAt ?? -Infinity)<30_000 ? "Measured RTT" : "RTT · historical or unmeasured"} value={props.selectedLink?.rttMs !== undefined ? `${props.selectedLink.rttMs} ms · last direct sample` : props.selectedRoute?.length === 2 ? "Run a ping" : "Not measured end-to-end"} />
          <InfoRow icon="pulse" label="Direct-link app bytes" value={props.selectedLink ? `${props.selectedLink.bytesSent} ↑  ${props.selectedLink.bytesReceived} ↓` : "0 ↑  0 ↓"} />
          <InfoRow icon="route" label="Hello neighbor / destination" value={`${props.routerState?.neighbors.find((neighbor) => neighbor.id === props.selectedPeer?.id)?.active ? "Active" : "Not active"} / ${props.selectedRoute ? "Reachable" : "Unreachable"}`} />
          <p className="session-note">Channel: {props.selectedLink?.channelState ?? "not established"}. Byte counters are recorded connection totals, not live throughput. Signaling and data connectivity are independent.</p>
        </div>
        <label className="policy-control">Path strategy<select value={props.routeStrategy} onChange={(event) => props.onRouteStrategy(event.target.value as RouteStrategy)}><option value="minimum-hops">Minimum hops</option><option value="lowest-latency">Lowest observed RTT</option><option value="adaptive">Adaptive resilience</option></select></label>
        {props.selectedRoute && <div className="route-chip">{props.selectedRoute.map((id) => orderedPeers.find((peer) => peer.id === id)?.displayName ?? "peer").join(" → ")}</div>}
        <TransferShelf compact transfers={props.transfers} peers={props.peers} self={props.self} onResponse={props.onTransferResponse} />
        <button className="inspector-action" onClick={props.onPing} disabled={props.selectedLink?.state !== "direct"}><Icon name="pulse"/>Ping over WebRTC</button>
        <Composer className="desktop-composer" message={props.message} onMessage={props.onMessage} onSend={props.onSend} disabled={!props.selectedRoute} onFile={props.onFile} fileDisabled={!props.selectedRoute || !window.isSecureContext || !crypto.subtle} />
        <FilePicker disabled={!props.selectedRoute || !window.isSecureContext || !crypto.subtle} onFile={props.onFile} />
        {!window.isSecureContext && <p className="secure-transfer-note">Verified files require trusted LAN HTTPS on both devices. See Network Doctor under Lab.</p>}
        <button className="fallback-action" onClick={props.onFallback} disabled={!props.message.trim()}>Use explicit coordinator fallback</button>
        {props.selectedLink?.error && <p className="inline-error">{props.selectedLink.error}</p>}
      </motion.aside> : null}
    </div></> : <section className="studio-workspace" aria-label={`${view} workspace`}>{view === "routing" ? <RoutingWorkspace {...props}/> : view === "send" ? <SendWorkspace {...props}/> : view === "lab" ? <LabWorkspace {...props}/> : <ReplayWorkspace events={props.events}/>}</section>}

    {view === "space" && <EventRibbon events={props.events} expanded={false} />}
    {props.error && <button className="error-toast" onClick={props.onClearError}>{props.error}</button>}
  </main>;
}

function MobileInvitation(props:Props) {
  const [feedback,setFeedback]=useState("");
  return <>
    {props.networkInfo?.interfaces.length ? <label className="invitation-origin">Invitation address<select aria-label="Invitation address" value={props.invitationOrigin} onChange={(event) => props.onInvitationOrigin(event.target.value)}>{props.networkInfo.interfaces.map((item) => <option key={item.id} value={item.origin}>{item.address} · {item.name}</option>)}</select></label> : null}
    <button className="soft-button" onClick={() => {if(!navigator.clipboard) {setFeedback("Clipboard unavailable. Scan the QR using trusted HTTPS.");return;} void navigator.clipboard.writeText(props.inviteUrl).then(() => setFeedback("Invitation copied")).catch(() => setFeedback("Clipboard unavailable. Scan the QR using trusted HTTPS."));}}>Copy invitation</button>
    {feedback && <p role="status">{feedback}</p>}
  </>;
}

function MobileRoom(props: Props) {
  const [tab, setTab] = useState<"room" | "routing" | "messages" | "activity" | "lab">("messages");
  const [keyboardInset, setKeyboardInset] = useState(0);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => setKeyboardInset(Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop));
    viewport.addEventListener("resize", update); viewport.addEventListener("scroll", update); update();
    return () => { viewport.removeEventListener("resize", update); viewport.removeEventListener("scroll", update); };
  }, []);
  const directCount = Object.values(props.links).filter((link) => link.state === "direct").length;
  const remotePeers = props.peers.filter((peer) => peer.id !== props.self.id);
  const routeNames = props.selectedRoute?.map((id) => props.peers.find((peer) => peer.id === id)?.displayName ?? "peer");
  const secureFiles = window.isSecureContext && Boolean(crypto.subtle);
  return <main className="hopnet-shell mobile-room">
    <Atmosphere />
    <header className="mobile-header"><div><strong>HOPNET</strong><span>The Network You Can Touch</span></div><div className="mobile-status"><span><i className="green"/>Coordinator {props.coordinatorState}</span><span><i/> {directCount ? "Direct WebRTC ready" : "Waiting for direct WebRTC"}</span></div></header>
    {props.self.role === "host" && <button className="soft-button invitation-toggle" onClick={() => setTab("room")}>Room invitation{props.joinRequests.length ? ` (${props.joinRequests.length})` : ""}</button>}

    {tab === "room" && <>
      <section className="relay-hero"><div className="relay-symbol"><Icon name="route"/></div><div><h1>You’re part of the route.</h1><strong>Keep HOPNET open while relaying.</strong><p>Your phone can forward permitted messages and files between other peers.</p></div></section>
      <section className="mobile-peer-card mobile-room-list">
        <h2>Room participants</h2>
        <p>{props.peers.length} admitted · {props.peers.filter((peer) => peer.id === props.self.id ? props.coordinatorState === "connected" : peer.coordinatorConnected).length} signaling connected</p>
        {props.peers.map((peer) => <div className="mobile-room-peer" key={peer.id}>
          <DeviceAsset category={peer.deviceCategory}/>
          <div><strong>{peer.displayName}{peer.id === props.self.id ? " · you" : ""}</strong><small>{peer.id === props.self.id ? `Signaling ${props.coordinatorState}` : peer.coordinatorConnected ? "Signaling connected" : "Signaling disconnected · data plane independent"}</small></div>
          {peer.id !== props.self.id && <button onClick={() => { props.onSelectPeer(peer.id); setTab("messages"); }}>Open</button>}
        </div>)}
        {props.self.role === "host" && <div className="mobile-room-invite">
          <img src={props.inviteQrUrl} alt="QR code to join this HOPNET room"/>
          <small>Scan to request admission</small>
          <MobileInvitation {...props}/>
          {props.joinRequests.map((request) => <div className="admission" key={request.requestId}><span>{request.displayName}</span><button onClick={() => props.onApprove(request.requestId)}>Admit</button><button onClick={() => props.onReject(request.requestId)}>Reject</button></div>)}
        </div>}
        <NetworkDoctor {...props}/>
        <button className="primary-button" onClick={() => setTab("lab")}>Open Resilience Lab</button>
      </section>
    </>}

    {tab === "messages" && <>
      {remotePeers.length ? <section className="mobile-peer-card">
        <div className="mobile-peer-head"><DeviceAsset category={props.selectedPeer?.deviceCategory ?? "other"}/><div><h2>{props.selectedPeer?.displayName}</h2><p><i />{props.selectedPeer?.coordinatorConnected ? "Coordinator connected" : "Signaling offline"}</p></div></div>
        <div className="mobile-route"><span /><b>{routeNames?.join(" → ") ?? "No data route available"}</b><span /></div>
        <div className="mobile-measure"><div><small>DATA PLANE</small><strong>{props.selectedLink?.state === "direct" ? "Direct WebRTC" : props.selectedRoute ? `${props.selectedRoute.length - 1}-hop overlay` : "Unavailable"}</strong></div><div><small>{props.selectedLink?.state === "direct" && performance.now()-(props.selectedLink.measuredAt ?? -Infinity)<30_000 ? "MEASURED RTT" : "LAST RTT · HISTORICAL"}</small><strong>{props.selectedLink?.rttMs !== undefined ? `${props.selectedLink.rttMs} ms` : "Not measured"}</strong></div></div>
        <p className="session-note">Channel {props.selectedLink?.channelState ?? "not established"} · Hello neighbor {props.routerState?.neighbors.find((neighbor) => neighbor.id===props.selectedPeer?.id)?.active ? "active" : "not active"} · Destination {props.selectedRoute ? "reachable" : "unreachable"}</p>
        <div className="mobile-peer-actions"><button onClick={props.onPing} disabled={props.selectedLink?.state !== "direct"}>Ping over WebRTC</button><select aria-label="Selected peer" value={props.selectedPeer?.id} onChange={(event) => props.onSelectPeer(event.target.value)}>{remotePeers.map((peer) => <option key={peer.id} value={peer.id}>{peer.displayName}</option>)}</select></div>
        <FilePicker disabled={!props.selectedRoute || !secureFiles} onFile={props.onFile}/>
        {!secureFiles && <p className="secure-transfer-note mobile">Verified file transfer requires trusted HTTPS on this device. Ask the host for the HTTPS LAN address and install the trusted local CA certificate.</p>}
      </section> : <section className="mobile-peer-card mobile-invite">
        <h2>Waiting for another peer.</h2><p>Join or admit another device to begin messaging.</p>
        {props.self.role === "host" && <><img src={props.inviteQrUrl} alt="QR code to join this HOPNET room"/>{props.joinRequests.map((request) => <button key={request.requestId} onClick={() => props.onApprove(request.requestId)}>Admit {request.displayName}</button>)}</>}
      </section>}
      <Conversation {...props}/>
      <TransferShelf transfers={props.transfers} peers={props.peers} self={props.self} onResponse={props.onTransferResponse} onCancel={props.onCancelTransfer}/>
    </>}

    {tab === "activity" && <ReplayWorkspace events={props.events}/>}
    {tab === "lab" && <LabWorkspace {...props}/>}
    {tab === "routing" && <RoutingWorkspace {...props}/>}

    <div className="mobile-controls" style={{ bottom: `${Math.max(12, keyboardInset)}px` }}>
      {tab === "messages" && <Composer message={props.message} onMessage={props.onMessage} onSend={props.onSend} disabled={!props.selectedRoute} onFile={props.onFile} fileDisabled={!props.selectedRoute || !secureFiles}/>}
      <nav aria-label="Mobile navigation">
        <button aria-current={tab === "routing" ? "page" : undefined} className={tab === "routing" ? "active" : ""} onClick={() => setTab("routing")}><Icon name="route"/><span>Routing</span></button>
        <button aria-current={tab === "room" ? "page" : undefined} className={tab === "room" ? "active" : ""} onClick={() => setTab("room")}><Icon name="space"/><span>Room</span></button>
        <button aria-current={tab === "messages" ? "page" : undefined} className={tab === "messages" ? "active" : ""} onClick={() => setTab("messages")}><Icon name="send"/><span>Messages</span></button>
        <button aria-current={tab === "activity" ? "page" : undefined} className={tab === "activity" ? "active" : ""} onClick={() => setTab("activity")}><Icon name="replay"/><span>Activity</span></button>
      </nav>
    </div>
    {props.error && <button className="error-toast" onClick={props.onClearError}>{props.error}</button>}
  </main>;
}

function Atmosphere() { return <div className="atmosphere" aria-hidden="true"><i className="blob blob-a"/><i className="blob blob-b"/><i className="blob blob-c"/><i className="grain"/></div>; }

function Navigation({ active, onSelect }: { active: View; onSelect: (view: View) => void }) {
  return <nav className="primary-nav" aria-label="Workspace navigation">{(["space", "routing", "send", "lab", "replay"] as View[]).map((item) => <button key={item} aria-label={`Open ${item} view`} aria-current={active === item ? "page" : undefined} className={active === item ? "active" : ""} onClick={() => onSelect(item)}>{active === item && <motion.span className="nav-selection" layoutId="workspace-selection" transition={{ type: "spring", stiffness: 390, damping: 34 }} />}<Icon name={item}/><span>{item[0].toUpperCase() + item.slice(1)}</span></button>)}</nav>;
}

function SpatialDevice({ peer, point, state, selected, self, onClick }: { peer: Peer; point: Point; state: LinkState["state"] | "overlay"; selected: boolean; self: boolean; onClick: () => void }) {
  return <button aria-label={`${peer.displayName}, ${self ? "this device" : state === "direct" ? "Direct WebRTC" : state}`} className={`spatial-device ${selected ? "selected" : ""} ${self ? "self" : ""}`} style={{ "--x": `${point.x}%`, "--y": `${point.y}%` } as CSSProperties} onClick={onClick} disabled={self}>
    <span className="device-label"><i className={state}/>{self ? `${peer.displayName} · you` : peer.displayName}</span>
    <span className="device-render"><DeviceAsset category={peer.deviceCategory}/></span>
    <span className="plinth"><i/></span>
  </button>;
}

function DeviceAsset({ category }: { category: DeviceCategory }) {
  const asset = deviceAsset(category);
  return <img className={`device-asset ${asset.className}`} src={asset.source} alt="" decoding="async"/>;
}

function InfoRow({ icon, label, value }: { icon: string; label: string; value: string }) { return <div className="info-row"><Icon name={icon}/><div><strong>{label}</strong><span>{value}</span></div></div>; }

export function Composer({ message, onMessage, onSend, disabled, className = "", onFile, fileDisabled = false }: { message: string; onMessage: (value: string) => void; onSend: () => void; disabled?: boolean; className?: string; onFile?: (file: File) => Promise<void>; fileDisabled?: boolean }) {
  return <div className={`premium-composer ${className}`}>
    {onFile ? <label className={`composer-attach ${fileDisabled ? "disabled" : ""}`} title={fileDisabled ? "A usable route and trusted HTTPS are required for verified files" : "Attach a file"}><Icon name="attach"/><input aria-label="Attach a file" type="file" disabled={fileDisabled} onChange={(event) => { const file = event.target.files?.[0]; if (file) void onFile(file); event.target.value = ""; }}/></label> : <span aria-hidden="true"><Icon name="attach"/></span>}
    <input value={message} maxLength={8192} onChange={(event) => onMessage(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !disabled) onSend(); }} placeholder="Message this peer…"/>
    <button onClick={onSend} disabled={disabled || !message.trim()} aria-label="Send"><Icon name="send"/></button>
  </div>;
}

function FilePicker({ disabled, onFile }: { disabled: boolean; onFile: (file: File) => Promise<void> }) {
  return <label className={`file-picker ${disabled ? "disabled" : ""}`}><Icon name="attach"/><span>Choose file to send</span><input aria-label="Choose file to send" type="file" disabled={disabled} onChange={(event) => { const file = event.target.files?.[0]; if (file) void onFile(file); event.target.value = ""; }}/></label>;
}

export function TransferShelf({ transfers, peers, self, onResponse, onCancel, compact = false }: { transfers: TransferView[]; peers: Peer[]; self: Peer; onResponse: (transferId: string, accepted: boolean) => Promise<void>; onCancel?: (id: string) => Promise<void>; compact?: boolean }) {
  const active = transfers.filter((transfer) => !["verified", "failed", "declined", "cancelled"].includes(transfer.status));
  const visible = compact ? active.length ? active : transfers.slice(0, 1) : transfers.slice(0, 12);
  if (!visible.length) return null;
  return <section className="transfer-shelf" aria-label="File transfers">{visible.map((transfer) => {
    const peer = peers.find((item) => item.id === transfer.peerId)?.displayName ?? "peer";
    const percentage = Math.min(100, Math.round(transfer.acknowledgedBytes / Math.max(1, transfer.size) * 100));
    const path = transfer.paths[0]?.map((id) => id === self.id ? "This device" : peers.find((item) => item.id === id)?.displayName ?? "peer").join(" → ");
    return <motion.article key={transfer.id} data-testid={`transfer-${transfer.direction}`} data-status={transfer.status} initial={{ opacity: 0, y: 18, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }}>
      <div className="transfer-file-icon"><Icon name="file"/></div>
      <div className="transfer-copy"><small>{transfer.direction === "receive" ? `FROM ${peer}` : `TO ${peer}`}</small><strong>{transfer.fileName}</strong><span>{formatBytes(transfer.size)} · {transfer.paths.length > 1 ? `${transfer.paths.length} routes observed` : path ?? "finding route"}</span></div>
      {transfer.status === "awaiting-acceptance" ? <div className="transfer-consent"><button onClick={() => void onResponse(transfer.id, true)} aria-label={`Accept ${transfer.fileName}`}>Accept</button><button onClick={() => void onResponse(transfer.id, false)} aria-label={`Decline ${transfer.fileName}`}>Decline</button></div> : <div className="transfer-progress"><div><i style={{ width: `${percentage}%` }}/></div><span>{transfer.status === "verified" ? "SHA-256 verified" : ["failed", "declined", "cancelled"].includes(transfer.status) ? transfer.error ?? transfer.status : transfer.status === "offered" ? "Waiting for receiver consent" : transfer.status === "verifying" ? "Verifying whole file…" : `${percentage}% receiver acknowledged`}</span>{transfer.downloadUrl && <a href={transfer.downloadUrl} download={transfer.fileName}>Save file</a>}</div>}
      {onCancel && !["verified", "failed", "declined", "cancelled"].includes(transfer.status) && <button className="cancel-transfer" onClick={() => void onCancel(transfer.id)}>Cancel transfer</button>}
      <details className="transfer-evidence"><summary>Receiver evidence · {transfer.acknowledgedChunks}/{transfer.totalChunks} chunks</summary><pre data-testid="transfer-evidence">{JSON.stringify({ ...transfer, downloadUrl: undefined, history: transfer.history?.filter((event) => !["chunk-scheduled", "receiver-ack", "chunk-received"].includes(event.type)) }, null, 2)}</pre></details>
    </motion.article>;
  })}</section>;
}

function EventRibbon({ events, expanded }: { events: NetworkEvent[]; expanded: boolean }) {
  const shown = events.slice(0, expanded ? 8 : 3);
  return <section className={`event-ribbon-premium ${expanded ? "expanded" : ""}`} aria-label="Recent real network events">{shown.length ? shown.map((event, index) => <article key={event.id}><div className="event-icon"><Icon name={index === 0 ? "check" : "route"}/></div><div><strong>{index + 1}. {event.title}</strong><span>{event.detail}</span></div><time>{event.at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time><em className={event.provenance.toLowerCase()}>{event.provenance}</em></article>) : <p>Live protocol events will appear here.</p>}</section>;
}

function NetworkDoctor(props: Props) {
  const direct = Object.values(props.links).some((link) => link.state === "direct");
  const measured = Object.values(props.links).some((link) => link.rttMs !== undefined);
  const checks = [
    { label: "LAN invitation", detail: new URL(props.invitationOrigin).host, ready: Boolean(props.networkInfo?.interfaces.length) },
    { label: "Coordinator", detail: props.coordinatorState, ready: props.coordinatorState === "connected" },
    { label: "Direct data channel", detail: direct ? "RTCDataChannel open" : "Needs a second device", ready: direct },
    { label: "Measured echo", detail: measured ? "Receiver response observed" : "Run a WebRTC ping", ready: measured },
    { label: "Secure context", detail: window.isSecureContext ? "Trusted by this browser" : "Configure trusted HTTPS", ready: window.isSecureContext },
  ];
  return <details className="network-doctor"><summary>Network Doctor <span>{checks.filter((check) => check.ready).length}/{checks.length}</span></summary><div>{checks.map((check) => <p key={check.label} className={check.ready ? "ready" : "pending"}><i/><span><strong>{check.label}</strong><small>{check.detail}</small></span></p>)}<em>VPNs, client isolation, cellular fallback, firewalls, and background suspension can block peer connectivity.</em></div></details>;
}

export function Topology({ peers, edges, onToggle, links = [] }: { peers: Peer[]; edges: TopologyEdge[]; onToggle: (a: string, b: string) => void; links?: OverlayLink[] }) {
  return <div className="topology"><span>PERMITTED LINKS · WEBRTC STATUS</span>{peerPairs(peers).map(([a, b]) => { const key = canonicalEdge(a.id, b.id); const active = edges.some((edge) => canonicalEdge(edge.a, edge.b) === key); const link = links.find((item) => canonicalEdge(item.a, item.b) === key); const state = !active ? "not permitted" : link?.state === "direct" ? "established" : link?.state ?? "permitted · negotiating"; return <button key={key} aria-label={`${a.displayName} ↔ ${b.displayName}`} aria-description={state} aria-pressed={active} className={active ? "active" : ""} onClick={() => onToggle(a.id, b.id)}><i/>{a.displayName} ↔ {b.displayName}<small>{state}</small></button>; })}</div>;
}

function Icon({ name }: { name: string }) {
  const paths: Record<string, React.ReactNode> = {
    space: <><circle cx="6" cy="12" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="18" cy="18" r="2"/><path d="M8 11l8-4M8 13l8 4"/></>,
    send: <path d="M21 3L10 14M21 3l-7 18-4-7-7-4 18-7z"/>,
    lab: <path d="M9 3h6M10 3v6l-5 9a2 2 0 001.7 3h10.6a2 2 0 001.7-3l-5-9V3M8 15h8"/>,
    replay: <><path d="M3 12a9 9 0 109-9 9.7 9.7 0 00-6.7 2.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></>,
    route: <><circle cx="6" cy="17" r="2.4"/><circle cx="18" cy="7" r="2.4"/><path d="M8 16c1-5 3-7 8-8"/></>,
    swap: <><path d="M4 8h14l-3-3M20 16H6l3 3"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    pulse: <path d="M3 12h4l2-5 4 10 2-5h6"/>,
    attach: <path d="M8 12l6-6a4 4 0 015.7 5.7l-8 8a6 6 0 01-8.5-8.5l8-8"/>,
    check: <path d="M5 12l4 4L19 6"/>,
    file: <><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name === "routing" ? "route" : name] ?? paths.space}</svg>;
}

function curve(a: Point, b: Point, size: { width: number; height: number }) {
  const scale = window.innerWidth <= 1000 ? .75 : 1;
  const ax = a.x * size.width / 100, ay = a.y * size.height / 100 + 41 * scale;
  const bx = b.x * size.width / 100, by = b.y * size.height / 100 + 41 * scale;
  const distance = Math.max(1, Math.hypot(bx - ax, by - ay));
  // Terminate on the illuminated plinth perimeter, not the device's screen.
  const ox = (bx - ax) / distance * 70 * scale, oy = (by - ay) / distance * 17 * scale;
  const x1 = ax + ox, y1 = ay + oy, x2 = bx - ox, y2 = by - oy;
  const dx = x2 - x1, dy = y2 - y1, length = Math.max(1, Math.hypot(dx, dy));
  const offset = Math.min(64, length * .11);
  const cx = Math.max(12, Math.min(size.width - 12, (x1 + x2) / 2 - (dy / length) * offset));
  const cy = Math.max(12, Math.min(size.height - 12, (y1 + y2) / 2 + (dx / length) * offset));
  return `M ${x1} ${y1} Q ${cx} ${cy}, ${x2} ${y2}`;
}

function peerPairs(peers: Peer[]): Array<[Peer, Peer]> { const pairs: Array<[Peer, Peer]> = []; for (let left = 0; left < peers.length; left += 1) for (let right = left + 1; right < peers.length; right += 1) pairs.push([peers[left], peers[right]]); return pairs; }

function formatBytes(bytes: number): string { return bytes < 1_024 ? `${bytes} B` : bytes < 1_048_576 ? `${(bytes / 1_024).toFixed(1)} KB` : `${(bytes / 1_048_576).toFixed(1)} MB`; }
