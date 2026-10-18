import assert from "node:assert/strict";
import test from "node:test";
import { NoRouteError, edgeCost, minimumHopPath, pathEdges, twoNodeDisjointPaths, validateGraph, weightedPath, type GraphEdge } from "../src/index.ts";

const nodes = ["A", "B", "C", "D", "E"];

test("BFS chooses the deterministic minimum-hop route", () => {
  const edges = [{ a: "A", b: "B" }, { a: "B", b: "D" }, { a: "A", b: "C" }, { a: "C", b: "D" }];
  assert.deepEqual(minimumHopPath(nodes, edges, "A", "D"), ["A", "B", "D"]);
});

test("disabled edges are excluded and a missing route is explicit", () => {
  const edges: GraphEdge[] = [{ a: "A", b: "B", metrics: { disabled: true } }, { a: "B", b: "D" }];
  assert.throws(() => minimumHopPath(nodes, edges, "A", "D"), NoRouteError);
});

test("latency-aware Dijkstra can choose more hops", () => {
  const now = Date.now();
  const edges: GraphEdge[] = [
    { a: "A", b: "D", metrics: { rttMs: 400, measuredAt: now } },
    { a: "A", b: "B", metrics: { rttMs: 20, measuredAt: now } },
    { a: "B", b: "C", metrics: { rttMs: 20, measuredAt: now } },
    { a: "C", b: "D", metrics: { rttMs: 20, measuredAt: now } },
  ];
  assert.deepEqual(weightedPath(nodes, edges, "A", "D", "lowest-latency", now), ["A", "B", "C", "D"]);
});

test("adaptive cost penalizes loss and queue pressure", () => {
  const now = Date.now();
  const healthy = edgeCost({ a: "A", b: "B", metrics: { rttMs: 50, lossRatio: 0, queuedBytes: 0, measuredAt: now } }, "adaptive", now);
  const congested = edgeCost({ a: "A", b: "B", metrics: { rttMs: 50, lossRatio: .2, queuedBytes: 900_000, measuredAt: now } }, "adaptive", now);
  assert.ok(congested > healthy);
});

test("stale metrics receive a conservative cost", () => {
  const now = Date.now();
  const stale = edgeCost({ a: "A", b: "B", metrics: { rttMs: 1, lossRatio: 0, queuedBytes: 0, measuredAt: now - 60_000 } }, "adaptive", now);
  const fresh = edgeCost({ a: "A", b: "B", metrics: { rttMs: 50, lossRatio: 0, queuedBytes: 0, measuredAt: now } }, "adaptive", now);
  assert.ok(stale > fresh);
});

test("finds two internally node-disjoint paths when they exist", () => {
  const edges = [{ a: "A", b: "B" }, { a: "B", b: "D" }, { a: "A", b: "C" }, { a: "C", b: "D" }];
  assert.deepEqual(twoNodeDisjointPaths(nodes, edges, "A", "D"), [["A", "B", "D"], ["A", "C", "D"]]);
});

test("falls back honestly to one path when a second does not exist", () => {
  const edges = [{ a: "A", b: "B" }, { a: "B", b: "D" }];
  assert.deepEqual(twoNodeDisjointPaths(nodes, edges, "A", "D"), [["A", "B", "D"]]);
});

test("rejects malformed graphs and derives canonical path edges", () => {
  assert.throws(() => validateGraph(nodes, [{ a: "A", b: "A" }]), /distinct/);
  assert.throws(() => validateGraph(nodes, [{ a: "A", b: "B" }, { a: "B", b: "A" }]), /Duplicate/);
  assert.deepEqual(pathEdges(["C", "A", "B"]), ["A\u0000C", "A\u0000B"]);
});
