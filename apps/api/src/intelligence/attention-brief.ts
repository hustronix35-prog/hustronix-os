/**
 * Home brief: what needs attention, ranked, each item opens Talk.
 */
import { db } from "../database.js";
import { getReadinessPrior } from "./readiness-learning.js";
import { buildOrgIntelligence } from "../org/intelligence.js";

export type AttentionItem = {
  rank: number;
  kind:
    | "decision_ready"
    | "worsening"
    | "blocked_execution"
    | "capacity"
    | "awaiting_validation"
    | "failed_outcome";
  title: string;
  why: string;
  talkPrompt: string;
  href: string;
};

export type AttentionBrief = {
  headline: string;
  items: AttentionItem[];
};

export function buildAttentionBrief(userId: string): AttentionBrief {
  const items: Omit<AttentionItem, "rank">[] = [];

  const ready = db.rawGet(
    `SELECT id, title, confidence, trajectory FROM situations
     WHERE user_id = ? AND stage = 'DECISION_READY'
     ORDER BY confidence DESC LIMIT 6`,
    [userId],
  ) as { id: string; title: string; confidence: number; trajectory: string }[];
  for (const s of ready) {
    const prior = getReadinessPrior(userId, "open_world");
    items.push({
      kind: "decision_ready",
      title: s.title,
      why: `Decision-ready (${Math.round((s.confidence || 0) * 100)}% confidence, ${String(s.trajectory || "").toLowerCase() || "unknown"}).${prior.sample_count ? ` Learning: ${prior.explanation}` : ""}`,
      talkPrompt: `What's happening with ${s.title}?`,
      href: `/chat?q=${encodeURIComponent(`What's happening with ${s.title}?`)}`,
    });
  }

  const worse = db.rawGet(
    `SELECT id, title, stage FROM situations
     WHERE user_id = ? AND trajectory = 'WORSENING' AND stage NOT IN ('RESOLVED','DECISION_READY')
     ORDER BY updated_at DESC LIMIT 6`,
    [userId],
  ) as { id: string; title: string; stage: string }[];
  for (const s of worse) {
    items.push({
      kind: "worsening",
      title: s.title,
      why: `Worsening while ${String(s.stage).toLowerCase().replace(/_/g, " ")}.`,
      talkPrompt: `Why is ${s.title} getting worse?`,
      href: `/chat?q=${encodeURIComponent(`Why is ${s.title} getting worse?`)}`,
    });
  }

  const blocked = db.rawGet(
    `SELECT e.task_id, e.owner, e.success_condition, e.blocked_reasons, d.vow
     FROM execution_ledger e
     INNER JOIN decision_ledger d ON d.id = e.decision_id
     WHERE d.user_id = ? AND e.status = 'BLOCKED'
     ORDER BY e.last_update DESC LIMIT 6`,
    [userId],
  ) as {
    task_id: string;
    owner: string;
    success_condition: string | null;
    blocked_reasons: string | null;
    vow: string;
  }[];
  for (const b of blocked) {
    let reason = "";
    try {
      const arr = JSON.parse(String(b.blocked_reasons || "[]"));
      reason = Array.isArray(arr) ? String(arr[0] || "") : "";
    } catch {
      reason = String(b.blocked_reasons || "");
    }
    items.push({
      kind: "blocked_execution",
      title: String(b.success_condition || b.vow).slice(0, 80),
      why: `${b.owner} blocked${reason ? ` (${reason})` : ""}.`,
      talkPrompt: `Why is execution blocked for ${b.owner}?`,
      href: `/chat?q=${encodeURIComponent(`Why is execution blocked for ${b.owner}?`)}`,
    });
  }

  const drafts = db.rawGet(
    `SELECT id, vow FROM decision_ledger WHERE user_id = ? AND status = 'DRAFT' LIMIT 4`,
    [userId],
  ) as { id: string; vow: string }[];
  for (const d of drafts) {
    items.push({
      kind: "awaiting_validation",
      title: d.vow.slice(0, 80),
      why: "DRAFT awaiting validation in Talk before it can become ACTIVE.",
      talkPrompt: "Validate the next check.",
      href: `/chat?q=${encodeURIComponent("Validate the next check.")}`,
    });
  }

  const failed = db.rawGet(
    `SELECT o.decision_id, o.learning_notes, d.vow
     FROM decision_outcomes o
     INNER JOIN decision_ledger d ON d.id = o.decision_id
     WHERE d.user_id = ? AND o.result = 'failed'
     ORDER BY o.evaluated_at DESC LIMIT 4`,
    [userId],
  ) as { decision_id: string; learning_notes: string | null; vow: string }[];
  for (const f of failed) {
    items.push({
      kind: "failed_outcome",
      title: f.vow.slice(0, 80),
      why: String(f.learning_notes || "Outcome evaluated as failed.").slice(0, 180),
      talkPrompt: "What did we learn?",
      href: `/chat?q=${encodeURIComponent("What did we learn?")}`,
    });
  }

  try {
    const org = buildOrgIntelligence(userId);
    for (const p of org.people.filter((x) => x.workload === "High").slice(0, 3)) {
      items.push({
        kind: "capacity",
        title: `${p.name} overloaded`,
        why: `${p.team}: ${p.loadPct}% load, ${p.active} active / ${p.blocked} blocked.`,
        talkPrompt: `Can we actually execute this? ${p.name} looks overloaded.`,
        href: `/chat?q=${encodeURIComponent("Can we actually execute this?")}`,
      });
    }
  } catch {
    /* org map optional */
  }

  const kindOrder: Record<AttentionItem["kind"], number> = {
    decision_ready: 1,
    worsening: 2,
    blocked_execution: 3,
    capacity: 4,
    awaiting_validation: 5,
    failed_outcome: 6,
  };
  const ranked = items
    .sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind])
    .slice(0, 8)
    .map((item, i) => ({ ...item, rank: i + 1 }));

  return {
    headline: ranked.length ? "What needs attention" : "Nothing urgent on the ledger right now.",
    items: ranked,
  };
}
