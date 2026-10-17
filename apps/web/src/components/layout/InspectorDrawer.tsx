import React, { useState } from 'react';
import { DeviceNode, DecisionEvent } from '../../types';
import { X, Battery, BatteryCharging, Zap, ShieldAlert, Cpu, Send, Info, CheckCircle2 } from 'lucide-react';
import { SentinelApi } from '../../services/api';

interface DrawerProps {
  device: DeviceNode | null;
  onClose: () => void;
  recentEvents: DecisionEvent[];
}

export const InspectorDrawer: React.FC<DrawerProps> = ({ device, onClose, recentEvents }) => {
  const [isSending, setIsSending] = useState(false);
  const [burstCount, setBurstCount] = useState(1);

  if (!device) return null;

  const filteredEvents = recentEvents
    .filter(e => e.clientIdentifier === device.clientId || (device.id === 'gateway' || device.id === 'upstream'))
    .slice(0, 8);

  const handleFireTest = async () => {
    setIsSending(true);
    try {
      for (let i = 0; i < burstCount; i++) {
        await SentinelApi.sendTestRequest({
          simulatedIp: device.ip,
          clientId: device.clientId,
          batteryLevel: device.telemetry.battery ?? undefined,
          charging: device.telemetry.charging ?? undefined
        });
      }
    } catch (err) {
      console.error('Test request failed:', err);
    } finally {
      setIsSending(false);
    }
  };

  const isThrottled = device.status === 'throttled';
  const battery = device.telemetry.battery;
  const charging = device.telemetry.charging;

  return (
    <aside className="w-96 border-l border-graphite-700 bg-graphite-950/95 backdrop-blur-xl h-full flex flex-col z-20 shadow-2xl select-none font-mono">
      {/* Header */}
      <div className="p-4 border-b border-graphite-700 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <span className={`w-2 h-2 rounded-full ${isThrottled ? 'bg-signal-salmon animate-ping' : 'bg-signal-lime'}`} />
          <h2 className="text-sm font-semibold tracking-wide text-white uppercase">{device.name}</h2>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded text-slate-400 hover:text-white hover:bg-graphite-800 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* Network & Identity Card */}
        <div className="p-3 rounded-lg border border-graphite-700 bg-graphite-900/60 space-y-2">
          <div className="text-[10px] text-slate-400 tracking-wider uppercase font-semibold">Entity Identity</div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-slate-500 block text-[10px]">CLIENT ID</span>
              <span className="text-slate-200 truncate block">{device.clientId}</span>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px]">NETWORK IP</span>
              <span className="text-slate-200 block">{device.ip}</span>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px]">TOTAL REQS</span>
              <span className="text-slate-200 block">{device.totalRequests}</span>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px]">STATUS</span>
              <span className={`block font-semibold ${isThrottled ? 'text-signal-salmon' : 'text-signal-lime'}`}>
                {device.status.toUpperCase()}
              </span>
            </div>
          </div>
        </div>

        {/* Real-time Hardware Telemetry (if client device) */}
        {device.category === 'client' && (
          <div className="p-3 rounded-lg border border-graphite-700 bg-graphite-900/60 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-slate-400 tracking-wider uppercase font-semibold">Client Telemetry</span>
              <span className="text-[10px] text-amber-400/80">Self-Reported</span>
            </div>

            {/* Battery Indicator */}
            {battery !== null ? (
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="flex items-center space-x-1 text-slate-400">
                    {charging ? <BatteryCharging className="w-3.5 h-3.5 text-signal-lime" /> : <Battery className="w-3.5 h-3.5 text-slate-400" />}
                    <span>Battery Level</span>
                  </span>
                  <span className="text-white font-medium">{battery}%</span>
                </div>
                <div className="w-full bg-graphite-800 h-1.5 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 ${charging ? 'bg-signal-lime' : battery < 20 ? 'bg-signal-salmon' : 'bg-slate-300'}`}
                    style={{ width: `${battery}%` }}
                  />
                </div>
              </div>
            ) : (
              <div className="text-[11px] text-slate-400 italic">No battery telemetry provided (desktop/server)</div>
            )}

            {/* Cadence & Inter-arrival Stats */}
            <div className="pt-2 border-t border-graphite-800 grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-slate-500 block text-[10px]">MEAN CADENCE (μ)</span>
                <span className="text-slate-200">{device.telemetry.cadenceMs}ms</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px]">JITTER STD (σ)</span>
                <span className="text-slate-200">{device.telemetry.jitterMs}ms</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px]">SAMPLE WINDOW</span>
                <span className="text-slate-200">{device.telemetry.sampleCount} / 20</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px]">CADENCE RATIO (CV)</span>
                <span className="text-slate-200">
                  {device.telemetry.cadenceMs > 0 ? (device.telemetry.jitterMs / device.telemetry.cadenceMs).toFixed(2) : '0.00'}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Live Manual Traffic Injector (Trigger genuine test requests) */}
        {device.category === 'client' && (
          <div className="p-3 rounded-lg border border-graphite-700 bg-graphite-900/60 space-y-2.5">
            <div className="text-[10px] text-slate-400 tracking-wider uppercase font-semibold">Live Traffic Generator</div>
            <div className="flex items-center space-x-2">
              <div className="flex rounded border border-graphite-700 bg-graphite-950 p-0.5 text-xs">
                {[1, 5, 10].map(cnt => (
                  <button
                    key={cnt}
                    onClick={() => setBurstCount(cnt)}
                    className={`px-2.5 py-1 rounded transition-colors ${burstCount === cnt ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                  >
                    {cnt}x
                  </button>
                ))}
              </div>
              <button
                onClick={handleFireTest}
                disabled={isSending}
                className="flex-1 flex items-center justify-center space-x-1.5 py-1.5 px-3 rounded bg-signal-lime text-black font-semibold text-xs hover:bg-lime-400 transition-colors shadow-brutal-sm disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{isSending ? 'SENDING...' : `INJECT ${burstCount} REQ`}</span>
              </button>
            </div>
          </div>
        )}

        {/* Scientific Transparency Disclosure */}
        <div className="p-3 rounded-lg border border-graphite-800 bg-graphite-900/30 text-[11px] text-slate-400 space-y-1.5 leading-relaxed">
          <div className="flex items-center space-x-1.5 text-slate-300 font-semibold text-[10px] uppercase">
            <Info className="w-3.5 h-3.5 text-cyan-400" />
            <span>Scientific Measurement Bounds</span>
          </div>
          <p>
            Arrival timing represents application-layer measurements in Node.js (<code className="text-slate-300">process.hrtime</code>), influenced by socket buffers and transport dynamics. Battery data is self-reported and untrusted.
          </p>
        </div>

        {/* Recent Packets Log for this device */}
        <div className="space-y-2">
          <div className="text-[10px] text-slate-400 tracking-wider uppercase font-semibold">Device Packet Stream</div>
          <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
            {filteredEvents.length === 0 ? (
              <div className="text-[11px] text-slate-400 italic py-2">No packet events recorded yet.</div>
            ) : (
              filteredEvents.map(evt => (
                <div
                  key={evt.eventId}
                  className="p-2 rounded border border-graphite-800 bg-graphite-900/40 text-[11px] flex items-center justify-between"
                >
                  <div className="flex items-center space-x-2 truncate">
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                      evt.decision === 'ALLOW' ? 'bg-signal-lime/20 text-signal-lime' : 'bg-signal-salmon/20 text-signal-salmon'
                    }`}>
                      {evt.decision}
                    </span>
                    <span className="text-slate-300 truncate">{evt.requestPath}</span>
                  </div>
                  <span className="text-[10px] text-slate-400 ml-2 whitespace-nowrap">
                    {evt.upstreamLatencyMs !== null ? `${evt.upstreamLatencyMs}ms` : '429 Blocked'}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </aside>
  );
};
