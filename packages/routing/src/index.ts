export type NodeId = string;

export type EdgeMetrics = {
  rttMs?: number;
  lossRatio?: number;
  queuedBytes?: number;
  measuredAt?: number;
  disabled?: boolean;
};

export type GraphEdge = {
  a: NodeId;
  b: NodeId;
  metrics?: EdgeMetrics;
};

export type RouteStrategy = "minimum-hops" | "lowest-latency" | "adaptive";

export type AdaptiveWeights = {
  rtt: number;
  loss: number;
  queue: number;
  hop: number;
  staleAfterMs: number;
};

export const defaultAdaptiveWeights: AdaptiveWeights = {
  rtt: 0.4,
  loss: 0.3,
  queue: 0.2,
  hop: 0.1,
  staleAfterMs: 15_000,
};

export class NoRouteError extends Error {
  constructor(source: NodeId, destination: NodeId) {
    super(`No enabled route from ${source} to ${destination}.`);
    this.name = "NoRouteError";
  }
}

export function canonicalEdge(a: NodeId, b: NodeId): string {
  if (!a || !b || a === b) throw new Error("An overlay edge requires two distinct node IDs.");
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

export function validateGraph(nodes: Iterable<NodeId>, edges: readonly GraphEdge[]): void {
  const nodeSet = new Set(nodes);
  const seen = new Set<string>();
  for (const edge of edges) {
    if (!nodeSet.has(edge.a) || !nodeSet.has(edge.b)) throw new Error("Every edge endpoint must exist in the graph.");
    const key = canonicalEdge(edge.a, edge.b);
    if (seen.has(key)) throw new Error("Duplicate undirected overlay edge.");
    seen.add(key);
    if (edge.metrics?.lossRatio !== undefined && (edge.metrics.lossRatio < 0 || edge.metrics.lossRatio > 1)) throw new Error("Loss ratio must be in [0, 1].");
    if (edge.metrics?.rttMs !== undefined && edge.metrics.rttMs < 0) throw new Error("RTT cannot be negative.");
    if (edge.metrics?.queuedBytes !== undefined && edge.metrics.queuedBytes < 0) throw new Error("Queued bytes cannot be negative.");
  }
}

function adjacency(nodes: Iterable<NodeId>, edges: readonly GraphEdge[]): Map<NodeId, Array<{ node: NodeId; edge: GraphEdge }>> {
  const result = new Map<NodeId, Array<{ node: NodeId; edge: GraphEdge }>>();
  for (const node of nodes) result.set(node, []);
  for (const edge of edges) {
    if (edge.metrics?.disabled) continue;
    result.get(edge.a)?.push({ node: edge.b, edge });
    result.get(edge.b)?.push({ node: edge.a, edge });
  }
  for (const neighbours of result.values()) neighbours.sort((left, right) => left.node.localeCompare(right.node));
  return result;
}

export function minimumHopPath(nodes: Iterable<NodeId>, edges: readonly GraphEdge[], source: NodeId, destination: NodeId): NodeId[] {
  const nodeList = [...nodes];
  validateGraph(nodeList, edges);
  if (!nodeList.includes(source) || !nodeList.includes(destination)) throw new NoRouteError(source, destination);
  if (source === destination) return [source];
  const graph = adjacency(nodeList, edges);
  const previous = new Map<NodeId, NodeId>();
  const visited = new Set<NodeId>([source]);
  const queue = [source];
  while (queue.length) {
    const current = queue.shift()!;
    for (const neighbour of graph.get(current) ?? []) {
      if (visited.has(neighbour.node)) continue;
      visited.add(neighbour.node);
      previous.set(neighbour.node, current);
      if (neighbour.node === destination) return reconstruct(previous, source, destination);
      queue.push(neighbour.node);
    }
  }
  throw new NoRouteError(source, destination);
}

function reconstruct(previous: Map<NodeId, NodeId>, source: NodeId, destination: NodeId): NodeId[] {
  const path = [destination];
  let current = destination;
  while (current !== source) {
    const parent = previous.get(current);
    if (!parent) throw new NoRouteError(source, destination);
    path.unshift(parent);
    current = parent;
  }
  return path;
}

function normalized(value: number | undefined, ceiling: number): number {
  if (value === undefined || !Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(1, value / ceiling));
}

export function edgeCost(edge: GraphEdge, strategy: Exclude<RouteStrategy, "minimum-hops">, now = Date.now(), weights = defaultAdaptiveWeights): number {
  if (edge.metrics?.disabled) return Number.POSITIVE_INFINITY;
  const stale = edge.metrics?.measuredAt === undefined || now - edge.metrics.measuredAt > weights.staleAfterMs;
  const rtt = stale ? 1 : normalized(edge.metrics?.rttMs, 500);
  if (strategy === "lowest-latency") return rtt;
  const loss = stale ? 1 : normalized(edge.metrics?.lossRatio, 0.25);
  const queue = stale ? 1 : normalized(edge.metrics?.queuedBytes, 1_048_576);
  return weights.rtt * rtt + weights.loss * loss + weights.queue * queue + weights.hop;
}

export function weightedPath(nodes: Iterable<NodeId>, edges: readonly GraphEdge[], source: NodeId, destination: NodeId, strategy: Exclude<RouteStrategy, "minimum-hops">, now = Date.now(), weights = defaultAdaptiveWeights): NodeId[] {
  const nodeList = [...nodes];
  validateGraph(nodeList, edges);
  if (!nodeList.includes(source) || !nodeList.includes(destination)) throw new NoRouteError(source, destination);
  if (source === destination) return [source];
  const graph = adjacency(nodeList, edges);
  const distance = new Map(nodeList.map((node) => [node, node === source ? 0 : Number.POSITIVE_INFINITY]));
  const previous = new Map<NodeId, NodeId>();
  const remaining = new Set(nodeList);
  while (remaining.size) {
    const current = [...remaining].sort((a, b) => (distance.get(a)! - distance.get(b)!) || a.localeCompare(b))[0];
    remaining.delete(current);
    const currentDistance = distance.get(current)!;
    if (!Number.isFinite(currentDistance)) break;
    if (current === destination) return reconstruct(previous, source, destination);
    for (const neighbour of graph.get(current) ?? []) {
      if (!remaining.has(neighbour.node)) continue;
      const candidate = currentDistance + edgeCost(neighbour.edge, strategy, now, weights);
      if (candidate < distance.get(neighbour.node)!) {
        distance.set(neighbour.node, candidate);
        previous.set(neighbour.node, current);
      }
    }
  }
  throw new NoRouteError(source, destination);
}

export function selectPath(nodes: Iterable<NodeId>, edges: readonly GraphEdge[], source: NodeId, destination: NodeId, strategy: RouteStrategy, now = Date.now()): NodeId[] {
  return strategy === "minimum-hops" ? minimumHopPath(nodes, edges, source, destination) : weightedPath(nodes, edges, source, destination, strategy, now);
}

export function twoNodeDisjointPaths(nodes: Iterable<NodeId>, edges: readonly GraphEdge[], source: NodeId, destination: NodeId, strategy: RouteStrategy = "minimum-hops", now = Date.now()): NodeId[][] {
  const nodeList = [...nodes];
  const first = selectPath(nodeList, edges, source, destination, strategy, now);
  const blocked = new Set(first.slice(1, -1));
  const remainingNodes = nodeList.filter((node) => !blocked.has(node));
  const remainingEdges = edges.filter((edge) => !blocked.has(edge.a) && !blocked.has(edge.b));
  try {
    return [first, selectPath(remainingNodes, remainingEdges, source, destination, strategy, now)];
  } catch (error) {
    if (error instanceof NoRouteError) return [first];
    throw error;
  }
}

export function pathEdges(path: readonly NodeId[]): string[] {
  const result: string[] = [];
  for (let index = 1; index < path.length; index += 1) result.push(canonicalEdge(path[index - 1], path[index]));
  return result;
}
