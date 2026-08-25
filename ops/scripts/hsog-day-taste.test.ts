/**
 * Smoke for day-taste helpers. Full chronological run: npm run hsog:day-taste
 *   npx tsx --test ops/scripts/hsog-day-taste.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadHsogBundle } from "../../apps/api/src/integrations/hsog/loadBundle.js";
import { eventsForDay } from "../../apps/api/src/integrations/hsog/daySim.js";

describe("HSOG day taste helpers", () => {
  it("filters events by sim day", () => {
    const { bundle } = loadHsogBundle("");
    const d84 = eventsForDay(bundle, 84);
    assert.ok(d84.length >= 1);
    assert.ok(d84.every((e) => e.day === 84));
    assert.ok(d84.some((e) => e.event_type === "launch_gate_failed" || e.event_type === "incident_declared"));
  });

  it("covers ~3 months of event days by day 90", () => {
    const { bundle } = loadHsogBundle("");
    const days = [...new Set((bundle.events || []).filter((e) => e.day <= 90).map((e) => e.day))];
    assert.ok(days.length >= 20, `expected ≥20 event days by d90, got ${days.length}`);
    assert.ok((bundle.max_days || 0) >= 90);
  });
});
