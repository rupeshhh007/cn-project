import type { Peer } from "@hopnet/protocol";
import type { RoutePulse as Pulse } from "../lib/distributed-router.ts";
import { deviceAsset } from "../lib/device-assets.ts";
import { exportFile } from "../lib/evidence.ts";
import "../route-pulse.css";

type Props = {
  self: Peer; peers: Peer[]; pulses: Pulse[]; selectedPeer?: Peer; selectedRoute?: string[];
  onSelectPeer: (id: string) => void; onPulse: (destination: string) => void; compact?: boolean;
};

export function RoutePulsePanel(props: Props) {
  const entries = props.pulses.filter((pulse) => pulse.destination === props.selectedPeer?.id);
  const latest = entries[0];
  const previous = entries.find((pulse) => pulse.status === "received" && pulse.id !== latest?.id);
  const changed = latest?.status === "received" && previous && JSON.stringify(latest.outboundPath) !== JSON.stringify(previous.outboundPath);
  const pending = props.pulses.some((pulse) => pulse.status === "pending");
  // The existing local-router snapshot refresh re-renders this view every
  // 500 ms; no background diagnostic traffic or extra timer is needed.
  const cooling = performance.now() - (props.pulses[0]?.startedAt ?? -Infinity) < 1000;
  const name = (id: string) => props.peers.find((peer) => peer.id === id)?.displayName ?? id;
  const exportEvidence = () => exportFile("hopnet-route-pulses.json", JSON.stringify({
    schemaVersion: 1, provenance: "ON-DEMAND RTC OVERLAY PROBES", observer: props.self.id,
    peers: props.peers.map(({ id, displayName, deviceCategory }) => ({ id, displayName, deviceCategory })), pulses: entries,
    limitations: "Historical receiver-reported trails in a cooperative protocol, not signed file receipts or IP traceroute. RTT uses one sender-local monotonic clock and includes both routes and browser scheduling. No one-way or per-hop latency is measured. No automatic retries or background probing.",
  }, null, 2), "application/json");

  return <section className={`route-pulse ${props.compact ? "compact" : ""} ${latest?.status ?? "idle"}`} aria-label="Route Pulse">
    <div className="pulse-intro">
      <div className="pulse-orb" aria-hidden="true"><i/><span/><b/></div>
      <div className="pulse-copy"><span className="pulse-eyebrow">FROM {props.self.displayName} · REAL DATA PLANE</span><h2>Route Pulse</h2><p>A small packet. Its actual journey back.</p></div>
      {!props.compact && <label className="pulse-receiver">Destination<select aria-label="Pulse receiver" value={props.selectedPeer?.id ?? ""} onChange={(event) => props.onSelectPeer(event.target.value)} disabled={!props.peers.some((peer) => peer.id !== props.self.id)}>
        {!props.selectedPeer && <option value="">Choose a peer</option>}
        {props.peers.filter((peer) => peer.id !== props.self.id).map((peer) => <option key={peer.id} value={peer.id}>{peer.displayName}</option>)}
      </select></label>}
      <button className="pulse-launch" disabled={!props.selectedPeer || !props.selectedRoute || pending || cooling} onClick={() => { if (props.selectedPeer) props.onPulse(props.selectedPeer.id); }}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h4l3-7 4 14 3-7h4"/></svg>{pending ? "Awaiting receipt…" : cooling ? "Ready in a moment…" : "Send route pulse"}
      </button>
    </div>
    <div className="pulse-readout" role="status" aria-live="polite">
      {latest?.status === "received" ? <><span className="pulse-receipt"><i/>Receipt returned</span><strong>{latest.roundTripMs?.toFixed(1)}<small> ms round trip</small></strong><span>{(latest.outboundPath?.length ?? 1) - 1} outward hops{changed ? <b className="pulse-changed">Path changed</b> : null}</span></> : latest?.status === "failed" ? <><span className="pulse-receipt">Receipt unconfirmed</span><p>{latest.error}</p></> : latest?.status === "pending" ? <p>Waiting for {props.selectedPeer?.displayName} to report its hop trail. No success until the receipt returns.</p> : <p>{props.selectedRoute ? "Ready when you are. Uses the current local forwarding tables." : "Establish a route to another peer to send a pulse."}</p>}
    </div>
    {latest?.status === "received" && latest.outboundPath && <>
      <ol className="pulse-trail" aria-label="Receiver-reported outward route" key={latest.id}>{latest.outboundPath.map((id, index) => <li key={id} style={{ animationDelay: `${index * 65}ms` }}><div className="pulse-device"><img src={deviceAsset(props.peers.find((peer) => peer.id === id)?.deviceCategory ?? "other").source} alt=""/></div><span>{name(id)}</span><small>{index === 0 ? "Sent" : index === latest.outboundPath!.length - 1 ? "Receiver" : "Relayed"}</small></li>)}</ol>
      <p className="pulse-return">Return receipt: {latest.returnPath?.map(name).join(" → ")}</p>
    </>}
    {!props.compact && <div className="pulse-footer"><p>Historical receipt, not a live connection guarantee. Cooperative hop reports; not IP traceroute or per-hop latency.</p><button onClick={exportEvidence} disabled={!entries.length}>Export pulses</button></div>}
    {!props.compact && entries.filter((pulse) => pulse.status !== "pending").length > 1 && <details className="pulse-history"><summary>Recent pulses · {entries.filter((pulse) => pulse.status !== "pending").length} recorded</summary>{entries.filter((pulse) => pulse.status !== "pending").map((pulse) => <div key={pulse.id}><span>{pulse.status === "received" ? `${pulse.roundTripMs?.toFixed(1)} ms` : "Unconfirmed"}</span><p>{pulse.outboundPath?.map(name).join(" → ") ?? pulse.error}</p></div>)}</details>}
  </section>;
}
