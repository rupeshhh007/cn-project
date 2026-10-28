import { useEffect, useMemo, useState } from "react";
import { canonicalEdge } from "@hopnet/routing";
import { transferPaths } from "../lib/experiment-paths.ts";
import { Composer, Topology, TransferShelf, type Props } from "./RoomSurface.tsx";
import { experimentResult, exportFile, resultsCsv, type ExperimentConfig, type NetworkEvent } from "../lib/evidence.ts";
import { deviceAsset } from "../lib/device-assets.ts";

export function Conversation(props: Props) {
  const messages = props.conversations.filter((message) => message.peerId === props.selectedPeer?.id);
  return <section className="conversation" aria-label="Conversation history" aria-live="polite">
    <p className="session-note">Current room session · history clears on reload</p>
    {!messages.length && <div className="conversation-empty"><span>↗</span><h3>A conversation with {props.selectedPeer?.displayName ?? "your next peer"}.</h3><p>Messages and receiver confirmations will appear here.</p></div>}
    {messages.map((message) => <article key={message.id} className={`message-bubble ${message.direction}`}><p>{message.body}</p><small>{message.direction === "incoming" ? props.selectedPeer?.displayName : "You"} · {new Date(message.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {message.status === "sent" ? "Awaiting receiver receipt" : message.status === "failed" ? "Delivery unconfirmed. Check the route and keep the peer foregrounded before resending." : message.status}</small></article>)}
  </section>;
}

export function SendWorkspace(props: Props) {
  const peers = props.peers.filter((peer) => peer.id !== props.self.id);
  return <div className="send-workspace">
    <aside className="conversation-peers"><span className="studio-eyebrow">YOUR ROOM</span><h1>Send something.</h1><p>A conversation, with a verifiable path.</p>{peers.length ? peers.map((peer) => <button key={peer.id} className={props.selectedPeer?.id === peer.id ? "selected" : ""} onClick={() => props.onSelectPeer(peer.id)}><img src={deviceAsset(peer.deviceCategory).source} alt=""/><span>{peer.displayName}<small>{peer.coordinatorConnected ? "In this room" : "Signaling offline"}</small></span></button>) : <p>Admit another device from Space to begin.</p>}</aside>
    <section className="conversation-main"><header><div><span className="studio-eyebrow">SESSION CONVERSATION</span><h2>{props.selectedPeer?.displayName ?? "Choose a peer"}</h2><p>{props.selectedRoute ? props.selectedRoute.map((id) => props.peers.find((peer) => peer.id === id)?.displayName ?? "peer").join(" → ") : "No established route"}</p></div><span className="connection-pill">{props.selectedRoute ? "WebRTC data plane" : "Waiting for a route"}</span></header>
      <div className="conversation-scroll"><Conversation {...props}/><TransferShelf transfers={props.transfers.filter((item) => item.peerId === props.selectedPeer?.id)} peers={props.peers} self={props.self} onResponse={props.onTransferResponse} onCancel={props.onCancelTransfer}/></div>
      <Composer message={props.message} onMessage={props.onMessage} onSend={props.onSend} disabled={!props.selectedRoute} onFile={props.onFile} fileDisabled={!props.selectedRoute || !window.isSecureContext || !crypto.subtle}/>
      {!window.isSecureContext && <p className="session-note">File verification requires trusted LAN HTTPS on both devices.</p>}
    </section>
  </div>;
}

export function LabWorkspace(props: Props) {
  const [preset, setPreset] = useState<ExperimentConfig["preset"]>("relay-recovery");
  const [mode, setMode] = useState<ExperimentConfig["mode"]>("multipath");
  const [relay, setRelay] = useState("");
  const [file, setFile] = useState<File | undefined>(undefined);
  const [starting, setStarting] = useState(false);
  const host = props.self.role === "host";
  const receiver = props.selectedPeer?.id ?? "";
  const relays = props.peers.filter((peer) => peer.id !== props.self.id && peer.id !== receiver);
  const selectedRelay = relays.some((peer) => peer.id === relay) ? relay : relays[0]?.id ?? "";
  const live = props.routingGraph;
  let paths: string[][] = [];
  try { paths = transferPaths(props.peers.map((peer) => peer.id), live, props.self.id, receiver, props.routeStrategy, mode); } catch { /* An absent route is displayed, never synthesized. */ }
  const results = props.experiments.map((experiment) => experimentResult(experiment, experiment.result ?? props.transfers.find((transfer) => transfer.id === experiment.transferId)));
  const active = props.experiments.some((experiment) => !experiment.error && !experiment.result && (!experiment.transferId || !["verified", "failed", "cancelled", "declined"].includes(props.transfers.find((transfer) => transfer.id === experiment.transferId)?.status ?? "preparing")));
  const ready = host && receiver && paths.length >= (mode === "multipath" ? 2 : 1) && window.isSecureContext && Boolean(crypto.subtle) && !active && !starting;
  const name = (id: string) => props.peers.find((peer) => peer.id === id)?.displayName ?? "peer";
  const begin = async () => {
    setStarting(true);
    try {
      // A repeatable payload is real data: it is sent, hashed and downloaded
      // through the same consent and RTC transfer protocol as a user file.
      const bytes = new Uint8Array(4 * 1024 * 1024);
      for (let index = 0; index < bytes.length; index += 1) bytes[index] = (index * 31 + (index >>> 8)) & 255;
      await props.onExperiment({ preset, mode, strategy: props.routeStrategy, peerId: receiver }, file ?? new File([bytes], "hopnet-repeatable-4MiB.bin", { type: "application/octet-stream" }));
    } finally { setStarting(false); }
  };
  const completed = results.filter((result) => result.status === "verified");
  const comparable = completed.filter((result) => result.experiment.mode === mode && result.experiment.strategy === props.routeStrategy && result.payloadBytes === (file?.size ?? 4 * 1024 * 1024));
  const times = comparable.map((result) => result.elapsedMs!).sort((a, b) => a - b);
  const median = times.length >= 3 ? (times[Math.floor((times.length - 1) / 2)]! + times[Math.ceil((times.length - 1) / 2)]!) / 2 : undefined;
  return <div className="lab-workspace">
    <header className="studio-heading"><span className="studio-eyebrow">RESILIENCE STUDIO</span><h1>Watch a network recover.</h1><p>Real browser relays. Receiver receipts. Measured consequences.</p></header>
    <div className="lab-columns"><section className="lab-controls glass-sheet"><h2>Set the experiment.</h2>
      <label>Experiment preset<select value={preset} onChange={(event) => { const next = event.target.value as ExperimentConfig["preset"]; setPreset(next); setMode(next === "direct-overlay" ? "direct" : "multipath"); }}><option value="direct-overlay">A · Direct versus multi-hop</option><option value="single-multipath">B · Single route versus multipath</option><option value="relay-recovery">C · Recovery under relay failure</option></select></label>
      <label>Receiver<select aria-label="Experiment receiver" value={receiver} onChange={(event) => props.onSelectPeer(event.target.value)}><option value="" disabled>Select a participant</option>{props.peers.filter((peer) => peer.id !== props.self.id).map((peer) => <option key={peer.id} value={peer.id}>{peer.displayName}</option>)}</select></label>
      <label>Trial route mode<select value={mode} onChange={(event) => setMode(event.target.value as ExperimentConfig["mode"])}>{preset === "direct-overlay" && <option value="direct">Established direct link</option>}<option value="single-overlay">One overlay route</option>{preset !== "direct-overlay" && <option value="multipath">Two independent overlay routes</option>}</select></label>
      <label>Routing strategy<select value={props.routeStrategy} onChange={(event) => props.onRouteStrategy(event.target.value as Props["routeStrategy"])} disabled={active}><option value="minimum-hops">Minimum hops</option><option value="lowest-latency">Lowest observed RTT</option><option value="adaptive">Adaptive resilience</option></select></label>
      <label>Payload<input type="file" aria-label="Experiment test file" onChange={(event) => setFile(event.target.files?.[0])}/><small>{file ? `${file.name} · ${file.size} bytes` : "Default: repeatable 4 MiB payload"}</small></label>
      <div className="lab-paths" aria-label="Available experiment routes"><strong>{paths.length} established {paths.length === 1 ? "route" : "routes"}</strong>{paths.map((path, index) => <p key={path.join()}><span>{index + 1}</span>{path.map(name).join(" → ")}</p>)}{!paths.length && <p>Permit links below, then wait for their WebRTC channels to open.</p>}</div>
      <button className="primary-button" onClick={() => void begin()} disabled={!ready}>{starting ? "Preparing file…" : active ? "Trial active · waiting for receiver" : "Start experiment"}</button>
      {!host && <p className="session-note">Only the room host can start trials or change the topology.</p>}
      {host && <><label>Failure target<select aria-label="Failure relay" value={selectedRelay} onChange={(event) => setRelay(event.target.value)}>{relays.map((peer) => <option value={peer.id} key={peer.id}>{peer.displayName}</option>)}</select></label><button className="fault-button" disabled={!selectedRelay || !props.topologyEdges.some((edge) => edge.a === selectedRelay || edge.b === selectedRelay)} onClick={() => props.onFault(selectedRelay)}>Disconnect relay links</button><button disabled={!props.restorablePeers.includes(selectedRelay) || !props.peers.find((peer) => peer.id === selectedRelay)?.coordinatorConnected} onClick={() => props.onRestore(selectedRelay)}>Restore relay links</button><p className="session-note">Application-level fault injection. Closes permitted relay DataChannels; Wi-Fi remains unchanged. Restore saved links to repeat; a physically closed browser must rejoin first.</p></>}
    </section><section className="lab-observations"><div className="glass-sheet"><h2>The live fabric.</h2>{host ? <Topology peers={props.peers} edges={props.topologyEdges} links={props.observedLinks} onToggle={props.onToggleEdge}/> : <p>{live.length} established links observed.</p>}<p className="session-note">For two paths: Sender ↔ R1 ↔ Receiver and Sender ↔ R2 ↔ Receiver. A permitted edge only becomes usable when its channel is established.</p></div>
      <TransferShelf transfers={props.transfers} peers={props.peers} self={props.self} onResponse={props.onTransferResponse} onCancel={props.onCancelTransfer}/>
      <section className="glass-sheet experiment-results" aria-label="Experiment results"><header><h2>Evidence, as it happens.</h2><div><button disabled={!results.length} onClick={() => exportFile("hopnet-experiments.json", JSON.stringify({ exportedAt: new Date().toISOString(), results }, null, 2), "application/json")}>Export JSON</button><button disabled={!results.length} onClick={() => exportFile("hopnet-experiments.csv", resultsCsv(results), "text/csv")}>Export CSV</button></div></header>
      {!results.length && <p>No trials recorded. Results appear after an actual file offer.</p>}
      {results.map((result) => <article key={result.experiment.id}><div><strong>{result.experiment.preset} · {result.experiment.mode}</strong><span>{result.status}</span></div><dl><div><dt>Receiver confirmed</dt><dd>{result.receiverAcknowledgedBytes.toLocaleString()} bytes</dd></div><div><dt>Chunk retries</dt><dd>{result.retries}</dd></div><div><dt>Completion</dt><dd>{result.elapsedMs === null ? "Pending" : `${(result.elapsedMs / 1000).toFixed(2)} s`}</dd></div><div><dt>Recovery</dt><dd>{result.recoveryMs === null ? "Not observed" : `${result.recoveryMs.toFixed(1)} ms`}</dd></div></dl>{result.error && <p role="alert">{result.error}</p>}{result.verifiedHash && <code>{result.verifiedHash}</code>}</article>)}
      <p className="session-note">{median === undefined ? `${times.length} comparable verified trials. At least three are required for a median.` : `${times.length} comparable trials · median ${(median / 1000).toFixed(2)} s · range ${(times[0]! / 1000).toFixed(2)}–${(times.at(-1)! / 1000).toFixed(2)} s.`} Each trial still requires receiver consent.</p></section>
    </section></div>
  </div>;
}

export function ReplayWorkspace({ events }: { events: NetworkEvent[] }) {
  // Freeze the recorded window on entry; live arrivals cannot move the scrubber.
  const [sourceRecording, setRecording] = useState(() => [...events].reverse());
  const [filter, setFilter] = useState("all");
  const recording = useMemo(() => sourceRecording.filter((event) => filter === "all" || event.plane === filter || event.type.includes(filter) || (filter === "hello" && event.type.startsWith("neighbor-"))), [sourceRecording, filter]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const event = recording[index];
  useEffect(() => {
    if (!playing || index >= recording.length - 1) { setPlaying(false); return; }
    const wait = Math.max(16, (recording[index + 1]!.monotonicMs - recording[index]!.monotonicMs) / speed);
    const timer = setTimeout(() => setIndex((current) => current + 1), wait);
    return () => clearTimeout(timer);
  }, [playing, index, speed, recording]);
  const positions = useMemo(() => new Map((event?.snapshot.peers ?? []).map((peer, i, peers) => [peer.id, { x: 50 + 33 * Math.cos(i * 2 * Math.PI / peers.length - Math.PI / 2), y: 50 + 33 * Math.sin(i * 2 * Math.PI / peers.length - Math.PI / 2) }])), [event]);
  const explanation = event?.type === "packet-forward" ? "This browser selected the next hop using its own forwarding table. The recorded trace describes observed traversal, not a centrally prescribed end-to-end path." : event?.type === "delivery-ack" ? "A cooperative receiver returned an application acknowledgement through independently chosen next hops. Unlike file receipts, chat acknowledgements are not endpoint-signed." : event?.plane === "control" ? "A local observation of the distributed control plane. LSA origin and observing router are distinct; remote clocks are not synchronized." : event?.type.includes("ack") ? "This is a final receiver acknowledgement, not a relay accepting a send. Its round trip includes forwarding and verification." : event?.type.includes("verified") ? "The reconstructed file matched its offered SHA-256. The sender requires a matching completion receipt before displaying verification." : event?.type.includes("forward") ? "An intermediate browser forwarded an envelope over another RTCDataChannel. The path and TTL constrain its next hop." : event?.type.includes("unavailable") || event?.type.includes("retry") ? "The sender observed an unavailable path or an expired acknowledgement deadline. Only unconfirmed chunks may be rescheduled." : event?.type.includes("link") ? "Signaling negotiates a peer connection. Only an open DataChannel qualifies as an established data-plane edge." : "This event was recorded locally by this browser. Other devices may have additional observations; their clocks have not been synchronized.";
  return <div className="replay-workspace"><header className="studio-heading"><span className="studio-eyebrow">PROTOCOL TIME MACHINE · RECORDED STATE</span><h1>Every hop has a story.</h1><p>A bounded, local journal. Playback sends no network packets.</p></header>
    <label className="protocol-filter">Event filter<select aria-label="Protocol event filter" value={filter} onChange={(event) => { setFilter(event.target.value); setIndex(0); setPlaying(false); }}>{[["all","All observed events"],["control","Control plane"],["data","Data plane"],["hello","Hello / liveness"],["lsa","Link-state advertisements"],["route-recompute","SPF recomputations"],["packet-forward","Packet forwarding"],["delivery","Delivery acknowledgements"],["drop","Drops"],["retry","Retransmissions"],["verified","File verification"]].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <div className="replay-controls"><button disabled={!recording.length} onClick={() => { if (index >= recording.length - 1) setIndex(0); setPlaying(!playing); }}>{playing ? "Pause replay" : "Play replay"}</button><button aria-label="Previous event" disabled={index === 0} onClick={() => { setPlaying(false); setIndex(index - 1); }}>←</button><input aria-label="Replay timeline" type="range" min="0" max={Math.max(0, recording.length - 1)} value={index} onChange={(e) => { setPlaying(false); setIndex(Number(e.target.value)); }} disabled={!recording.length}/><button aria-label="Next event" disabled={index >= recording.length - 1} onClick={() => { setPlaying(false); setIndex(index + 1); }}>→</button><select aria-label="Replay speed" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}><option value=".5">0.5×</option><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option></select><button onClick={() => { setPlaying(false); setRecording([...events].reverse()); setIndex(0); }}>Load latest journal</button><button disabled={!recording.length} onClick={() => exportFile("hopnet-journal.json", JSON.stringify({ schemaVersion: 1, retention: "latest 2048 local events", events: recording }, null, 2), "application/json")}>Export journal</button></div>
    {event ? <div className="replay-columns"><section className="historical-network" aria-label="Recorded network state"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">{event.snapshot.edges.map((edge) => { const a = positions.get(edge.a), b = positions.get(edge.b); if (!a || !b) return null; const established = event.snapshot.links.some((link) => link.state === "direct" && canonicalEdge(link.a, link.b) === canonicalEdge(edge.a, edge.b)); const active = event.path?.some((id, i) => i > 0 && canonicalEdge(event.path![i - 1]!, id) === canonicalEdge(edge.a, edge.b)); return <line key={canonicalEdge(edge.a, edge.b)} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={active ? "recorded-route" : established ? "recorded-live" : "recorded-permitted"}/>; })}<RecordedHop event={event} positions={positions}/></svg>{event.snapshot.peers.map((peer) => { const point = positions.get(peer.id)!; return <div className="historical-peer" key={peer.id} style={{ left: `${point.x}%`, top: `${point.y}%` }}><img src={deviceAsset(peer.deviceCategory).source} alt=""/><span title={peer.displayName}>{peer.displayName}</span></div>; })}<small>Snapshot at event {index + 1} · solid: established · dashed: permitted</small></section><aside className="protocol-inspector glass-sheet" aria-label="Selected protocol event"><span className="studio-eyebrow">{event.provenance} · {event.type}</span><h2>{event.title}</h2><p>{event.detail}</p><p>{explanation}</p><dl><dt>Observed locally</dt><dd>{event.at.toLocaleTimeString()} · {event.monotonicMs.toFixed(1)} ms</dd>{event.transferId && <><dt>Transfer</dt><dd>{event.transferId}</dd></>}{event.chunkIndex !== undefined && <><dt>Chunk index</dt><dd>{event.chunkIndex}</dd></>}{event.path && <><dt>Recorded path</dt><dd>{event.path.map((id) => event.snapshot.peers.find((peer) => peer.id === id)?.displayName ?? id).join(" → ")}</dd></>}</dl><details className="routing-replay-details"><summary>Recorded router state · {event.plane ?? "application"} plane</summary><p>{event.routerId ?? "This observer"} · {event.snapshot.router?.lsdb.length ?? 0} LSA origins</p>{event.snapshot.router?.table.map((row) => <p key={row.destination}>{row.destination} → {row.nextHop} · cost {row.cost.toFixed(3)}</p>)}</details><p className="session-note">State is limited to this device's observations at this event. Dropped journal history and unobserved remote state cannot be reconstructed.</p></aside></div> : <p className="glass-sheet">No recorded events. Connect a device, message a peer, or run a transfer.</p>}
    <div className="replay-event-list" aria-label="Recorded protocol events">{recording.map((item, i) => <button key={item.id} aria-pressed={i === index} onClick={() => { setPlaying(false); setIndex(i); }}><time>+{((item.monotonicMs - recording[0]!.monotonicMs) / 1000).toFixed(2)} s</time><strong>{item.title}</strong><span>{item.provenance}</span></button>)}</div>
  </div>;
}

function RecordedHop({ event, positions }: { event: NetworkEvent; positions: Map<string, { x:number; y:number }> }) {
  const from = positions.get(event.path?.at(-2) ?? ""), to = positions.get(event.path?.at(-1) ?? "");
  if (!from || !to || !event.plane) return null;
  return <circle key={event.id} className={`recorded-hop ${event.plane}-pulse`} r=".65" fill={event.plane === "control" ? "#a184ff" : "#48d9ff"}>
    <animateMotion path={`M ${from.x} ${from.y} L ${to.x} ${to.y}`} dur=".65s" repeatCount="1" fill="freeze"/>
    <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;.1;.8;1" dur=".65s" fill="freeze"/>
  </circle>;
}
