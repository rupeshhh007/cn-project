import React, { useState } from 'react';
import { Play, Pause, RotateCcw, Download, CheckCircle2, AlertTriangle, ShieldCheck, Cpu } from 'lucide-react';
import { ScenarioDefinition, ScenarioComparisonSummary, PolicyMode } from '../../types';
import { SentinelApi } from '../../services/api';

const SCENARIO_LIST: ScenarioDefinition[] = [
  {
    id: 'legitimate-traffic',
    name: '1. Legitimate Human Traffic',
    category: 'Baseline Validation',
    description: 'Human-paced requests (600-1200ms) across laptop and mobile devices.',
    expectedPolicyOutcome: 'Zero false positives. Token bucket replenishes steadily.'
  },
  {
    id: 'ip-rotation-attack',
    name: '2. Scripted IP Rotation Attack',
    category: 'Adversarial Evasion',
    description: 'Automated scraper rotating simulated source IPs on every request (35-45ms cadence).',
    expectedPolicyOutcome: 'Policy A fails (100% bypass). Policy C clusters arrival jitter and throttles the bot.'
  },
  {
    id: 'shared-nat-fairness',
    name: '3. Shared NAT IP Fairness',
    category: 'False Positive Analysis',
    description: 'Three distinct campus clients sharing one external public NAT IP (203.0.113.1).',
    expectedPolicyOutcome: 'Policy A starves innocent users. Policy C preserves individual client cadences.'
  },
  {
    id: 'burst-recovery',
    name: '4. Burst Overload & Leaky Recovery',
    category: 'Limiter Dynamics',
    description: 'Sudden spike of 18 requests exceeding capacity (10 tokens), followed by a 2-second recovery.',
    expectedPolicyOutcome: 'Demonstrates mathematically predicted token depletion and 2.0 tokens/sec refill.'
  },
  {
    id: 'cadence-jitter-evasion',
    name: '5. Cadence Jitter Evasion (Limits)',
    category: 'Adversarial Boundary',
    description: 'Smart bot introducing randomized interval jitter (80-400ms) to evade behavioral clustering.',
    expectedPolicyOutcome: 'Transparently shows boundary limits of clustering where signature drift occurs.'
  }
];

interface StudioProps {
  activePolicy: PolicyMode;
  onRefreshOverview: () => void;
}

export const ScenarioStudio: React.FC<StudioProps> = ({ activePolicy, onRefreshOverview }) => {
  const [selectedScenario, setSelectedScenario] = useState<ScenarioDefinition>(SCENARIO_LIST[1]);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [lastResults, setLastResults] = useState<{
    total: number;
    allowed: number;
    throttled: number;
    tp: number;
    fp: number;
    tn: number;
    fn: number;
  } | null>(null);

  const handleRunScenario = async () => {
    setIsRunning(true);
    setProgress(0);
    setLastResults(null);

    try {
      // Execute 20 trace requests according to selected scenario
      const totalRequests = 20;
      let allowed = 0;
      let throttled = 0;
      let tp = 0;
      let fp = 0;
      let tn = 0;
      let fn = 0;

      for (let i = 0; i < totalRequests; i++) {
        let simulatedIp = '192.168.1.100';
        let clientId = 'client-workstation';
        let isMalicious = false;
        let batteryLevel: number | undefined = 80;
        let delayMs = 50;

        if (selectedScenario.id === 'ip-rotation-attack') {
          simulatedIp = `198.51.100.${(i % 250) + 1}`;
          clientId = 'scripted-bot-node';
          isMalicious = true;
          delayMs = 40;
        } else if (selectedScenario.id === 'shared-nat-fairness') {
          simulatedIp = '203.0.113.1'; // Shared IP
          clientId = ['alice-dev', 'bob-student', 'iot-hub'][i % 3];
          isMalicious = false;
          delayMs = 60;
        } else if (selectedScenario.id === 'burst-recovery') {
          simulatedIp = '10.0.0.50';
          clientId = 'burst-client';
          isMalicious = i >= 10;
          delayMs = 15;
        } else if (selectedScenario.id === 'cadence-jitter-evasion') {
          simulatedIp = `172.16.0.${(i % 15) + 1}`;
          clientId = 'jitter-bot';
          isMalicious = true;
          delayMs = 80 + Math.floor(Math.random() * 200);
        }

        await new Promise(r => setTimeout(r, delayMs));

        const res = await SentinelApi.sendTestRequest({
          simulatedIp,
          clientId,
          batteryLevel
        });

        const isThrottled = res.decision === 'THROTTLE' || res.status === 429;
        if (isThrottled) throttled++;
        else allowed++;

        if (isMalicious) {
          if (isThrottled) tp++;
          else fn++;
        } else {
          if (isThrottled) fp++;
          else tn++;
        }

        setProgress(Math.round(((i + 1) / totalRequests) * 100));
      }

      setLastResults({ total: totalRequests, allowed, throttled, tp, fp, tn, fn });
      onRefreshOverview();
    } catch (err) {
      console.error('Scenario run failed:', err);
    } finally {
      setIsRunning(false);
    }
  };

  const handleExportData = () => {
    if (!lastResults) return;
    const exportPayload = {
      scenario: selectedScenario,
      activePolicy,
      timestamp: new Date().toISOString(),
      results: lastResults
    };
    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sentinel-${selectedScenario.id}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="h-full flex flex-col font-mono select-none">
      {/* Studio Header */}
      <div className="p-3 border-b border-graphite-700 bg-graphite-950 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Cpu className="w-4 h-4 text-signal-lime" />
          <span className="text-xs font-semibold text-white tracking-wider uppercase">Scenario Laboratory</span>
        </div>
        <div className="text-[10px] text-slate-400">
          Active: <span className="text-signal-lime font-bold">{activePolicy}</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Scenario Selection Grid */}
        <div className="space-y-1.5">
          <div className="text-[10px] text-slate-400 tracking-wider uppercase font-semibold">Select Experiment Scenario</div>
          <div className="grid grid-cols-1 gap-1.5">
            {SCENARIO_LIST.map((sc) => {
              const isSelected = selectedScenario.id === sc.id;
              return (
                <button
                  key={sc.id}
                  onClick={() => setSelectedScenario(sc)}
                  className={`p-2.5 rounded border text-left transition-all ${
                    isSelected
                      ? 'border-signal-lime bg-lime-950/30 text-white shadow-sm'
                      : 'border-graphite-800 bg-graphite-900/50 text-slate-300 hover:border-slate-600'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold">{sc.name}</span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-black/40 text-slate-400">{sc.category}</span>
                  </div>
                  <div className="text-[11px] text-slate-400 line-clamp-1">{sc.description}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Selected Scenario Details */}
        <div className="p-3 rounded-lg border border-graphite-700 bg-graphite-900/60 space-y-2">
          <div className="text-[10px] text-slate-400 uppercase font-semibold">Hypothesis & Expected Outcome</div>
          <p className="text-[11px] text-slate-300 leading-relaxed">{selectedScenario.expectedPolicyOutcome}</p>
        </div>

        {/* Playback Controls & Progress */}
        <div className="p-3 rounded-lg border border-graphite-700 bg-graphite-900/60 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-400 uppercase font-semibold">Experiment Execution</span>
            <span className="text-xs text-signal-lime">{progress}%</span>
          </div>

          <div className="w-full bg-graphite-800 h-1.5 rounded-full overflow-hidden">
            <div
              className="h-full bg-signal-lime transition-all duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>

          <div className="flex items-center space-x-2 pt-1">
            <button
              onClick={handleRunScenario}
              disabled={isRunning}
              className="flex-1 py-2 px-3 rounded bg-signal-lime text-black font-semibold text-xs flex items-center justify-center space-x-1.5 hover:bg-lime-400 transition-colors shadow-brutal-sm disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>{isRunning ? 'EXECUTING TRACE...' : 'RUN SCENARIO'}</span>
            </button>

            {lastResults && (
              <button
                onClick={handleExportData}
                className="py-2 px-3 rounded border border-graphite-700 bg-graphite-900 text-slate-300 hover:text-white hover:border-slate-500 text-xs flex items-center space-x-1 transition-colors"
                title="Export Results JSON"
              >
                <Download className="w-3.5 h-3.5" />
                <span>EXPORT</span>
              </button>
            )}
          </div>
        </div>

        {/* Live Ground Truth & Confusion Matrix */}
        {lastResults && (
          <div className="p-3 rounded-lg border border-graphite-700 bg-graphite-900/80 space-y-3">
            <div className="text-[10px] text-slate-400 uppercase font-semibold">Ground Truth Evaluation</div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2 rounded bg-graphite-950 border border-graphite-800">
                <span className="text-slate-500 block text-[9px]">TOTAL REQUESTS</span>
                <span className="text-base font-bold text-white">{lastResults.total}</span>
              </div>
              <div className="p-2 rounded bg-graphite-950 border border-graphite-800">
                <span className="text-slate-500 block text-[9px]">ALLOWED / THROTTLED</span>
                <span className="text-base font-bold text-signal-lime">
                  {lastResults.allowed} <span className="text-slate-500 font-normal">/</span> <span className="text-signal-salmon">{lastResults.throttled}</span>
                </span>
              </div>
              <div className="p-2 rounded bg-graphite-950 border border-graphite-800">
                <span className="text-slate-500 block text-[9px]">BOT THROTTLED (TP)</span>
                <span className="text-sm font-semibold text-signal-lime">{lastResults.tp}</span>
              </div>
              <div className="p-2 rounded bg-graphite-950 border border-graphite-800">
                <span className="text-slate-500 block text-[9px]">HUMAN THROTTLED (FP)</span>
                <span className={`text-sm font-semibold ${lastResults.fp > 0 ? 'text-signal-salmon' : 'text-slate-400'}`}>
                  {lastResults.fp}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
