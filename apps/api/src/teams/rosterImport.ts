import * as llm from "../llm.js";
import {
  ROSTER_FIELD_SCHEMA,
  type RosterDraftMember,
  type RosterFieldKey,
  type RosterParseResult,
} from "@hustronix/shared";

export { ROSTER_FIELD_SCHEMA };
export type { RosterDraftMember, RosterFieldKey, RosterParseResult };

function normHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[_\s]+/g, " ");
}

function mapHeaders(headers: string[]): Partial<Record<RosterFieldKey, number>> {
  const normalized = headers.map(normHeader);
  const out: Partial<Record<RosterFieldKey, number>> = {};
  for (const spec of ROSTER_FIELD_SCHEMA) {
    for (let i = 0; i < normalized.length; i++) {
      const h = normalized[i]!;
      if (spec.aliases.some((a) => h === a || h.includes(a))) {
        if (out[spec.key] === undefined) out[spec.key] = i;
        break;
      }
    }
  }
  return out;
}

function cell(row: string[], idx: number | undefined): string {
  if (idx === undefined || idx < 0) return "";
  return String(row[idx] ?? "").trim();
}

function validateDraft(m: RosterDraftMember): string[] {
  const issues: string[] = [];
  if (!m.name) issues.push("Name is required");
  if (!m.email) issues.push("Email is required");
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.email)) issues.push("Email format looks invalid");
  return issues;
}

export function rowsToRosterMembers(headers: string[], rows: string[][]): RosterParseResult {
  const col = mapHeaders(headers);
  const columnMapping: Partial<Record<RosterFieldKey, string>> = {};
  for (const spec of ROSTER_FIELD_SCHEMA) {
    const idx = col[spec.key];
    if (idx !== undefined && headers[idx]) columnMapping[spec.key] = headers[idx];
  }

  const warnings: string[] = [];
  if (col.name === undefined) warnings.push('No "name" column detected — check header row.');
  if (col.email === undefined) warnings.push('No "email" column detected — check header row.');

  const members: RosterDraftMember[] = [];
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]!;
    const allEmpty = row.every((c) => !String(c ?? "").trim());
    if (allEmpty) continue;

    const draft: RosterDraftMember = {
      name: cell(row, col.name),
      email: cell(row, col.email).toLowerCase(),
      role: cell(row, col.role) || "Member",
      team: cell(row, col.team) || "General",
      capacity: cell(row, col.capacity) || "40h / week",
      slackId: cell(row, col.slackId) || undefined,
      talentTier: cell(row, col.talentTier) || undefined,
      sourceRow: r + 2,
    };
    draft.issues = validateDraft(draft);
    if (draft.name || draft.email) members.push(draft);
  }

  return {
    members,
    columnMapping,
    detectedHeaders: headers,
    warnings,
    method: "heuristic",
  };
}

async function extractRosterWithLlm(userId: string, text: string): Promise<RosterDraftMember[]> {
  const schemaHint = ROSTER_FIELD_SCHEMA.map((f) =>
    `${f.key}${f.required ? " (required)" : ""}: ${f.description}`,
  ).join("\n");

  const prompt = `Extract team roster rows from this document text. Return ONLY a JSON array (no markdown).
Each object must use these keys: name, email, role, team, capacity, slackId, talentTier.
Required: name, email. Use defaults: role "Member", team "General", capacity "40h / week" when missing.
Omit slackId/talentTier when unknown.

Field guide:
${schemaHint}

Document:
---
${text.slice(0, 48_000)}
---`;

  const res = await llm.chat(
    userId,
    [{ role: "user", content: prompt }],
    [],
    undefined,
    { modelTier: "fast" },
  );

  const raw = res.text.trim();
  const jsonStart = raw.indexOf("[");
  const jsonEnd = raw.lastIndexOf("]");
  if (jsonStart < 0 || jsonEnd <= jsonStart) {
    throw new Error("LLM did not return a JSON array");
  }
  const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as unknown;
  if (!Array.isArray(parsed)) throw new Error("LLM output is not an array");

  const members: RosterDraftMember[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const draft: RosterDraftMember = {
      name: String(o.name ?? "").trim(),
      email: String(o.email ?? "").trim().toLowerCase(),
      role: String(o.role ?? "Member").trim() || "Member",
      team: String(o.team ?? "General").trim() || "General",
      capacity: String(o.capacity ?? "40h / week").trim() || "40h / week",
      slackId: o.slackId ? String(o.slackId).trim() : undefined,
      talentTier: o.talentTier ? String(o.talentTier).trim() : undefined,
    };
    draft.issues = validateDraft(draft);
    if (draft.name || draft.email) members.push(draft);
  }
  return members;
}

export async function extractTextFromPdfBuffer(buf: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buf });
  try {
    const textResult = await parser.getText();
    return String(textResult.text || "").trim();
  } finally {
    await parser.destroy();
  }
}

export async function parsePdfTextToRoster(userId: string, text: string): Promise<RosterParseResult> {
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      members: [],
      columnMapping: {},
      detectedHeaders: [],
      warnings: ["PDF contained no extractable text."],
      method: "heuristic",
    };
  }

  if (llm.hasLlmCredentials(userId)) {
    try {
      const members = await extractRosterWithLlm(userId, trimmed);
      if (members.length > 0) {
        return {
          members,
          columnMapping: {},
          detectedHeaders: [],
          warnings: [],
          method: "llm",
        };
      }
    } catch (err) {
      console.warn("[rosterImport] LLM PDF extraction failed:", err);
    }
  }

  /** Fallback: line-based table (tab or comma separated). */
  const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) {
    return {
      members: [],
      columnMapping: {},
      detectedHeaders: [],
      warnings: ["Could not parse PDF as a table. Configure an LLM key for unstructured rosters."],
      method: "heuristic",
    };
  }
  const delim = lines[0]!.includes("\t") ? "\t" : lines[0]!.includes(",") ? "," : null;
  if (!delim) {
    return {
      members: [],
      columnMapping: {},
      detectedHeaders: [],
      warnings: ["PDF text is not tabular. Configure an LLM key to extract roster rows."],
      method: "heuristic",
    };
  }
  const rows = lines.map((l) => l.split(delim).map((c) => c.trim()));
  const headers = rows[0]!;
  return rowsToRosterMembers(headers, rows.slice(1));
}
