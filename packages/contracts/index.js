/**
 * @sentinel/contracts
 * Authoritative data transfer objects, policy definitions, and event schemas
 * for SENTINEL / NETWORK LAB.
 */

export const PolicyModes = Object.freeze({
  IP_BASELINE: 'IP_BASELINE',
  SESSION_BASELINE: 'SESSION_BASELINE',
  HYBRID_BEHAVIORAL: 'HYBRID_BEHAVIORAL'
});

export const DecisionTypes = Object.freeze({
  ALLOW: 'ALLOW',
  THROTTLE: 'THROTTLE'
});

export const DecisionReasons = Object.freeze({
  TOKEN_AVAILABLE: 'TOKEN_AVAILABLE',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  COLD_START_IP_FALLBACK: 'COLD_START_IP_FALLBACK',
  POLICY_BYPASS_HEALTH: 'POLICY_BYPASS_HEALTH',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  INVALID_CONTENT_TYPE: 'INVALID_CONTENT_TYPE'
});

/**
 * Validates and sanitizes a DecisionEvent structure.
 * @param {Object} event
 * @returns {Object} validated event
 */
export function validateDecisionEvent(event) {
  if (!event || typeof event !== 'object') {
    throw new TypeError('DecisionEvent must be an object');
  }

  const required = [
    'eventId',
    'timestamp',
    'requestId',
    'policyMode',
    'decision',
    'reason',
    'socketRemoteIp',
    'tokensRemaining',
    'httpStatus',
    'requestPath',
    'requestMethod'
  ];

  for (const field of required) {
    if (event[field] === undefined || event[field] === null) {
      throw new Error(`DecisionEvent missing mandatory field: ${field}`);
    }
  }

  if (!Object.values(PolicyModes).includes(event.policyMode)) {
    throw new Error(`Invalid PolicyMode: ${event.policyMode}`);
  }

  if (!Object.values(DecisionTypes).includes(event.decision)) {
    throw new Error(`Invalid DecisionType: ${event.decision}`);
  }

  return {
    eventId: String(event.eventId),
    timestamp: String(event.timestamp),
    requestId: String(event.requestId),
    policyMode: event.policyMode,
    decision: event.decision,
    reason: String(event.reason),
    clientIdentifier: event.clientIdentifier ? String(event.clientIdentifier) : 'unspecified',
    socketRemoteIp: String(event.socketRemoteIp),
    simulatedSourceIp: event.simulatedSourceIp ? String(event.simulatedSourceIp) : null,
    clusterId: event.clusterId ? String(event.clusterId) : null,
    signalConfidence: typeof event.signalConfidence === 'number' ? event.signalConfidence : 0.0,
    tokensRemaining: Number(event.tokensRemaining),
    tokensCapacity: Number(event.tokensCapacity || 10.0),
    upstreamForwarded: Boolean(event.upstreamForwarded),
    upstreamLatencyMs: typeof event.upstreamLatencyMs === 'number' ? event.upstreamLatencyMs : null,
    httpStatus: Number(event.httpStatus),
    requestPath: String(event.requestPath),
    requestMethod: String(event.requestMethod).toUpperCase()
  };
}
