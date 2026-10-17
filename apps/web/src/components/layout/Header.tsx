import React from 'react';
import { PolicyMode, GatewayOverview } from '../../types';
import { Shield, Activity, RefreshCw, Layers, Box, Cpu } from 'lucide-react';

interface HeaderProps {
  overview: GatewayOverview | null;
  activePolicy: PolicyMode;
  onSelectPolicy: (policy: PolicyMode) => void;
  onReset: () => void;
  viewMode: '3d' | '2d';
  onToggleViewMode: () => void;
  isSseConnected: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  overview,
  activePolicy,
  onSelectPolicy,
  onReset,
  viewMode,
  onToggleViewMode,
  isSseConnected
}) => {
  const total = overview?.totalRequests || 0;
  const allowed = overview?.allowedRequests || 0;
  const throttled = overview?.throttledRequests || 0;
  const allowPercent = total > 0 ? Math.round((allowed / total) * 100) : 100;
  const throttlePercent = total > 0 ? Math.round((throttled / total) * 100) : 0;

  return (
    <header className="h-14 border-b border-graphite-700 bg-graphite-950/95 backdrop-blur-md px-4 flex items-center justify-between z-30 select-none">
      {/* Brand & Status Indicator */}
      <div className="flex items-center space-x-3">
        <div className="flex items-center space-x-2">
          <div className="w-7 h-7 rounded bg-signal-lime/10 border border-signal-lime/40 flex items-center justify-center text-signal-lime font-mono font-bold text-sm shadow-brutal-sm">
            <Shield className="w-4 h-4" />
          </div>
          <div className="flex items-baseline space-x-1.5">
            <span className="font-mono font-bold text-base tracking-tight text-white">SENTINEL</span>
            <span className="text-xs font-mono tracking-widest text-slate-400">/ LAB</span>
          </div>
        </div>

        {/* Live SSE Pulse Pill */}
        <div className="flex items-center space-x-1.5 px-2 py-0.5 rounded-full border border-graphite-700 bg-graphite-900 text-[10px] font-mono">
          <span className={`w-1.5 h-1.5 rounded-full ${isSseConnected ? 'bg-signal-lime animate-pulse' : 'bg-signal-salmon'}`} />
          <span className="text-slate-300">{isSseConnected ? 'SSE ACTIVE' : 'RECONNECTING'}</span>
        </div>
      </div>

      {/* Policy Mode Selector Pills */}
      <div className="flex items-center space-x-1 p-0.5 rounded-lg border border-graphite-700 bg-graphite-900/90 text-xs font-mono">
        <button
          onClick={() => onSelectPolicy('IP_BASELINE')}
          className={`px-3 py-1 rounded transition-all font-medium ${
            activePolicy === 'IP_BASELINE'
              ? 'bg-graphite-700 text-white shadow-sm border border-slate-600'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          IP BASELINE
        </button>
        <button
          onClick={() => onSelectPolicy('SESSION_BASELINE')}
          className={`px-3 py-1 rounded transition-all font-medium ${
            activePolicy === 'SESSION_BASELINE'
              ? 'bg-graphite-700 text-white shadow-sm border border-slate-600'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          SESSION ID
        </button>
        <button
          onClick={() => onSelectPolicy('HYBRID_BEHAVIORAL')}
          className={`px-3 py-1 rounded transition-all font-medium flex items-center space-x-1 ${
            activePolicy === 'HYBRID_BEHAVIORAL'
              ? 'bg-signal-lime text-black font-semibold shadow-brutal-sm border border-signal-lime'
              : 'text-signal-lime/80 hover:text-signal-lime'
          }`}
        >
          <Cpu className="w-3.5 h-3.5 mr-1 inline" />
          <span>HYBRID BEHAVIORAL</span>
        </button>
      </div>

      {/* Telemetry Metrics & View Controls */}
      <div className="flex items-center space-x-4">
        {/* Real-Time Stats */}
        <div className="hidden lg:flex items-center space-x-4 text-xs font-mono">
          <div className="flex items-center space-x-1.5">
            <span className="text-slate-400">TOTAL:</span>
            <span className="font-semibold text-white">{total}</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <span className="text-slate-400">ALLOW:</span>
            <span className="font-semibold text-signal-lime">{allowPercent}%</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <span className="text-slate-400">THROTTLE:</span>
            <span className="font-semibold text-signal-salmon">{throttlePercent}%</span>
          </div>
        </div>

        {/* 3D / 2D View Switcher */}
        <button
          onClick={onToggleViewMode}
          className="flex items-center space-x-1.5 px-2.5 py-1 rounded border border-graphite-700 bg-graphite-900 hover:border-slate-500 text-xs font-mono text-slate-300 transition-colors"
          title="Toggle 3D Diorama / 2D Schematic"
        >
          {viewMode === '3d' ? (
            <>
              <Layers className="w-3.5 h-3.5 text-cyan-400" />
              <span>2D SCHEMATIC</span>
            </>
          ) : (
            <>
              <Box className="w-3.5 h-3.5 text-signal-lime" />
              <span>3D DIORAMA</span>
            </>
          )}
        </button>

        {/* Reset State Button */}
        <button
          onClick={onReset}
          className="p-1.5 rounded border border-graphite-700 bg-graphite-900 hover:border-signal-salmon text-slate-400 hover:text-signal-salmon transition-colors"
          title="Reset Gateway State & Buckets"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  );
};
