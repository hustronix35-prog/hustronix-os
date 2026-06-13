import { config } from "./config.js";
import { db } from "./database.js";

function sliceText(s: string, max: number): string {
  const t = s.trim();
  if (!t) return "";
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

/** Rebuild digest from stored `org.*` keys when precomputed blobs are missing. */
function buildDigestFromSettings(settings: Record<string, string>): string {
  const orgName = settings["org.name"]?.trim() ?? "";
  const oneLiner = settings["org.value_prop_one_liner"]?.trim() ?? "";
  const icp = settings["org.icp_summary"]?.trim() ?? "";
  const northStar = settings["org.north_star_90d"]?.trim() ?? "";
  if (!orgName && !oneLiner && !icp && !northStar) return "";

  const lines: string[] = [];
  if (orgName) lines.push(`Organization name: ${orgName}`);
  if (oneLiner) lines.push(`What they do: ${oneLiner}`);
  if (icp) lines.push(`Ideal customer / ICP: ${icp}`);
  if (northStar) lines.push(`90-day north star: ${northStar}`);

  const decisionStyle = settings["org.decision_style"]?.trim();
  if (decisionStyle) lines.push(`Decision style: ${decisionStyle}`);
  const decisionNotes = settings["org.decision_style_notes"]?.trim();
  if (decisionNotes) lines.push(`How decisions really get made: ${decisionNotes}`);

  const teamBand = settings["org.team_size_band"]?.trim();
  if (teamBand) lines.push(`Team size band: ${teamBand}`);
  const stage = settings["org.company_stage"]?.trim();
  if (stage) lines.push(`Stage: ${stage}`);

  const pain = settings["org.top_operational_pain"]?.trim();
  if (pain) lines.push(`Top operational pain: ${pain}`);
  const landscape = settings["org.competitive_landscape"]?.trim();
  if (landscape) lines.push(`Competitive landscape: ${landscape}`);
  const stack = settings["org.stack_snapshot"]?.trim();
  if (stack) lines.push(`Tools & systems: ${stack}`);
  const constraints = settings["org.constraints_notes"]?.trim();
  if (constraints) lines.push(`Constraints / governance: ${constraints}`);

  return lines.join("\n");
}

function loadOrgSettings(userId: string): Record<string, string> {
  const rows = db.rawGet(
    `SELECT key, value FROM settings WHERE user_id = ? AND key LIKE 'org.%'`,
    [userId],
  ) as { key: string; value: string }[];
  const out: Record<string, string> = {};
  for (const row of rows) {
    if (row?.key) out[row.key] = String(row.value ?? "");
  }
  return out;
}

/**
 * Company profile from onboarding / Profile → Company context.
 * Used in Chat coordinator system prompt (not ledger decisions).
 */
export function loadOrganizationContextForPrompt(userId: string): string | null {
  if (!userId || userId === "system") return null;

  const maxChars = config.agent.orgContextPromptMaxChars;

  const fromCore = db.getCoreMemory(userId, "organization")?.trim();
  if (fromCore) return sliceText(fromCore, maxChars);

  const digest = db.getSetting(userId, "org.agent_context_digest")?.trim();
  if (digest) return sliceText(digest, maxChars);

  const settings = loadOrgSettings(userId);
  const rebuilt = buildDigestFromSettings(settings);
  if (rebuilt) return sliceText(rebuilt, maxChars);

  return null;
}

export function formatOrganizationContextBlock(userId: string): string {
  const body = loadOrganizationContextForPrompt(userId);
  if (!body) return "";
  return `
### Organization profile (onboarding / company context)
Treat this block as canonical when the user asks what you know about their company, ICP, goals, or how they decide. Do not claim you lack company context while this section is present.
${body}
`;
}
