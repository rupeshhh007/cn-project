import { useState } from "react";
import type { Props } from "./RoomSurface.tsx";
import { deviceAsset } from "../lib/device-assets.ts";
import { exportFile } from "../lib/evidence.ts";
import type { RouterSnapshot } from "../lib/distributed-router.ts";

export function RoutingWorkspace(props: Props) {
  const [routerId, setRouterId] = useState(props.self.id);
  const [destination, setDestination] = useState("");
  const snapshots = [props.routerState, ...props.routerReports].filter((s): s is RouterSnapshot => Boolean(s));
  const selected = snapshots.find((s) => s.id === routerId);
  const local = routerId === props.self.id;
  const name = (id: string) => props.peers.find((peer) => peer.id === id)?.displayName ?? id;
  const route = selected?.table.find((row) => row.destination === destination) ?? selected?.table[0];
  const episode = selected?.convergence;
  const csv = () => {
    const quote = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
    return [["router", "destination", "nextHop", "cost", "path", "strategy"], ...snapshots.flatMap((s) => s.table.map((row) => [s.id, row.destination, row.nextHop, row.cost, row.path.join(" -> "), s.strategy]))].map((row) => row.map(quote).join(",")).join("\r\n");
  };
  return <div className="routing-workspace">
    <header className="studio-heading"><span className="studio-eyebrow">HOPNET CN STUDIO · DISTRIBUTED CONTROL PLANE</span><h1>Every peer, a router.</h1><p>Hello → flood → learn → compute → forward. These tables are computed inside the browsers, not assigned by the coordinator.</p><div className="routing-exports"><button onClick={() => exportFile("hopnet-routers.json", JSON.stringify({ provenance: "RTC-FLOODED ROUTER OBSERVATIONS", observer: props.self.id, snapshots }, null, 2), "application/json")}>Export router evidence</button><button onClick={() => exportFile("hopnet-forwarding.csv", csv(), "text/csv")}>Export forwarding CSV</button></div></header>
    <div className="routing-columns"><nav className="router-rail" aria-label="Router inspectors">{props.peers.map((peer) => {
      const report = snapshots.find((s) => s.id === peer.id);
      return <button key={peer.id} aria-pressed={routerId === peer.id} onClick={() => { setRouterId(peer.id); setDestination(""); }}><img src={deviceAsset(peer.deviceCategory).source} alt=""/><span>{peer.displayName}<small>{peer.id === props.self.id ? "This browser · local truth" : report ? "Received over the overlay" : "No fresh router report"}</small></span></button>;
    })}</nav><section className="router-detail" aria-label="Router control plane">
      <header><h2>{name(routerId)}</h2><p>{routerId} · {props.peers.find((peer) => peer.id === routerId)?.deviceCategory} · {props.peers.find((peer) => peer.id === routerId)?.role}</p></header>
      {!selected ? <p className="router-notice">Waiting for this browser's report over an established overlay route. Coordinator presence does not provide its LSDB. A partitioned router may be unreachable.</p> : <>
        <p className="session-note">{local ? "Live local state." : `Remote snapshot, received ${Math.max(0, (performance.now() - (selected.receivedLocallyAt ?? performance.now())) / 1000).toFixed(1)} s ago. Times within that snapshot use its own monotonic clock.`} Cooperative classroom protocol; routing updates are not OSPF or IP routes.</p>
        <section className="convergence-strip" aria-label="Convergence observation"><strong>{episode?.agreementAt ? "Reachable component agreement" : episode?.settledAt ? "Local table stable · awaiting reports" : "Learning / recomputing"}</strong><p>{episode?.agreementAt ? `${(episode.agreementAt - episode.startedAt).toFixed(1)} ms observer window · ${selected.table.length + 1} reachable routers reported the same graph` : "A 1-second quiet window establishes local stability; fresh matching reports are needed for component agreement."}</p><span>{props.peers.length - 1 - selected.table.length} destinations without a route. Agreement excludes unreachable/partitioned peers.</span></section>
        <div className="router-stat-strip">{[["Hello RX", selected.counters.helloReceived], ["LSA RX / originated", `${selected.counters.lsaReceived} / ${selected.counters.lsaSent}`], ["SPF runs", selected.counters.recomputations], ["Forwarded", selected.counters.forwarded], ["Delivered", selected.counters.received], ["Drops / duplicates", `${selected.counters.dropped} / ${selected.counters.duplicates}`], ["Control bytes TX", selected.counters.controlBytes]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
        <section><h3>Forwarding table <small>{selected.strategy} · click a destination</small></h3><div className="router-table-scroll"><table aria-label="Local forwarding table"><thead><tr><th>Destination</th><th>Next hop</th><th>Cost</th><th>Hops</th></tr></thead><tbody>{selected.table.map((entry) => <tr key={entry.destination} data-selected={route?.destination === entry.destination}><td><button onClick={() => setDestination(entry.destination)}>{name(entry.destination)}</button></td><td>{name(entry.nextHop)}</td><td>{entry.cost.toFixed(3)} {selected.strategy === "minimum-hops" ? "hops" : "normalized"}</td><td>{entry.path.length - 1}</td></tr>)}</tbody></table></div>{!selected.table.length && <p>No route: establish bidirectional hello neighbors and flood their LSAs.</p>}
        {route && <div className="route-explanation"><span>Locally computed shortest-path branch</span><ol>{route.path.map((id) => <li key={id}><img src={deviceAsset(props.peers.find((peer) => peer.id === id)?.deviceCategory ?? "other").source} alt=""/><span>{name(id)}</span></li>)}</ol><p>For {name(route.destination)}, this router selects <strong>{name(route.nextHop)}</strong>. The next router makes its own decision. Actual traversals are recorded by packet-forward and delivery events.</p></div>}</section>
        <section><h3>Direct neighbors <small>hello every 1 s · dead after 4.5 s</small></h3><div className="router-table-scroll"><table aria-label="Router neighbors"><thead><tr><th>Neighbor</th><th>State</th><th>Last hello</th><th>Hello RTT</th></tr></thead><tbody>{selected.neighbors.map((neighbor) => <tr key={neighbor.id}><td>{name(neighbor.id)}</td><td>{neighbor.active ? "active" : neighbor.channelOpen ? "probing / degraded" : "closed"}</td><td>{Math.max(0, selected.observedAt - neighbor.lastHello).toFixed(0)} ms ago</td><td>{neighbor.rttMs.toFixed(1)} ms</td></tr>)}</tbody></table></div></section>
        <section><h3>Link-state database <small>refresh 6 s · maximum age 18 s</small></h3><div className="router-table-scroll"><table aria-label="Link-state database"><thead><tr><th>Origin</th><th>Sequence</th><th>Observed age</th><th>Advertised neighbors</th></tr></thead><tbody>{selected.lsdb.map((lsa) => <tr key={lsa.origin}><td>{name(lsa.origin)}</td><td>{lsa.sequence}</td><td>{Math.max(0, selected.observedAt - lsa.receivedAt).toFixed(0)} ms</td><td>{lsa.neighbors.map((n) => name(n.id)).join(" · ") || "none"}</td></tr>)}</tbody></table></div></section>
        {episode && <section className="routing-before-after"><h3>Last recomputation episode</h3><div><section><h4>Before</h4>{episode.before.map((row) => <p key={row.destination}>{name(row.destination)} → {name(row.nextHop)}</p>)}</section><section><h4>After</h4>{episode.after.map((row) => <p key={row.destination}>{name(row.destination)} → {name(row.nextHop)}</p>)}</section></div></section>}
      </>}
      <p className="router-notice">Messages and ACKs use distributed next-hop forwarding. Files currently use locally LSA-learned topology with the existing signed, source-routed multipath envelopes. A failed path is retried over a newly learned route; file relays do not rewrite signed routes.</p>
    </section></div>
  </div>;
}
