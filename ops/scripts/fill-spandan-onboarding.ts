/**
 * Fill onboarding for local user `spandan` and mark complete.
 * Usage: npx tsx ops/scripts/fill-spandan-onboarding.ts
 */
import { db } from "../../apps/api/src/database.js";

const username = process.argv[2]?.trim() || "spandan";
const user = db.getUser(username) as { id: string } | undefined;
if (!user) {
  console.error(`User not found: ${username}`);
  process.exit(1);
}
const userId = user.id;

const digest = [
  "Organization name: Hustronix",
  "What they do: Decision intelligence and execution system that helps organizations think, decide, and execute with shared context.",
  "Ideal customer / ICP: Founder-led B2B SaaS and mid-market operators (11-200 people) who lose decision context across Slack, CRM, and project tools and need an executive OS.",
  "90-day north star: Ship a reliable Company Brain + Decide + Execute loop used daily by the founding team, with live ledger and authenticated onboarding.",
  "Decision style: founder_led",
  "How decisions really get made: Founder (Spandan) owns final calls; eng and product input on capacity and risk; large bets get a short written vow before activation.",
  "Team size band: 1-10",
  "Stage: early",
  "Top operational pain: Context scatters across tools; decisions get re-litigated; execution status is unclear without a single ledger.",
  "Competitive landscape: Generic AI chat copilots and project tools lack enforced decision/execution ledgers; Hustronix competes on organizational memory and commit discipline.",
  "Tools & systems: GitHub, Slack, Google Calendar/Gmail, Notion, Next.js, Node/Express, SQLite",
  "Constraints / governance: Early-stage budget; prefer local-first SQLite; cookie session auth; cost-saver LLM defaults.",
].join("\n");

const patch: Record<string, string> = {
  "org.owner_user_id": userId,
  "org.role": "owner",
  "org.onboarding.completed": "1",
  "org.name": "Hustronix",
  "org.value_prop_one_liner":
    "Decision intelligence and execution system that helps organizations think, decide, and execute with shared context.",
  "org.icp_summary":
    "Founder-led B2B SaaS and mid-market operators (11-200 people) who lose decision context across Slack, CRM, and project tools and need an executive OS.",
  "org.north_star_90d":
    "Ship a reliable Company Brain + Decide + Execute loop used daily by the founding team, with live ledger and authenticated onboarding.",
  "org.decision_style": "founder_led",
  "org.decision_style_notes":
    "Founder (Spandan) owns final calls; eng and product input on capacity and risk; large bets get a short written vow before activation.",
  "org.team_size_band": "1-10",
  "org.company_stage": "early",
  "org.top_operational_pain":
    "Context scatters across tools; decisions get re-litigated; execution status is unclear without a single ledger.",
  "org.competitive_landscape":
    "Generic AI chat copilots and project tools lack enforced decision/execution ledgers; Hustronix competes on organizational memory and commit discipline.",
  "org.stack_snapshot":
    "GitHub, Slack, Google Calendar/Gmail, Notion, Next.js, Node/Express, SQLite",
  "org.constraints_notes":
    "Early-stage budget; prefer local-first SQLite; cookie session auth; cost-saver LLM defaults.",
  "org.agent_context_digest": digest,
  "profile.display_name": "Spandan Patil",
  "profile.role_title": "CEO / Founder",
};

for (const [k, v] of Object.entries(patch)) {
  db.updateSetting(userId, k, v);
}
db.updateCoreMemory(userId, "organization", digest.slice(0, 4000));

console.log(`Saved onboarding for ${username} (${userId})`);
console.log(`  completed = ${db.getSetting(userId, "org.onboarding.completed")}`);
console.log(`  org       = ${db.getSetting(userId, "org.name")}`);
console.log(`  role      = ${db.getSetting(userId, "org.role")}`);
console.log(`  stage     = ${db.getSetting(userId, "org.company_stage")}`);
console.log(`  style     = ${db.getSetting(userId, "org.decision_style")}`);
console.log(`  display   = ${db.getSetting(userId, "profile.display_name")}`);
