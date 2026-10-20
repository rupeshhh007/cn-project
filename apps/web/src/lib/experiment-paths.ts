import { canonicalEdge, selectPath, twoNodeDisjointPaths, type GraphEdge, type RouteStrategy } from "@hopnet/routing";
import type { ExperimentConfig } from "./evidence.ts";

export function transferPaths(nodes: string[], edges: GraphEdge[], source: string, destination: string, strategy: RouteStrategy, mode?: ExperimentConfig["mode"]): string[][] {
  if (mode === "direct") return edges.some((edge) => canonicalEdge(edge.a, edge.b) === canonicalEdge(source, destination) && !edge.metrics?.disabled) ? [[source, destination]] : [];
  const eligible = mode ? edges.filter((edge) => canonicalEdge(edge.a, edge.b) !== canonicalEdge(source, destination)) : edges;
  return mode === "single-overlay" ? [selectPath(nodes, eligible, source, destination, strategy)] : twoNodeDisjointPaths(nodes, eligible, source, destination, strategy);
}
