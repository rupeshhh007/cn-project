import React, { useState } from 'react';
import { DecisionEvent } from '../../types';
import { Terminal, ChevronRight, ChevronDown } from 'lucide-react';

interface FeedProps {
  events: DecisionEvent[];
}

export const LivePacketFeed: React.FC<FeedProps> = ({ events }) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggleExpand = (id: string) => {
    setExpandedId(prev => (prev === id ? null : id));
  };

  return (
    <div className="h-full flex flex-col font-mono select-none border-t border-graphite-700 bg-graphite-950/95">
      {/* Header bar */}
      <div className="px-4 py-2 border-b border-graphite-800 flex items-center justify-between bg-graphite-950">
        <div className="flex items-center space-x-2 text-xs">
          <Terminal className="w-3.5 h-3.5 text-signal-lime" />
          <span className="font-semibold text-white uppercase tracking-wider">Live Packet Observation Feed</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded bg-graphite-800 text-slate-400">
            {events.length} captured
          </span>
        </div>
        <span className="text-[10px] text-slate-500">Auto-streaming via Server-Sent Events (:8080)</span>
      </div>

      {/* Packet Event List */}
      <div className="flex-1 overflow-y-auto divide-y divide-graphite-800 text-xs">
        {events.length === 0 ? (
          <div className="p-4 text-center text-slate-500 italic text-xs">
            Waiting for network traffic... Fire a scenario or inject a test request to observe policy decisions.
          </div>
        ) : (
          events.slice(0, 50).map((evt) => {
            const isAllowed = evt.decision === 'ALLOW';
            const isExpanded = expandedId === evt.eventId;

            return (
              <div key={evt.eventId} className="hover:bg-graphite-900/60 transition-colors">
                <div
                  onClick={() => toggleExpand(evt.eventId)}
                  className="px-4 py-2 flex items-center justify-between cursor-pointer"
                >
                  <div className="flex items-center space-x-3 truncate">
                    <span className="text-slate-500 text-[10px]">
                      {evt.timestamp ? new Date(evt.timestamp).toLocaleTimeString() : '00:00:00'}
                    </span>

                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        isAllowed
                          ? 'bg-signal-lime/20 text-signal-lime border border-signal-lime/40'
                          : 'bg-signal-salmon/20 text-signal-salmon border border-signal-salmon/40'
                      }`}
                    >
                      {evt.decision}
                    </span>

                    <span className="text-slate-300 font-semibold">{evt.requestMethod}</span>
                    <span className="text-slate-400 truncate max-w-[200px]">{evt.requestPath}</span>
                    <span className="text-slate-500 text-[11px] truncate">
                      {evt.simulatedSourceIp || evt.socketRemoteIp} ({evt.clientIdentifier})
                    </span>
                  </div>

                  <div className="flex items-center space-x-4 text-[11px] whitespace-nowrap">
                    <span className="text-slate-400">
                      Tokens: <span className="text-white font-medium">{evt.tokensRemaining}</span>
                    </span>
                    <span className="text-slate-400">
                      Cluster: <span className="text-cyan-400">{evt.clusterId || 'cold-start'}</span>
                    </span>
                    <span className={evt.upstreamForwarded ? 'text-signal-lime font-medium' : 'text-slate-500'}>
                      {evt.upstreamLatencyMs !== null ? `${evt.upstreamLatencyMs}ms` : 'Edge Block'}
                    </span>
                    {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-500" />}
                  </div>
                </div>

                {/* Expanded Raw DTO Payload */}
                {isExpanded && (
                  <div className="px-6 py-3 bg-graphite-900/90 border-t border-b border-graphite-800 text-[11px] text-slate-300">
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 font-semibold">
                      Authoritative DecisionEvent Schema (packages/contracts)
                    </div>
                    <pre className="p-2.5 rounded bg-black/60 border border-graphite-800 text-slate-300 overflow-x-auto text-[10px]">
                      {JSON.stringify(evt, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
