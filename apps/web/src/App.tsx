import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { serverSocketMessageSchema, type DataPacket, type DeviceCategory, type Peer } from "@hopnet/protocol";
import { PeerManager, type LinkState } from "./lib/peer-manager.ts";

type Credentials = { roomId: string; inviteSecret: string; hostToken?: string; peer: Peer; sessionToken: string };
type JoinRequest = { requestId: string; displayName: string; deviceCategory: DeviceCategory };
type EventItem = { id: string; at: Date; title: string; detail: string; provenance: "REAL" | "INFERRED" };

const query = new URLSearchParams(location.search);
const invitedRoom = query.get("room") ?? "";
const invitedSecret = query.get("invite") ?? "";

function App() {
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [links, setLinks] = useState<Record<string, LinkState>>({});
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [selectedPeerId, setSelectedPeerId] = useState<string>();
  const [coordinatorState, setCoordinatorState] = useState("offline");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [joinPending, setJoinPending] = useState(false);
  const socketRef = useRef<WebSocket | undefined>(undefined);
  const managerRef = useRef<PeerManager | undefined>(undefined);
  const peersRef = useRef<Peer[]>([]);

  useEffect(() => { peersRef.current = peers; }, [peers]);

  const addEvent = (title: string, detail: string, provenance: EventItem["provenance"] = "REAL") => {
    setEvents((current) => [{ id: crypto.randomUUID(), at: new Date(), title, detail, provenance }, ...current].slice(0, 30));
  };

  useEffect(() => {
    if (!credentials) return;
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${location.host}/signal?token=${encodeURIComponent(credentials.sessionToken)}`);
    socketRef.current = socket;
    const manager = new PeerManager(
      credentials.peer.id,
      (targetPeerId, signal) => socket.send(JSON.stringify({ type: "signal", targetPeerId, signal })),
      (state) => setLinks((current) => ({ ...current, [state.peerId]: state })),
      (peerId, packet) => onDataPacket(peerId, packet),
    );
    managerRef.current = manager;
    const onDataPacket = (peerId: string, packet: DataPacket) => {
      const source = peersRef.current.find((peer) => peer.id === peerId)?.displayName ?? `peer …${peerId.slice(-5)}`;
      if (packet.kind === "pong") addEvent("Direct echo returned", `${source} replied over RTCDataChannel`);
      if (packet.kind === "message") addEvent(`Message from ${source}`, packet.body);
      if (packet.kind === "message-ack") addEvent("Message acknowledged", `${source} confirmed application receipt`);
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
        for (const peer of item.peers) if (peer.id !== item.selfPeerId && peer.coordinatorConnected) manager.ensure(peer.id);
      } else if (item.type === "peer-joined") {
        setPeers((current) => [...current.filter((peer) => peer.id !== item.peer.id), item.peer]);
        manager.ensure(item.peer.id);
        addEvent("Peer joined", `${item.peer.displayName} is connected to the coordinator`);
      } else if (item.type === "peer-left") {
        setPeers((current) => current.map((peer) => peer.id === item.peerId ? { ...peer, coordinatorConnected: false } : peer));
        addEvent("Signaling disconnected", "The peer left the coordinator; an established data channel may remain active");
      } else if (item.type === "signal") {
        void manager.receiveSignal(item.sourcePeerId, item.signal);
      } else if (item.type === "join-requested") {
        setJoinRequests((current) => [...current.filter((request) => request.requestId !== item.requestId), item]);
      } else if (item.type === "relay-data") {
        addEvent("Fallback relay received", item.payload);
      } else if (item.type === "error") {
        setError(item.message);
      }
    };
    return () => { socket.close(); manager.closeAll(); };
  }, [credentials]);

  const remotePeers = peers.filter((peer) => peer.id !== credentials?.peer.id);
  const selectedPeer = remotePeers.find((peer) => peer.id === selectedPeerId) ?? remotePeers[0];
  const selectedLink = selectedPeer ? links[selectedPeer.id] : undefined;

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
    if (!selectedPeer || !message.trim()) return;
    try {
      managerRef.current?.sendMessage(selectedPeer.id, message.trim());
      addEvent("Message sent on direct channel", `${selectedPeer.displayName}: ${message.trim()}`);
      setMessage("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Message failed"); }
  };

  const relayFallback = () => {
    if (!selectedPeer || !message.trim() || socketRef.current?.readyState !== WebSocket.OPEN) return;
    socketRef.current.send(JSON.stringify({ type: "relay-data", targetPeerId: selectedPeer.id, payload: message.trim() }));
    addEvent("Explicit fallback used", `${selectedPeer.displayName}: coordinator relayed payload`);
    setMessage("");
  };

  if (!credentials) return <Entry invited={Boolean(invitedRoom && invitedSecret)} pending={joinPending} onCreate={createRoom} onJoin={joinRoom} error={error} />;

  const inviteUrl = `${location.origin}/?room=${encodeURIComponent(credentials.roomId)}&invite=${encodeURIComponent(credentials.inviteSecret)}`;
  return (
    <main className="app-shell">
      <header className="brand-bar"><span className="brand">HOPNET</span><span className="brand-note">The Network You Can Touch</span><span className={`coordinator-state ${coordinatorState}`}>{coordinatorState}</span></header>
      <section className="command-capsule">
        <p>{credentials.peer.role === "host" ? "A network you can touch." : "You’re part of the route."}</p>
        <span><i /> {peers.filter((peer) => peer.coordinatorConnected).length} peers present <b>·</b> {Object.values(links).filter((link) => link.state === "direct").length} direct WebRTC</span>
      </section>

      <section className="network-stage" aria-label="Live network peers">
        <svg className="filaments" viewBox="0 0 1000 560" preserveAspectRatio="none" aria-hidden="true">
          {remotePeers.map((peer, index) => <line key={peer.id} x1="500" y1="280" x2={remotePeers.length === 1 ? 750 : 180 + (index % 3) * 320} y2={remotePeers.length === 1 ? 300 : 170 + Math.floor(index / 3) * 260} className={links[peer.id]?.state === "direct" ? "live" : "pending"} />)}
        </svg>
        <Device peer={credentials.peer} self state="direct" index={-1} selected={false} />
        <AnimatePresence>
          {remotePeers.map((peer, index) => <Device key={peer.id} peer={peer} state={links[peer.id]?.state ?? "connecting"} index={index} solo={remotePeers.length === 1} selected={selectedPeer?.id === peer.id} onClick={() => setSelectedPeerId(peer.id)} />)}
        </AnimatePresence>
        {remotePeers.length === 0 && <div className="empty-network"><span>Your room is ready.</span><p>Invite another physical device. It will appear here only after host approval.</p></div>}
      </section>

      {credentials.hostToken && <aside className={`invite-pane glass-pane ${selectedPeer ? "has-inspector" : ""}`}>
        <span className="technical-label">PRIVATE LAN INVITE</span>
        <img src={`/api/rooms/${credentials.roomId}/qr?invite=${encodeURIComponent(credentials.inviteSecret)}`} alt="QR code to join this HOPNET room" />
        <button className="text-button" onClick={() => navigator.clipboard.writeText(inviteUrl)}>Copy invitation</button>
        {joinRequests.map((request) => <div className="join-request" key={request.requestId}><span>{request.displayName}<small>{request.deviceCategory}</small></span><button onClick={() => approve(request.requestId)}>Admit</button></div>)}
      </aside>}

      {selectedPeer && <aside className="inspector glass-pane">
        <span className="technical-label">PEER INSPECTOR · REAL STATE</span>
        <h2>{selectedPeer.displayName}</h2>
        <p className="device-kind">{selectedPeer.deviceCategory}</p>
        <dl>
          <div><dt>Coordinator</dt><dd>{selectedPeer.coordinatorConnected ? "connected" : "offline"}</dd></div>
          <div><dt>Data plane</dt><dd>{selectedLink?.state ?? "establishing"}</dd></div>
          <div><dt>Candidate pair</dt><dd>{selectedLink?.candidateType ?? "not selected"}</dd></div>
          <div><dt>Measured RTT</dt><dd>{selectedLink?.rttMs !== undefined ? `${selectedLink.rttMs} ms` : "run ping"}</dd></div>
          <div><dt>App bytes</dt><dd>{selectedLink ? `${selectedLink.bytesSent} ↑ ${selectedLink.bytesReceived} ↓` : "0"}</dd></div>
        </dl>
        <button className="primary-button" onClick={ping} disabled={selectedLink?.state !== "direct"}>Ping over WebRTC</button>
        <div className="composer"><input value={message} maxLength={8192} onChange={(event) => setMessage(event.target.value)} placeholder="Message this peer…" /><button onClick={sendMessage} disabled={selectedLink?.state !== "direct"}>Send</button></div>
        <button className="fallback-button" onClick={relayFallback} disabled={!message.trim()}>Use explicit coordinator fallback</button>
        {selectedLink?.error && <p className="error-text">{selectedLink.error}</p>}
      </aside>}

      <section className="event-ribbon" aria-label="Recent real network events">
        {events.slice(0, 3).map((event, index) => <article key={event.id}><span>{index + 1}</span><div><strong>{event.title}</strong><small>{event.detail}</small></div><em>{event.provenance}</em></article>)}
        {events.length === 0 && <p>Live protocol events will appear here.</p>}
      </section>
      {error && <button className="error-toast" onClick={() => setError("")}>{error}</button>}
    </main>
  );
}

function Entry({ invited, pending, onCreate, onJoin, error }: { invited: boolean; pending: boolean; onCreate: (name: string, category: DeviceCategory) => Promise<void>; onJoin: (name: string, category: DeviceCategory) => Promise<void>; error: string }) {
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
      <p className="entry-note">Only devices you approve can enter. HOPNET does not scan your LAN.</p>
      {error && <p className="error-text">{error}</p>}
    </section>
  </main>;
}

function Device({ peer, state, index, self, solo, selected, onClick }: { peer: Peer; state: LinkState["state"]; index: number; self?: boolean; solo?: boolean; selected: boolean; onClick?: () => void }) {
  const positions = ["peer-one", "peer-two", "peer-three", "peer-four"];
  return <motion.button layoutId={`peer-${peer.id}`} initial={{ opacity: 0, scale: .8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: .8 }} className={`device-object ${self ? "self-device" : positions[index % positions.length]} ${solo ? "solo-peer" : ""} ${selected ? "selected" : ""}`} onClick={onClick} disabled={self}>
    <span className={`device-glyph ${peer.deviceCategory}`}><i /></span><strong>{self ? `${peer.displayName} · you` : peer.displayName}</strong><small><i className={state} />{state === "direct" ? "Direct WebRTC" : state}</small>
  </motion.button>;
}

export default App;
