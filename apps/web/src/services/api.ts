import { DecisionEvent, GatewayOverview, PolicyMode } from '../types';

export class SentinelApi {
  private static eventSource: EventSource | null = null;

  static async getOverview(): Promise<GatewayOverview> {
    const res = await fetch('/api/overview');
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching overview`);
    return res.json();
  }

  static async setPolicy(policyMode: PolicyMode): Promise<{ status: string; activePolicy: PolicyMode }> {
    const res = await fetch('/api/policy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ policyMode })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} updating policy`);
    return res.json();
  }

  static async resetGateway(): Promise<{ status: string }> {
    const res = await fetch('/api/reset', { method: 'POST' });
    if (!res.ok) throw new Error(`HTTP ${res.status} resetting gateway`);
    return res.json();
  }

  static async sendTestRequest(params: {
    path?: string;
    method?: string;
    simulatedIp?: string;
    clientId?: string;
    batteryLevel?: number;
    charging?: boolean;
  }): Promise<{ status: number; decision: string; body: any; headers: Record<string, string> }> {
    const targetPath = `/protected${params.path || '/api/data'}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    if (params.simulatedIp) headers['X-Demo-IP'] = params.simulatedIp;
    if (params.clientId) headers['X-Client-ID'] = params.clientId;
    if (params.batteryLevel !== undefined) headers['X-Telemetry-Battery'] = String(params.batteryLevel);
    if (params.charging !== undefined) headers['X-Telemetry-Charging'] = String(params.charging);

    const res = await fetch(targetPath, {
      method: params.method || 'GET',
      headers
    });

    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }

    const resHeaders: Record<string, string> = {};
    res.headers.forEach((val, key) => {
      resHeaders[key] = val;
    });

    return {
      status: res.status,
      decision: res.headers.get('x-sentinel-decision') || (res.status === 200 ? 'ALLOW' : 'THROTTLE'),
      body,
      headers: resHeaders
    };
  }

  static subscribeToEvents(onEvent: (event: DecisionEvent) => void, onError?: (err: any) => void): () => void {
    if (this.eventSource) {
      this.eventSource.close();
    }

    const es = new EventSource('/api/events');
    this.eventSource = es;

    es.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data) as DecisionEvent;
        onEvent(data);
      } catch (err) {
        // SSE control frames (like :keepalive or comments) are safely ignored
      }
    };

    es.onerror = (err) => {
      if (onError) onError(err);
    };

    return () => {
      es.close();
      if (this.eventSource === es) {
        this.eventSource = null;
      }
    };
  }
}
