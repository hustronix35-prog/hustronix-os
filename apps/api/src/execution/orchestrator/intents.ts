import type { ExecutionPlan, ExecutionPlanAction } from "../execution-plan.js";
import type { ExecutionIntent } from "./types.js";

export type UnlinkedWork = {
  signalId: string;
  source: string;
  externalId: string | null;
  content: string;
  owner: string | null;
};

export type OwnerCandidate = {
  name: string;
  loadPct: number;
  status: string;
  team: string;
};

function tokens(s: string): Set<string> {
  return new Set(
    String(s || "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 4),
  );
}

function overlapScore(a: string, b: string): number {
  const A = tokens(a);
  const B = tokens(b);
  let n = 0;
  for (const t of A) if (B.has(t)) n += 1;
  return n;
}

function ownerUnclear(owner: string): boolean {
  const o = (owner || "").trim().toLowerCase();
  return !o || o === "system" || o === "unknown";
}

export function matchExistingWork(
  work: UnlinkedWork,
  action: ExecutionPlanAction,
): { hit: boolean; score: number; reason: string } {
  const key = String(work.externalId || "").trim();
  const hay = `${action.label} ${action.taskId}`.toLowerCase();
  if (key && hay.includes(key.toLowerCase())) {
    return { hit: true, score: 10, reason: "external_id_in_task" };
  }
  const score = overlapScore(`${work.externalId || ""} ${work.content}`, action.label);
  if (score >= 2) return { hit: true, score, reason: "token_overlap" };
  return { hit: false, score, reason: "none" };
}

export function pickOwnerCandidate(
  label: string,
  currentOwner: string,
  people: OwnerCandidate[],
  loads: Array<{ owner: string; conflict: boolean }>,
): { owner: string; loadPct: number; reason: string } | null {
  if (!ownerUnclear(currentOwner)) {
    const conflict = loads.some((l) => l.owner === currentOwner && l.conflict);
    const person = people.find((p) => p.name === currentOwner);
    return {
      owner: currentOwner,
      loadPct: person?.loadPct ?? 0,
      reason: conflict ? "current_owner_over_capacity" : "current_owner_retained",
    };
  }
  const labelTok = tokens(label);
  const ranked = people
    .filter((p) => p.status !== "Over Capacity")
    .map((p) => ({
      p,
      teamHit: [...tokens(p.team)].some((t) => labelTok.has(t)) ? 1 : 0,
    }))
    .sort((a, b) => b.teamHit - a.teamHit || a.p.loadPct - b.p.loadPct);
  const pick = ranked[0]?.p || people.slice().sort((a, b) => a.loadPct - b.loadPct)[0];
  if (!pick) return null;
  const teamHit = ranked[0]?.teamHit === 1;
  return {
    owner: pick.name,
    loadPct: pick.loadPct,
    reason: teamHit ? `team_alignment_${pick.team}` : `lowest_load_${pick.team || "unassigned"}`,
  };
}

export function generateIntents(input: {
  plan: ExecutionPlan;
  unlinkedWork: UnlinkedWork[];
  people: OwnerCandidate[];
}): ExecutionIntent[] {
  const { plan, unlinkedWork, people } = input;
  const out: ExecutionIntent[] = [];
  const linkedTaskIds = new Set<string>();
  const usedSignals = new Set<string>();

  for (const work of unlinkedWork) {
    let best: { action: ExecutionPlanAction; score: number; reason: string } | null = null;
    for (const action of plan.actions) {
      if (action.kind === "done" || action.kind === "killed") continue;
      const m = matchExistingWork(work, action);
      if (!m.hit) continue;
      if (!best || m.score > best.score) best = { action, score: m.score, reason: m.reason };
    }
    if (!best) continue;
    usedSignals.add(work.signalId);
    linkedTaskIds.add(best.action.taskId);
    out.push({
      actionType: "LINK_EXISTING_WORK",
      targetSystem: "ledger",
      decisionId: plan.decisionId,
      executionId: best.action.taskId,
      idempotencyKey: `link:${work.signalId}:${best.action.taskId}`,
      reason: `Existing ${work.source} ${work.externalId || work.signalId} matches “${best.action.label}” (${best.reason}).`,
      owner: best.action.owner,
      risk: "LOW",
      payload: {
        signalId: work.signalId,
        taskId: best.action.taskId,
        source: work.source,
        externalId: work.externalId,
        matchReason: best.reason,
      },
    });
  }

  for (const action of plan.actions) {
    if (action.kind === "done" || action.kind === "killed") continue;
    const hasWork = action.existingWork.length > 0 || linkedTaskIds.has(action.taskId);
    if (!hasWork) {
      out.push({
        actionType: "CREATE_JIRA",
        targetSystem: "jira",
        decisionId: plan.decisionId,
        executionId: action.taskId,
        idempotencyKey: `jira:${action.taskId}`,
        reason: `Missing project work for “${action.label}”.`,
        owner: action.owner,
        risk: "MEDIUM",
        payload: {
          title: action.label,
          why: `Required to execute decision ${plan.decisionId}.`,
          expectedOutcome: action.label,
          owner: action.owner,
          decisionId: plan.decisionId,
        },
      });
    }

    if (action.kind === "blocked" || action.kind === "needs_clarification") {
      out.push({
        actionType: "ASK_CLARIFICATION",
        targetSystem: "ledger",
        decisionId: plan.decisionId,
        executionId: action.taskId,
        idempotencyKey: `clarify:${action.taskId}`,
        reason: action.blockedReasons[0] || action.clarification?.trigger || "Execution needs an owner answer.",
        owner: action.owner,
        risk: "LOW",
        payload: { taskId: action.taskId, kind: action.kind },
      });
      if (!ownerUnclear(action.owner)) {
        out.push({
          actionType: "NOTIFY_OWNER",
          targetSystem: "notify",
          decisionId: plan.decisionId,
          executionId: action.taskId,
          idempotencyKey: `notify:owner:${action.taskId}`,
          reason: `Action required: “${action.label}” is ${action.kind.replace(/_/g, " ")}.`,
          owner: action.owner,
          risk: "LOW",
          payload: { audience: "owner", taskId: action.taskId, label: action.label },
        });
      }
    }

    if (ownerUnclear(action.owner)) {
      const rec = pickOwnerCandidate(action.label, action.owner, people, plan.owners);
      if (rec) {
        out.push({
          actionType: "RECOMMEND_OWNER",
          targetSystem: "people",
          decisionId: plan.decisionId,
          executionId: action.taskId,
          idempotencyKey: `recommend:${action.taskId}:${rec.owner}`,
          reason: `Recommended owner ${rec.owner} (${rec.reason}, load ${rec.loadPct}%).`,
          owner: rec.owner,
          risk: "LOW",
          payload: { taskId: action.taskId, candidate: rec.owner, loadPct: rec.loadPct, why: rec.reason },
        });
        out.push({
          actionType: "ASSIGN_OWNER",
          targetSystem: "people",
          decisionId: plan.decisionId,
          executionId: action.taskId,
          idempotencyKey: `assign:${action.taskId}`,
          reason: `Assign “${action.label}” to ${rec.owner}.`,
          owner: rec.owner,
          risk: "MEDIUM",
          payload: { taskId: action.taskId, owner: rec.owner, fromLoadPct: rec.loadPct },
        });
      }
    }
  }

  const coordOwners = [
    ...new Set(
      plan.actions
        .filter((a) => a.kind !== "done" && a.kind !== "killed" && (a.incompleteDeps > 0 || a.kind === "blocked"))
        .map((a) => a.owner)
        .filter((o) => !ownerUnclear(o)),
    ),
  ];
  if (coordOwners.length >= 3) {
    out.push({
      actionType: "CREATE_MEETING",
      targetSystem: "calendar",
      decisionId: plan.decisionId,
      idempotencyKey: `meeting:${plan.decisionId}:coordination`,
      reason: `${coordOwners.length} workstreams cannot progress independently.`,
      owner: coordOwners[0],
      risk: "MEDIUM",
      payload: {
        title: `Resolve dependencies: ${plan.vow.slice(0, 72)}`,
        participants: coordOwners.slice(0, 8),
        agenda: [
          "What remains blocked?",
          "Who owns each blocker?",
          "Expected resolution date?",
          "What dependency remains?",
          "Does the commitment remain achievable?",
        ],
        durationMinutes: 30,
      },
    });
  }

  const blocked = plan.counts.blocked + plan.counts.needsClarification;
  if (!blocked) {
    out.push({
      actionType: "NOTIFY_FOUNDER",
      targetSystem: "notify",
      decisionId: plan.decisionId,
      idempotencyKey: `notify:founder:${plan.decisionId}`,
      reason: "No action required — execution is not blocked.",
      risk: "LOW",
      payload: { audience: "founder", tone: "on_track", readinessPct: plan.readinessPct },
    });
  } else {
    out.push({
      actionType: "NOTIFY_FOUNDER",
      targetSystem: "notify",
      decisionId: plan.decisionId,
      idempotencyKey: `notify:founder:${plan.decisionId}:watch`,
      reason: `${blocked} item${blocked === 1 ? "" : "s"} need clarification. No intervention required unless they stall.`,
      risk: "LOW",
      payload: { audience: "founder", tone: "informational", blocked },
    });
  }

  return out;
}
