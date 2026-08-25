import { layoutRing, recsFromDecisions } from "./summary.js";

const ring3 = layoutRing(3, 50, 50, 10);
if (ring3.length !== 3) throw new Error("layoutRing(3) size");
if (ring3[0].x !== 50 || ring3[0].y !== 40) throw new Error(`layoutRing first point ${JSON.stringify(ring3[0])}`);

const recs = recsFromDecisions([
  { id: "a", vow: "Ship v1", status: "DRAFT", confidence: 0.8, expected_outcomes: null, decision_reasoning: "Need commit" },
  { id: "b", vow: "Active bet", status: "ACTIVE", confidence: 0.4, expected_outcomes: null, decision_reasoning: null },
]);
if (recs.length !== 1 || recs[0].id !== "a" || recs[0].confidence !== 80) {
  throw new Error(`recsFromDecisions ${JSON.stringify(recs)}`);
}

const none = recsFromDecisions([]);
if (none.length !== 0) throw new Error("empty recs");

console.log("brain/summary.check ok");
