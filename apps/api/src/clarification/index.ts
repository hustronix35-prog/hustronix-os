/**
 * Clarification is an exception channel for execution uncertainty.
 *
 * Chat/messages are transport. ClarificationRequest is the workflow object.
 * Ledger + signals + audit_log remain the source of truth.
 *
 * Flow: owner answer → extract claims (LLM proposes, heuristic fallback)
 *     → validate → allowed mutation → ledger/signal → auditor.
 */
import { v4 as uuidv4 } from "uuid";
import { db } from "../database.js";
import { chat, hasLlmCredentials } from "../llm.js";
import { notify, defaultAppLink } from "../notifications/dispatcher.js";
import { mutationLinkSignal, mutationTransitionExecution } from "../security/mutation-handlers.js";
import { wrapUntrustedContent } from "../security/prompt-injection.js";

export const CLARIFICATION_TRIGGERS = [
  "BLOCKED",
  "STALE",
  "MISSING_FIELD",
  "CONFLICT",
  "DEPENDENCY_UNCLEAR",
  "OWNER_UNCLEAR",
] as const;

export const CLARIFICATION_QUESTION_TYPES = [
  "STATUS",
  "ETA",
  "BLOCKER",
  "FACT",
  "DEPENDENCY",
  "OWNERSHIP",
] as const;

export type ClarificationTrigger = (typeof CLARIFICATION_TRIGGERS)[number];
export type ClarificationQuestionType = (typeof CLARIFICATION_QUESTION_TYPES)[number];
export type ClarificationStatus = "OPEN" | "ANSWERED" | "COMMITTED" | "DISMISSED" | "EXPIRED";

export type ClarificationClaim =
  | { kind: "eta"; date: string; raw: string }
  | { kind: "status"; status: "PENDING" | "ACTIVE" | "DONE" | "BLOCKED"; raw: string }
  | { kind: "blocker"; text: string }
  | { kind: "dependency"; note: string; taskHint?: string }
  | { kind: "owner"; owner: string }
  | { kind: "fact"; field: string; value: string };

export type AllowedMutation =
  | { type: "set_duration_hours"; hours: number }
  | { type: "transition"; newState: "PENDING" | "ACTIVE" | "DONE" | "BLOCKED"; reason: string }
  | { type: "set_owner"; owner: string }
  | { type: "add_dependency"; depTaskId: string }
  | { type: "set_success_condition"; text: string }
  | { type: "ingest_signal"; content: string };

export interface ClarificationRow {
  id: string;
  task_id: string;
  decision_id: string | null;
  user_id: string;
  owner: string;
  owner_user_id: string | null;
  trigger: ClarificationTrigger;
  question_type: ClarificationQuestionType;
  question: string;
  reason: string;
  requested_fields: string | null;
  trigger_fingerprint: string;
  status: ClarificationStatus;
  answer: string | null;
  extracted_claims: string | null;
  proposed_mutations: string | null;
  committed_mutations: string | null;
  rejected_claims: string | null;
  created_at: string;
  answered_at: string | null;
  committed_at: string | null;
}

type TaskSnapshot = {
  task_id: string;
  decision_id: string;
  owner: string;
  status: string;
  blocked_reasons: string | null;
  success_condition: string | null;
  dependencies: string | null;
  last_update: string | null;
  started_at: string | null;
  estimated_duration_hours: number | null;
  user_id: string;
  vow: string | null;
};

const STALE_HOURS = Math.max(1, Number(process.env.CLARIFICATION_STALE_HOURS || 24) || 24);
const VALID_STATUSES = new Set(["PENDING", "ACTIVE", "DONE", "BLOCKED"]);

function audit(action: string, reason: string, entityId: string | null) {
  db.rawRun("INSERT INTO audit_log (action, reason, affected_entity_id) VALUES (?, ?, ?)", [
    action,
    reason,
    entityId,
  ]);
}

function parseJsonArray(raw: string | null): unknown[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function taskLabel(task: Pick<TaskSnapshot, "success_condition" | "task_id">): string {
  return String(task.success_condition || task.task_id).trim().slice(0, 80) || task.task_id;
}

function ownerUnclear(owner: string): boolean {
  const o = (owner || "").trim().toLowerCase();
  return !o || o === "system" || o === "unknown";
}

function blockedReasons(task: TaskSnapshot): string[] {
  const parsed = parseJsonArray(task.blocked_reasons);
  return parsed.map((r) => String(r)).filter(Boolean);
}

function hasIncompleteDeps(task: TaskSnapshot): boolean {
  const reasons = blockedReasons(task);
  if (reasons.some((r) => r.toLowerCase().includes("dependency"))) return true;
  const deps = parseJsonArray(task.dependencies).map((d) => String(d));
  if (!deps.length) return false;
  for (const depId of deps) {
    const row = db.rawGet(`SELECT status FROM execution_ledger WHERE task_id = ?`, [depId])[0] as
      | { status: string }
      | undefined;
    if (!row || row.status !== "DONE") return true;
  }
  return false;
}

function isStale(task: TaskSnapshot): boolean {
  if (!task.last_update) return false;
  if (task.status !== "ACTIVE" && task.status !== "PENDING") return false;
  const hit = db.rawGet(
    `SELECT 1 AS ok FROM execution_ledger WHERE task_id = ? AND datetime(last_update) < datetime('now', ?)`,
    [task.task_id, `-${STALE_HOURS} hours`],
  )[0];
  return Boolean(hit);
}

function missingSuccess(task: TaskSnapshot): boolean {
  return !String(task.success_condition || "").trim() && task.status !== "DONE" && task.status !== "KILLED";
}

export function detectClarificationNeed(task: TaskSnapshot): {
  trigger: ClarificationTrigger;
  questionType: ClarificationQuestionType;
  requestedFields: string[];
} | null {
  if (!["PENDING", "ACTIVE", "BLOCKED"].includes(task.status)) return null;

  if (ownerUnclear(task.owner)) {
    return { trigger: "OWNER_UNCLEAR", questionType: "OWNERSHIP", requestedFields: ["owner"] };
  }
  if (task.status === "BLOCKED") {
    if (hasIncompleteDeps(task)) {
      return { trigger: "BLOCKED", questionType: "DEPENDENCY", requestedFields: ["dependency", "eta"] };
    }
    return { trigger: "BLOCKED", questionType: "BLOCKER", requestedFields: ["blocker", "eta"] };
  }
  if (hasIncompleteDeps(task)) {
    return { trigger: "DEPENDENCY_UNCLEAR", questionType: "DEPENDENCY", requestedFields: ["dependency", "eta"] };
  }
  if (missingSuccess(task)) {
    return { trigger: "MISSING_FIELD", questionType: "FACT", requestedFields: ["fact"] };
  }
  if (isStale(task)) {
    return { trigger: "STALE", questionType: "STATUS", requestedFields: ["status", "eta"] };
  }
  return null;
}

export function triggerFingerprint(
  trigger: ClarificationTrigger,
  questionType: ClarificationQuestionType,
  task: TaskSnapshot,
): string {
  const reasons = blockedReasons(task).map((r) => r.toLowerCase()).sort().join("|");
  const owner = (task.owner || "").trim().toLowerCase();
  const missing = missingSuccess(task) ? "1" : "0";
  return `${trigger}|${questionType}|${task.status}|${owner}|${missing}|${reasons}`.slice(0, 400);
}

export function buildClarificationCopy(task: TaskSnapshot, need: NonNullable<ReturnType<typeof detectClarificationNeed>>): {
  reason: string;
  question: string;
} {
  const label = taskLabel(task);
  const reasons = blockedReasons(task);
  const reasonText = reasons.length ? reasons.join("; ") : task.status.toLowerCase();

  let reason: string;
  let ask: string;
  if (need.trigger === "OWNER_UNCLEAR") {
    reason = `“${label}” is on the execution ledger without an accountable owner (currently “${task.owner || "system"}”).`;
    ask = "Who is responsible for this task?";
  } else if (need.questionType === "DEPENDENCY") {
    reason = `“${label}” is blocked because a dependency is unresolved (${reasonText}).`;
    ask = "Is that dependency still blocking this work, and when do you expect it to clear?";
  } else if (need.trigger === "BLOCKED") {
    reason = `“${label}” is blocked (${reasonText || "no reason recorded"}).`;
    ask = "What is blocking this task now, and when do you expect it to move again?";
  } else if (need.trigger === "MISSING_FIELD") {
    reason = `“${label}” is in flight but has no success condition recorded, so Hustronix cannot tell when it is done.`;
    ask = "What does done look like for this task?";
  } else {
    reason = `“${label}” has had no ledger update for ${STALE_HOURS}+ hours while still ${task.status.toLowerCase()}.`;
    ask = "What is the current status, and when do you expect it to complete?";
  }

  const aftermath =
    "Your answer updates the execution ledger. If the new dates leave no buffer, Hustronix will escalate.";
  return {
    reason,
    question: `${reason}\n\n${ask}\n\n${aftermath}`,
  };
}

function loadTask(taskId: string): TaskSnapshot | null {
  const row = db.rawGet(
    `SELECT e.task_id, e.decision_id, e.owner, e.status, e.blocked_reasons, e.success_condition,
            e.dependencies, e.last_update, e.started_at, e.estimated_duration_hours,
            d.user_id, d.vow
     FROM execution_ledger e
     INNER JOIN decision_ledger d ON d.id = e.decision_id
     WHERE e.task_id = ?`,
    [taskId],
  )[0] as TaskSnapshot | undefined;
  return row ?? null;
}

function latestForTask(taskId: string): Pick<ClarificationRow, "status" | "trigger_fingerprint"> | null {
  return (
    (db.rawGet(
      `SELECT status, trigger_fingerprint FROM clarification_requests
       WHERE task_id = ? ORDER BY datetime(created_at) DESC LIMIT 1`,
      [taskId],
    )[0] as Pick<ClarificationRow, "status" | "trigger_fingerprint"> | undefined) ?? null
  );
}

function rowFromDb(raw: Record<string, unknown>): ClarificationRow {
  return {
    id: String(raw.id),
    task_id: String(raw.task_id),
    decision_id: raw.decision_id != null ? String(raw.decision_id) : null,
    user_id: String(raw.user_id),
    owner: String(raw.owner),
    owner_user_id: raw.owner_user_id != null ? String(raw.owner_user_id) : null,
    trigger: String(raw.trigger) as ClarificationTrigger,
    question_type: String(raw.question_type) as ClarificationQuestionType,
    question: String(raw.question),
    reason: String(raw.reason),
    requested_fields: raw.requested_fields != null ? String(raw.requested_fields) : null,
    trigger_fingerprint: String(raw.trigger_fingerprint),
    status: String(raw.status) as ClarificationStatus,
    answer: raw.answer != null ? String(raw.answer) : null,
    extracted_claims: raw.extracted_claims != null ? String(raw.extracted_claims) : null,
    proposed_mutations: raw.proposed_mutations != null ? String(raw.proposed_mutations) : null,
    committed_mutations: raw.committed_mutations != null ? String(raw.committed_mutations) : null,
    rejected_claims: raw.rejected_claims != null ? String(raw.rejected_claims) : null,
    created_at: String(raw.created_at),
    answered_at: raw.answered_at != null ? String(raw.answered_at) : null,
    committed_at: raw.committed_at != null ? String(raw.committed_at) : null,
  };
}

export function getClarification(id: string, userId?: string): ClarificationRow | null {
  const sql = userId
    ? `SELECT * FROM clarification_requests WHERE id = ? AND user_id = ?`
    : `SELECT * FROM clarification_requests WHERE id = ?`;
  const params = userId ? [id, userId] : [id];
  const raw = db.rawGet(sql, params)[0] as Record<string, unknown> | undefined;
  return raw ? rowFromDb(raw) : null;
}

export function listClarifications(
  userId: string,
  status?: ClarificationStatus,
): ClarificationRow[] {
  const rows = status
    ? (db.rawGet(
        `SELECT * FROM clarification_requests WHERE user_id = ? AND status = ?
         ORDER BY datetime(created_at) DESC LIMIT 50`,
        [userId, status],
      ) as Record<string, unknown>[])
    : (db.rawGet(
        `SELECT * FROM clarification_requests WHERE user_id = ?
         ORDER BY datetime(created_at) DESC LIMIT 50`,
        [userId],
      ) as Record<string, unknown>[]);
  return rows.map(rowFromDb);
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function nextWeekday(name: string, from = new Date()): Date | null {
  const map: Record<string, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };
  const target = map[name.toLowerCase()];
  if (target == null) return null;
  const d = new Date(from);
  d.setHours(12, 0, 0, 0);
  let add = (target - d.getDay() + 7) % 7;
  if (add === 0 && d.getDay() !== target) add = 7;
  d.setDate(d.getDate() + add);
  return d;
}

const MONTHS: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

function parseLooseDate(text: string, now = new Date()): string | null {
  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];

  const md = text.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:,?\s*(20\d{2}))?\b/i,
  );
  if (md) {
    const month = MONTHS[md[1].toLowerCase()];
    const day = Number(md[2]);
    const year = md[3] ? Number(md[3]) : now.getFullYear();
    if (month != null && day >= 1 && day <= 31) {
      const d = new Date(year, month, day, 12, 0, 0);
      if (d < now && !md[3]) d.setFullYear(d.getFullYear() + 1);
      return isoDate(d);
    }
  }

  const weekday = text.match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i);
  if (weekday) {
    const d = nextWeekday(weekday[1], now);
    if (d) return isoDate(d);
  }
  return null;
}

function coerceClaims(raw: unknown): ClarificationClaim[] {
  if (!raw || typeof raw !== "object") return [];
  const list = Array.isArray(raw) ? raw : Array.isArray((raw as { claims?: unknown }).claims)
    ? (raw as { claims: unknown[] }).claims
    : [];
  const out: ClarificationClaim[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const kind = String(rec.kind || "").toLowerCase();
    if (kind === "eta") {
      const date = String(rec.date || rec.value || "").slice(0, 32);
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        out.push({ kind: "eta", date, raw: String(rec.raw || rec.date || date).slice(0, 120) });
      }
    } else if (kind === "status") {
      const status = String(rec.status || rec.value || "").toUpperCase();
      if (VALID_STATUSES.has(status) && status !== "KILLED") {
        out.push({
          kind: "status",
          status: status as "PENDING" | "ACTIVE" | "DONE" | "BLOCKED",
          raw: String(rec.raw || status).slice(0, 80),
        });
      }
    } else if (kind === "blocker") {
      const text = String(rec.text || rec.value || rec.note || "").trim().slice(0, 400);
      if (text.length >= 3) out.push({ kind: "blocker", text });
    } else if (kind === "dependency") {
      const note = String(rec.note || rec.text || rec.value || "").trim().slice(0, 400);
      if (note.length >= 2) {
        const hint = rec.taskHint || rec.task_id || rec.taskId;
        out.push({
          kind: "dependency",
          note,
          ...(hint ? { taskHint: String(hint).slice(0, 120) } : {}),
        });
      }
    } else if (kind === "owner") {
      const owner = String(rec.owner || rec.value || rec.name || "").trim().slice(0, 120);
      if (owner && !ownerUnclear(owner)) out.push({ kind: "owner", owner });
    } else if (kind === "fact") {
      const value = String(rec.value || rec.text || "").trim().slice(0, 500);
      if (value.length >= 2) {
        out.push({ kind: "fact", field: String(rec.field || "success_condition").slice(0, 80), value });
      }
    }
  }
  return dedupeClaims(out);
}

function dedupeClaims(claims: ClarificationClaim[]): ClarificationClaim[] {
  const seen = new Set<string>();
  const out: ClarificationClaim[] = [];
  for (const c of claims) {
    const key = JSON.stringify(c);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/** Deterministic extractor — used in tests and as LLM fallback. */
export function extractClaimsHeuristic(answer: string, now = new Date()): ClarificationClaim[] {
  const text = String(answer || "").trim();
  if (!text) return [];
  const claims: ClarificationClaim[] = [];
  const date = parseLooseDate(text, now);
  if (date) claims.push({ kind: "eta", date, raw: text.slice(0, 80) });

  if (/\b(done|complete[d]?|finished|shipped)\b/i.test(text) && !/\bnot\s+(done|complete)/i.test(text)) {
    claims.push({ kind: "status", status: "DONE", raw: "done" });
  } else if (/\b(unblocked|back on track|ready to (go|proceed)|no longer blocked)\b/i.test(text)) {
    claims.push({ kind: "status", status: "ACTIVE", raw: "unblocked" });
  } else if (/\bstill\s+blocked\b/i.test(text)) {
    claims.push({ kind: "status", status: "BLOCKED", raw: "still blocked" });
  }

  const waiting = text.match(/\bwaiting\s+(?:for|on)\s+([^.,;]+)/i);
  if (waiting) {
    const note = waiting[1].trim().slice(0, 200);
    if (note) claims.push({ kind: "dependency", note });
  }

  const blockedBy = text.match(/\bblocked\s+by\s+([^.,;]+)/i);
  if (blockedBy) {
    const note = blockedBy[1].trim().slice(0, 200);
    if (note) claims.push({ kind: "blocker", text: note });
  }

  const owner =
    text.match(/\bassign(?:ed)?\s+to\s+([A-Z][a-zA-Z.'-]{1,40}(?:\s+[A-Z][a-zA-Z.'-]{1,40})?)/) ||
    text.match(/\b([A-Z][a-zA-Z.'-]{1,40})\s+owns\s+this\b/) ||
    text.match(/\b(?:owner(?:ship)?(?:\s+is)?)\s*[:\-]?\s*([A-Z][a-zA-Z.'-]{1,40}(?:\s+[A-Z][a-zA-Z.'-]{1,40})?)/i);
  if (owner?.[1] && !ownerUnclear(owner[1])) {
    claims.push({ kind: "owner", owner: owner[1].trim() });
  }

  const coverage = text.match(/\b(\d{1,3})\s*%\s*(?:coverage|complete|done)?/i);
  if (coverage) {
    claims.push({ kind: "fact", field: "coverage", value: `${coverage[1]}%` });
  }

  return dedupeClaims(claims);
}

async function extractClaimsLlm(
  userId: string,
  answer: string,
  question: string,
): Promise<ClarificationClaim[]> {
  const reply = await chat(
    userId,
    [
      {
        role: "system",
        content: [
          "Extract structured execution claims from an owner's clarification answer.",
          "Output STRICT JSON only. No prose. No code fences.",
          `Schema: {"claims":[{"kind":"eta"|"status"|"blocker"|"dependency"|"owner"|"fact", ...}]}`,
          "eta: {kind, date: YYYY-MM-DD, raw}",
          "status: {kind, status: PENDING|ACTIVE|DONE|BLOCKED, raw} — never KILLED",
          "blocker: {kind, text}",
          "dependency: {kind, note, taskHint?}",
          "owner: {kind, owner}",
          "fact: {kind, field, value}",
          "Only extract claims clearly present. Empty claims array is allowed.",
        ].join("\n"),
      },
      {
        role: "user",
        content: `Question:\n${question}\n\n${wrapUntrustedContent(answer, "clarification_answer")}\n\nReturn JSON only.`,
      },
    ],
    [],
    undefined,
    { modelTier: "fast" },
  );
  const text = String(reply.text || "").trim();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first >= 0 && last > first) {
      try {
        parsed = JSON.parse(text.slice(first, last + 1));
      } catch {
        parsed = null;
      }
    }
  }
  return coerceClaims(parsed);
}

export async function extractClaims(
  userId: string,
  answer: string,
  question: string,
): Promise<{ claims: ClarificationClaim[]; source: "llm" | "heuristic" }> {
  const heuristic = extractClaimsHeuristic(answer);
  /** Cost-saver: deterministic extract first. LLM only if the answer had no parseable claims. */
  if (heuristic.length > 0 || !hasLlmCredentials(userId)) {
    return { claims: heuristic, source: "heuristic" };
  }
  try {
    const llmClaims = await extractClaimsLlm(userId, answer, question);
    if (llmClaims.length) return { claims: llmClaims, source: "llm" };
  } catch (e) {
    console.warn("[clarification] LLM extract failed, using heuristic:", e);
  }
  return { claims: heuristic, source: "heuristic" };
}

function rosterOrKnownOwner(userId: string, owner: string): string | null {
  const name = owner.trim();
  if (!name || ownerUnclear(name)) return null;
  const roster = db.rawGet(
    `SELECT name FROM team_roster WHERE user_id = ? AND lower(name) = lower(?) LIMIT 1`,
    [userId, name],
  )[0] as { name: string } | undefined;
  if (roster?.name) return roster.name;
  const known = db.rawGet(
    `SELECT DISTINCT e.owner AS owner
     FROM execution_ledger e
     INNER JOIN decision_ledger d ON d.id = e.decision_id
     WHERE d.user_id = ? AND lower(e.owner) = lower(?) LIMIT 1`,
    [userId, name],
  )[0] as { owner: string } | undefined;
  return known?.owner ?? null;
}

function resolveDependencyTask(decisionId: string, hint: string): string | null {
  const h = hint.trim();
  if (!h) return null;
  const byId = db.rawGet(
    `SELECT task_id FROM execution_ledger WHERE decision_id = ? AND task_id = ? LIMIT 1`,
    [decisionId, h],
  )[0] as { task_id: string } | undefined;
  if (byId) return byId.task_id;
  const byLabel = db.rawGet(
    `SELECT task_id FROM execution_ledger
     WHERE decision_id = ? AND lower(coalesce(success_condition,'')) LIKE lower(?)
     LIMIT 1`,
    [decisionId, `%${h}%`],
  )[0] as { task_id: string } | undefined;
  return byLabel?.task_id ?? null;
}

export function validateClaims(
  claims: ClarificationClaim[],
  task: TaskSnapshot,
  questionType: ClarificationQuestionType,
): { allowed: AllowedMutation[]; rejected: { claim: ClarificationClaim; reason: string }[] } {
  const allowed: AllowedMutation[] = [];
  const rejected: { claim: ClarificationClaim; reason: string }[] = [];
  const current = task.status;

  for (const claim of claims) {
    if (claim.kind === "eta") {
      const eta = new Date(`${claim.date}T12:00:00`);
      if (Number.isNaN(eta.getTime())) {
        rejected.push({ claim, reason: "unparseable_eta" });
        continue;
      }
      const now = Date.now();
      if (eta.getTime() < now - 30 * 86400000) {
        rejected.push({ claim, reason: "eta_too_far_past" });
        continue;
      }
      if (eta.getTime() > now + 730 * 86400000) {
        rejected.push({ claim, reason: "eta_too_far_future" });
        continue;
      }
      const start = task.started_at ? new Date(task.started_at).getTime() : now;
      const hours = Math.max(1, Math.round((eta.getTime() - start) / 3600000));
      allowed.push({ type: "set_duration_hours", hours });
      continue;
    }

    if (claim.kind === "status") {
      if (current === "DONE" || current === "KILLED") {
        rejected.push({ claim, reason: "terminal_task" });
        continue;
      }
      if (claim.status === current) {
        rejected.push({ claim, reason: "status_unchanged" });
        continue;
      }
      const ok =
        (current === "BLOCKED" && (claim.status === "ACTIVE" || claim.status === "DONE" || claim.status === "PENDING")) ||
        (current === "ACTIVE" && (claim.status === "DONE" || claim.status === "BLOCKED" || claim.status === "PENDING")) ||
        (current === "PENDING" && (claim.status === "ACTIVE" || claim.status === "BLOCKED" || claim.status === "DONE"));
      if (!ok) {
        rejected.push({ claim, reason: "illegal_transition" });
        continue;
      }
      allowed.push({
        type: "transition",
        newState: claim.status,
        reason: `clarification status: ${claim.raw}`,
      });
      continue;
    }

    if (claim.kind === "blocker") {
      if (current === "DONE" || current === "KILLED") {
        rejected.push({ claim, reason: "terminal_task" });
        continue;
      }
      if (current !== "BLOCKED") {
        allowed.push({
          type: "transition",
          newState: "BLOCKED",
          reason: `clarification blocker: ${claim.text}`,
        });
      }
      continue;
    }

    if (claim.kind === "dependency") {
      const depId = resolveDependencyTask(task.decision_id, claim.taskHint || claim.note);
      if (depId && depId !== task.task_id) {
        allowed.push({ type: "add_dependency", depTaskId: depId });
      } else if (!claim.note) {
        rejected.push({ claim, reason: "unresolved_dependency" });
      }
      continue;
    }

    if (claim.kind === "owner") {
      const resolved = rosterOrKnownOwner(task.user_id, claim.owner);
      if (!resolved) {
        rejected.push({ claim, reason: "unknown_owner" });
        continue;
      }
      if (resolved.toLowerCase() === (task.owner || "").toLowerCase()) {
        rejected.push({ claim, reason: "owner_unchanged" });
        continue;
      }
      allowed.push({ type: "set_owner", owner: resolved });
      continue;
    }

    if (claim.kind === "fact") {
      if (questionType === "FACT" || questionType === "STATUS" || claim.field === "success_condition") {
        if (claim.field === "success_condition" || questionType === "FACT") {
          allowed.push({ type: "set_success_condition", text: claim.value });
        }
      }
    }
  }

  return { allowed, rejected };
}

function applyMutations(
  userId: string,
  task: TaskSnapshot,
  mutations: AllowedMutation[],
  clarificationId: string,
  answer: string,
): AllowedMutation[] {
  const committed: AllowedMutation[] = [];
  const signalContent = `[clarification:${clarificationId}] ${answer}`.slice(0, 4000);
  const signalId = uuidv4();
  db.insertExternalSignal({
    id: signalId,
    userId,
    source: "MANUAL",
    content: signalContent,
    owner: task.owner || userId,
    sourceSubtype: "clarification.answer",
    externalId: `clarification:${clarificationId}`,
    ingestMeta: JSON.stringify({ clarificationId, taskId: task.task_id }),
  });
  mutationLinkSignal(userId, {
    signalId,
    taskId: task.task_id,
    linkMethod: "clarification",
    linkProvenance: { clarificationId, actor: userId },
  });
  committed.push({ type: "ingest_signal", content: signalContent });

  let currentStatus = task.status;
  for (const m of mutations) {
    if (m.type === "set_duration_hours") {
      db.transitionExecutionState(task.task_id, currentStatus, `clarification eta (${clarificationId})`, false, {
        estimatedDurationHours: m.hours,
        attribution: `clarification:${clarificationId}`,
      });
      committed.push(m);
      continue;
    }
    if (m.type === "transition") {
      const result = mutationTransitionExecution(userId, {
        taskId: task.task_id,
        newState: m.newState,
        reason: `${m.reason} (${clarificationId})`,
      });
      currentStatus = String((result as { status?: string }).status || m.newState);
      committed.push(m);
      continue;
    }
    if (m.type === "set_owner") {
      db.rawRun(
        `UPDATE execution_ledger SET owner = ?, last_update = CURRENT_TIMESTAMP WHERE task_id = ?`,
        [m.owner, task.task_id],
      );
      audit("TASK_OWNER_UPDATED", `clarification ${clarificationId}: ${m.owner}`, task.task_id);
      db.notifyLedgerAuditor({ type: "execution", taskId: task.task_id });
      committed.push(m);
      continue;
    }
    if (m.type === "add_dependency") {
      const deps = parseJsonArray(task.dependencies).map(String);
      if (!deps.includes(m.depTaskId)) {
        deps.push(m.depTaskId);
        db.rawRun(
          `UPDATE execution_ledger SET dependencies = ?, last_update = CURRENT_TIMESTAMP WHERE task_id = ?`,
          [JSON.stringify(deps), task.task_id],
        );
        task.dependencies = JSON.stringify(deps);
        audit("TASK_DEPENDENCY_ADDED", `clarification ${clarificationId}: ${m.depTaskId}`, task.task_id);
        db.notifyLedgerAuditor({ type: "execution", taskId: task.task_id });
      }
      committed.push(m);
      continue;
    }
    if (m.type === "set_success_condition") {
      db.rawRun(
        `UPDATE execution_ledger SET success_condition = ?, last_update = CURRENT_TIMESTAMP WHERE task_id = ?`,
        [m.text.slice(0, 500), task.task_id],
      );
      audit("TASK_SUCCESS_CONDITION_UPDATED", `clarification ${clarificationId}`, task.task_id);
      db.notifyLedgerAuditor({ type: "execution", taskId: task.task_id });
      committed.push(m);
    }
  }
  return committed;
}

export function openClarificationIfNeeded(taskId: string): { row: ClarificationRow; created: boolean } | null {
  const task = loadTask(taskId);
  if (!task) return null;
  const need = detectClarificationNeed(task);
  if (!need) return null;

  const fingerprint = triggerFingerprint(need.trigger, need.questionType, task);
  const openRow = db.rawGet(
    `SELECT * FROM clarification_requests WHERE task_id = ? AND status = 'OPEN' LIMIT 1`,
    [taskId],
  )[0] as Record<string, unknown> | undefined;
  if (openRow) return { row: rowFromDb(openRow), created: false };

  const latest = latestForTask(taskId);
  if (latest && latest.trigger_fingerprint === fingerprint && latest.status !== "EXPIRED") {
    return null;
  }

  const copy = buildClarificationCopy(task, need);
  const id = uuidv4();
  try {
    db.rawRun(
      `INSERT INTO clarification_requests (
        id, task_id, decision_id, user_id, owner, owner_user_id,
        trigger, question_type, question, reason, requested_fields, trigger_fingerprint, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN')`,
      [
        id,
        task.task_id,
        task.decision_id,
        task.user_id,
        task.owner || "system",
        task.user_id,
        need.trigger,
        need.questionType,
        copy.question,
        copy.reason,
        JSON.stringify(need.requestedFields),
        fingerprint,
      ],
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/unique/i.test(msg)) {
      const existing = db.rawGet(
        `SELECT * FROM clarification_requests WHERE task_id = ? AND status = 'OPEN' LIMIT 1`,
        [taskId],
      )[0] as Record<string, unknown> | undefined;
      return existing ? { row: rowFromDb(existing), created: false } : null;
    }
    throw e;
  }

  audit("CLARIFICATION_OPENED", `${need.trigger}/${need.questionType}: ${copy.reason}`.slice(0, 500), id);

  if (task.user_id && task.user_id !== "system") {
    void notify(task.user_id, {
      kind: "execution.clarification",
      title: `Clarification: ${taskLabel(task)}`,
      body: copy.question,
      linkUrl: defaultAppLink(`/execute?clarify=${id}`),
      payload: { clarificationId: id, taskId: task.task_id, trigger: need.trigger },
    }).catch((err) => console.error("[clarification] notify failed:", err));
  }

  const created = getClarification(id);
  return created ? { row: created, created: true } : null;
}

export function scanClarificationForTask(taskId: string): ClarificationRow | null {
  return openClarificationIfNeeded(taskId)?.row ?? null;
}

export function scanClarifications(): { opened: number; scanned: number } {
  const rows = db.rawGet(
    `SELECT e.task_id
     FROM execution_ledger e
     INNER JOIN decision_ledger d ON d.id = e.decision_id
     WHERE e.status IN ('PENDING','ACTIVE','BLOCKED')
     ORDER BY datetime(e.last_update) DESC
     LIMIT 400`,
  ) as { task_id: string }[];
  let opened = 0;
  for (const row of rows) {
    const result = openClarificationIfNeeded(row.task_id);
    if (result?.created) opened += 1;
  }
  return { opened, scanned: rows.length };
}

export async function answerClarification(
  userId: string,
  clarificationId: string,
  answerRaw: string,
): Promise<{
  clarification: ClarificationRow;
  claims: ClarificationClaim[];
  extractSource: "llm" | "heuristic";
  proposed: AllowedMutation[];
  committed: AllowedMutation[];
  rejected: { claim: ClarificationClaim; reason: string }[];
}> {
  const row = getClarification(clarificationId, userId);
  if (!row) throw new Error("Clarification not found");
  if (row.status !== "OPEN") throw new Error(`Clarification is ${row.status.toLowerCase()}, not open`);
  const answer = String(answerRaw || "").trim();
  if (answer.length < 2) throw new Error("answer required");
  if (answer.length > 4000) throw new Error("answer too long");

  const task = loadTask(row.task_id);
  if (!task) throw new Error("Task not found");

  const extracted = await extractClaims(userId, answer, row.question);
  const { allowed, rejected } = validateClaims(extracted.claims, task, row.question_type);
  const committed = applyMutations(userId, task, allowed, row.id, answer);

  db.rawRun(
    `UPDATE clarification_requests
     SET status = 'COMMITTED',
         answer = ?,
         extracted_claims = ?,
         proposed_mutations = ?,
         committed_mutations = ?,
         rejected_claims = ?,
         answered_at = CURRENT_TIMESTAMP,
         committed_at = CURRENT_TIMESTAMP
     WHERE id = ? AND user_id = ?`,
    [
      answer,
      JSON.stringify(extracted.claims),
      JSON.stringify(allowed),
      JSON.stringify(committed),
      JSON.stringify(rejected),
      row.id,
      userId,
    ],
  );
  audit(
    "CLARIFICATION_COMMITTED",
    `claims=${extracted.claims.length} committed=${committed.length} rejected=${rejected.length}`,
    row.id,
  );

  return {
    clarification: getClarification(row.id, userId)!,
    claims: extracted.claims,
    extractSource: extracted.source,
    proposed: allowed,
    committed,
    rejected,
  };
}

export function dismissClarification(userId: string, clarificationId: string): ClarificationRow {
  const row = getClarification(clarificationId, userId);
  if (!row) throw new Error("Clarification not found");
  if (row.status !== "OPEN") throw new Error(`Clarification is ${row.status.toLowerCase()}, not open`);
  db.rawRun(
    `UPDATE clarification_requests SET status = 'DISMISSED', committed_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?`,
    [clarificationId, userId],
  );
  audit("CLARIFICATION_DISMISSED", "Owner dismissed without answer", clarificationId);
  return getClarification(clarificationId, userId)!;
}

export function toPublicClarification(row: ClarificationRow) {
  return {
    id: row.id,
    taskId: row.task_id,
    decisionId: row.decision_id,
    owner: row.owner,
    trigger: row.trigger,
    questionType: row.question_type,
    question: row.question,
    reason: row.reason,
    requestedFields: parseJsonArray(row.requested_fields).map(String),
    status: row.status,
    answer: row.answer,
    extractedClaims: row.extracted_claims ? safeJson(row.extracted_claims) : null,
    proposedMutations: row.proposed_mutations ? safeJson(row.proposed_mutations) : null,
    committedMutations: row.committed_mutations ? safeJson(row.committed_mutations) : null,
    rejectedClaims: row.rejected_claims ? safeJson(row.rejected_claims) : null,
    createdAt: row.created_at,
    answeredAt: row.answered_at,
    committedAt: row.committed_at,
  };
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
