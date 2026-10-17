import React, { useState, useEffect, useRef } from 'react';
import { DeviceNode, DecisionEvent, GatewayOverview, PolicyMode, PacketVisual } from './types';
import { SentinelApi } from './services/api';
import { Header } from './components/layout/Header';
import { NetworkDiorama } from './components/canvas/NetworkDiorama';
import { Topology2DFallback } from './components/diorama/Topology2DFallback';
import { InspectorDrawer } from './components/layout/InspectorDrawer';
import { ScenarioStudio } from './components/studio/ScenarioStudio';
import { LivePacketFeed } from './components/studio/LivePacketFeed';
import { PolicyComparisonModal } from './components/studio/PolicyComparisonModal';
import { EventScrubber } from './components/timeline/EventScrubber';
import { Cpu, HelpCircle, ShieldAlert, Sparkles, ChevronUp, ChevronDown } from 'lucide-react';

const INITIAL_DEVICES: DeviceNode[] = [
  {
    id: 'laptop',
    name: 'Workstation Terminal',
    category: 'client',
    position: [-3.5, 0, 1.5],
    ip: '192.168.1.42',
    clientId: 'laptop-workstation',
    status: 'idle',
    telemetry: { battery: 85, charging: true, cadenceMs: 850, jitterMs: 45, sampleCount: 12 },
    totalRequests: 0,
    allowedCount: 0,
    throttledCount: 0
  },
  {
    id: 'phone',
    name: 'Mobile Client',
    category: 'client',
    position: [-2.4, 0, 3.2],
    ip: '192.168.1.105',
    clientId: 'phone-mobile',
    status: 'idle',
    telemetry: { battery: 62, charging: false, cadenceMs: 1100, jitterMs: 120, sampleCount: 8 },
    totalRequests: 0,
    allowedCount: 0,
    throttledCount: 0
  },
  {
    id: 'iot',
    name: 'IoT Sampling Sensor',
    category: 'client',
    position: [-4.0, 0, -1.8],
    ip: '192.168.1.210',
    clientId: 'iot-sensor-hub',
    status: 'idle',
    telemetry: { battery: null, charging: null, cadenceMs: 250, jitterMs: 12, sampleCount: 20 },
    totalRequests: 0,
    allowedCount: 0,
    throttledCount: 0
  },
  {
    id: 'gateway',
    name: 'Sentinel Reverse Proxy',
    category: 'gateway',
    position: [0, 0, 0],
    ip: '0.0.0.0:8080',
    clientId: 'sentinel-lab-edge',
    status: 'active',
    telemetry: { battery: null, charging: null, cadenceMs: 0, jitterMs: 0, sampleCount: 0 },
    totalRequests: 0,
    allowedCount: 0,
    throttledCount: 0
  },
  {
    id: 'upstream',
    name: 'Upstream Application',
    category: 'upstream',
    position: [3.8, 0, -1.0],
    ip: '127.0.0.1:8081',
    clientId: 'sentinel-upstream-backend',
    status: 'idle',
    telemetry: { battery: null, charging: null, cadenceMs: 0, jitterMs: 0, sampleCount: 0 },
    totalRequests: 0,
    allowedCount: 0,
    throttledCount: 0
  }
];

export const App: React.FC = () => {
  const [overview, setOverview] = useState<GatewayOverview | null>(null);
  const [activePolicy, setActivePolicy] = useState<PolicyMode>('HYBRID_BEHAVIORAL');
  const [viewMode, setViewMode] = useState<'3d' | '2d'>('3d');
  const [devices, setDevices] = useState<DeviceNode[]>(INITIAL_DEVICES);
  const [selectedDevice, setSelectedDevice] = useState<DeviceNode | null>(null);
  const [events, setEvents] = useState<DecisionEvent[]>([]);
  const [packets, setPackets] = useState<PacketVisual[]>([]);
  const [isSseConnected, setIsSseConnected] = useState(false);
  const [isPolicyModalOpen, setIsPolicyModalOpen] = useState(false);
  const [bottomTab, setBottomTab] = useState<'feed' | 'studio'>('feed');
  const [isBottomOpen, setIsBottomOpen] = useState(true);

  // Scrubber playback state
  const [scrubberIndex, setScrubberIndex] = useState(0);
  const [isPlayingScrubber, setIsPlayingScrubber] = useState(false);

  // Load initial gateway overview
  const fetchOverview = async () => {
    try {
      const data = await SentinelApi.getOverview();
      setOverview(data);
      setActivePolicy(data.policyMode);
    } catch (err) {
      console.warn('Initial overview fetch waiting for gateway:', err);
    }
  };

  useEffect(() => {
    fetchOverview();
    const interval = setInterval(fetchOverview, 5000);
    return () => clearInterval(interval);
  }, []);

  // Subscribe to SSE DecisionEvents
  useEffect(() => {
    const unsubscribe = SentinelApi.subscribeToEvents(
      (newEvent) => {
        setIsSseConnected(true);
        setEvents((prev) => [newEvent, ...prev.slice(0, 199)]);

        // Spawn visual 3D packet
        const isClient = newEvent.clientIdentifier.includes('phone') ? 'phone' : newEvent.clientIdentifier.includes('iot') ? 'iot' : 'laptop';
        const clientNode = devices.find(d => d.id === isClient) || devices[0];

        const targetPos: [number, number, number] = newEvent.decision === 'ALLOW' ? [3.8, 0.4, -1.0] : [0, 0.3, 0];

        const newPacket: PacketVisual = {
          id: `pkt_${Date.now()}_${Math.random()}`,
          from: clientNode.position,
          to: targetPos,
          progress: 0,
          decision: newEvent.decision,
          clientIdentifier: newEvent.clientIdentifier,
          timestamp: Date.now()
        };

        setPackets((prev) => [...prev.slice(-15), newPacket]);

        // Update node metrics
        setDevices((prev) =>
          prev.map((dev) => {
            if (dev.clientId === newEvent.clientIdentifier || dev.id === isClient) {
              return {
                ...dev,
                totalRequests: dev.totalRequests + 1,
                allowedCount: dev.allowedCount + (newEvent.decision === 'ALLOW' ? 1 : 0),
                throttledCount: dev.throttledCount + (newEvent.decision === 'THROTTLE' ? 1 : 0),
                status: newEvent.decision === 'THROTTLE' ? 'throttled' : 'active'
              };
            }
            if (dev.id === 'gateway') {
              return {
                ...dev,
                totalRequests: dev.totalRequests + 1,
                allowedCount: dev.allowedCount + (newEvent.decision === 'ALLOW' ? 1 : 0),
                throttledCount: dev.throttledCount + (newEvent.decision === 'THROTTLE' ? 1 : 0)
              };
            }
            if (dev.id === 'upstream' && newEvent.upstreamForwarded) {
              return {
                ...dev,
                totalRequests: dev.totalRequests + 1,
                allowedCount: dev.allowedCount + 1,
                status: 'active'
              };
            }
            return dev;
          })
        );
      },
      () => {
        setIsSseConnected(false);
      }
    );

    return unsubscribe;
  }, [devices]);

  // Animate packet progress
  useEffect(() => {
    if (packets.length === 0) return;
    const interval = setInterval(() => {
      setPackets((prev) =>
        prev
          .map((p) => ({ ...p, progress: p.progress + 0.08 }))
          .filter((p) => p.progress <= 1.0)
      );
    }, 30);
    return () => clearInterval(interval);
  }, [packets]);

  // Handle policy switch
  const handleSelectPolicy = async (policy: PolicyMode) => {
    try {
      await SentinelApi.setPolicy(policy);
      setActivePolicy(policy);
      await fetchOverview();
    } catch (err) {
      console.error('Failed to change policy mode:', err);
    }
  };

  // Handle gateway reset
  const handleReset = async () => {
    try {
      await SentinelApi.resetGateway();
      setEvents([]);
      setPackets([]);
      setDevices(INITIAL_DEVICES);
      setSelectedDevice(null);
      await fetchOverview();
    } catch (err) {
      console.error('Failed to reset gateway:', err);
    }
  };

  return (
    <div className="w-screen h-screen flex flex-col bg-[#070a0f] text-slate-100 overflow-hidden font-sans">
      {/* 1. Master Header Bar */}
      <Header
        overview={overview}
        activePolicy={activePolicy}
        onSelectPolicy={handleSelectPolicy}
        onReset={handleReset}
        viewMode={viewMode}
        onToggleViewMode={() => setViewMode(prev => prev === '3d' ? '2d' : '3d')}
        isSseConnected={isSseConnected}
      />

      {/* 2. Main Workspace */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Canvas / Schematic Center Workspace */}
        <div className="flex-1 h-full relative">
          {viewMode === '3d' ? (
            <NetworkDiorama
              devices={devices}
              selectedDevice={selectedDevice}
              onSelectDevice={(d) => setSelectedDevice(d)}
              packets={packets}
            />
          ) : (
            <Topology2DFallback
              devices={devices}
              selectedDevice={selectedDevice}
              onSelectDevice={(d) => setSelectedDevice(d)}
            />
          )}

          {/* Floating HUD Badges & Action Buttons */}
          <div className="absolute top-4 left-4 z-10 flex flex-col space-y-2 pointer-events-auto">
            <button
              onClick={() => setIsPolicyModalOpen(true)}
              className="px-3 py-1.5 rounded-lg border border-graphite-700 bg-graphite-950/80 hover:border-signal-lime text-xs font-mono text-slate-200 flex items-center space-x-2 backdrop-blur-md shadow-brutal-sm transition-all"
            >
              <Cpu className="w-3.5 h-3.5 text-signal-lime" />
              <span>DEFENSE ARCHITECTURE EXPLAINED</span>
            </button>
          </div>
        </div>

        {/* Right Drawer: Contextual Hardware Inspector OR Studio */}
        {selectedDevice ? (
          <InspectorDrawer
            device={selectedDevice}
            onClose={() => setSelectedDevice(null)}
            recentEvents={events}
          />
        ) : (
          <div className="w-96 border-l border-graphite-700 bg-graphite-950/95 z-20 hidden md:block">
            <ScenarioStudio
              activePolicy={activePolicy}
              onRefreshOverview={fetchOverview}
            />
          </div>
        )}
      </div>

      {/* 3. Bottom Panel: Live Packet Feed & Event Scrubber */}
      <div className={`transition-all duration-300 z-30 ${isBottomOpen ? 'h-56' : 'h-8'} flex flex-col`}>
        {/* Panel Toggle Handle */}
        <div className="h-8 border-t border-graphite-700 bg-graphite-950 flex items-center justify-between px-4 text-xs font-mono select-none">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => { setBottomTab('feed'); setIsBottomOpen(true); }}
              className={`font-semibold transition-colors ${bottomTab === 'feed' ? 'text-signal-lime' : 'text-slate-400 hover:text-white'}`}
            >
              LIVE PACKET STREAM ({events.length})
            </button>
            <button
              onClick={() => { setBottomTab('studio'); setIsBottomOpen(true); }}
              className={`font-semibold md:hidden transition-colors ${bottomTab === 'studio' ? 'text-signal-lime' : 'text-slate-400 hover:text-white'}`}
            >
              SCENARIO STUDIO
            </button>
          </div>

          <button
            onClick={() => setIsBottomOpen(prev => !prev)}
            className="flex items-center space-x-1 text-slate-400 hover:text-white text-[11px]"
          >
            <span>{isBottomOpen ? 'COLLAPSE' : 'EXPAND FEED'}</span>
            {isBottomOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* Panel Content */}
        {isBottomOpen && (
          <div className="flex-1 overflow-hidden">
            {bottomTab === 'feed' ? (
              <LivePacketFeed events={events} />
            ) : (
              <div className="h-full bg-graphite-950 overflow-y-auto">
                <ScenarioStudio activePolicy={activePolicy} onRefreshOverview={fetchOverview} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* 4. Policy Comparison Modal */}
      <PolicyComparisonModal
        isOpen={isPolicyModalOpen}
        onClose={() => setIsPolicyModalOpen(false)}
        activePolicy={activePolicy}
        onSelectPolicy={handleSelectPolicy}
      />
    </div>
  );
};
