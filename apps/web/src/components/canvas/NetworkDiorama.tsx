import React, { useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Html } from '@react-three/drei';
import * as THREE from 'three';
import { DeviceNode, PacketVisual } from '../../types';
import { LaptopModel, PhoneModel, IoTModel, GatewayModel, UpstreamModel } from './HardwareModels';

interface DioramaProps {
  devices: DeviceNode[];
  selectedDevice: DeviceNode | null;
  onSelectDevice: (device: DeviceNode) => void;
  packets: PacketVisual[];
}

// Visual packet component traveling between 3D points
const PacketTrail: React.FC<{ packet: PacketVisual }> = ({ packet }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const color = packet.decision === 'ALLOW' ? '#a3e635' : '#fb7185';

  useFrame(() => {
    if (!meshRef.current) return;
    const { from, to, progress } = packet;
    // Linear interpolation with a gentle parabolic arc in Y
    const x = from[0] + (to[0] - from[0]) * progress;
    const z = from[2] + (to[2] - from[2]) * progress;
    const arcHeight = Math.sin(progress * Math.PI) * 0.8;
    const y = from[1] + (to[1] - from[1]) * progress + 0.3 + arcHeight;

    meshRef.current.position.set(x, y, z);
  });

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[0.09, 12, 12]} />
      <meshBasicMaterial color={color} />
    </mesh>
  );
};

// Static glowing laser connection lines between hardware nodes
const ConnectionLines: React.FC = () => {
  // Client positions -> Gateway -> Upstream
  const lines = [
    { start: [-3.5, 0.1, 1.5], end: [0, 0.15, 0] },     // Laptop to Gateway
    { start: [-2.4, 0.1, 3.2], end: [0, 0.15, 0] },     // Phone to Gateway
    { start: [-4.0, 0.1, -1.8], end: [0, 0.15, 0] },    // IoT to Gateway
    { start: [0, 0.15, 0], end: [3.8, 0.2, -1.0] },      // Gateway to Upstream
  ];

  return (
    <group>
      {lines.map((l, i) => {
        const points = [new THREE.Vector3(...l.start), new THREE.Vector3(...l.end)];
        const geom = new THREE.BufferGeometry().setFromPoints(points);
        return (
          <line key={i} geometry={geom}>
            <lineBasicMaterial color="#334155" opacity={0.4} transparent linewidth={1} />
          </line>
        );
      })}
    </group>
  );
};

// Floating HTML Badge above hardware entities
const FloatingBadge: React.FC<{
  position: [number, number, number];
  name: string;
  ip: string;
  status: 'active' | 'throttled' | 'idle';
  isSelected: boolean;
}> = ({ position, name, ip, status, isSelected }) => {
  const badgeColor = status === 'throttled' 
    ? 'border-signal-salmon text-signal-salmon bg-red-950/80' 
    : isSelected 
    ? 'border-signal-lime text-signal-lime bg-lime-950/80' 
    : 'border-slate-700 text-slate-300 bg-graphite-900/80';

  return (
    <Html position={[position[0], position[1] + 1.2, position[2]]} center distanceFactor={12}>
      <div className={`px-2 py-0.5 rounded border text-[11px] font-mono tracking-tight whitespace-nowrap shadow-md backdrop-blur-sm transition-all pointer-events-none ${badgeColor}`}>
        <span className="font-semibold">{name}</span>
        <span className="opacity-60 ml-1.5">{ip}</span>
      </div>
    </Html>
  );
};

export const NetworkDiorama: React.FC<DioramaProps> = ({
  devices,
  selectedDevice,
  onSelectDevice,
  packets
}) => {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const getDeviceNode = (id: string) => devices.find(d => d.id === id) || null;

  return (
    <div className="w-full h-full relative cursor-grab active:cursor-grabbing">
      <Canvas
        camera={{ position: [7.5, 7.0, 8.5], fov: 38 }}
        gl={{ antialias: true, alpha: true }}
      >
        <ambientLight intensity={0.7} />
        <directionalLight position={[10, 15, 10]} intensity={1.2} />
        <pointLight position={[0, 4, 0]} intensity={1.5} color="#10b981" distance={8} />

        {/* Isometric Circuit Grid Floor */}
        <gridHelper args={[20, 20, '#1e293b', '#0f172a']} position={[0, -0.01, 0]} />

        {/* Hardware Connection laser traces */}
        <ConnectionLines />

        {/* 1. Laptop Model */}
        {(() => {
          const d = getDeviceNode('laptop');
          if (!d) return null;
          return (
            <group>
              <LaptopModel
                isSelected={selectedDevice?.id === 'laptop'}
                isHovered={hoveredId === 'laptop'}
                status={d.status}
                onClick={() => onSelectDevice(d)}
                onPointerOver={() => setHoveredId('laptop')}
                onPointerOut={() => setHoveredId(null)}
              />
              <FloatingBadge
                position={[-3.5, 0.4, 1.5]}
                name={d.name}
                ip={d.ip}
                status={d.status}
                isSelected={selectedDevice?.id === 'laptop'}
              />
            </group>
          );
        })()}

        {/* 2. Phone Model */}
        {(() => {
          const d = getDeviceNode('phone');
          if (!d) return null;
          return (
            <group>
              <PhoneModel
                isSelected={selectedDevice?.id === 'phone'}
                isHovered={hoveredId === 'phone'}
                status={d.status}
                onClick={() => onSelectDevice(d)}
                onPointerOver={() => setHoveredId('phone')}
                onPointerOut={() => setHoveredId(null)}
              />
              <FloatingBadge
                position={[-2.4, 0.4, 3.2]}
                name={d.name}
                ip={d.ip}
                status={d.status}
                isSelected={selectedDevice?.id === 'phone'}
              />
            </group>
          );
        })()}

        {/* 3. IoT Sensor Model */}
        {(() => {
          const d = getDeviceNode('iot');
          if (!d) return null;
          return (
            <group>
              <IoTModel
                isSelected={selectedDevice?.id === 'iot'}
                isHovered={hoveredId === 'iot'}
                status={d.status}
                onClick={() => onSelectDevice(d)}
                onPointerOver={() => setHoveredId('iot')}
                onPointerOut={() => setHoveredId(null)}
              />
              <FloatingBadge
                position={[-4.0, 0.4, -1.8]}
                name={d.name}
                ip={d.ip}
                status={d.status}
                isSelected={selectedDevice?.id === 'iot'}
              />
            </group>
          );
        })()}

        {/* 4. Gateway Reverse Proxy Model */}
        {(() => {
          const d = getDeviceNode('gateway');
          if (!d) return null;
          return (
            <group>
              <GatewayModel
                isSelected={selectedDevice?.id === 'gateway'}
                isHovered={hoveredId === 'gateway'}
                status={d.status}
                onClick={() => onSelectDevice(d)}
                onPointerOver={() => setHoveredId('gateway')}
                onPointerOut={() => setHoveredId(null)}
              />
              <FloatingBadge
                position={[0, 0.6, 0]}
                name={d.name}
                ip="GATEWAY :8080"
                status={d.status}
                isSelected={selectedDevice?.id === 'gateway'}
              />
            </group>
          );
        })()}

        {/* 5. Upstream Server Rack Model */}
        {(() => {
          const d = getDeviceNode('upstream');
          if (!d) return null;
          return (
            <group>
              <UpstreamModel
                isSelected={selectedDevice?.id === 'upstream'}
                isHovered={hoveredId === 'upstream'}
                status={d.status}
                onClick={() => onSelectDevice(d)}
                onPointerOver={() => setHoveredId('upstream')}
                onPointerOut={() => setHoveredId(null)}
              />
              <FloatingBadge
                position={[3.8, 1.4, -1.0]}
                name={d.name}
                ip="BACKEND :8081"
                status={d.status}
                isSelected={selectedDevice?.id === 'upstream'}
              />
            </group>
          );
        })()}

        {/* Live Packet Particles in transit */}
        {packets.map((pkt) => (
          <PacketTrail key={pkt.id} packet={pkt} />
        ))}

        {/* Bounded Orbit Controls */}
        <OrbitControls
          enablePan={true}
          enableZoom={true}
          minDistance={5}
          maxDistance={22}
          maxPolarAngle={Math.PI / 2.1} // Prevent flipping under floor
          target={[0, 0.3, 0]}
        />
      </Canvas>
    </div>
  );
};
