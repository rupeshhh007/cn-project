export type PolicyMode = 'IP_BASELINE' | 'SESSION_BASELINE' | 'HYBRID_BEHAVIORAL';
export type DecisionType = 'ALLOW' | 'THROTTLE';

export interface DecisionEvent {
  eventId: string;
  timestamp: string;
  requestId: string;
  policyMode: PolicyMode;
  decision: DecisionType;
  reason: string;
  clientIdentifier: string;
  socketRemoteIp: string;
  simulatedSourceIp: string | null;
  clusterId: string | null;
  signalConfidence: number;
  tokensRemaining: number;
  tokensCapacity: number;
  upstreamForwarded: boolean;
  upstreamLatencyMs: number | null;
  httpStatus: number;
  requestPath: string;
  requestMethod: string;
}

export interface DeviceNode {
  id: 'laptop' | 'phone' | 'iot' | 'gateway' | 'upstream';
  name: string;
  category: 'client' | 'gateway' | 'upstream';
  position: [number, number, number];
  ip: string;
  clientId: string;
  status: 'active' | 'throttled' | 'idle';
  telemetry: {
    battery: number | null;
    charging: boolean | null;
    cadenceMs: number;
    jitterMs: number;
    sampleCount: number;
  };
  totalRequests: number;
  allowedCount: number;
  throttledCount: number;
}

export interface PacketVisual {
  id: string;
  from: [number, number, number];
  to: [number, number, number];
  progress: number;
  decision: DecisionType;
  clientIdentifier: string;
  timestamp: number;
}

export interface GatewayOverview {
  service: string;
  policyMode: PolicyMode;
  upstreamTarget: string;
  totalRequests: number;
  allowedRequests: number;
  throttledRequests: number;
  uptimeSeconds: number;
}

export interface ScenarioDefinition {
  id: string;
  name: string;
  category: string;
  description: string;
  expectedPolicyOutcome: string;
}

export interface ScenarioComparisonSummary {
  policyMode: PolicyMode;
  totalRequests: number;
  allowedCount: number;
  throttledCount: number;
  tp: number;
  fp: number;
  tn: number;
  fn: number;
  accuracyPercent: number;
  falsePositiveRatePercent: number;
  falseNegativeRatePercent: number;
  avgLatencyMs: number;
}
