import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { DeviceCategory, OverlayLink, Peer, TopologyEdge } from "@hopnet/protocol";
import { canonicalEdge, type RouteStrategy } from "@hopnet/routing";
import type { LinkState } from "../lib/peer-manager.ts";
import type { TransferView } from "../lib/transfer-manager.ts";
import type { NetworkInfo } from "../App.tsx";

export type NetworkEvent = { id: string; at: Date; title: string; detail: string; provenance: "REAL" | "EMULATED" | "INFERRED" };

type Props = {
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
  onToggleEdge: (a: string, b: string) => void;
  onRouteStrategy: (strategy: RouteStrategy) => void;
  onMessage: (message: string) => void;
  onSend: () => void;
  onFile: (file: File) => Promise<void>;
  onTransferResponse: (transferId: string, accepted: boolean) => Promise<void>;
  onPing: () => void;
  onFallback: () => void;
  onClearError: () => void;
};

type View = "space" | "send" | "lab" | "replay";
type Point = { x: number; y: number };

const positions: Point[] = [
  { x: 33, y: 54 },
  { x: 61, y: 25 },
  { x: 77, y: 52 },
  { x: 57, y: 79 },
  { x: 23, y: 77 },
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
  const [view, setView] = useState<View>("space");
  const [inviteCopied, setInviteCopied] = useState(false);
  const orderedPeers = useMemo(() => [props.self, ...props.peers.filter((peer) => peer.id !== props.self.id)], [props.peers, props.self]);
  const pointByPeer = new Map(orderedPeers.map((peer, index) => [peer.id, positions[index % positions.length]]));
  const routeEdges = new Set((props.selectedRoute ?? []).slice(1).map((id, index) => canonicalEdge(props.selectedRoute![index], id)));
  const liveEdges = new Set(props.observedLinks.filter((link) => link.state === "direct").map((link) => canonicalEdge(link.a, link.b)));
  const panelOpen = Boolean(props.selectedPeer) || view === "lab";
  const showInvite = props.self.role === "host" && (orderedPeers.length === 1 || props.joinRequests.length > 0 || view === "lab");

  const chooseView = (next: View) => {
    setView(next);
    if (next === "send") window.setTimeout(() => document.querySelector<HTMLInputElement>(".desktop-composer input")?.focus(), 120);
  };

  return <main className="hopnet-shell desktop-room">
    <Atmosphere />
    <header className="top-bar">
      <div className="wordmark"><strong>HOPNET</strong><i /><span>The Network You Can Touch</span></div>
      <Navigation active={view} onSelect={chooseView} />
      <button className={`status-orb ${props.coordinatorState}`} onClick={() => chooseView("lab")} aria-label={`Coordinator ${props.coordinatorState}`}><span /><span /></button>
    </header>

    <motion.section className={`hero-command ${orderedPeers.length > 1 ? "compact" : ""}`} initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .65, ease: [0.16, 1, 0.3, 1] }}>
      <h1>Touch a device. See the route.</h1>
      <p><i />{orderedPeers.filter((peer) => peer.id === props.self.id ? props.coordinatorState === "connected" : peer.coordinatorConnected).length} peers present <span /> {Object.values(props.links).filter((link) => link.state === "direct").length ? "Direct WebRTC" : "Awaiting a peer"}</p>
    </motion.section>

    <section className={`spatial-board ${panelOpen ? "with-panel" : ""}`} aria-label="Live network peers">
      <div className="tabletop" />
      <svg className="network-lines" viewBox="0 0 1000 620" preserveAspectRatio="none" aria-hidden="true">
        <defs><filter id="routeGlow"><feGaussianBlur stdDeviation="4" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
        {props.topologyEdges.map((edge) => {
          const a = pointByPeer.get(edge.a); const b = pointByPeer.get(edge.b);
          if (!a || !b) return null;
          const key = canonicalEdge(edge.a, edge.b);
          const route = routeEdges.has(key); const live = liveEdges.has(key);
          return <g key={key} className={route ? "route-line" : live ? "live-line" : "planned-line"}>
            <path d={curve(a, b)} />
            
          </g>;
        })}
      </svg>
      {orderedPeers.slice(0, positions.length).map((peer, index) => {
        const state = peer.id === props.self.id ? "direct" : props.links[peer.id]?.state ?? (props.topologyEdges.some((edge) => edge.a === peer.id || edge.b === peer.id) ? "connecting" : "overlay");
        return <SpatialDevice key={peer.id} peer={peer} self={peer.id === props.self.id} point={positions[index]} state={state} selected={props.selectedPeer?.id === peer.id} onClick={() => props.onSelectPeer(peer.id)} />;
      })}
      {orderedPeers.length === 1 && <div className="room-ready"><span>Your room is ready.</span><p>Invite a physical device. It appears here after you approve it.</p></div>}
    </section>

    <AnimatePresence mode="wait">
      {showInvite ? <motion.aside key="room" className="room-panel glass-panel" initial={{ opacity: 0, x: -24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }}>
        <div className="panel-heading"><span>PRIVATE LAN ROOM</span><button onClick={() => setView("space")} aria-label="Close room panel">×</button></div>
        <img src={props.inviteQrUrl} alt="QR code to join this HOPNET room" />
        <strong>Bring another device into the space.</strong>
        {props.networkInfo?.interfaces.length ? <label className="invitation-origin">Invitation address<select aria-label="Invitation address" value={props.invitationOrigin} onChange={(event) => props.onInvitationOrigin(event.target.value)}>{props.networkInfo.interfaces.map((item) => <option key={item.id} value={item.origin}>{item.address} · {item.name}{item.recommended ? " · recommended" : ""}</option>)}</select></label> : null}
        <button className="soft-button" onClick={() => { void navigator.clipboard.writeText(props.inviteUrl); setInviteCopied(true); window.setTimeout(() => setInviteCopied(false), 1600); }}>{inviteCopied ? "Invitation copied" : "Copy invitation"}</button>
        <NetworkDoctor {...props} />
        <TransferShelf transfers={props.transfers} peers={props.peers} self={props.self} onResponse={props.onTransferResponse} />
        {props.joinRequests.map((request) => <div className="admission" key={request.requestId}><span>{request.displayName}<small>{request.deviceCategory} requests entry</small></span><button onClick={() => props.onApprove(request.requestId)}>Admit</button></div>)}
        {orderedPeers.length > 1 && <Topology peers={orderedPeers} edges={props.topologyEdges} onToggle={props.onToggleEdge} />}
      </motion.aside> : props.selectedPeer ? <motion.aside key={props.selectedPeer.id} className="peer-inspector" initial={{ opacity: 0, x: 28, scale: .96 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: 28 }} transition={{ type: "spring", stiffness: 340, damping: 30 }}>
        <div className="inspector-top"><DeviceAsset category={props.selectedPeer.deviceCategory} /><div><h2>{props.selectedPeer.displayName}</h2><p><i />{props.selectedPeer.coordinatorConnected ? "Online" : "Offline"}</p></div><button aria-label="Close peer inspector" onClick={() => props.onSelectPeer("")}>×</button></div>
        <div className="inspector-section">
          <InfoRow icon="swap" label={props.selectedLink?.state === "direct" ? "Direct WebRTC" : props.selectedRoute ? `${props.selectedRoute.length - 1}-hop overlay` : "Route unavailable"} value={props.selectedLink?.candidateType ?? "not selected"} />
          <InfoRow icon="clock" label="Measured RTT" value={props.selectedLink?.rttMs !== undefined ? `${props.selectedLink.rttMs} ms` : "Run a ping"} />
          <InfoRow icon="pulse" label="App bytes" value={props.selectedLink ? `${props.selectedLink.bytesSent} ↑  ${props.selectedLink.bytesReceived} ↓` : "0 ↑  0 ↓"} />
        </div>
        <label className="policy-control">Path strategy<select value={props.routeStrategy} onChange={(event) => props.onRouteStrategy(event.target.value as RouteStrategy)}><option value="minimum-hops">Minimum hops</option><option value="lowest-latency">Lowest observed RTT</option><option value="adaptive">Adaptive resilience</option></select></label>
        {props.selectedRoute && <div className="route-chip">{props.selectedRoute.map((id) => orderedPeers.find((peer) => peer.id === id)?.displayName ?? "peer").join(" → ")}</div>}
        <TransferShelf transfers={props.transfers} peers={props.peers} self={props.self} onResponse={props.onTransferResponse} />
        <button className="inspector-action" onClick={props.onPing} disabled={props.selectedLink?.state !== "direct"}><Icon name="pulse"/>Ping over WebRTC</button>
        <Composer className="desktop-composer" message={props.message} onMessage={props.onMessage} onSend={props.onSend} disabled={!props.selectedRoute} onFile={props.onFile} fileDisabled={!props.selectedRoute || !window.isSecureContext || !crypto.subtle} />
        <FilePicker disabled={!props.selectedRoute || !window.isSecureContext || !crypto.subtle} onFile={props.onFile} />
        {!window.isSecureContext && <p className="secure-transfer-note">Verified files require trusted LAN HTTPS on both devices. See Network Doctor under Lab.</p>}
        <button className="fallback-action" onClick={props.onFallback} disabled={!props.message.trim()}>Use explicit coordinator fallback</button>
        {props.selectedLink?.error && <p className="inline-error">{props.selectedLink.error}</p>}
      </motion.aside> : null}
    </AnimatePresence>

    {view === "replay" ? <ReplayPanel events={props.events} onClose={() => setView("space")} /> : <EventRibbon events={props.events} expanded={false} />}
    {props.error && <button className="error-toast" onClick={props.onClearError}>{props.error}</button>}
  </main>;
}

function MobileRoom(props: Props) {
  const directCount = Object.values(props.links).filter((link) => link.state === "direct").length;
  const remotePeers = props.peers.filter((peer) => peer.id !== props.self.id);
  const routeNames = props.selectedRoute?.map((id) => props.peers.find((peer) => peer.id === id)?.displayName ?? "peer");
  return <main className="hopnet-shell mobile-room">
    <Atmosphere />
    <header className="mobile-header"><div><strong>HOPNET</strong><span>The Network You Can Touch</span></div><div className="mobile-status"><span><i className="green"/>Coordinator {props.coordinatorState}</span><span><i/> {directCount ? "Direct WebRTC ready" : "Waiting for direct WebRTC"}</span></div></header>
    <section className="relay-hero"><div className="relay-symbol"><Icon name="route"/></div><div><h1>You’re part of the route.</h1><strong>Keep HOPNET open while relaying.</strong><p>Your phone helps forward messages and files between approved peers in this room.</p></div></section>
    {remotePeers.length ? <section className="mobile-peer-card">
      <div className="mobile-peer-head"><DeviceAsset category={props.selectedPeer?.deviceCategory ?? "other"}/><div><h2>{props.selectedPeer?.displayName}</h2><p><i />{props.selectedPeer?.coordinatorConnected ? "Available on this room" : "Signaling offline"}</p></div></div>
      <div className="mobile-route"><span /><b>{routeNames?.join("  →  ") ?? "No route available"}</b><span /></div>
      <div className="mobile-measure"><div><small>DATA PLANE</small><strong>{props.selectedLink?.state === "direct" ? "Direct WebRTC" : props.selectedRoute ? `${props.selectedRoute.length - 1}-hop overlay` : "Unavailable"}</strong></div><div><small>MEASURED RTT</small><strong>{props.selectedLink?.rttMs !== undefined ? `${props.selectedLink.rttMs} ms` : "Not measured"}</strong></div></div>
      <div className="mobile-peer-actions"><button onClick={props.onPing} disabled={props.selectedLink?.state !== "direct"}>Ping over WebRTC</button><select aria-label="Selected peer" value={props.selectedPeer?.id} onChange={(event) => props.onSelectPeer(event.target.value)}>{remotePeers.map((peer) => <option key={peer.id} value={peer.id}>{peer.displayName}</option>)}</select></div>
      <FilePicker disabled={!props.selectedRoute} onFile={props.onFile} />
    </section> : props.self.role === "host" ? <section className="mobile-peer-card mobile-invite"><img src={props.inviteQrUrl} alt="QR code to join this HOPNET room"/><div><h2>Your room is ready.</h2><p>Scan this on another physical device, then approve its request here.</p><small>{new URL(props.invitationOrigin).host}</small></div>{props.joinRequests.map((request) => <button key={request.requestId} onClick={() => props.onApprove(request.requestId)}>Admit {request.displayName}</button>)}</section> : <section className="mobile-peer-card"><h2>Waiting for another peer.</h2><p>The room will update from real coordinator state.</p></section>}
    <TransferShelf transfers={props.transfers} peers={props.peers} self={props.self} onResponse={props.onTransferResponse} />
    <section className="mobile-activity-log" aria-label="Live protocol activity">{props.events.map((event) => <article key={event.id}><strong>{event.title}</strong><span>{event.detail}</span></article>)}</section>
    <div className="mobile-controls"><Composer message={props.message} onMessage={props.onMessage} onSend={props.onSend} disabled={!props.selectedRoute}/><nav><button><Icon name="space"/><span>Room</span></button><button className="active"><Icon name="send"/><span>Messages</span></button><button><Icon name="replay"/><span>Activity</span></button></nav></div>
    {props.error && <button className="error-toast" onClick={props.onClearError}>{props.error}</button>}
  </main>;
}

function Atmosphere() { return <div className="atmosphere" aria-hidden="true"><i className="blob blob-a"/><i className="blob blob-b"/><i className="blob blob-c"/><i className="grain"/></div>; }

function Navigation({ active, onSelect }: { active: View; onSelect: (view: View) => void }) {
  return <nav className="primary-nav">{(["space", "send", "lab", "replay"] as View[]).map((item) => <button key={item} aria-label={`Open ${item} view`} className={active === item ? "active" : ""} onClick={() => onSelect(item)}><Icon name={item}/><span>{item[0].toUpperCase() + item.slice(1)}</span></button>)}</nav>;
}

function SpatialDevice({ peer, point, state, selected, self, onClick }: { peer: Peer; point: Point; state: LinkState["state"] | "overlay"; selected: boolean; self: boolean; onClick: () => void }) {
  return <button aria-label={`${peer.displayName}, ${state === "direct" ? "Direct WebRTC" : state}`} className={`spatial-device ${selected ? "selected" : ""} ${self ? "self" : ""}`} style={{ "--x": `${point.x}%`, "--y": `${point.y}%` } as CSSProperties} onClick={onClick} disabled={self}>
    <span className="device-label"><i className={state}/>{self ? `${peer.displayName} · you` : peer.displayName}</span>
    <span className="device-render"><DeviceAsset category={peer.deviceCategory}/></span>
    <span className="plinth"><i/></span>
  </button>;
}

function DeviceAsset({ category }: { category: DeviceCategory }) {
  const source = category === "laptop" ? "laptop" : category === "phone" ? "phone" : category === "tablet" ? "tablet" : "node";
  return <img className={`device-asset ${source}`} src={`/assets/devices/${source}.webp`} alt="" decoding="async"/>;
}

function InfoRow({ icon, label, value }: { icon: string; label: string; value: string }) { return <div className="info-row"><Icon name={icon}/><div><strong>{label}</strong><span>{value}</span></div><b>›</b></div>; }

function Composer({ message, onMessage, onSend, disabled, className = "", onFile, fileDisabled = false }: { message: string; onMessage: (value: string) => void; onSend: () => void; disabled?: boolean; className?: string; onFile?: (file: File) => Promise<void>; fileDisabled?: boolean }) {
  return <div className={`premium-composer ${className}`}>
    {onFile ? <label className={`composer-attach ${fileDisabled ? "disabled" : ""}`} title={fileDisabled ? "A usable route and trusted HTTPS are required for verified files" : "Attach a file"}><Icon name="attach"/><input aria-label="Attach a file" type="file" disabled={fileDisabled} onChange={(event) => { const file = event.target.files?.[0]; if (file) void onFile(file); event.target.value = ""; }}/></label> : <span aria-hidden="true"><Icon name="attach"/></span>}
    <input value={message} maxLength={8192} onChange={(event) => onMessage(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !disabled) onSend(); }} placeholder="Message this peer…"/>
    <button onClick={onSend} disabled={disabled || !message.trim()} aria-label="Send"><Icon name="send"/></button>
  </div>;
}

function FilePicker({ disabled, onFile }: { disabled: boolean; onFile: (file: File) => Promise<void> }) {
  return <label className={`file-picker ${disabled ? "disabled" : ""}`}><Icon name="attach"/><span>Choose file to send</span><input aria-label="Choose file to send" type="file" disabled={disabled} onChange={(event) => { const file = event.target.files?.[0]; if (file) void onFile(file); event.target.value = ""; }}/></label>;
}

function TransferShelf({ transfers, peers, self, onResponse }: { transfers: TransferView[]; peers: Peer[]; self: Peer; onResponse: (transferId: string, accepted: boolean) => Promise<void> }) {
  const visible = transfers.filter((transfer) => transfer.status === "awaiting-acceptance" || transfer.status === "transferring" || transfer.status === "verifying" || transfer.status === "verified" || transfer.status === "failed").slice(0, 2);
  if (!visible.length) return null;
  return <section className="transfer-shelf" aria-label="File transfers">{visible.map((transfer) => {
    const peer = peers.find((item) => item.id === transfer.peerId)?.displayName ?? "peer";
    const percentage = Math.min(100, Math.round(transfer.acknowledgedBytes / Math.max(1, transfer.size) * 100));
    const path = transfer.paths[0]?.map((id) => id === self.id ? "This device" : peers.find((item) => item.id === id)?.displayName ?? "peer").join(" → ");
    return <motion.article key={transfer.id} initial={{ opacity: 0, y: 18, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }}>
      <div className="transfer-file-icon"><Icon name="file"/></div>
      <div className="transfer-copy"><small>{transfer.direction === "receive" ? `FROM ${peer}` : `TO ${peer}`}</small><strong>{transfer.fileName}</strong><span>{formatBytes(transfer.size)} · {transfer.paths.length > 1 ? `${transfer.paths.length} disjoint paths` : path ?? "finding route"}</span></div>
      {transfer.status === "awaiting-acceptance" ? <div className="transfer-consent"><button onClick={() => void onResponse(transfer.id, true)} aria-label={`Accept ${transfer.fileName}`}>Accept</button><button onClick={() => void onResponse(transfer.id, false)} aria-label={`Decline ${transfer.fileName}`}>Decline</button></div> : <div className="transfer-progress"><div><i style={{ width: `${percentage}%` }}/></div><span>{transfer.status === "verified" ? "SHA-256 verified" : transfer.status === "failed" ? transfer.error : transfer.status === "verifying" ? "Verifying whole file…" : `${percentage}% receiver acknowledged`}</span>{transfer.downloadUrl && <a href={transfer.downloadUrl} download={transfer.fileName}>Save file</a>}</div>}
    </motion.article>;
  })}</section>;
}

function ReplayPanel({ events, onClose }: { events: NetworkEvent[]; onClose: () => void }) {
  return <section className="replay-panel" aria-label="Recent network activity">
    <header><div><small>RECORDED LOCAL EVENTS</small><h2>Network activity</h2><p>Actual events observed by this browser. Full historical network-state replay is not implemented yet.</p></div><button onClick={onClose} aria-label="Close activity panel">×</button></header>
    <div className="replay-feed">{events.length ? events.map((event) => <article key={event.id}><time>{event.at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time><div><strong>{event.title}</strong><p>{event.detail}</p></div><span>{event.provenance}</span></article>) : <p>No activity recorded yet. Send a message or ping a connected peer to begin.</p>}</div>
  </section>;
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

function Topology({ peers, edges, onToggle }: { peers: Peer[]; edges: TopologyEdge[]; onToggle: (a: string, b: string) => void }) {
  return <div className="topology"><span>PERMITTED LINKS</span>{peerPairs(peers).map(([a, b]) => { const active = edges.some((edge) => canonicalEdge(edge.a, edge.b) === canonicalEdge(a.id, b.id)); return <button key={canonicalEdge(a.id, b.id)} className={active ? "active" : ""} onClick={() => onToggle(a.id, b.id)}><i/>{a.displayName} ↔ {b.displayName}</button>; })}</div>;
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
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name] ?? paths.space}</svg>;
}

function curve(a: Point, b: Point) {
  const x1 = a.x * 10, y1 = a.y * 6.2, x2 = b.x * 10, y2 = b.y * 6.2;
  const dx = x2 - x1, dy = y2 - y1, length = Math.max(1, Math.hypot(dx, dy));
  const offset = Math.min(64, length * .11);
  const cx = Math.max(24, Math.min(976, (x1 + x2) / 2 - (dy / length) * offset));
  const cy = Math.max(24, Math.min(596, (y1 + y2) / 2 + (dx / length) * offset));
  return `M ${x1} ${y1} Q ${cx} ${cy}, ${x2} ${y2}`;
}

function peerPairs(peers: Peer[]): Array<[Peer, Peer]> { const pairs: Array<[Peer, Peer]> = []; for (let left = 0; left < peers.length; left += 1) for (let right = left + 1; right < peers.length; right += 1) pairs.push([peers[left], peers[right]]); return pairs; }

function formatBytes(bytes: number): string { return bytes < 1_024 ? `${bytes} B` : bytes < 1_048_576 ? `${(bytes / 1_024).toFixed(1)} KB` : `${(bytes / 1_048_576).toFixed(1)} MB`; }
