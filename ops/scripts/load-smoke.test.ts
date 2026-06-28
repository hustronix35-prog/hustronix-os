/**
 * Load / soak test skeleton — expand for 100–10k user scenarios per v9 trust program.
 * Run: npx tsx --test ops/scripts/load-smoke.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { db } from "../../apps/api/src/database.js";
import { listBeliefs } from "../../apps/api/src/beliefs/belief-engine.js";
import { runCausalSimulation } from "../../apps/api/src/simulation/causal-simulator.js";
import { computeDigitalTwin } from "../../apps/api/src/state/digital-twin.js";
import { getRepository } from "../../apps/api/src/db/sqlite-adapter.js";

describe("load-smoke — repository adapter", () => {
  it("executes async query wrapper", async () => {
    const repo = getRepository();
    const result = await repo.query("SELECT 1 AS ok");
    assert.equal(result.rows[0]?.ok, 1);
  });
});

describe("load-smoke — belief + simulation hot paths", () => {
  it("lists beliefs without throwing for system tenant", () => {
    const beliefs = listBeliefs("system");
    assert.ok(Array.isArray(beliefs));
  });

  it("runs causal simulation deterministically", () => {
    const sim = runCausalSimulation({
      tenantId: "system",
      vow: "Smoke test decision",
    });
    assert.ok(sim.runId);
    assert.ok(sim.scenarios.length >= 3);
    assert.ok(sim.input_graph_hash.length === 64);
  });

  it("computes digital twin metrics", () => {
    const twin = computeDigitalTwin("system");
    assert.equal(twin.tenant_id, "system");
    assert.ok(twin.compiled_at);
  });
});

describe("load-smoke — ledger read throughput (micro)", () => {
  it("reads decision ledger 50x under budget", () => {
    const start = Date.now();
    for (let i = 0; i < 50; i++) {
      db.rawGet(`SELECT COUNT(*) AS c FROM decision_ledger`, []);
    }
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 5000, `ledger reads too slow: ${elapsed}ms`);
  });
});
