import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface ModelProps {
  isSelected: boolean;
  isHovered: boolean;
  status: 'active' | 'throttled' | 'idle';
  onClick: () => void;
  onPointerOver: () => void;
  onPointerOut: () => void;
}

// 1. Laptop Workstation Model
export const LaptopModel: React.FC<ModelProps> = ({ isSelected, isHovered, status, onClick, onPointerOver, onPointerOut }) => {
  const group = useRef<THREE.Group>(null);
  const statusColor = status === 'throttled' ? '#fb7185' : isSelected ? '#a3e635' : '#38bdf8';

  useFrame((state) => {
    if (group.current && (isHovered || isSelected)) {
      group.current.position.y = Math.sin(state.clock.elapsedTime * 3) * 0.05;
    } else if (group.current) {
      group.current.position.y = 0;
    }
  });

  return (
    <group
      ref={group}
      position={[-3.5, 0, 1.5]}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onPointerOver={(e) => { e.stopPropagation(); onPointerOver(); }}
      onPointerOut={onPointerOut}
    >
      {/* Selection ring / Pedestal */}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.9, 1.05, 32]} />
        <meshBasicMaterial color={statusColor} opacity={isSelected ? 0.9 : isHovered ? 0.5 : 0.2} transparent />
      </mesh>

      {/* Laptop Base (chassis) */}
      <mesh position={[0, 0.08, 0]}>
        <boxGeometry args={[1.2, 0.06, 0.9]} />
        <meshStandardMaterial color="#1a2332" roughness={0.4} metalness={0.7} />
      </mesh>

      {/* Keyboard Bed */}
      <mesh position={[0, 0.115, 0.05]}>
        <boxGeometry args={[1.0, 0.015, 0.5]} />
        <meshStandardMaterial color="#0d131d" roughness={0.8} />
      </mesh>

      {/* Trackpad */}
      <mesh position={[0, 0.115, 0.32]}>
        <boxGeometry args={[0.35, 0.012, 0.2]} />
        <meshStandardMaterial color="#223044" roughness={0.3} />
      </mesh>

      {/* Screen Hinge & Lid (angled 115 deg) */}
      <group position={[0, 0.11, -0.42]} rotation={[0.45, 0, 0]}>
        {/* Screen back casing */}
        <mesh position={[0, 0.42, 0]}>
          <boxGeometry args={[1.2, 0.8, 0.04]} />
          <meshStandardMaterial color="#141c28" roughness={0.4} metalness={0.8} />
        </mesh>
        {/* Glowing Screen matrix */}
        <mesh position={[0, 0.42, 0.025]}>
          <planeGeometry args={[1.1, 0.7]} />
          <meshBasicMaterial color={statusColor} opacity={0.85} transparent />
        </mesh>
      </group>
    </group>
  );
};

// 2. Mobile Client (Smartphone)
export const PhoneModel: React.FC<ModelProps> = ({ isSelected, isHovered, status, onClick, onPointerOver, onPointerOut }) => {
  const group = useRef<THREE.Group>(null);
  const statusColor = status === 'throttled' ? '#fb7185' : isSelected ? '#a3e635' : '#38bdf8';

  useFrame((state) => {
    if (group.current) {
      group.current.rotation.y = Math.sin(state.clock.elapsedTime * 1.5) * 0.1 + 0.3;
      if (isHovered || isSelected) {
        group.current.position.y = Math.sin(state.clock.elapsedTime * 3) * 0.05;
      } else {
        group.current.position.y = 0;
      }
    }
  });

  return (
    <group
      ref={group}
      position={[-2.4, 0, 3.2]}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onPointerOver={(e) => { e.stopPropagation(); onPointerOver(); }}
      onPointerOut={onPointerOut}
    >
      {/* Base Ring */}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.65, 0.8, 32]} />
        <meshBasicMaterial color={statusColor} opacity={isSelected ? 0.9 : isHovered ? 0.5 : 0.2} transparent />
      </mesh>

      {/* Phone Stand (angled wedge) */}
      <mesh position={[0, 0.15, -0.1]}>
        <boxGeometry args={[0.3, 0.3, 0.25]} />
        <meshStandardMaterial color="#111827" roughness={0.5} />
      </mesh>

      {/* Phone Body (leaning on stand) */}
      <group position={[0, 0.4, 0]} rotation={[-0.35, 0, 0]}>
        <mesh>
          <boxGeometry args={[0.48, 0.95, 0.05]} />
          <meshStandardMaterial color="#1a2332" roughness={0.3} metalness={0.8} />
        </mesh>
        {/* Screen */}
        <mesh position={[0, 0, 0.03]}>
          <planeGeometry args={[0.42, 0.88]} />
          <meshBasicMaterial color={statusColor} opacity={0.8} transparent />
        </mesh>
      </group>
    </group>
  );
};

// 3. IoT Edge Sensor Hub
export const IoTModel: React.FC<ModelProps> = ({ isSelected, isHovered, status, onClick, onPointerOver, onPointerOut }) => {
  const group = useRef<THREE.Group>(null);
  const statusColor = status === 'throttled' ? '#fb7185' : isSelected ? '#a3e635' : '#38bdf8';

  useFrame((state) => {
    if (group.current && (isHovered || isSelected)) {
      group.current.position.y = Math.sin(state.clock.elapsedTime * 3) * 0.05;
    } else if (group.current) {
      group.current.position.y = 0;
    }
  });

  return (
    <group
      ref={group}
      position={[-4.0, 0, -1.8]}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onPointerOver={(e) => { e.stopPropagation(); onPointerOver(); }}
      onPointerOut={onPointerOut}
    >
      {/* Base Ring */}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.7, 0.85, 32]} />
        <meshBasicMaterial color={statusColor} opacity={isSelected ? 0.9 : isHovered ? 0.5 : 0.2} transparent />
      </mesh>

      {/* PCB Circuit Board */}
      <mesh position={[0, 0.08, 0]}>
        <boxGeometry args={[0.85, 0.04, 0.85]} />
        <meshStandardMaterial color="#064e3b" roughness={0.5} />
      </mesh>

      {/* MCU Microchip */}
      <mesh position={[0, 0.12, 0]}>
        <boxGeometry args={[0.35, 0.04, 0.35]} />
        <meshStandardMaterial color="#0f172a" roughness={0.2} metalness={0.9} />
      </mesh>

      {/* Antenna Rod */}
      <mesh position={[0.3, 0.45, -0.3]}>
        <cylinderGeometry args={[0.015, 0.015, 0.7, 12]} />
        <meshStandardMaterial color="#334155" metalness={0.9} />
      </mesh>

      {/* Blinking Sampling Diode */}
      <mesh position={[-0.25, 0.13, 0.25]}>
        <sphereGeometry args={[0.04, 16, 16]} />
        <meshBasicMaterial color={statusColor} />
      </mesh>
    </group>
  );
};

// 4. Central Sentinel Edge Reverse Proxy Gateway
export const GatewayModel: React.FC<ModelProps> = ({ isSelected, isHovered, status, onClick, onPointerOver, onPointerOut }) => {
  const group = useRef<THREE.Group>(null);
  const statusColor = status === 'throttled' ? '#fb7185' : isSelected ? '#a3e635' : '#10b981';

  useFrame((state) => {
    if (group.current) {
      // Gentle floating pulse
      group.current.position.y = Math.sin(state.clock.elapsedTime * 1.8) * 0.04;
    }
  });

  return (
    <group
      ref={group}
      position={[0, 0, 0]}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onPointerOver={(e) => { e.stopPropagation(); onPointerOver(); }}
      onPointerOut={onPointerOut}
    >
      {/* Central Defensive Perimeter Ring */}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.5, 1.7, 48]} />
        <meshBasicMaterial color={statusColor} opacity={isSelected ? 0.95 : 0.4} transparent />
      </mesh>

      {/* Lower appliance chassis */}
      <mesh position={[0, 0.2, 0]}>
        <boxGeometry args={[1.6, 0.35, 1.2]} />
        <meshStandardMaterial color="#111827" roughness={0.3} metalness={0.8} />
      </mesh>

      {/* Heatsink Fins */}
      {[-0.5, -0.25, 0, 0.25, 0.5].map((x, i) => (
        <mesh key={i} position={[x, 0.42, 0]}>
          <boxGeometry args={[0.05, 0.1, 0.9]} />
          <meshStandardMaterial color="#1f2937" metalness={0.9} />
        </mesh>
      ))}

      {/* Dual High-Gain Antennas */}
      <mesh position={[-0.65, 0.75, -0.45]} rotation={[0.1, 0, -0.15]}>
        <cylinderGeometry args={[0.025, 0.03, 0.9, 16]} />
        <meshStandardMaterial color="#374151" metalness={0.8} />
      </mesh>
      <mesh position={[0.65, 0.75, -0.45]} rotation={[0.1, 0, 0.15]}>
        <cylinderGeometry args={[0.025, 0.03, 0.9, 16]} />
        <meshStandardMaterial color="#374151" metalness={0.8} />
      </mesh>

      {/* Gateway Front Telemetry Display */}
      <mesh position={[0, 0.2, 0.605]}>
        <planeGeometry args={[1.3, 0.2]} />
        <meshBasicMaterial color={statusColor} opacity={0.9} transparent />
      </mesh>
    </group>
  );
};

// 5. Upstream Backend Application Server Rack
export const UpstreamModel: React.FC<ModelProps> = ({ isSelected, isHovered, status, onClick, onPointerOver, onPointerOut }) => {
  const group = useRef<THREE.Group>(null);
  const statusColor = isSelected ? '#a3e635' : '#38bdf8';

  useFrame((state) => {
    if (group.current && (isHovered || isSelected)) {
      group.current.position.y = Math.sin(state.clock.elapsedTime * 3) * 0.05;
    } else if (group.current) {
      group.current.position.y = 0;
    }
  });

  return (
    <group
      ref={group}
      position={[3.8, 0, -1.0]}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onPointerOver={(e) => { e.stopPropagation(); onPointerOver(); }}
      onPointerOut={onPointerOut}
    >
      {/* Base Ring */}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.1, 1.3, 32]} />
        <meshBasicMaterial color={statusColor} opacity={isSelected ? 0.9 : isHovered ? 0.5 : 0.2} transparent />
      </mesh>

      {/* Main Server Cabinet (Tower) */}
      <mesh position={[0, 1.1, 0]}>
        <boxGeometry args={[1.1, 2.1, 1.1]} />
        <meshStandardMaterial color="#0f172a" roughness={0.4} metalness={0.8} />
      </mesh>

      {/* Server Sled Blades (Stacked 1U/2U server nodes) */}
      {[0.4, 0.75, 1.1, 1.45, 1.8].map((y, i) => (
        <group key={i} position={[0, y, 0.56]}>
          {/* Blade faceplate */}
          <mesh>
            <planeGeometry args={[0.95, 0.25]} />
            <meshStandardMaterial color="#1e293b" metalness={0.7} />
          </mesh>
          {/* Activity LEDs */}
          <mesh position={[-0.35, 0, 0.01]}>
            <sphereGeometry args={[0.02, 8, 8]} />
            <meshBasicMaterial color="#10b981" />
          </mesh>
          <mesh position={[-0.25, 0, 0.01]}>
            <sphereGeometry args={[0.02, 8, 8]} />
            <meshBasicMaterial color="#38bdf8" />
          </mesh>
          {/* Drive Vent Grill */}
          <mesh position={[0.15, 0, 0.01]}>
            <planeGeometry args={[0.45, 0.12]} />
            <meshBasicMaterial color="#090d16" />
          </mesh>
        </group>
      ))}
    </group>
  );
};
