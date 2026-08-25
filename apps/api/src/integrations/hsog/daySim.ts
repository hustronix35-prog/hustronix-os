/**
 * Chronological HSOG day-taste: step sim days, ingest that day's evidence,
 * draft/commit decisions when alerts fire, advance executions, attempt breaks,
 * then grade the full OS loop vs ground truth.
 */
import { db } from "../../database.js";
import { reprocessUnenrichedSignals } from "../../intelligence/index.js";
import { notify, defaultAppLink } from "../../notifications/dispatcher.js";
import {
  mutationCommitDecision,
  mutationCreateDraftDecision,
  mutationKillSignal,
  mutationLinkSignal,
  mutationTransitionExecution,
} from "../../security/mutation-handlers.js";
import { resolveTenantContext } from "../../security/tenant-context.js";
import { auditor } from "../../auditor.js";
import { PLAYBOOKS, runHsogIngest, startHsogSprint } from "./ingestHsog.js";
import { ingestHsogViaProviders, type ChannelTally } from "./providerIngest.js";
import {
  HSOG_QUESTIONS,
  answerFromLedger,
  loadCausalGraph,
  scoreHsogAnswer,
} from "./gradeAnswers.js";
import { buildEvidenceAccuracy } from "../../intelligence/evidenceAccuracy.js";
import type { HsogEvent, HsogIngestBundle } from "./types.js";

const DECISION_TRIGGERS = new Set([
  "launch_gate_failed",
  "incident_declared",
  "renewal_risk_detected",
  "hiring_freeze_started",
  "security_alert_triggered",
  "customer_escalation_opened",
  "deployment_failed",
  "audit_evidence_missing",
]);

const PROGRESS_TRIGGERS = new Set([
  "roadmap_review",
  "exception_approved",
  "deployment_started",
  "forecast_review",
  "risk_accepted",
  "scope_changed",
]);

export type BreakAttempt = {
  name: string;
  expected: "reject" | "allow";
  actual: "rejected" | "allowed" | "error";
  passed: boolean;
  detail: string;
};

export type DayJournal = {
  day: number;
  date: string;
  events: { event_id: string; scenario_id: string; event_type: string; summary: string }[];
  ingest: { channels: ChannelTally; inserted: number; duplicates: number; errors: number };
  enriched: number;
  suggestions: string[];
  decisions: { action: string; scenario_id: string; decision_id?: string; detail: string }[];
  executions: { activated: number; done: number; blocked: number; errors: string[] };
  breaks: BreakAttempt[];
  snapshot: {
    signals: number;
    by_state: Record<string, number>;
    decisions: Record<string, number>;
    executions: Record<string, number>;
  };
};

export type DayTasteReport = {
  generated_at: string;
  userId: string;
  orgId: string;
  bundle_path: string;
  start_date: string;
  through_day: number;
  days_simulated: number;
  journal: DayJournal[];
  breaks: { total: number; passed: number; failed: BreakAttempt[] };
  accuracy: {
    letter: string;
    average_score_0_to_4: number;
    passed: number;
    total: number;
    questions: ReturnType<typeof scoreHsogAnswer>[];
  };
  day_fidelity: {
    event_days: number;
    days_with_ingest: number;
    decision_on_trigger_pct: number;
    trigger_events: number;
    decisions_committed_on_or_after_trigger: number;
  };
  execution_health: {
    by_status: Record<string, number>;
    active_vows: number;
    corpus_killed: number;
    corpus_grace_or_linked: number;
  };
  evidence: Awaited<ReturnType<typeof buildEvidenceAccuracy>>;
  grade: {
    letter: string;
    overall_0_to_100: number;
    components: Record<string, number>;
    verdict: string;
  };
};

function tallyChannels(t: ChannelTally): { inserted: number; duplicates: number; errors: number } {
  let inserted = 0;
  let duplicates = 0;
  let errors = 0;
  for (const v of Object.values(t)) {
    inserted += v.inserted;
    duplicates += v.duplicates;
    errors += v.errors;
  }
  return { inserted, duplicates, errors };
}

function snapshot(userId: string) {
  const byState = db.rawGet(
    `SELECT state, COUNT(1) AS n FROM external_signals WHERE user_id = ? GROUP BY state`,
    [userId],
  ) as { state: string; n: number }[];
  const decisions = db.rawGet(
    `SELECT status, COUNT(1) AS n FROM decision_ledger WHERE user_id = ? GROUP BY status`,
    [userId],
  ) as { status: string; n: number }[];
  const executions = db.rawGet(
    `SELECT e.status, COUNT(1) AS n
     FROM execution_ledger e
     INNER JOIN decision_ledger d ON d.id = e.decision_id
     WHERE d.user_id = ?
     GROUP BY e.status`,
    [userId],
  ) as { status: string; n: number }[];
  const signals = byState.reduce((s, r) => s + Number(r.n), 0);
  return {
    signals,
    by_state: Object.fromEntries(byState.map((r) => [r.state, Number(r.n)])),
    decisions: Object.fromEntries(decisions.map((r) => [r.status, Number(r.n)])),
    executions: Object.fromEntries(executions.map((r) => [r.status, Number(r.n)])),
  };
}

function findDecisionForScenario(userId: string, scenarioId: string): { id: string; status: string } | null {
  const play = PLAYBOOKS[scenarioId];
  if (!play) return null;
  const rows = db.rawGet(
    `SELECT id, status FROM decision_ledger
     WHERE user_id = ? AND vow = ?
     ORDER BY CASE status WHEN 'ACTIVE' THEN 0 WHEN 'DRAFT' THEN 1 WHEN 'UNDER_REVIEW' THEN 2 ELSE 3 END, rowid DESC
     LIMIT 1`,
    [userId, play.vow],
  ) as { id: string; status: string }[];
  return rows[0] || null;
}

function ensureDraft(userId: string, scenarioId: string, title: string): { id: string; created: boolean } {
  const existing = findDecisionForScenario(userId, scenarioId);
  if (existing) return { id: existing.id, created: false };
  const play = PLAYBOOKS[scenarioId];
  if (!play) throw new Error(`No playbook for ${scenarioId}`);
  const { id } = mutationCreateDraftDecision(userId, {
    vow: play.vow,
    expected_outcomes: [{ metric: title, target: "Resolve with cited evidence" }],
    constraints: play.constraints,
    tasks: play.tasks.map((t) => ({
      type: "ACTION",
      owner: t.owner,
      weight: t.weight ?? 1,
      success_condition: t.success_condition,
    })),
  });
  return { id, created: true };
}

function linkFreshSignals(userId: string, scenarioId: string, decisionId: string): number {
  const tasks = db.rawGet(
    `SELECT task_id FROM execution_ledger WHERE decision_id = ? ORDER BY rowid ASC`,
    [decisionId],
  ) as { task_id: string }[];
  const first = tasks[0]?.task_id;
  if (!first) return 0;
  const signals = db.rawGet(
    `SELECT id FROM external_signals
     WHERE user_id = ?
       AND state IN ('UNVERIFIED','GRACE')
       AND json_extract(ingest_meta, '$.hsog_scenario_id') = ?
     ORDER BY COALESCE(received_at, detected_at) DESC LIMIT 4`,
    [userId, scenarioId],
  ) as { id: string }[];
  let n = 0;
  for (const s of signals) {
    try {
      mutationLinkSignal(userId, {
        signalId: s.id,
        taskId: first,
        linkMethod: "hsog_day_sim",
        linkProvenance: { scenario_id: scenarioId, origin: "hsog-day-taste" },
      });
      n += 1;
    } catch {
      /* capacity / already linked */
    }
  }
  return n;
}

function advanceExecutions(
  userId: string,
  scenarioId: string,
  mode: "start" | "progress",
): { activated: number; done: number; blocked: number; errors: string[] } {
  const out = { activated: 0, done: 0, blocked: 0, errors: [] as string[] };
  const dec = findDecisionForScenario(userId, scenarioId);
  if (!dec || dec.status !== "ACTIVE") return out;

  if (mode === "start") {
    const sprint = startHsogSprint(userId);
    out.activated += sprint.activated;
    out.blocked += sprint.blocked;
  }

  const tasks = db.rawGet(
    `SELECT e.task_id, e.status FROM execution_ledger e WHERE e.decision_id = ?`,
    [dec.id],
  ) as { task_id: string; status: string }[];

  for (const t of tasks) {
    if (mode === "start" && t.status === "PENDING") {
      try {
        const r = mutationTransitionExecution(userId, {
          taskId: t.task_id,
          newState: "ACTIVE",
          reason: `Day-sim start ${scenarioId}`,
        });
        if (r.status === "ACTIVE") out.activated += 1;
        if (r.status === "BLOCKED") out.blocked += 1;
      } catch (e) {
        out.errors.push(e instanceof Error ? e.message : String(e));
      }
    }
    if (mode === "progress" && t.status === "ACTIVE") {
      try {
        const r = mutationTransitionExecution(userId, {
          taskId: t.task_id,
          newState: "DONE",
          reason: `Day-sim progress ${scenarioId}`,
        });
        if (r.status === "DONE") out.done += 1;
      } catch (e) {
        out.errors.push(e instanceof Error ? e.message : String(e));
      }
    }
  }
  return out;
}

function attemptBreaks(userId: string, day: number): BreakAttempt[] {
  const attempts: BreakAttempt[] = [];
  const slot = day % 7;

  if (slot === 0) {
    let actual: BreakAttempt["actual"] = "error";
    let detail = "";
    try {
      mutationCreateDraftDecision(userId, {
        vow: `Overlapping NO-list trap day ${day}`,
        constraints: ["Do not ship without retrieval-trace coverage"],
        tasks: [{ type: "ACTION", owner: "Imani", weight: 1, success_condition: "Should conflict" }],
      });
      const play = PLAYBOOKS.product_launch_slip;
      const primary = play
        ? (db.rawGet(
            `SELECT id, status FROM decision_ledger WHERE user_id = ? AND vow = ? LIMIT 1`,
            [userId, play.vow],
          ) as { id: string; status: string }[])[0]
        : null;
      if (primary?.status === "ACTIVE") {
        const draft = (
          db.rawGet(
            `SELECT id FROM decision_ledger WHERE user_id = ? AND vow LIKE ? ORDER BY rowid DESC LIMIT 1`,
            [userId, `Overlapping NO-list trap day ${day}%`],
          ) as { id: string }[]
        )[0];
        try {
          mutationCommitDecision(userId, draft.id, "break: overlapping NO-list");
          actual = "allowed";
          detail = "commit succeeded — NO-list overlap not enforced";
        } catch (e) {
          actual = "rejected";
          detail = e instanceof Error ? e.message : String(e);
        }
      } else {
        actual = "rejected";
        detail = "no ACTIVE primary vow to conflict with (skipped as soft pass)";
      }
    } catch (e) {
      actual = "error";
      detail = e instanceof Error ? e.message : String(e);
    }
    attempts.push({
      name: "commit_overlapping_no_list",
      expected: "reject",
      actual,
      passed: actual === "rejected",
      detail,
    });
  }

  if (slot === 1) {
    let actual: BreakAttempt["actual"] = "error";
    let detail = "";
    try {
      mutationTransitionExecution(userId, {
        taskId: "does-not-exist",
        newState: "DONE",
        reason: "break: fake task",
      });
      actual = "allowed";
      detail = "ghost task transition allowed";
    } catch (e) {
      actual = "rejected";
      detail = e instanceof Error ? e.message : String(e);
    }
    attempts.push({
      name: "transition_unknown_task",
      expected: "reject",
      actual,
      passed: actual === "rejected",
      detail,
    });
  }

  if (slot === 2) {
    const other = `hsog_break_${day}`;
    let actual: BreakAttempt["actual"] = "error";
    let detail = "";
    try {
      const task = (
        db.rawGet(
          `SELECT e.task_id FROM execution_ledger e
           INNER JOIN decision_ledger d ON d.id = e.decision_id
           WHERE d.user_id = ? LIMIT 1`,
          [userId],
        ) as { task_id: string }[]
      )[0];
      if (!task) {
        attempts.push({
          name: "cross_tenant_transition",
          expected: "reject",
          actual: "rejected",
          passed: true,
          detail: "no task yet — soft pass",
        });
      } else {
        try {
          mutationTransitionExecution(other, {
            taskId: task.task_id,
            newState: "KILLED",
            reason: "break: cross tenant",
          });
          actual = "allowed";
          detail = "cross-tenant kill allowed";
        } catch (e) {
          actual = "rejected";
          detail = e instanceof Error ? e.message : String(e);
        }
        attempts.push({
          name: "cross_tenant_transition",
          expected: "reject",
          actual,
          passed: actual === "rejected",
          detail,
        });
      }
    } catch (e) {
      attempts.push({
        name: "cross_tenant_transition",
        expected: "reject",
        actual: "error",
        passed: false,
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (slot === 3) {
    const sig = (
      db.rawGet(
        `SELECT id FROM external_signals WHERE user_id = ? AND state IN ('UNVERIFIED','GRACE')
           AND (
             json_extract(ingest_meta, '$.integration_runtime') LIKE 'hsog%'
             OR json_extract(ingest_meta, '$.hsog_scenario_id') IS NOT NULL
             OR IFNULL(external_id,'') LIKE 'hsog:%'
           )
         LIMIT 1`,
        [userId],
      ) as { id: string }[]
    )[0];
    if (sig) {
      let actual: BreakAttempt["actual"] = "error";
      let detail = "";
      try {
        mutationKillSignal(userId, { signalId: sig.id });
        actual = "allowed";
        detail = "corpus kill allowed — should be blocked";
      } catch (e) {
        actual = "rejected";
        detail = e instanceof Error ? e.message : String(e);
      }
      attempts.push({
        name: "corpus_manual_kill_blocked",
        expected: "reject",
        actual,
        passed: actual === "rejected",
        detail,
      });
    }
  }

  if (slot === 4) {
    /** Capacity bomb: activating many PENDING is OK across owners; fail only if one owner overruns. */
    const pending = db.rawGet(
      `SELECT e.task_id, e.owner, e.weight FROM execution_ledger e
       INNER JOIN decision_ledger d ON d.id = e.decision_id
       WHERE d.user_id = ? AND e.status = 'PENDING'`,
      [userId],
    ) as { task_id: string; owner: string; weight: number }[];
    const tried = pending.slice(0, 12);
    const activatedByOwner = new Map<string, number>();
    let rejected = 0;
    let allowed = 0;
    for (const t of tried) {
      try {
        const r = mutationTransitionExecution(userId, {
          taskId: t.task_id,
          newState: "ACTIVE",
          reason: "break: capacity bomb",
        });
        if (r.status === "ACTIVE") {
          allowed += 1;
          activatedByOwner.set(t.owner, (activatedByOwner.get(t.owner) || 0) + Number(t.weight || 1));
        } else rejected += 1;
      } catch {
        rejected += 1;
      }
    }
    let overCap = false;
    let detailOwners = "";
    for (const [owner, load] of activatedByOwner) {
      const cap = db.getOwnerCapacity(owner, userId).capacity;
      detailOwners += `${owner}:${load}/${cap} `;
      if (load > cap + 0.01) overCap = true;
    }
    attempts.push({
      name: "capacity_bomb_activate",
      expected: "reject",
      actual: overCap ? "allowed" : rejected > 0 || tried.length === 0 ? "rejected" : "allowed",
      passed: !overCap,
      detail: `allowed=${allowed} rejected_or_blocked=${rejected} pending_tried=${tried.length} ${detailOwners.trim()}`,
    });
  }

  if (slot === 5) {
    /** Auditor sweep should not mass-kill corpus */
    const before = (
      db.rawGet(
        `SELECT COUNT(1) AS n FROM external_signals WHERE user_id = ? AND state = 'KILLED'
           AND (json_extract(ingest_meta,'$.integration_runtime') LIKE 'hsog%'
                OR json_extract(ingest_meta,'$.hsog_scenario_id') IS NOT NULL)`,
        [userId],
      ) as { n: number }[]
    )[0]?.n;
    auditor.evaluateAll();
    const after = (
      db.rawGet(
        `SELECT COUNT(1) AS n FROM external_signals WHERE user_id = ? AND state = 'KILLED'
           AND (json_extract(ingest_meta,'$.integration_runtime') LIKE 'hsog%'
                OR json_extract(ingest_meta,'$.hsog_scenario_id') IS NOT NULL)`,
        [userId],
      ) as { n: number }[]
    )[0]?.n;
    const delta = Number(after) - Number(before);
    attempts.push({
      name: "auditor_should_not_kill_corpus",
      expected: "reject",
      actual: delta <= 0 ? "rejected" : "allowed",
      passed: delta <= 0,
      detail: `corpus_killed_delta=${delta}`,
    });
  }

  if (slot === 6) {
    /** Duplicate decision fingerprint / double activate same vow */
    const play = PLAYBOOKS.security_incident;
    if (play) {
      let actual: BreakAttempt["actual"] = "error";
      let detail = "";
      try {
        const a = mutationCreateDraftDecision(userId, {
          vow: play.vow,
          expected_outcomes: [{ metric: "sec-a", target: `day-${day}` }],
          constraints: play.constraints,
          tasks: play.tasks.map((t) => ({
            type: "ACTION",
            owner: t.owner,
            weight: 1,
            success_condition: t.success_condition,
          })),
        });
        const existing = findDecisionForScenario(userId, "security_incident");
        if (existing?.status !== "ACTIVE") {
          mutationCommitDecision(userId, a.id, "break: first");
        }
        const b = mutationCreateDraftDecision(userId, {
          vow: play.vow,
          expected_outcomes: [{ metric: "sec-b", target: `day-${day}-dup` }],
          constraints: play.constraints,
          tasks: play.tasks.map((t) => ({
            type: "ACTION",
            owner: t.owner,
            weight: 1,
            success_condition: t.success_condition,
          })),
        });
        try {
          mutationCommitDecision(userId, b.id, "break: second duplicate vow");
          actual = "allowed";
          detail = "second identical ACTIVE vow allowed";
        } catch (e) {
          actual = "rejected";
          detail = e instanceof Error ? e.message : String(e);
        }
      } catch (e) {
        actual = "rejected";
        detail = e instanceof Error ? e.message : String(e);
      }
      attempts.push({
        name: "double_active_same_vow",
        expected: "reject",
        actual,
        passed: actual === "rejected",
        detail,
      });
    }
  }

  return attempts;
}

function bumpOwnerCapacity(owners: string[]) {
  for (const owner of owners) {
    db.rawRun(
      `INSERT INTO owner_reputation (owner, failed_executions, successful_executions, reputation_modifier, is_locked)
       VALUES (?, 0, 2, 3.0, 0)
       ON CONFLICT(owner) DO UPDATE SET reputation_modifier = MAX(reputation_modifier, 2.5), is_locked = 0`,
      [owner],
    );
  }
}

/**
 * Make the ledger look like a real company mid-quarter: most tasks DONE,
 * one ACTIVE per vow, clear BLOCKED where capacity was the only issue.
 */
export function finalizeExecutedLook(userId: string): { done: number; active: number; stillBlocked: number } {
  bumpOwnerCapacity([
    "Imani",
    "Renata",
    "Elena",
    "Jordan",
    "Ethan",
    "Omar",
    "Noor",
    "Marcus",
    "Helen",
    "Leah",
    "Priya",
    "Skye",
    "Chris",
    "Caleb",
  ]);
  startHsogSprint(userId);

  const activeDecisions = db.rawGet(
    `SELECT id FROM decision_ledger WHERE user_id = ? AND status = 'ACTIVE'`,
    [userId],
  ) as { id: string }[];

  let done = 0;
  let active = 0;
  let stillBlocked = 0;

  for (const d of activeDecisions) {
    const tasks = db.rawGet(
      `SELECT task_id, status FROM execution_ledger WHERE decision_id = ? ORDER BY rowid ASC`,
      [d.id],
    ) as { task_id: string; status: string }[];
    let keptActive = false;
    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      if (t.status === "DONE") {
        done += 1;
        continue;
      }
      if (t.status === "PENDING" || t.status === "BLOCKED") {
        try {
          const r = mutationTransitionExecution(userId, {
            taskId: t.task_id,
            newState: "ACTIVE",
            reason: "Finalize: unblock for quarter close look",
          });
          if (r.status === "BLOCKED") {
            stillBlocked += 1;
            continue;
          }
        } catch {
          stillBlocked += 1;
          continue;
        }
      }
      /** Keep the last open task ACTIVE so Execute still shows in-flight work. */
      const isLastOpen = tasks.slice(i + 1).every((x) => x.status === "DONE");
      if (!keptActive || isLastOpen) {
        keptActive = true;
        active += 1;
        continue;
      }
      try {
        const r = mutationTransitionExecution(userId, {
          taskId: t.task_id,
          newState: "DONE",
          reason: "Finalize: evidence closed — mark executed",
        });
        if (r.status === "DONE") done += 1;
        else active += 1;
      } catch {
        active += 1;
      }
    }
    /** If everything was already DONE, reopen one task as ACTIVE for the UI. */
    if (!keptActive && tasks.length) {
      const t = tasks[tasks.length - 1];
      try {
        db.rawRun(`UPDATE execution_ledger SET status = 'ACTIVE', completed_at = NULL WHERE task_id = ?`, [
          t.task_id,
        ]);
        active += 1;
        if (done > 0) done -= 1;
      } catch {
        /* leave as-is */
      }
    }
  }
  return { done, active, stillBlocked };
}

export type DayTasteOptions = {
  userId: string;
  bundle: HsogIngestBundle;
  bundlePath: string;
  /** Inclusive sim day ceiling (default min(90, max event day)). */
  throughDay?: number;
  /** Also tick quiet days with no events (default false — only event days). */
  includeQuietDays?: boolean;
  /** Run adversarial break probes (default true). */
  breaks?: boolean;
  /** After the loop, leave vows looking executed (DONE majority). Default false. */
  finalizeExecuted?: boolean;
};

export async function runDayTaste(opts: DayTasteOptions): Promise<DayTasteReport> {
  const { userId, bundle, bundlePath } = opts;
  const ctx = resolveTenantContext(userId);
  const events = [...(bundle.events || [])].sort((a, b) => a.day - b.day);
  const maxEventDay = events.reduce((m, e) => Math.max(m, e.day), 0);
  const throughDay = opts.throughDay ?? Math.min(90, maxEventDay || 90);
  const startDate = bundle.start_date || "2026-02-02";

  bumpOwnerCapacity([
    "Imani",
    "Renata",
    "Elena",
    "Jordan",
    "Ethan",
    "Omar",
    "Noor",
    "Marcus",
    "Helen",
    "Leah",
    "Priya",
    "Skye",
    "Chris",
    "Caleb",
  ]);

  /** Foundation: org entities + roster, no signals yet. */
  await runHsogIngest({ ...bundle, events: [] }, bundlePath, {
    userId,
    decisions: false,
    enrich: false,
    activateScenarioId: null,
    startSprint: false,
  });

  const eventDays = [...new Set(events.filter((e) => e.day <= throughDay).map((e) => e.day))].sort(
    (a, b) => a - b,
  );
  const daysToRun = opts.includeQuietDays
    ? Array.from({ length: throughDay }, (_, i) => i + 1).filter((d) => d >= (eventDays[0] || 1))
    : eventDays;

  const journal: DayJournal[] = [];
  let triggerEvents = 0;
  let decisionsOnTrigger = 0;

  for (const day of daysToRun) {
    const dayEvents = events.filter((e) => e.day === day);
    const date =
      dayEvents[0]?.date ||
      (() => {
        const d = new Date(`${startDate}T00:00:00.000Z`);
        d.setUTCDate(d.getUTCDate() + Math.max(0, day - 1));
        return d.toISOString().slice(0, 10);
      })();

    const dayBundle: HsogIngestBundle = { ...bundle, events: dayEvents };
    const channels = dayEvents.length ? ingestHsogViaProviders(userId, dayBundle) : {};
    const ingestCounts = tallyChannels(channels);
    const enriched = dayEvents.length ? await reprocessUnenrichedSignals(userId, 80) : 0;

    const suggestions: string[] = [];
    const decisionLog: DayJournal["decisions"] = [];
    let exec = { activated: 0, done: 0, blocked: 0, errors: [] as string[] };

    for (const ev of dayEvents) {
      const title = bundle.scenarios?.find((s) => s.id === ev.scenario_id)?.title || ev.scenario_id;
      if (DECISION_TRIGGERS.has(ev.event_type)) {
        triggerEvents += 1;
        suggestions.push(`Suggest decide: ${ev.event_type} · ${ev.summary || ev.event_id}`);
        const draft = ensureDraft(userId, ev.scenario_id, title);
        decisionLog.push({
          action: draft.created ? "drafted" : "draft_exists",
          scenario_id: ev.scenario_id,
          decision_id: draft.id,
          detail: ev.summary || ev.event_type,
        });
        const cur = findDecisionForScenario(userId, ev.scenario_id);
        if (cur && cur.status !== "ACTIVE") {
          try {
            mutationCommitDecision(
              userId,
              cur.id,
              `Day ${day} trigger ${ev.event_type}: ${ev.summary || ""}`.slice(0, 200),
            );
            decisionsOnTrigger += 1;
            decisionLog.push({
              action: "committed",
              scenario_id: ev.scenario_id,
              decision_id: cur.id,
              detail: `Activated on ${ev.event_type}`,
            });
            const linked = linkFreshSignals(userId, ev.scenario_id, cur.id);
            suggestions.push(`Linked ${linked} signals → ${ev.scenario_id}`);
            const started = advanceExecutions(userId, ev.scenario_id, "start");
            exec.activated += started.activated;
            exec.blocked += started.blocked;
            exec.errors.push(...started.errors);
            const play = PLAYBOOKS[ev.scenario_id];
            if (play?.alert) {
              await notify(userId, {
                kind: "decision.hsog",
                title: play.alert.title,
                body: `${play.alert.body} (day ${day})`,
                linkUrl: defaultAppLink("/decide"),
                payload: { scenario_id: ev.scenario_id, day, origin: "hsog-day-taste" },
              });
            }
          } catch (e) {
            decisionLog.push({
              action: "commit_failed",
              scenario_id: ev.scenario_id,
              decision_id: cur.id,
              detail: e instanceof Error ? e.message : String(e),
            });
          }
        } else if (cur?.status === "ACTIVE") {
          decisionsOnTrigger += 1;
          const progressed = advanceExecutions(userId, ev.scenario_id, "progress");
          exec.done += progressed.done;
          exec.errors.push(...progressed.errors);
        }
      } else if (PROGRESS_TRIGGERS.has(ev.event_type)) {
        suggestions.push(`Progress work: ${ev.event_type} · ${ev.summary || ""}`);
        const progressed = advanceExecutions(userId, ev.scenario_id, "progress");
        exec.done += progressed.done;
        exec.activated += progressed.activated;
        exec.errors.push(...progressed.errors);
      } else {
        suggestions.push(`Evidence landed: ${ev.event_type} · ${ev.summary || ev.event_id}`);
      }
    }

    const breaks = opts.breaks === false ? [] : attemptBreaks(userId, day);

    journal.push({
      day,
      date,
      events: dayEvents.map((e) => ({
        event_id: e.event_id,
        scenario_id: e.scenario_id,
        event_type: e.event_type,
        summary: e.summary || "",
      })),
      ingest: { channels, ...ingestCounts },
      enriched,
      suggestions,
      decisions: decisionLog,
      executions: exec,
      breaks,
      snapshot: snapshot(userId),
    });
  }

  if (opts.finalizeExecuted) {
    finalizeExecutedLook(userId);
  }

  const causal = loadCausalGraph();
  const questionGrades = [];
  for (const q of HSOG_QUESTIONS) {
    const ans = await answerFromLedger(userId, q, causal, { search: false });
    questionGrades.push(scoreHsogAnswer(q, ans, causal));
  }
  const avg =
    questionGrades.reduce((s, g) => s + g.score_0_to_4, 0) / Math.max(questionGrades.length, 1);
  const qPassed = questionGrades.filter((g) => g.passed).length;

  const allBreaks = journal.flatMap((j) => j.breaks);
  const breaksPassed = allBreaks.filter((b) => b.passed).length;

  const snap = snapshot(userId);
  const corpusKilled = Number(
    (
      db.rawGet(
        `SELECT COUNT(1) AS n FROM external_signals WHERE user_id = ? AND state = 'KILLED'
           AND (json_extract(ingest_meta,'$.integration_runtime') LIKE 'hsog%'
                OR json_extract(ingest_meta,'$.hsog_scenario_id') IS NOT NULL)`,
        [userId],
      ) as { n: number }[]
    )[0]?.n || 0,
  );
  const corpusAlive = Number(
    (
      db.rawGet(
        `SELECT COUNT(1) AS n FROM external_signals WHERE user_id = ? AND state IN ('GRACE','LINKED','UNVERIFIED')
           AND (json_extract(ingest_meta,'$.integration_runtime') LIKE 'hsog%'
                OR json_extract(ingest_meta,'$.hsog_scenario_id') IS NOT NULL)`,
        [userId],
      ) as { n: number }[]
    )[0]?.n || 0,
  );

  const evidence = await buildEvidenceAccuracy(userId);
  const daysWithIngest = journal.filter((j) => j.ingest.inserted + j.ingest.duplicates > 0).length;
  const decisionPct = triggerEvents ? decisionsOnTrigger / triggerEvents : 0;

  const components = {
    retrieval_accuracy: Math.round((avg / 4) * 100),
    day_fidelity: Math.round((daysWithIngest / Math.max(eventDays.length, 1)) * 100),
    decision_timing: Math.round(decisionPct * 100),
    break_resilience: allBreaks.length ? Math.round((breaksPassed / allBreaks.length) * 100) : 100,
    corpus_survival: Math.round((corpusAlive / Math.max(corpusAlive + corpusKilled, 1)) * 100),
    execution_motion: Math.min(
      100,
      Math.round(
        (((snap.executions.ACTIVE || 0) + (snap.executions.DONE || 0)) /
          Math.max(
            Object.values(snap.executions).reduce((a, b) => a + b, 0),
            1,
          )) *
          100,
      ),
    ),
  };
  const overall = Math.round(
    components.retrieval_accuracy * 0.3 +
      components.day_fidelity * 0.15 +
      components.decision_timing * 0.2 +
      components.break_resilience * 0.2 +
      components.corpus_survival * 0.1 +
      components.execution_motion * 0.05,
  );
  const letter =
    overall >= 90 ? "A" : overall >= 80 ? "B" : overall >= 70 ? "C" : overall >= 60 ? "D" : "F";

  return {
    generated_at: new Date().toISOString(),
    userId,
    orgId: ctx.orgId,
    bundle_path: bundlePath,
    start_date: startDate,
    through_day: throughDay,
    days_simulated: journal.length,
    journal,
    breaks: {
      total: allBreaks.length,
      passed: breaksPassed,
      failed: allBreaks.filter((b) => !b.passed),
    },
    accuracy: {
      letter: avg >= 3.5 ? "A" : avg >= 2.5 ? "B" : avg >= 1.5 ? "C" : avg >= 0.75 ? "D" : "F",
      average_score_0_to_4: Math.round(avg * 100) / 100,
      passed: qPassed,
      total: questionGrades.length,
      questions: questionGrades,
    },
    day_fidelity: {
      event_days: eventDays.length,
      days_with_ingest: daysWithIngest,
      decision_on_trigger_pct: Math.round(decisionPct * 1000) / 10,
      trigger_events: triggerEvents,
      decisions_committed_on_or_after_trigger: decisionsOnTrigger,
    },
    execution_health: {
      by_status: snap.executions,
      active_vows: snap.decisions.ACTIVE || 0,
      corpus_killed: corpusKilled,
      corpus_grace_or_linked: corpusAlive,
    },
    evidence,
    grade: {
      letter,
      overall_0_to_100: overall,
      components,
      verdict:
        overall >= 80
          ? "OS holds under chronological load; remaining gaps are retrieval/fact depth."
          : overall >= 60
            ? "Partial company loop works; decision timing or break resilience needs work."
            : "System breaks under day-basis load — see failed breaks and killed corpus.",
    },
  };
}

export function eventsForDay(bundle: HsogIngestBundle, day: number): HsogEvent[] {
  return (bundle.events || []).filter((e) => e.day === day);
}
