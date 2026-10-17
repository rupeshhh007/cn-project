/**
 * SENTINEL / NETWORK LAB — Scenario Definitions & Trace Generator
 * 
 * Provides 5 deterministic, seed-based network traffic scenarios with ground truth labels:
 * 1. legitimate-traffic: Natural spaced browsing from multiple human clients.
 * 2. ip-rotation-attack: High-frequency scripted scraper rotating simulated IPs to evade IP filters.
 * 3. shared-nat-fairness: Multiple distinct legitimate clients sharing one external NAT IP.
 * 4. burst-recovery: Sudden high-volume burst exhausting bucket capacity followed by recovery pause.
 * 5. cadence-jitter-evasion: Advanced attack perturbing arrival jitter to test boundary limits of clustering.
 */

// Deterministic Mulberry32 PRNG for reproducible runs across any machine
export function createRng(seed = 42) {
  let s = Math.floor(seed);
  return function() {
    s |= 0; s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export const Scenarios = Object.freeze({
  SCENARIO_1_LEGITIMATE: 'legitimate-traffic',
  SCENARIO_2_IP_ROTATION: 'ip-rotation-attack',
  SCENARIO_3_SHARED_NAT: 'shared-nat-fairness',
  SCENARIO_4_BURST_RECOVERY: 'burst-recovery',
  SCENARIO_5_JITTER_EVASION: 'cadence-jitter-evasion'
});

export const ScenarioMetadata = {
  [Scenarios.SCENARIO_1_LEGITIMATE]: {
    id: Scenarios.SCENARIO_1_LEGITIMATE,
    name: 'Legitimate Human Workload',
    category: 'Baseline Validation',
    description: 'Natural spaced web requests from laptop and mobile devices with human-like inter-arrival delays.',
    expectedPolicyOutcome: 'All policies should exhibit 0% false positives, allowing steady token replenishment.'
  },
  [Scenarios.SCENARIO_2_IP_ROTATION]: {
    id: Scenarios.SCENARIO_2_IP_ROTATION,
    name: 'Scripted IP-Rotation Attack',
    category: 'Adversarial Evasion',
    description: 'High-frequency automated bot rotating source IP addresses on every request to evade conventional IP rate-limiting.',
    expectedPolicyOutcome: 'Policy A (IP) fails completely (100% bypass). Policy C (Behavioral) clusters arrival cadence and successfully mitigates the attack.'
  },
  [Scenarios.SCENARIO_3_SHARED_NAT]: {
    id: Scenarios.SCENARIO_3_SHARED_NAT,
    name: 'Shared NAT IP Multi-Client Fairness',
    category: 'False Positive Analysis',
    description: 'Three legitimate clients on a single public IP (e.g., student dorm or office NAT) making concurrent normal requests.',
    expectedPolicyOutcome: 'Policy A causes severe collateral damage (starving innocent clients). Policy C isolates cadences and maintains high throughput.'
  },
  [Scenarios.SCENARIO_4_BURST_RECOVERY]: {
    id: Scenarios.SCENARIO_4_BURST_RECOVERY,
    name: 'Burst Overload & Leaky Recovery',
    category: 'Rate Limiter Dynamics',
    description: 'Sharp microburst of 18 requests exceeding bucket capacity (10 tokens), followed by a 2-second recovery pause.',
    expectedPolicyOutcome: 'Demonstrates mathematically predicted token depletion and linear time-based replenishment at 2.0 tokens/second.'
  },
  [Scenarios.SCENARIO_5_JITTER_EVASION]: {
    id: Scenarios.SCENARIO_5_JITTER_EVASION,
    name: 'Cadence Jitter Evasion (Honest Limits)',
    category: 'Adversarial Boundary',
    description: 'Sophisticated attacker injecting randomized inter-arrival jitter (100-300ms) to evade behavioral clustering.',
    expectedPolicyOutcome: 'Demonstrates where behavioral clustering experiences signature drift and boundary limits, triggering fallback to IP protection.'
  }
};

/**
 * Generates an array of pre-computed synthetic request trace items with deterministic delays and ground truth labels.
 * 
 * Trace Item Schema:
 * {
 *   index: number,
 *   delayMs: number,
 *   simulatedIp: string,
 *   clientId: string,
 *   batteryLevel: number|null,
 *   charging: boolean|null,
 *   isMalicious: boolean,
 *   intendedDecision: 'ALLOW' | 'THROTTLE'
 * }
 */
export function generateScenarioTrace(scenarioId, { count = 30, seed = 1337 } = {}) {
  const rng = createRng(seed);
  const trace = [];

  switch (scenarioId) {
    case Scenarios.SCENARIO_1_LEGITIMATE: {
      const devices = [
        { id: 'laptop-workstation', ip: '192.168.1.42', battery: 85, charging: true },
        { id: 'phone-mobile', ip: '192.168.1.105', battery: 62, charging: false }
      ];
      for (let i = 0; i < count; i++) {
        const dev = devices[i % devices.length];
        // Human spacing: 600ms - 1200ms
        const delayMs = Math.round(600 + rng() * 600);
        trace.push({
          index: i + 1,
          delayMs,
          simulatedIp: dev.ip,
          clientId: dev.id,
          batteryLevel: dev.battery,
          charging: dev.charging,
          isMalicious: false,
          intendedDecision: 'ALLOW'
        });
      }
      break;
    }

    case Scenarios.SCENARIO_2_IP_ROTATION: {
      // High-speed bot rotating simulated IPs on every single request
      for (let i = 0; i < count; i++) {
        const rotatingIp = `198.51.100.${(i % 250) + 1}`;
        // Rigid scripted cadence: 35ms - 45ms
        const delayMs = Math.round(35 + rng() * 10);
        trace.push({
          index: i + 1,
          delayMs,
          simulatedIp: rotatingIp,
          clientId: `bot-instance-${(i % 5) + 1}`,
          batteryLevel: null,
          charging: null,
          isMalicious: true,
          intendedDecision: i < 10 ? 'ALLOW' : 'THROTTLE'
        });
      }
      break;
    }

    case Scenarios.SCENARIO_3_SHARED_NAT: {
      // 3 legitimate users behind single NAT IP 203.0.113.1
      const sharedIp = '203.0.113.1';
      const users = [
        { id: 'alice-terminal', battery: 90, charging: true, cadence: 250 },
        { id: 'bob-laptop', battery: 45, charging: false, cadence: 350 },
        { id: 'iot-sensor-hub', battery: 100, charging: true, cadence: 150 }
      ];
      for (let i = 0; i < count; i++) {
        const u = users[i % users.length];
        const delayMs = Math.round(u.cadence + (rng() * 40 - 20));
        trace.push({
          index: i + 1,
          delayMs,
          simulatedIp: sharedIp,
          clientId: u.id,
          batteryLevel: u.battery,
          charging: u.charging,
          isMalicious: false,
          intendedDecision: 'ALLOW'
        });
      }
      break;
    }

    case Scenarios.SCENARIO_4_BURST_RECOVERY: {
      // 18 requests at 10ms (burst), then 2000ms pause, then 6 requests
      const burstSize = 18;
      for (let i = 0; i < count; i++) {
        let delayMs = 15;
        if (i === burstSize) {
          delayMs = 2100; // Recovery pause
        }
        trace.push({
          index: i + 1,
          delayMs,
          simulatedIp: '10.0.0.50',
          clientId: 'burst-tester',
          batteryLevel: 75,
          charging: false,
          isMalicious: i < burstSize && i >= 10,
          intendedDecision: (i < 10 || i >= burstSize) ? 'ALLOW' : 'THROTTLE'
        });
      }
      break;
    }

    case Scenarios.SCENARIO_5_JITTER_EVASION: {
      // Attacker deliberately injecting variable delay 80ms - 400ms to break static quantization
      for (let i = 0; i < count; i++) {
        const delayMs = Math.round(80 + rng() * 320);
        trace.push({
          index: i + 1,
          delayMs,
          simulatedIp: `172.16.0.${(i % 15) + 1}`,
          clientId: 'jitter-evader',
          batteryLevel: Math.round(50 + rng() * 40),
          charging: rng() > 0.5,
          isMalicious: true,
          intendedDecision: 'THROTTLE'
        });
      }
      break;
    }

    default:
      throw new Error(`Unknown scenario ID: ${scenarioId}`);
  }

  return trace;
}
