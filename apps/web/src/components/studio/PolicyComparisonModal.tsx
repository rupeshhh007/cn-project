import React from 'react';
import { X, Shield, AlertTriangle, CheckCircle2, Cpu } from 'lucide-react';
import { PolicyMode } from '../../types';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  activePolicy: PolicyMode;
  onSelectPolicy: (policy: PolicyMode) => void;
}

export const PolicyComparisonModal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  activePolicy,
  onSelectPolicy
}) => {
  if (!isOpen) return null;

  const policies = [
    {
      id: 'IP_BASELINE' as PolicyMode,
      name: 'Policy A — Source-IP Token Bucket',
      type: 'Conventional Baseline',
      mechanism: 'Token bucket partitioned by socket remote address (or X-Demo-IP).',
      vulnerability: 'Completely defeated by rotating proxy pools and cloud scrapers. Causes severe collateral damage to innocent users sharing NAT IPs.',
      tradeoff: 'Simple, zero overhead, but fundamentally blind to distributed or rotating traffic.'
    },
    {
      id: 'SESSION_BASELINE' as PolicyMode,
      name: 'Policy B — Session Identifier Baseline',
      type: 'Client-Identifier Baseline',
      mechanism: 'Token bucket keyed on client-supplied session token / header.',
      vulnerability: 'Trivially spoofable: automated bots generate new session identifiers per request or omit headers entirely.',
      tradeoff: 'Useful for cooperative API clients, but provides zero adversarial security against malicious scrapers.'
    },
    {
      id: 'HYBRID_BEHAVIORAL' as PolicyMode,
      name: 'Policy C — Experimental Hybrid Behavioral',
      type: 'Novel Research Defense',
      mechanism: 'Extracts inter-arrival timing statistics (mean, std dev, CV) over a sliding window (N=20), grouping requests into deterministic behavioral clusters.',
      vulnerability: 'Sensitive to deliberate cadence perturbation (jitter evasion). Requires cold-start IP fallback during initial sampling.',
      tradeoff: 'Successfully mitigates IP rotation while maintaining multi-client NAT fairness. Demonstrates explainable boundaries.'
    }
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm font-mono select-none">
      <div className="w-full max-w-4xl bg-graphite-950 border border-graphite-700 rounded-xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
        {/* Modal Header */}
        <div className="p-4 border-b border-graphite-700 flex items-center justify-between bg-graphite-900/60">
          <div className="flex items-center space-x-2">
            <Cpu className="w-4 h-4 text-signal-lime" />
            <h2 className="text-sm font-bold text-white tracking-wide uppercase">
              Defense Policy Architecture & Scientific Comparison
            </h2>
          </div>
          <button onClick={onClose} className="p-1 rounded text-slate-400 hover:text-white hover:bg-graphite-800">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-5">
          <p className="text-xs text-slate-300 leading-relaxed">
            The core research problem addressed by <strong>SENTINEL</strong> is comparing traditional L3/L4 rate-limiting against application-layer behavioral correlation under changing identity conditions.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {policies.map(p => {
              const isActive = activePolicy === p.id;
              return (
                <div
                  key={p.id}
                  className={`p-4 rounded-lg border flex flex-col justify-between transition-all ${
                    isActive
                      ? 'border-signal-lime bg-lime-950/20 shadow-brutal-sm'
                      : 'border-graphite-800 bg-graphite-900/50 hover:border-slate-600'
                  }`}
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-black/40 text-slate-400 font-semibold">{p.type}</span>
                      {isActive && <span className="text-[9px] px-1.5 py-0.5 rounded bg-signal-lime text-black font-bold">ACTIVE</span>}
                    </div>

                    <h3 className="text-xs font-bold text-white leading-tight">{p.name}</h3>

                    <div>
                      <span className="text-[10px] text-slate-500 uppercase block font-semibold">Mechanism</span>
                      <p className="text-[11px] text-slate-300 leading-normal">{p.mechanism}</p>
                    </div>

                    <div>
                      <span className="text-[10px] text-signal-salmon uppercase block font-semibold flex items-center space-x-1">
                        <AlertTriangle className="w-3 h-3 inline mr-1" /> Vulnerability & Limits
                      </span>
                      <p className="text-[11px] text-slate-400 leading-normal">{p.vulnerability}</p>
                    </div>

                    <div>
                      <span className="text-[10px] text-cyan-400 uppercase block font-semibold">Scientific Trade-off</span>
                      <p className="text-[11px] text-slate-400 leading-normal">{p.tradeoff}</p>
                    </div>
                  </div>

                  <div className="pt-4 mt-4 border-t border-graphite-800">
                    <button
                      onClick={() => onSelectPolicy(p.id)}
                      disabled={isActive}
                      className={`w-full py-1.5 px-3 rounded text-xs font-semibold transition-all ${
                        isActive
                          ? 'bg-signal-lime text-black cursor-default'
                          : 'bg-graphite-800 hover:bg-slate-700 text-white'
                      }`}
                    >
                      {isActive ? 'CURRENTLY ACTIVE' : 'ACTIVATE POLICY'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
