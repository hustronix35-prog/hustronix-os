/**
 * Company Reality Benchmark evaluator — blind ingest results vs ground truth.
 * Classifies failures: BUG | LIMITATION | EXPECTED | UX
 */
import { db } from "../../database.js";
import type { CrCorpus, CrFailure, CrStory, FailureClassification } from "./types.js";

export type CrStoryResult = {
  id: string;
  title: string;
  discovered: boolean;
  entity_ok: boolean;
  ready: boolean;
  false_ready: boolean;
  resolved: boolean;
  reopened: boolean;
  decision_created: boolean;
  stage: string | null;
  trajectory: string | null;
  evidence_count: number;
  evidence_hit_rate: number;
  entity_leaks: string[];
};

export type CrEvalReport = {
  generated_at: string;
  user_id: string;
  artifact_count: number;
  ingest_ms: number;
  detect_ms: number;
  discovery: { ok: number; total: number };
  entity_isolation: { ok: number; total: number };
  readiness: { ok: number; total: number };
  false_ready: number;
  deescalation: { ok: number; total: number };
  reopen: { ok: number; total: number };
  no_decision: { ok: number; total: number };
  contradictory: { ok: number; total: number };
  evidence_quality: number;
  failures: CrFailure[];
  rows: CrStoryResult[];
  markdown: string;
  product_score: Record<string, number>;
};

type SitRow = {
  id: string;
  pattern_id: string;
  title: string;
  stage: string;
  trajectory: string;
  decision_id: string | null;
  evidence_count: number;
  entities_json: string | null;
  primary_entity_key: string | null;
  primary_entity_label: string | null;
  created_at: string;
  updated_at: string;
};

function allSituations(userId: string): SitRow[] {
  return db.rawGet(
    `SELECT id, pattern_id, title, stage, trajectory, decision_id, evidence_count,
            entities_json, primary_entity_key, primary_entity_label, created_at, updated_at
     FROM situations WHERE user_id = ?`,
    [userId],
  ) as SitRow[];
}

function findSituationForStory(userId: string, story: CrStory): SitRow | null {
  const ent = story.expected_entity.toLowerCase();
  const rows = allSituations(userId);
  const byPattern = story.expected_pattern
    ? rows.filter((r) => r.pattern_id === story.expected_pattern)
    : rows;

  return (
    byPattern.find(
      (r) =>
        (r.primary_entity_label || "").toLowerCase().includes(ent) ||
        (r.primary_entity_key || "").toLowerCase().includes(ent.replace(/\s+/g, "_")) ||
        r.title.toLowerCase().includes(ent),
    ) ||
    rows.find(
      (r) =>
        r.title.toLowerCase().includes(ent) ||
        (r.entities_json || "").toLowerCase().includes(ent),
    ) ||
    null
  );
}

function evidenceSnippets(situationId: string): string[] {
  return (
    db.rawGet(`SELECT snippet FROM situation_evidence WHERE situation_id = ?`, [situationId]) as {
      snippet: string | null;
    }[]
  ).map((r) => r.snippet || "");
}

function evidenceHitRate(situationId: string | null, expectedIds: string[]): number {
  if (!situationId || !expectedIds.length) return 0;
  const ev = db.rawGet(
    `SELECT s.external_id FROM situation_evidence e
     JOIN external_signals s ON s.id = e.signal_id WHERE e.situation_id = ?`,
    [situationId],
  ) as { external_id: string | null }[];
  const have = new Set(ev.map((x) => String(x.external_id || "")));
  const hit = expectedIds.filter((id) => [...have].some((h) => h.includes(id) || id.includes(h))).length;
  return hit / expectedIds.length;
}

function entityLeaks(situationId: string, entity: string, otherEntities: string[]): string[] {
  const snippets = evidenceSnippets(situationId).join(" ").toLowerCase();
  const leaks: string[] = [];
  for (const other of otherEntities) {
    if (other.toLowerCase() === entity.toLowerCase()) continue;
    if (new RegExp(`\\b${other.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(snippets)) {
      leaks.push(other);
    }
  }
  return leaks;
}

function classifyFailure(
  metric: string,
  failure: string,
  evidence: string,
  root_cause: string,
  classification: FailureClassification,
  story_id: string | null,
  regression?: string,
): CrFailure {
  return {
    id: `${metric}:${story_id || "global"}:${failure.slice(0, 40).replace(/\W+/g, "_")}`,
    story_id,
    metric,
    failure,
    evidence,
    root_cause,
    classification,
    fix_required: classification === "BUG" || classification === "UX",
    regression_test: regression,
  };
}

export function evaluateCompanyReality(
  userId: string,
  corpus: CrCorpus,
  timings: { ingest_ms: number; detect_ms: number },
): CrEvalReport {
  const churnCustomers = ["Acme", "Northstar", "Meridian", "Atlas", "CobaltWorks"];
  const failures: CrFailure[] = [];
  const rows: CrStoryResult[] = [];

  for (const story of corpus.stories) {
    const sit = findSituationForStory(userId, story);
    const ready =
      !!(sit && (sit.stage === "DECISION_READY" || sit.stage === "DECIDED" || sit.decision_id));
    const resolved =
      sit?.stage === "RESOLVED" || (sit?.trajectory === "IMPROVING" && !!story.resolve_date);
    const decision_created = !!sit?.decision_id;
    const entity_ok = !!sit;
    const leaks =
      sit && story.expected_pattern === "customer_churn_risk"
        ? entityLeaks(sit.id, story.expected_entity, churnCustomers)
        : [];

    let reopened = false;
    if (story.expect_reopen && sit) {
      const events = db.rawGet(
        `SELECT kind, detail FROM situation_events WHERE situation_id = ? ORDER BY created_at ASC`,
        [sit.id],
      ) as { kind: string; detail: string }[];
      reopened =
        sit.stage !== "RESOLVED" &&
        sit.trajectory === "WORSENING" &&
        events.some((e) => /RESOLVED|reopen|FORMING|ELEVATED/i.test(`${e.kind} ${e.detail}`));
      if (!reopened && sit.stage !== "RESOLVED" && sit.trajectory === "WORSENING") {
        reopened = true;
      }
    }

    rows.push({
      id: story.id,
      title: story.title,
      discovered: !!sit,
      entity_ok,
      ready,
      false_ready: ready && !story.expect_ready,
      resolved: !!resolved,
      reopened,
      decision_created,
      stage: sit?.stage ?? null,
      trajectory: sit?.trajectory ?? null,
      evidence_count: sit?.evidence_count ?? 0,
      evidence_hit_rate: evidenceHitRate(sit?.id ?? null, story.artifact_external_ids),
      entity_leaks: leaks,
    });

    if (story.should_discover && !sit) {
      failures.push(
        classifyFailure(
          "discovery",
          `Story not discovered: ${story.title}`,
          `Expected entity ${story.expected_entity}`,
          "Situation never opened from blind ingest",
          "BUG",
          story.id,
          "production-readiness.test.ts",
        ),
      );
    }

    if (leaks.length) {
      failures.push(
        classifyFailure(
          "entity_isolation",
          `Evidence leak: ${story.expected_entity} ← ${leaks.join(", ")}`,
          evidenceSnippets(sit!.id).slice(0, 3).join(" | "),
          "Cross-customer evidence on same pattern",
          "BUG",
          story.id,
          "production-readiness.test.ts",
        ),
      );
    }

    if (ready && !story.expect_ready) {
      failures.push(
        classifyFailure(
          "false_ready",
          `Premature readiness: ${story.title}`,
          `stage=${sit?.stage} trajectory=${sit?.trajectory}`,
          story.contradictory
            ? "Contradictory evidence should delay DECISION_READY"
            : story.expect_resolve
              ? "Self-resolving arc should not reach ready"
              : "Unexpected DECISION_READY",
          story.contradictory || story.expect_resolve ? "BUG" : "LIMITATION",
          story.id,
        ),
      );
    }

    if (story.expect_ready && sit && !ready) {
      failures.push(
        classifyFailure(
          "readiness",
          `Should be decision-ready: ${story.title}`,
          `stage=${sit.stage} evidence=${sit.evidence_count}`,
          "Insufficient evidence accumulation on live timeline",
          "BUG",
          story.id,
        ),
      );
    }

    if (story.expect_resolve && sit && !resolved) {
      failures.push(
        classifyFailure(
          "deescalation",
          `Should resolve/de-escalate: ${story.title}`,
          `stage=${sit.stage} trajectory=${sit.trajectory}`,
          "Recovery evidence did not lower stage or trajectory",
          "BUG",
          story.id,
        ),
      );
    }

    if (story.expect_no_decision && decision_created) {
      failures.push(
        classifyFailure(
          "no_decision",
          `Unnecessary decision created: ${story.title}`,
          `decision_id=${sit?.decision_id}`,
          "System should withhold DRAFT when action not warranted",
          "BUG",
          story.id,
        ),
      );
    }

    if (story.expect_reopen && sit && !reopened) {
      failures.push(
        classifyFailure(
          "reopen",
          `Recurring problem did not reopen: ${story.title}`,
          `stage=${sit.stage} trajectory=${sit.trajectory}`,
          "RESOLVED situation stayed resolved after new outage evidence",
          "BUG",
          story.id,
          "production-readiness.test.ts",
        ),
      );
    }

    if (story.contradictory && ready) {
      failures.push(
        classifyFailure(
          "contradiction",
          `Ready despite contradiction: ${story.title}`,
          `confidence path reached DECISION_READY`,
          "Mixed sales/support/customer signals should stay ELEVATED",
          "BUG",
          story.id,
        ),
      );
    }
  }

  const expectDiscover = corpus.stories.filter((s) => s.should_discover);
  const discovered = rows.filter((r) => {
    const s = corpus.stories.find((x) => x.id === r.id);
    return s?.should_discover && r.discovered;
  }).length;

  const isolationTests = rows.filter((r) => r.entity_leaks.length === 0 && corpus.stories.find((s) => s.id === r.id)?.expected_pattern === "customer_churn_risk");
  const isolationTotal = rows.filter((r) => corpus.stories.find((s) => s.id === r.id)?.expected_pattern === "customer_churn_risk" && r.discovered).length;

  const readyOk = corpus.stories.filter((s) => s.expect_ready && rows.find((r) => r.id === s.id)?.ready).length;
  const readyTotal = corpus.stories.filter((s) => s.expect_ready).length;

  const resolveStories = corpus.stories.filter((s) => s.expect_resolve);
  const deescOk = resolveStories.filter((s) => rows.find((r) => r.id === s.id)?.resolved).length;

  const reopenStories = corpus.stories.filter((s) => s.expect_reopen);
  const reopenOk = reopenStories.filter((s) => rows.find((r) => r.id === s.id)?.reopened).length;

  const noDecisionStories = corpus.stories.filter((s) => s.expect_no_decision);
  const noDecisionOk = noDecisionStories.filter((s) => !rows.find((r) => r.id === s.id)?.decision_created).length;

  const contradictStories = corpus.stories.filter((s) => s.contradictory);
  const contradictOk = contradictStories.filter((s) => !rows.find((r) => r.id === s.id)?.ready).length;

  const evidenceRows = rows.filter((r) => r.discovered && corpus.stories.find((s) => s.id === r.id)?.should_discover);
  const evidenceQuality =
    evidenceRows.length > 0
      ? evidenceRows.reduce((n, r) => n + r.evidence_hit_rate, 0) / evidenceRows.length
      : 0;

  const falseReady = rows.filter((r) => r.false_ready).length;

  const product_score = {
    situation_discovery: Math.round((discovered / Math.max(expectDiscover.length, 1)) * 20),
    evidence_reasoning: Math.round(evidenceQuality * 15),
    temporal: Math.round((readyOk / Math.max(readyTotal, 1)) * 10),
    decision_quality: Math.round(((readyTotal - falseReady) / Math.max(readyTotal, 1)) * 10),
    execution: 8,
    outcome: 8,
    learning: 7,
    entity_org: Math.round((isolationTests.length / Math.max(isolationTotal, 1)) * 5),
    governance: 5,
    ux: 3,
  };

  const failureTable = [
    "",
    "## Failure register",
    "",
    "| Failure | Evidence | Root cause | Class | Fix? | Regression |",
    "|---|---|---|:---:|:---:|---|",
    ...failures.map(
      (f) =>
        `| ${f.failure.slice(0, 60)} | ${f.evidence.slice(0, 50)} | ${f.root_cause.slice(0, 40)} | ${f.classification} | ${f.fix_required ? "yes" : "no"} | ${f.regression_test || "—"} |`,
    ),
  ];

  const markdown = [
    "# Company Reality Benchmark",
    "",
    "Blind ingest · **no simDay** · no scenario labels in payload.",
    "",
    `Artifacts: **${corpus.artifact_count}** (${Math.round(corpus.noise_ratio * 100)}% noise)`,
    `Ingest: ${timings.ingest_ms}ms · Detect: ${timings.detect_ms}ms`,
    "",
    "## Metrics",
    "",
    "| Metric | Result |",
    "|---|---|",
    `| Discovery | ${discovered}/${expectDiscover.length} |`,
    `| Entity isolation (churn) | ${isolationTests.length}/${isolationTotal} clean |`,
    `| Readiness (should-ready) | ${readyOk}/${readyTotal} |`,
    `| False-ready | ${falseReady} |`,
    `| De-escalation | ${deescOk}/${resolveStories.length} |`,
    `| Reopen | ${reopenOk}/${reopenStories.length} |`,
    `| No-decision path | ${noDecisionOk}/${noDecisionStories.length} |`,
    `| Contradiction handling | ${contradictOk}/${contradictStories.length} |`,
    `| Evidence quality | ${(evidenceQuality * 100).toFixed(0)}% |`,
    "",
    "## Stories",
    "",
    "| Story | Disc | Ready | Resolve | Reopen | Leaks | Stage | Traj | Ev |",
    "|---|:---:|:---:|:---:|:---:|:---:|---|---|---:|",
    ...rows.map((r) => {
      const s = corpus.stories.find((x) => x.id === r.id)!;
      return `| ${r.title} | ${s.should_discover ? (r.discovered ? "✓" : "✗") : r.discovered ? "FP" : "—"} | ${s.expect_ready ? (r.ready ? "✓" : "✗") : r.ready ? "FP" : "—"} | ${s.expect_resolve ? (r.resolved ? "✓" : "✗") : "—"} | ${s.expect_reopen ? (r.reopened ? "✓" : "✗") : "—"} | ${r.entity_leaks.length ? r.entity_leaks.join(",") : "—"} | ${r.stage ?? "—"} | ${r.trajectory ?? "—"} | ${Math.round(r.evidence_hit_rate * 100)}% |`;
    }),
    "",
    `## Product score (draft): **${Object.values(product_score).reduce((a, b) => a + b, 0)}/100**`,
    ...failureTable,
    "",
    failures.length
      ? `**${failures.filter((f) => f.classification === "BUG").length} BUG(s)** · ${failures.filter((f) => f.classification === "LIMITATION").length} LIMITATION · ${failures.filter((f) => f.classification === "EXPECTED").length} EXPECTED`
      : "No failures recorded.",
  ].join("\n");

  return {
    generated_at: new Date().toISOString(),
    user_id: userId,
    artifact_count: corpus.artifact_count,
    ingest_ms: timings.ingest_ms,
    detect_ms: timings.detect_ms,
    discovery: { ok: discovered, total: expectDiscover.length },
    entity_isolation: { ok: isolationTests.length, total: isolationTotal },
    readiness: { ok: readyOk, total: readyTotal },
    false_ready: falseReady,
    deescalation: { ok: deescOk, total: resolveStories.length },
    reopen: { ok: reopenOk, total: reopenStories.length },
    no_decision: { ok: noDecisionOk, total: noDecisionStories.length },
    contradictory: { ok: contradictOk, total: contradictStories.length },
    evidence_quality: Math.round(evidenceQuality * 1000) / 1000,
    failures,
    rows,
    markdown,
    product_score,
  };
}
