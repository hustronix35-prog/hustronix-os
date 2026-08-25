/**
 * Live evidence provenance + optional HSOG accuracy against this tenant's ledger.
 */
import { db } from "../database.js";
import {
  HSOG_QUESTIONS,
  answerFromLedger,
  loadCausalGraph,
  scoreHsogAnswer,
} from "../integrations/hsog/gradeAnswers.js";

const SOURCE_LABEL: Record<string, string> = {
  SLACK: "Slack",
  GITHUB: "GitHub",
  JIRA: "Jira",
  GMAIL: "Gmail",
  GOOGLE: "Google",
  MICROSOFT: "Microsoft",
  NOTION: "Notion",
  LINEAR: "Linear",
  CRM: "CRM",
  MEETING: "Meeting",
  INCIDENT: "Incident",
  HRIS: "HRIS",
  FINANCE: "Finance",
  MANUAL: "Manual",
};

function parseMeta(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export type EvidenceAccuracyReport = {
  signals_total: number;
  provenance: {
    by_source: { source: string; label: string; n: number }[];
    by_subtype: { subtype: string; n: number }[];
    by_runtime: { runtime: string; n: number }[];
    recent: {
      id: string;
      source: string;
      source_label: string;
      subtype: string | null;
      runtime: string;
      artifact_type: string | null;
      scenario: string | null;
      occurred_at: string | null;
      received_at: string | null;
      state: string;
      excerpt: string;
    }[];
  };
  accuracy: {
    letter: string;
    average: number;
    passed: number;
    total: number;
    questions: {
      id: string;
      scenario: string;
      question: string;
      score: number;
      fact_coverage: number;
      artifact_type_coverage: number;
      cited_types: string[];
      cited_sources: string[];
      passed: boolean;
    }[];
  } | null;
  tested: {
    method: string;
    rubric: string;
    channels: string[];
    note: string;
  };
};

export async function buildEvidenceAccuracy(userId: string): Promise<EvidenceAccuracyReport> {
  const total = Number(
    (
      db.rawGet(`SELECT COUNT(*) AS c FROM external_signals WHERE user_id = ?`, [userId]) as { c: number }[]
    )[0]?.c || 0,
  );

  const bySourceRows = db.rawGet(
    `SELECT source, COUNT(*) AS n FROM external_signals WHERE user_id = ? GROUP BY source ORDER BY n DESC`,
    [userId],
  ) as { source: string; n: number }[];

  const bySubtypeRows = db.rawGet(
    `SELECT COALESCE(source_subtype, '(none)') AS subtype, COUNT(*) AS n
     FROM external_signals WHERE user_id = ?
     GROUP BY source_subtype ORDER BY n DESC LIMIT 16`,
    [userId],
  ) as { subtype: string; n: number }[];

  const byRuntimeRows = db.rawGet(
    `SELECT COALESCE(json_extract(ingest_meta, '$.integration_runtime'), 'unknown') AS runtime, COUNT(*) AS n
     FROM external_signals WHERE user_id = ?
     GROUP BY 1 ORDER BY n DESC`,
    [userId],
  ) as { runtime: string; n: number }[];

  const hsogN = Number(
    (
      db.rawGet(
        `SELECT COUNT(*) AS c FROM external_signals
         WHERE user_id = ?
           AND (
             json_extract(ingest_meta, '$.hsog_scenario_id') IS NOT NULL
             OR json_extract(ingest_meta, '$.integration_runtime') LIKE 'hsog%'
           )`,
        [userId],
      ) as { c: number }[]
    )[0]?.c || 0,
  );

  const recentRows = db.rawGet(
    `SELECT id, source, source_subtype, content, state, detected_at, received_at, ingest_meta
     FROM external_signals WHERE user_id = ?
     ORDER BY COALESCE(received_at, detected_at) DESC LIMIT 12`,
    [userId],
  ) as {
    id: string;
    source: string;
    source_subtype: string | null;
    content: string;
    state: string;
    detected_at: string | null;
    received_at: string | null;
    ingest_meta: string | null;
  }[];

  const recent = recentRows.map((r) => {
    const meta = parseMeta(r.ingest_meta);
    return {
      id: r.id,
      source: r.source,
      source_label: SOURCE_LABEL[r.source] || r.source,
      subtype: r.source_subtype,
      runtime: String(meta.integration_runtime || "unknown"),
      artifact_type: meta.artifact_type != null ? String(meta.artifact_type) : null,
      scenario: meta.hsog_scenario_id != null ? String(meta.hsog_scenario_id) : null,
      occurred_at: meta.occurred_at != null ? String(meta.occurred_at) : r.detected_at,
      received_at: r.received_at,
      state: r.state,
      excerpt: String(r.content || "").replace(/\s+/g, " ").slice(0, 140),
    };
  });

  let accuracy: EvidenceAccuracyReport["accuracy"] = null;
  if (hsogN >= 4) {
    const causal = loadCausalGraph();
    const questions = [];
    for (const q of HSOG_QUESTIONS) {
      const ans = await answerFromLedger(userId, q, causal, { search: false });
      const g = scoreHsogAnswer(q, ans, causal);
      questions.push({
        id: q.id,
        scenario: q.scenario,
        question: q.question,
        score: g.score_0_to_4,
        fact_coverage: g.fact_coverage,
        artifact_type_coverage: g.artifact_type_coverage,
        cited_types: ans.cited_artifact_types,
        cited_sources: ans.cited_sources,
        passed: g.passed,
      });
    }
    const avg = questions.reduce((s, q) => s + q.score, 0) / Math.max(questions.length, 1);
    accuracy = {
      letter: avg >= 3.5 ? "A" : avg >= 2.5 ? "B" : avg >= 1.5 ? "C" : avg >= 0.75 ? "D" : "F",
      average: Math.round(avg * 100) / 100,
      passed: questions.filter((q) => q.passed).length,
      total: questions.length,
      questions,
    };
  }

  return {
    signals_total: total,
    provenance: {
      by_source: bySourceRows.map((r) => ({
        source: r.source,
        label: SOURCE_LABEL[r.source] || r.source,
        n: Number(r.n),
      })),
      by_subtype: bySubtypeRows.map((r) => ({ subtype: r.subtype, n: Number(r.n) })),
      by_runtime: byRuntimeRows.map((r) => ({ runtime: String(r.runtime), n: Number(r.n) })),
      recent,
    },
    accuracy,
    tested: {
      method: "HSOG enterprise rubric on this tenant's live ledger",
      rubric: "Fact coverage 55% + artifact types 25% + causal bonus − unacceptable penalty. Pass ≥ 2/4.",
      channels: [
        "Slack Events",
        "Nango Slack",
        "Jira",
        "GitHub",
        "Gmail",
        "CRM",
        "Meetings",
        "Incidents",
        "HRIS",
        "Finance",
      ],
      note: accuracy
        ? "Graded from external_signals snippets for this user. Not an LLM coordinator run. Types without aliases."
        : "Connectors write source + subtype + runtime on each signal. Accuracy appears after HSOG (or hsog:ingest / hsog:heavy) lands benchmark artifacts.",
    },
  };
}

export function publicSignalProvenance(row: {
  source: string;
  source_subtype?: string | null;
  external_id?: string | null;
  detected_at?: string | null;
  received_at?: string | null;
  ingest_meta?: string | null;
}) {
  const meta = parseMeta(row.ingest_meta ?? null);
  return {
    source: row.source,
    source_label: SOURCE_LABEL[row.source] || row.source,
    source_subtype: row.source_subtype ?? null,
    runtime: meta.integration_runtime != null ? String(meta.integration_runtime) : null,
    artifact_type: meta.artifact_type != null ? String(meta.artifact_type) : null,
    scenario_id: meta.hsog_scenario_id != null ? String(meta.hsog_scenario_id) : null,
    occurred_at: meta.occurred_at != null ? String(meta.occurred_at) : row.detected_at ?? null,
    received_at: row.received_at ?? null,
    external_id: row.external_id ?? null,
  };
}
