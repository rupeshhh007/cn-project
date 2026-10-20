import assert from "node:assert/strict";
import test from "node:test";
import { transferPaths } from "../src/lib/experiment-paths.ts";

test("direct experiments retain their direct baseline even when relays are faster", () => {
  const now = Date.now();
  const edges = [["S", "T", 400], ["S", "A", 1], ["A", "T", 1], ["S", "B", 1], ["B", "T", 1]].map(([a, b, rttMs]) => ({ a: String(a), b: String(b), metrics: { rttMs: Number(rttMs), measuredAt: now } }));
  assert.deepEqual(transferPaths(["S", "T", "A", "B"], edges, "S", "T", "lowest-latency", "direct"), [["S", "T"]]);
  assert.equal(transferPaths(["S", "T", "A", "B"], edges, "S", "T", "lowest-latency", "multipath").length, 2);
});

test("a single-route baseline chooses its own optimum without optimizing a pair", () => {
  const now = Date.now();
  const edges = [["S", "A", 1], ["A", "B", 1], ["B", "T", 1], ["S", "C", 10], ["C", "B", 10], ["A", "D", 10], ["D", "T", 10]].map(([a, b, rttMs]) => ({ a: String(a), b: String(b), metrics: { rttMs: Number(rttMs), measuredAt: now } }));
  assert.deepEqual(transferPaths(["S", "A", "B", "C", "D", "T"], edges, "S", "T", "lowest-latency", "single-overlay"), [["S", "A", "B", "T"]]);
});
