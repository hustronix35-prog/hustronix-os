/**
 * Infer cross-team dependencies from signal language (not seeded playbooks).
 */
import { v4 as uuidv4 } from "uuid";
import { db } from "../database.js";

const TEAM_ALIASES: Array<{ re: RegExp; team: string }> = [
  { re: /\bfinance\b/i, team: "finance" },
  { re: /\bengineering\b|\bbackend\b|\bsre\b/i, team: "engineering" },
  { re: /\bsecurity\b|\bgrc\b/i, team: "security" },
  { re: /\bcustomer success\b|\bcs\b/i, team: "customer success" },
  { re: /\bsales\b|\bcro\b/i, team: "sales" },
  { re: /\bproduct\b/i, team: "product" },
  { re: /\bsupport\b/i, team: "support" },
  { re: /\bhr\b|\bhris\b|hiring/i, team: "hr ops" },
  { re: /\blegal\b/i, team: "legal" },
  { re: /\bqa\b/i, team: "qa support" },
  { re: /\bexec(?:utive)?\b|\bcfo\b|\bceo\b/i, team: "executive" },
];

function detectTeams(text: string): string[] {
  const hits: string[] = [];
  for (const a of TEAM_ALIASES) {
    if (a.re.test(text) && !hits.includes(a.team)) hits.push(a.team);
  }
  return hits;
}

export type InferredDep = {
  fromTeam: string;
  toTeam: string;
  fromWork: string;
  status: "AT_RISK" | "DELAYED" | "ON_TRACK";
  edgeType?: "waits_on" | "handoff" | "blocks";
  confidence?: number;
  evidence?: string[];
  situationId?: string | null;
  toWork?: string;
};

/**
 * Parse blocker / waiting-on / handoff language into directed team deps.
 */
export function inferDependenciesFromText(content: string): InferredDep[] {
  const text = String(content || "");
  const lower = text.toLowerCase();
  const teams = detectTeams(text);
  const out: InferredDep[] = [];

  const waiting =
    /waiting\s+(?:on|for)\s+([a-z\s]+?)(?:\.|,|;|$)/i.exec(text) ||
    /blocked\s+by\s+([a-z\s]+?)(?:\.|,|;|$)/i.exec(text) ||
    /needs?\s+([a-z\s]+?)\s+from\s+([a-z\s]+?)(?:\.|,|;|$)/i.exec(text) ||
    /exception\s+is\s+needed\s+for\s+/i.test(lower)
      ? { kind: "exception" as const }
      : null;

  if (/waiting\s+(?:on|for)/i.test(text) || /blocked\s+by/i.test(text)) {
    const m =
      /waiting\s+(?:on|for)\s+([^.,;]+)/i.exec(text) || /blocked\s+by\s+([^.,;]+)/i.exec(text);
    const targetBlob = m?.[1] || "";
    const toTeams = detectTeams(targetBlob);
    const fromTeams = teams.filter((t) => !toTeams.includes(t));
    const to = toTeams[0] || detectTeams(targetBlob + " finance engineering security")[0];
    const from = fromTeams[0] || teams[0] || "engineering";
    if (to && from && to !== from) {
      out.push({
        fromTeam: from,
        toTeam: to,
        fromWork: `Waiting: ${targetBlob.trim().slice(0, 80)}`,
        status: "DELAYED",
        edgeType: "waits_on",
        confidence: 0.7,
      });
    }
  }

  if (/exception\s+is\s+needed|requests?\s+exception|requires?\s+exception/i.test(text)) {
    const from = teams.includes("engineering")
      ? "engineering"
      : teams.includes("security")
        ? "security"
        : teams[0] || "engineering";
    const to = teams.includes("finance")
      ? "finance"
      : teams.includes("executive")
        ? "executive"
        : teams.includes("security") && from !== "security"
          ? "security"
          : "executive";
    if (from !== to) {
      out.push({
        fromTeam: from,
        toTeam: to,
        fromWork: "Exception / approval required",
        status: "AT_RISK",
        edgeType: "blocks",
        confidence: 0.7,
      });
    }
  }

  if (/handoff|depends on|dependency|blocked until/i.test(text) && teams.length >= 2) {
    out.push({
      fromTeam: teams[0],
      toTeam: teams[1],
      fromWork: "Cross-team dependency mentioned",
      status: "AT_RISK",
      edgeType: "handoff",
      confidence: 0.6,
    });
  }

  // credentials / access: Engineering waits on Security (from = waiter, to = blocker)
  if (/credential|api key|access review|admin exception/i.test(text) && teams.length) {
    const from = teams.includes("engineering") ? "engineering" : teams[0];
    const to = teams.includes("security")
      ? "security"
      : teams.includes("finance")
        ? "finance"
        : "security";
    if (from !== to) {
      out.push({
        fromTeam: from,
        toTeam: to,
        fromWork: "Access / credentials dependency",
        status: "AT_RISK",
        edgeType: "waits_on",
        confidence: 0.65,
      });
    }
  }

  return out;
}

export function persistInferredDependencies(
  userId: string,
  deps: InferredDep[],
  opts?: { allowInferredSource?: boolean },
): number {
  let n = 0;
  for (const d of deps) {
    const dup = (
      db.rawGet(
        `SELECT id FROM org_dependencies WHERE user_id = ? AND from_team = ? AND to_team = ?
         AND IFNULL(from_work,'') = ? LIMIT 1`,
        [userId, d.fromTeam, d.toTeam, d.fromWork],
      ) as { id: string }[]
    )[0];
    if (dup) continue;

    const id = uuidv4();
    const source = opts?.allowInferredSource === false ? "manual" : "inferred";
    const evidence = JSON.stringify(d.evidence || []);
    const confidence = d.confidence ?? 0.7;
    const edgeType = d.edgeType || "waits_on";
    try {
      db.rawRun(
        `INSERT INTO org_dependencies
          (id, user_id, from_team, from_work, to_team, to_work, status, source, edge_type, evidence_json, confidence_0_1, situation_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          userId,
          d.fromTeam,
          d.fromWork,
          d.toTeam,
          d.toWork || "inferred from signals",
          d.status,
          source,
          edgeType,
          evidence,
          confidence,
          d.situationId || null,
        ],
      );
      n += 1;
    } catch {
      try {
        db.rawRun(
          `INSERT INTO org_dependencies
            (id, user_id, from_team, from_work, to_team, to_work, status, source)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'manual')`,
          [
            id,
            userId,
            d.fromTeam,
            `[inferred] ${d.fromWork}`,
            d.toTeam,
            "inferred from signals",
            d.status,
          ],
        );
        n += 1;
      } catch {
        /* ignore */
      }
    }
  }
  return n;
}

/** Scan recent signals for a user and persist inferred deps. */
export function inferDependenciesFromSignals(userId: string, limit = 200): number {
  const rows = db.rawGet(
    `SELECT id, content FROM external_signals WHERE user_id = ?
     ORDER BY COALESCE(received_at, detected_at) DESC LIMIT ?`,
    [userId, limit],
  ) as { id: string; content: string }[];
  let total = 0;
  for (const r of rows) {
    const deps = inferDependenciesFromText(r.content || "").map((d) => ({
      ...d,
      evidence: [r.id],
      confidence: d.confidence ?? 0.7,
    }));
    total += persistInferredDependencies(userId, deps);
  }
  return total;
}
