/**
 * Export dual HSOG corpus:
 *   data/hsog/ground_truth.json     — evaluator only (never ingest)
 *   data/hsog/os_ingest_blind.json  — customer-shaped input
 *
 *   npm run hsog:export-blind
 */
import { loadHsogBundle } from "../../apps/api/src/integrations/hsog/loadBundle.js";
import { exportDualCorpus, defaultHsogDataDir } from "../../apps/api/src/integrations/hsog/customerPathCorpus.js";
import { repoRoot } from "../../apps/api/src/config.js";

const { path: sourcePath, bundle } = loadHsogBundle(process.argv.includes("--bundle")
  ? process.argv[process.argv.indexOf("--bundle") + 1] || ""
  : "");
const outDir = defaultHsogDataDir(repoRoot);
const { groundTruthPath, blindPath, groundTruth, blind } = exportDualCorpus(bundle, sourcePath, outDir);

console.log(`Source: ${sourcePath}`);
console.log(`Ground truth: ${groundTruthPath} (${groundTruth.scenarios.length} scenarios, ${groundTruth.artifacts.length} artifacts)`);
console.log(`Blind input:  ${blindPath} (${blind.artifacts.length} artifacts)`);
console.log(`Sample blind artifact:\n${JSON.stringify(blind.artifacts[0], null, 2)}`);
