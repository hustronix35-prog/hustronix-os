/**
 * Compare Hustronix OS state against HSOG ground truth (evaluator only).
 */
import { db } from "../../database.js";
import type { HsogGroundTruth } from "./customerPathCorpus.js";
import { SITUATION_PATTERNS } from "../../intelligence/situation-detect.js";
import {
  HSOG_QUESTIONS,
  answerFromLedger,
  loadCausalGraph,
  scoreHsogAnswer,
} from "./gradeAnswers.js";
import { buildOrgIntelligence } from "../../org/intelligence.js";

export type ScenarioEval = {
  id: string;
  title: string;
  detected: boolean;
  detect_day: number | null;
  ground_truth_start_day: number;
  timing_delta_days: number | null;
  evidence_hit_rate: number;
  people_hit_rate: number;
  team_hit_rate: number;
  decision_id: string | null;
  vow: string | null;
};

export type CustomerPathReport = {
  generated_at: string;
  user_id: string;
  mode: string;
  scenarios_detected: string;
  detection: ScenarioEval[];
  false_positives: string[];
  evidence_accuracy: number;
  dependency_accuracy: number;
  owner_accuracy: number;
  retrieval: { passed: number; total: number; avg_0_to_4: number };
  decisions: { drafts: number; active: number; useful: number };
  execution: { pending: number; active: number; done: number; blocked: number };
  signals: { total: number; by_state: Record<string, number> };
  governance_note: string;
  markdown: string;
};

function detectedSituations(userId: string): Array<{
  id: string;
  decision_id: string;
  vow: string;
  created_at: string | null;
}> {
  const rows = db.rawGet(
    `SELECT id, vow, decision_reasoning, created_at FROM decision_ledger WHERE user_id = ?`,
    [userId],
  ) as { id: string; vow: string; decision_reasoning: string | null; created_at: string | null }[];
  const out: Array<{ id: string; decision_id: string; vow: string; created_at: string | null }> = [];
  for (const r of rows) {
    try {
      const j = r.decision_reasoning ? JSON.parse(r.decision_reasoning) : null;
      if (j?.source === "situation_detect" && j?.situation_id) {
        out.push({
          id: String(j.situation_id),
          decision_id: r.id,
          vow: r.vow,
          created_at: r.created_at,
        });
        continue;
      }
    } catch {
      /* ignore */
    }
  }
  return out;
}

function signalBlob(userId: string): string {
  const rows = db.rawGet(
    `SELECT lower(content) AS c FROM external_signals WHERE user_id = ?`,
    [userId],
  ) as { c: string }[];
  return rows.map((r) => r.c || "").join("\n");
}

function ownersInOs(userId: string): Set<string> {
  const rows = db.rawGet(
    `SELECT DISTINCT owner FROM external_signals WHERE user_id = ? AND owner IS NOT NULL
     UNION
     SELECT DISTINCT e.owner FROM execution_ledger e
     JOIN decision_ledger d ON d.id = e.decision_id WHERE d.user_id = ?`,
    [userId, userId],
  ) as { owner: string }[];
  return new Set(rows.map((r) => String(r.owner || "").split(":")[0]).filter(Boolean));
}

function evidenceHitRate(userId: string, gt: HsogGroundTruth, scenarioId: string): number {
  const arts = gt.artifacts.filter((a) => a.scenario_id === scenarioId);
  if (!arts.length) return 0;
  const extIds = arts.map((a) => a.blind_external_id);
  let hit = 0;
  for (const ext of extIds) {
    const row = (
      db.rawGet(
        `SELECT id FROM external_signals WHERE user_id = ? AND external_id = ? LIMIT 1`,
        [userId, ext],
      ) as { id: string }[]
    )[0];
    if (row) hit += 1;
  }
  return hit / extIds.length;
}

export async function evaluateCustomerPath(
  userId: string,
  gt: HsogGroundTruth,
  mode: string,
): Promise<CustomerPathReport> {
  const detected = detectedSituations(userId);
  const detectedIds = new Set(detected.map((d) => d.id));
  const expectedIds = new Set(
    gt.scenarios.map((s) => s.expected_situation_pattern_id || s.id).filter(Boolean),
  );

  const falsePositives = [...detectedIds].filter((id) => !expectedIds.has(id));

  const blob = signalBlob(userId);
  const osOwners = ownersInOs(userId);

  const detection: ScenarioEval[] = gt.scenarios.map((s) => {
    const hit = detected.find((d) => d.id === s.id || d.id === s.expected_situation_pattern_id);
    const kw = s.detection_keywords || [];
    const kwHits = kw.filter((k) => blob.includes(k.toLowerCase())).length;
    const peopleHit =
      s.people.length === 0
        ? 1
        : s.people.filter((p) => osOwners.has(p) || blob.includes(p.toLowerCase())).length /
          s.people.length;
    const teamHit =
      s.teams.length === 0
        ? 1
        : s.teams.filter((t) => blob.includes(t.toLowerCase())).length / s.teams.length;

    return {
      id: s.id,
      title: s.title,
      detected: !!hit,
      detect_day: null, // wall-clock create ≠ sim day without extra stamps
      ground_truth_start_day: s.start_day,
      timing_delta_days: null,
      evidence_hit_rate: Math.round(evidenceHitRate(userId, gt, s.id) * 1000) / 1000,
      people_hit_rate: Math.round(peopleHit * 1000) / 1000,
      team_hit_rate: Math.round(teamHit * 1000) / 1000,
      decision_id: hit?.decision_id || null,
      vow: hit?.vow || null,
    };
  });

  const evidence_accuracy =
    detection.reduce((s, d) => s + d.evidence_hit_rate, 0) / Math.max(detection.length, 1);
  const owner_accuracy =
    detection.reduce((s, d) => s + d.people_hit_rate, 0) / Math.max(detection.length, 1);

  let org;
  try {
    org = buildOrgIntelligence(userId);
  } catch {
    org = { dependencies: [] as unknown[], people: [] as unknown[] };
  }
  const expectedTeamEdges = SITUATION_PATTERNS.flatMap((p) =>
    p.teams.map((t) => `${t.from}|${t.to}`),
  );
  const gotEdges = new Set(
    (org.dependencies || []).map(
      (d: { fromTeam?: string; toTeam?: string; from_team?: string; to_team?: string }) =>
        `${(d.fromTeam || d.from_team || "").toLowerCase()}|${(d.toTeam || d.to_team || "").toLowerCase()}`,
    ),
  );
  const depHits = expectedTeamEdges.filter((e) => {
    const [a, b] = e.toLowerCase().split("|");
    for (const g of gotEdges) {
      const [ga, gb] = g.split("|");
      if (ga.includes(a.split(" ")[0]) && gb.includes(b.split(" ")[0])) return true;
    }
    return false;
  }).length;
  const dependency_accuracy = expectedTeamEdges.length
    ? depHits / expectedTeamEdges.length
    : 0;

  const causal = loadCausalGraph();
  const grades = [];
  for (const q of HSOG_QUESTIONS) {
    const ans = await answerFromLedger(userId, q, causal, { search: false });
    grades.push(scoreHsogAnswer(q, ans, causal));
  }
  const retAvg = grades.reduce((s, g) => s + g.score_0_to_4, 0) / Math.max(grades.length, 1);
  const retPass = grades.filter((g) => g.passed).length;

  const dec = db.rawGet(
    `SELECT status, COUNT(1) AS n FROM decision_ledger WHERE user_id = ? GROUP BY status`,
    [userId],
  ) as { status: string; n: number }[];
  const drafts = Number(dec.find((d) => d.status === "DRAFT")?.n || 0);
  const active = Number(dec.find((d) => d.status === "ACTIVE")?.n || 0);

  const exec = db.rawGet(
    `SELECT e.status, COUNT(1) AS n FROM execution_ledger e
     JOIN decision_ledger d ON d.id = e.decision_id
     WHERE d.user_id = ? GROUP BY e.status`,
    [userId],
  ) as { status: string; n: number }[];
  const execMap = Object.fromEntries(exec.map((e) => [e.status, Number(e.n)]));

  const sig = db.rawGet(
    `SELECT state, COUNT(1) AS n FROM external_signals WHERE user_id = ? GROUP BY state`,
    [userId],
  ) as { state: string; n: number }[];
  const by_state = Object.fromEntries(sig.map((s) => [s.state, Number(s.n)]));
  const totalSig = Object.values(by_state).reduce((a, b) => a + b, 0);

  const detectedCount = detection.filter((d) => d.detected).length;
  const useful = detection.filter((d) => d.detected && d.vow).length;

  const markdown = formatReportMarkdown({
    detectedCount,
    total: detection.length,
    detection,
    falsePositives,
    evidence_accuracy,
    dependency_accuracy,
    owner_accuracy,
    retrieval: { passed: retPass, total: grades.length, avg: retAvg },
    decisions: { drafts, active, useful },
    execution: {
      pending: execMap.PENDING || 0,
      active: execMap.ACTIVE || 0,
      done: execMap.DONE || 0,
      blocked: execMap.BLOCKED || 0,
    },
    mode,
  });

  return {
    generated_at: new Date().toISOString(),
    user_id: userId,
    mode,
    scenarios_detected: `${detectedCount}/${detection.length}`,
    detection,
    false_positives: falsePositives,
    evidence_accuracy: Math.round(evidence_accuracy * 1000) / 1000,
    dependency_accuracy: Math.round(dependency_accuracy * 1000) / 1000,
    owner_accuracy: Math.round(owner_accuracy * 1000) / 1000,
    retrieval: {
      passed: retPass,
      total: grades.length,
      avg_0_to_4: Math.round(retAvg * 100) / 100,
    },
    decisions: { drafts, active, useful },
    execution: {
      pending: execMap.PENDING || 0,
      active: execMap.ACTIVE || 0,
      done: execMap.DONE || 0,
      blocked: execMap.BLOCKED || 0,
    },
    signals: { total: totalSig, by_state },
    governance_note: "Use npm run hsog:full-system for adversarial governance probes.",
    markdown,
  };
}

function formatReportMarkdown(p: {
  detectedCount: number;
  total: number;
  detection: ScenarioEval[];
  falsePositives: string[];
  evidence_accuracy: number;
  dependency_accuracy: number;
  owner_accuracy: number;
  retrieval: { passed: number; total: number; avg: number };
  decisions: { drafts: number; active: number; useful: number };
  execution: { pending: number; active: number; done: number; blocked: number };
  mode: string;
}): string {
  const lines = [
    "HUSTRONIX HSOG CUSTOMER-PATH BLIND TEST",
    "──────────────────────────────────────",
    "",
    `Mode: ${p.mode}`,
    `Scenarios detected: ${p.detectedCount}/${p.total}`,
    "",
    "Detection",
    "━━━━━━━━━━━━━━━━━━━━━━━━",
    ...p.detection.map((d) => {
      const mark = d.detected ? "✓" : "✗";
      const timing =
        d.detect_day != null
          ? `  Day ${d.detect_day} (GT ${d.ground_truth_start_day})`
          : `  GT start day ${d.ground_truth_start_day}`;
      return `${d.title.padEnd(28)} ${mark}${timing}`;
    }),
    "",
    `False positives: ${p.falsePositives.length}${p.falsePositives.length ? ` (${p.falsePositives.join(", ")})` : ""}`,
    "",
    `Evidence accuracy: ${Math.round(p.evidence_accuracy * 100)}%`,
    `Dependency accuracy: ${Math.round(p.dependency_accuracy * 100)}%`,
    `Owner accuracy: ${Math.round(p.owner_accuracy * 100)}%`,
    "",
    `Decision recommendations: ${p.decisions.useful}/${p.detectedCount || 0} useful (drafts=${p.decisions.drafts}, active=${p.decisions.active})`,
    "",
    "Execution (no finalizeExecuted in this suite):",
    `${p.execution.active} ACTIVE · ${p.execution.pending} PENDING · ${p.execution.done} DONE · ${p.execution.blocked} BLOCKED`,
    "",
    `Retrieval: ${p.retrieval.passed}/${p.retrieval.total} scenarios · avg ${p.retrieval.avg.toFixed(2)}/4`,
    "",
    "Rules: blind input only · production ingestExternal · no playbook triggers · no finalizeExecuted",
  ];
  return lines.join("\n");
}
