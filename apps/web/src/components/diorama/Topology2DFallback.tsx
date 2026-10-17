import React from 'react';
import { DeviceNode } from '../../types';
import { Laptop, Smartphone, Cpu, Shield, Server } from 'lucide-react';

interface TopologyProps {
  devices: DeviceNode[];
  selectedDevice: DeviceNode | null;
  onSelectDevice: (device: DeviceNode) => void;
}

export const Topology2DFallback: React.FC<TopologyProps> = ({
  devices,
  selectedDevice,
  onSelectDevice,
}) => {
  const getDevice = (id: string) => devices.find(d => d.id === id);

  const laptop = getDevice('laptop');
  const phone = getDevice('phone');
  const iot = getDevice('iot');
  const gateway = getDevice('gateway');
  const upstream = getDevice('upstream');

  const renderNodeCard = (device: DeviceNode | undefined, icon: React.ReactNode, sub: string) => {
    if (!device) return null;
    const isSelected = selectedDevice?.id === device.id;
    const isThrottled = device.status === 'throttled';

    const borderStyle = isThrottled
      ? 'border-signal-salmon bg-red-950/40 text-signal-salmon'
      : isSelected
      ? 'border-signal-lime bg-lime-950/40 text-signal-lime'
      : 'border-graphite-700 bg-graphite-900/80 text-slate-200 hover:border-slate-500';

    return (
      <button
        onClick={() => onSelectDevice(device)}
        className={`w-56 p-3 rounded-md border text-left font-mono transition-all backdrop-blur-sm cursor-pointer ${borderStyle} shadow-lg`}
      >
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center space-x-2">
            <span className="p-1 rounded bg-black/40">{icon}</span>
            <span className="text-xs font-semibold tracking-wide uppercase">{device.name}</span>
          </div>
          <span className={`w-2 h-2 rounded-full ${isThrottled ? 'bg-signal-salmon animate-ping' : 'bg-signal-lime'}`} />
        </div>
        <div className="text-[11px] opacity-70 mb-1">{device.ip}</div>
        <div className="flex items-center justify-between text-[10px] opacity-60">
          <span>{sub}</span>
          <span>{device.totalRequests} reqs</span>
        </div>
      </button>
    );
  };

  return (
    <div className="w-full h-full p-6 flex flex-col justify-center items-center relative overflow-hidden bg-grid-dots">
      {/* Background SVG routing lines */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="grad-allow" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#a3e635" stopOpacity="0.8" />
          </linearGradient>
        </defs>
        {/* Schematic connection tracks */}
        <line x1="28%" y1="25%" x2="50%" y2="50%" stroke="#1e293b" strokeWidth="2" strokeDasharray="4 4" />
        <line x1="28%" y1="50%" x2="50%" y2="50%" stroke="#1e293b" strokeWidth="2" strokeDasharray="4 4" />
        <line x1="28%" y1="75%" x2="50%" y2="50%" stroke="#1e293b" strokeWidth="2" strokeDasharray="4 4" />
        <line x1="50%" y1="50%" x2="72%" y2="50%" stroke="#1e293b" strokeWidth="2" strokeDasharray="4 4" />
      </svg>

      <div className="w-full max-w-5xl grid grid-cols-3 gap-8 items-center z-10">
        {/* Column 1: Client Edge Hardware */}
        <div className="flex flex-col space-y-6 items-center">
          <div className="text-[10px] font-mono tracking-widest text-slate-400 uppercase font-semibold">Client Devices</div>
          {renderNodeCard(laptop, <Laptop className="w-4 h-4" />, 'Workstation Terminal')}
          {renderNodeCard(phone, <Smartphone className="w-4 h-4" />, 'Mobile Client')}
          {renderNodeCard(iot, <Cpu className="w-4 h-4" />, 'IoT Sampling Sensor')}
        </div>

        {/* Column 2: Central Sentinel Edge Reverse Proxy Gateway */}
        <div className="flex flex-col items-center">
          <div className="text-[10px] font-mono tracking-widest text-signal-lime uppercase font-semibold mb-2">Defense Boundary</div>
          {renderNodeCard(gateway, <Shield className="w-5 h-5" />, 'Reverse Proxy (:8080)')}
        </div>

        {/* Column 3: Upstream Backend Application */}
        <div className="flex flex-col items-center">
          <div className="text-[10px] font-mono tracking-widest text-cyan-400 uppercase font-semibold mb-2">Isolated Upstream</div>
          {renderNodeCard(upstream, <Server className="w-5 h-5" />, 'API Application (:8081)')}
        </div>
      </div>
    </div>
  );
};
