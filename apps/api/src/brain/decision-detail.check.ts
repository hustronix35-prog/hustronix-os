import { healthFromExec, progressFromExec, slugifyVow } from "./decision-detail.js";

if (slugifyVow("Hold NexusAI 2.0 GA") !== "hold-nexusai-2-0-ga") {
  throw new Error(`slugify ${slugifyVow("Hold NexusAI 2.0 GA")}`);
}
if (progressFromExec({ total: 0, done: 0 }) !== 0) throw new Error("progress empty");
if (progressFromExec({ total: 4, done: 1 }) !== 25) throw new Error("progress 25");
if (healthFromExec({ total: 0, done: 0, active: 0, pending: 0, blocked: 0 }, 80) !== 80) {
  throw new Error("health fallback confidence");
}
const h = healthFromExec({ total: 4, done: 1, active: 1, pending: 0, blocked: 2 }, 90);
if (h >= 90) throw new Error(`blocked should lower health, got ${h}`);
console.log("brain/decision-detail.check ok");
