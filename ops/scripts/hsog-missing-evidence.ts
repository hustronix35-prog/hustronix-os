/**
 * One-shot: explain unattached HSOG artifacts on the last intelligence tenant.
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";
import { db } from "../../apps/api/src/database.js";
import { repoRoot } from "../../apps/api/src/config.js";
import type { HsogGroundTruth } from "../../apps/api/src/integrations/hsog/customerPathCorpus.js";
import { investigateMissingEvidence } from "../../apps/api/src/integrations/hsog/evidenceMiss.js";

const user = db.getUser("hsog_cust_intel") as { id: string } | undefined;
if (!user) {
  console.error("No hsog_cust_intel tenant — run npm run hsog:customer-path:intelligence first.");
  process.exit(1);
}
const gtPath = resolve(repoRoot, "data/hsog/ground_truth.json");
const groundTruth = JSON.parse(readFileSync(gtPath, "utf8")) as HsogGroundTruth;
console.log(`GT scenarios: ${groundTruth.scenarios.map((s) => s.id).join(", ")}`);
console.log(`GT artifacts: ${groundTruth.artifacts.length}`);
const miss = investigateMissingEvidence(user.id, groundTruth, [
  "infrastructure_outage",
  "feature_quality_regression",
  "security_incident",
]);
console.log(miss.markdown);
const docsOut = resolve(repoRoot, "docs", "hsog");
mkdirSync(docsOut, { recursive: true });
writeFileSync(resolve(docsOut, "hsog-missing-evidence.md"), miss.markdown + "\n");
writeFileSync(
  resolve(repoRoot, "data", "hsog-missing-evidence.json"),
  JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      user_id: user.id,
      by_scenario: miss.by_scenario.map((s) => ({
        scenario_id: s.scenario_id,
        title: s.title,
        missing: s.missing,
        total: s.total,
        hit_rate: s.hit_rate,
        classes: {
          architectural: s.rows.filter((r) => r.class === "architectural").length,
          off_facet: s.rows.filter((r) => r.class === "off_facet").length,
          ambiguous: s.rows.filter((r) => r.class === "ambiguous").length,
          not_ingested: s.rows.filter((r) => r.class === "not_ingested").length,
        },
        rows: s.rows,
      })),
    },
    null,
    2,
  ),
);
console.log("Wrote docs/hsog/hsog-missing-evidence.md");
