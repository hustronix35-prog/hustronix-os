/**
 * Ingest the HSOG enterprise benchmark into the live Hustronix OS ledger.
 *
 *   npx tsx ops/scripts/hsog-ingest.ts --user spandan
 *   npx tsx ops/scripts/hsog-ingest.ts --user spandan --start-sprint
 *   npx tsx ops/scripts/hsog-ingest.ts --user spandan --dry-run
 *   npx tsx ops/scripts/hsog-ingest.ts --user spandan --no-activate --org-profile
 *
 * Bundle lookup: --bundle PATH | HSOG_EXPORT | HSOG_ROOT | ../hsog/orgforge/.../os_ingest.json
 */
import { db } from "../../apps/api/src/database.js";
import { auditor } from "../../apps/api/src/auditor.js";
import { ingestHsogBundle } from "../../apps/api/src/integrations/hsog/index.js";

db.setLedgerAuditorHook((ctx) => auditor.onWrite(ctx));

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i < 0) return undefined;
  const v = process.argv[i + 1];
  if (!v || v.startsWith("--")) return "";
  return v;
}

function has(flag: string): boolean {
  return process.argv.includes(flag);
}

async function main() {
  if (has("--help") || has("-h")) {
    console.log(`Usage: npx tsx ops/scripts/hsog-ingest.ts --user <username-or-id> [options]

Options:
  --bundle PATH          os_ingest.json or export/hustronix directory
  --activate SCENARIO    commit this scenario to ACTIVE (default: product_launch_slip)
  --no-activate          leave every decision DRAFT
  --no-decisions         signals + entities + roster only
  --no-enrich            skip heuristic intelligence pass
  --start-sprint         ACTIVE pending tasks under the ACTIVE vow (within capacity)
  --org-profile          write org.* settings from Hustronix Systems company profile
  --dry-run              parse bundle, write nothing
`);
    process.exit(0);
  }

  const userArg = arg("--user") || process.env.HSOG_TENANT_USER || "spandan";
  const user = db.getUser(userArg) || db.getUserById(userArg);
  if (!user) {
    console.error(`User not found: ${userArg}`);
    console.error("Pass --user <username> for the account you log into on os-ui.");
    process.exit(1);
  }

  const activateFlag = arg("--activate");
  const result = await ingestHsogBundle(arg("--bundle"), {
    userId: (user as { id: string }).id,
    decisions: !has("--no-decisions"),
    activateScenarioId: has("--no-activate") ? null : (activateFlag || "product_launch_slip"),
    enrich: !has("--no-enrich"),
    startSprint: has("--start-sprint"),
    orgProfile: has("--org-profile"),
    dryRun: has("--dry-run"),
  });

  console.log(JSON.stringify(result, null, 2));
  if (has("--dry-run")) {
    console.log("dry-run: nothing written");
    return;
  }
  console.log(`
Taste it:
  Home     http://localhost:3000/
  Decide   http://localhost:3000/decide
  Execute  http://localhost:3000/execute
  Alerts   http://localhost:3000/alerts
Logged in as ${(user as { username?: string }).username || result.userId}
`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
