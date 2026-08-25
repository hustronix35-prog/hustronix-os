/**
 * Open-world eval — discovery, evidence, false positives, readiness, de-escalation, action.
 * No theme-lexicon scoring.
 */
import { db } from "../../database.js";
import { findSituationsForQuestion } from "../../intelligence/situation-chat.js";
import type { OpenWorldCorpus, OpenWorldStory } from "./openWorldCorpus.js";

export type OpenWorldStoryResult = {
  id: string;
  title: string;
  discovered: boolean;
  entity_ok: boolean;
  ready: boolean;
  resolved: boolean;
  false_ready: boolean;
  awareness_day: number | null;
  ready_day: number | null;
  stage: string | null;
  trajectory: string | null;
  evidence_count: number;
  evidence_hit_rate: number;
  action_useful: boolean;
  vow: string | null;
};

function findSituation(userId: string, story: OpenWorldStory) {
  const ent = story.expected_entity.toLowerCase();
  const rows = db.rawGet(
    `SELECT id, pattern_id, title, stage, trajectory, confidence,
            awareness_day, decision_ready_day, decision_id, evidence_count, entities_json
     FROM situations WHERE user_id = ? AND pattern_id LIKE 'openworld:%'`,
    [userId],
  ) as Array<{
    id: string;
    pattern_id: string;
    title: string;
    stage: string;
    trajectory: string;
    confidence: number;
    awareness_day: number | null;
    decision_ready_day: number | null;
    decision_id: string | null;
    evidence_count: number;
    entities_json: string | null;
  }>;
  return (
    rows.find(
      (r) =>
        r.title.toLowerCase().includes(ent) ||
        (r.entities_json || "").toLowerCase().includes(ent) ||
        r.pattern_id.toLowerCase().includes(ent.replace(/\s+/g, "_")),
    ) || null
  );
}

function evidenceHitRate(
  userId: string,
  situationId: string | null,
  expectedIds: string[],
): number {
  if (!situationId || !expectedIds.length) return 0;
  const ev = db.rawGet(
    `SELECT s.external_id FROM situation_evidence e
     JOIN external_signals s ON s.id = e.signal_id
     WHERE e.situation_id = ?`,
    [situationId],
  ) as { external_id: string | null }[];
  const have = new Set(
    ev.map((x) => String(x.external_id || "")).filter(Boolean),
  );
  const hit = expectedIds.filter((id) =>
    [...have].some((h) => h.includes(id) || id.includes(h)),
  ).length;
  return hit / expectedIds.length;
}

export function evaluateOpenWorld(userId: string, corpus: OpenWorldCorpus) {
  const expectDiscover = corpus.stories.filter((s) => s.should_discover);
  const rows: OpenWorldStoryResult[] = corpus.stories.map((story) => {
    const sit = findSituation(userId, story);
    const ready = !!(sit && (sit.stage === "DECISION_READY" || sit.stage === "DECIDED" || sit.decision_ready_day));
    const resolved =
      sit?.stage === "RESOLVED" ||
      (sit?.trajectory === "IMPROVING" && !!story.resolve_day);
    let vow: string | null = null;
    if (sit?.decision_id) {
      vow =
        (
          db.rawGet(`SELECT vow FROM decision_ledger WHERE id = ?`, [sit.decision_id]) as {
            vow: string;
          }[]
        )[0]?.vow || null;
    }
    const action_useful = !!(
      vow &&
      story.expected_entity &&
      vow.toLowerCase().includes(story.expected_entity.split(/\s+/)[0].toLowerCase())
    );
    return {
      id: story.id,
      title: story.title,
      discovered: !!sit,
      entity_ok: !!sit,
      ready,
      resolved: !!resolved,
      false_ready: ready && !story.expect_ready,
      awareness_day: sit?.awareness_day ?? null,
      ready_day: sit?.decision_ready_day ?? null,
      stage: sit?.stage ?? null,
      trajectory: sit?.trajectory ?? null,
      evidence_count: sit?.evidence_count ?? 0,
      evidence_hit_rate: evidenceHitRate(userId, sit?.id ?? null, story.artifact_external_ids),
      action_useful,
      vow,
    };
  });

  const discovered = expectDiscover.filter((s) => rows.find((r) => r.id === s.id)?.discovered).length;
  const readyOk = corpus.stories.filter((s) => s.expect_ready && rows.find((r) => r.id === s.id)?.ready).length;
  const readyTotal = corpus.stories.filter((s) => s.expect_ready).length;
  const resolveStories = corpus.stories.filter((s) => s.expect_resolve);
  const deesc = resolveStories.filter((s) => {
    const r = rows.find((x) => x.id === s.id);
    return r && (r.resolved || r.trajectory === "IMPROVING" || r.stage === "RESOLVED") && !r.ready;
  }).length;
  const noise = rows.find((r) => r.id === "ambient_noise");
  const falsePositives = rows.filter((r) => r.false_ready || (r.id === "ambient_noise" && r.discovered)).length;
  const evidenceRows = rows.filter((r) => r.id !== "ambient_noise" && r.discovered);
  const evidence =
    evidenceRows.length > 0
      ? evidenceRows.reduce((s, r) => s + r.evidence_hit_rate, 0) / evidenceRows.length
      : 0;
  const actionOk = rows.filter((r) => r.ready && r.action_useful).length;
  const actionTotal = rows.filter((r) => r.ready).length;

  const extraSits = (
    db.rawGet(
      `SELECT title, stage FROM situations WHERE user_id = ? AND pattern_id LIKE 'openworld:%'`,
      [userId],
    ) as { title: string; stage: string }[]
  ).filter((s) => {
    const hay = s.title.toLowerCase();
    return !corpus.stories.some(
      (st) => st.should_discover && hay.includes(st.expected_entity.toLowerCase()),
    );
  });

  const markdown = [
    "HUSTRONIX OPEN-WORLD INTELLIGENCE TEST",
    "────────────────────────────────────",
    "No scenario ID · no theme label · no theme lexicon · no playbook · no HSOG pattern keys.",
    "",
    "| Story | Discover | Ready | Resolve | Hit | Stage | Traj | Action |",
    "|---|:---:|:---:|:---:|---:|---|---|:---:|",
    ...rows.map((r) => {
      const s = corpus.stories.find((x) => x.id === r.id)!;
      const disc = s.should_discover ? (r.discovered ? "✓" : "✗") : r.discovered ? "FP" : "—";
      const rd = s.expect_ready ? (r.ready ? "✓" : "✗") : r.ready ? "FP" : "—";
      const rs = s.expect_resolve ? (r.resolved ? "✓" : "✗") : r.resolved ? "~" : "—";
      return `| ${r.title} | ${disc} | ${rd} | ${rs} | ${Math.round(r.evidence_hit_rate * 100)}% | ${r.stage ?? "—"} | ${r.trajectory ?? "—"} | ${r.action_useful ? "✓" : r.ready ? "~" : "—"} |`;
    }),
    "",
    `Discovery (should-find): ${discovered}/${expectDiscover.length}`,
    `Decision readiness (should-ready): ${readyOk}/${readyTotal}`,
    `De-escalation (resolve, no unnecessary ready): ${deesc}/${resolveStories.length}`,
    `Evidence quality (attached story artifacts): ${evidence.toFixed(2)}`,
    `False positives (noise discovered or unexpected ready): ${falsePositives}`,
    extraSits.length
      ? `Extra open-world situations: ${extraSits.map((s) => `${s.title} [${s.stage}]`).join("; ")}`
      : "Extra open-world situations: none",
    `Action usefulness (ready DRAFTs name the entity): ${actionOk}/${Math.max(actionTotal, 0)}`,
    noise?.discovered ? "WARNING: ambient noise formed a situation." : "Ambient noise did not form a situation.",
  ].join("\n");

  return {
    discovery: { ok: discovered, total: expectDiscover.length },
    readiness: { ok: readyOk, total: readyTotal },
    deescalation: { ok: deesc, total: resolveStories.length },
    evidence: Math.round(evidence * 100) / 100,
    false_positives: falsePositives,
    extra_situations: extraSits,
    action: { ok: actionOk, total: actionTotal },
    rows,
    markdown,
  };
}

export const OPEN_WORLD_CHAT_TURNS = [
  { question: "What is happening with MeridianRail?", must_include: ["MeridianRail"], grounded: true },
  { question: "Why is VoltHarbor a concern?", must_include: ["VoltHarbor"], grounded: true },
  { question: "Who is affected by Quinlan Labs?", must_include: ["Quinlan"], grounded: true },
  { question: "What should we do about BrambleNet?", must_include: ["BrambleNet"], grounded: true },
  { question: "What happened with CedarPath?", must_include: ["CedarPath"], grounded: true },
];

export function evaluateOpenWorldChat(userId: string) {
  const out = OPEN_WORLD_CHAT_TURNS.map((t) => {
    const cards = findSituationsForQuestion(userId, t.question);
    const answer = cards[0]?.answer || "";
    const grounded = cards.length > 0 && answer.length > 40;
    const missing = (t.must_include || []).filter((n) => !answer.toLowerCase().includes(n.toLowerCase()));
    return {
      question: t.question,
      grounded,
      passed: grounded && missing.length === 0,
      missing,
      answer_preview: answer.slice(0, 220).replace(/\n/g, " "),
    };
  });
  const passed = out.filter((x) => x.passed).length;
  const markdown = [
    "OPEN-WORLD CHAT (Situation-grounded)",
    "────────────────────────────────────",
    ...out.map(
      (t) =>
        `${t.passed ? "✓" : "✗"} Q: ${t.question}\n   grounded=${t.grounded} missing=[${t.missing.join(", ")}]\n   → ${t.answer_preview || "(empty)"}`,
    ),
    "",
    `Passed ${passed}/${out.length}`,
  ].join("\n");
  return { turns: out, passed, total: out.length, markdown };
}
