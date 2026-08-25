/**
 * Talk turn observability — diagnose retrieval vs reasoning without UI noise.
 * Architecture freeze: this is instrumentation only.
 */
import { db } from "../../database.js";
import type { TalkIntent, ContextMode } from "./talk-understanding.js";
import type { RetrievalPlan } from "./talk-retrieval-plan.js";
import type { CompanyContext } from "./talk-retrieval.js";

export type TalkTurnTrace = {
  conversation_id: string;
  mode: string;
  context_mode: ContextMode;
  intent: string;
  retrieval_plan: RetrievalPlan | null;
  retrieved_context_count: number;
  retrieved_entities: string[];
  retrieved_situations: string[];
  retrieved_evidence: number;
  understanding_latency_ms: number;
  retrieval_latency_ms: number;
  reasoning_latency_ms: number;
  llm_latency_ms: number | null;
  total_latency_ms: number;
  response_guard_ok: boolean;
  response_guard_reasons: string[];
  fallback_used: boolean;
  path: "brain" | "kernel";
};

export function ensureTalkObservabilitySchema(dbExec: (sql: string) => void) {
  dbExec(`
    CREATE TABLE IF NOT EXISTS talk_turn_traces (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      conversation_id TEXT,
      mode TEXT,
      context_mode TEXT,
      intent TEXT,
      path TEXT,
      retrieval_plan_json TEXT,
      retrieved_context_count INTEGER,
      retrieved_entities_json TEXT,
      retrieved_situations_json TEXT,
      retrieved_evidence INTEGER,
      understanding_latency_ms INTEGER,
      retrieval_latency_ms INTEGER,
      reasoning_latency_ms INTEGER,
      llm_latency_ms INTEGER,
      total_latency_ms INTEGER,
      response_guard_ok INTEGER,
      response_guard_reasons_json TEXT,
      fallback_used INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_talk_turn_traces_user ON talk_turn_traces(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_talk_turn_traces_conv ON talk_turn_traces(conversation_id, created_at);
  `);
}

export function buildTalkTrace(opts: {
  conversationId: string;
  intent: TalkIntent;
  plan: RetrievalPlan | null;
  ctx: CompanyContext | null;
  understandingMs: number;
  retrievalMs: number;
  reasoningMs: number;
  llmMs: number | null;
  totalMs: number;
  guardOk: boolean;
  guardReasons: string[];
  fallbackUsed: boolean;
  path: "brain" | "kernel";
}): TalkTurnTrace {
  const ctx = opts.ctx;
  return {
    conversation_id: opts.conversationId,
    mode: opts.intent.mode,
    context_mode: opts.intent.contextMode,
    intent: opts.intent.objective || opts.intent.mode,
    retrieval_plan: opts.plan,
    retrieved_context_count: ctx
      ? ctx.situations.length + ctx.evidence.length + ctx.decisions.length + ctx.signals.length
      : 0,
    retrieved_entities: ctx
      ? [...new Set(ctx.customers.map((c) => c.name).concat(ctx.situations.flatMap((s) => s.entities)))].slice(0, 12)
      : [],
    retrieved_situations: ctx ? ctx.situations.map((s) => s.id) : [],
    retrieved_evidence: ctx ? ctx.evidence.length : 0,
    understanding_latency_ms: Math.max(0, Math.round(opts.understandingMs)),
    retrieval_latency_ms: Math.max(0, Math.round(opts.retrievalMs)),
    reasoning_latency_ms: Math.max(0, Math.round(opts.reasoningMs)),
    llm_latency_ms: opts.llmMs == null ? null : Math.max(0, Math.round(opts.llmMs)),
    total_latency_ms: Math.max(0, Math.round(opts.totalMs)),
    response_guard_ok: opts.guardOk,
    response_guard_reasons: opts.guardReasons,
    fallback_used: opts.fallbackUsed,
    path: opts.path,
  };
}

export function recordTalkTurnTrace(userId: string, trace: TalkTurnTrace): void {
  try {
    db.rawRun(
      `INSERT INTO talk_turn_traces (
        id, user_id, conversation_id, mode, context_mode, intent, path,
        retrieval_plan_json, retrieved_context_count, retrieved_entities_json,
        retrieved_situations_json, retrieved_evidence,
        understanding_latency_ms, retrieval_latency_ms, reasoning_latency_ms,
        llm_latency_ms, total_latency_ms, response_guard_ok, response_guard_reasons_json, fallback_used
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `talk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        userId,
        trace.conversation_id,
        trace.mode,
        trace.context_mode,
        trace.intent,
        trace.path,
        trace.retrieval_plan ? JSON.stringify(trace.retrieval_plan) : null,
        trace.retrieved_context_count,
        JSON.stringify(trace.retrieved_entities),
        JSON.stringify(trace.retrieved_situations),
        trace.retrieved_evidence,
        trace.understanding_latency_ms,
        trace.retrieval_latency_ms,
        trace.reasoning_latency_ms,
        trace.llm_latency_ms,
        trace.total_latency_ms,
        trace.response_guard_ok ? 1 : 0,
        JSON.stringify(trace.response_guard_reasons),
        trace.fallback_used ? 1 : 0,
      ],
    );
  } catch {
    /* schema may not exist yet */
  }
}

export function recentTalkTraces(userId: string, limit = 20): TalkTurnTrace[] {
  try {
    const rows = db.rawGet(
      `SELECT * FROM talk_turn_traces WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
      [userId, Math.min(100, Math.max(1, limit))],
    ) as Array<Record<string, unknown>>;
    return (rows || []).map((r) => ({
      conversation_id: String(r.conversation_id || ""),
      mode: String(r.mode || ""),
      context_mode: String(r.context_mode || "GENERAL") as ContextMode,
      intent: String(r.intent || ""),
      retrieval_plan: r.retrieval_plan_json ? (JSON.parse(String(r.retrieval_plan_json)) as RetrievalPlan) : null,
      retrieved_context_count: Number(r.retrieved_context_count || 0),
      retrieved_entities: JSON.parse(String(r.retrieved_entities_json || "[]")) as string[],
      retrieved_situations: JSON.parse(String(r.retrieved_situations_json || "[]")) as string[],
      retrieved_evidence: Number(r.retrieved_evidence || 0),
      understanding_latency_ms: Number(r.understanding_latency_ms || 0),
      retrieval_latency_ms: Number(r.retrieval_latency_ms || 0),
      reasoning_latency_ms: Number(r.reasoning_latency_ms || 0),
      llm_latency_ms: r.llm_latency_ms == null ? null : Number(r.llm_latency_ms),
      total_latency_ms: Number(r.total_latency_ms || 0),
      response_guard_ok: Number(r.response_guard_ok) === 1,
      response_guard_reasons: JSON.parse(String(r.response_guard_reasons_json || "[]")) as string[],
      fallback_used: Number(r.fallback_used) === 1,
      path: (String(r.path || "brain") as "brain" | "kernel"),
    }));
  } catch {
    return [];
  }
}

export function talkObservabilitySummary(userId?: string): {
  turns: number;
  avg_total_ms: number | null;
  avg_retrieval_ms: number | null;
  avg_llm_ms: number | null;
  fallback_rate: number | null;
  guard_block_rate: number | null;
} {
  try {
    const tenant = userId && userId !== "system" ? userId : null;
    const where = tenant ? "WHERE user_id = ?" : "";
    const params = tenant ? [tenant] : [];
    const row = (
      db.rawGet(
        `SELECT
           COUNT(1) AS turns,
           AVG(total_latency_ms) AS avg_total,
           AVG(retrieval_latency_ms) AS avg_retrieval,
           AVG(CASE WHEN llm_latency_ms IS NOT NULL THEN llm_latency_ms END) AS avg_llm,
           AVG(fallback_used) AS fallback_rate,
           AVG(CASE WHEN response_guard_ok = 0 THEN 1.0 ELSE 0.0 END) AS guard_block
         FROM talk_turn_traces ${where}`,
        params,
      ) as Array<{
        turns: number;
        avg_total: number | null;
        avg_retrieval: number | null;
        avg_llm: number | null;
        fallback_rate: number | null;
        guard_block: number | null;
      }>
    )[0];
    return {
      turns: Number(row?.turns || 0),
      avg_total_ms: row?.avg_total == null ? null : Math.round(Number(row.avg_total)),
      avg_retrieval_ms: row?.avg_retrieval == null ? null : Math.round(Number(row.avg_retrieval)),
      avg_llm_ms: row?.avg_llm == null ? null : Math.round(Number(row.avg_llm)),
      fallback_rate: row?.fallback_rate == null ? null : Number(Number(row.fallback_rate).toFixed(3)),
      guard_block_rate: row?.guard_block == null ? null : Number(Number(row.guard_block).toFixed(3)),
    };
  } catch {
    return {
      turns: 0,
      avg_total_ms: null,
      avg_retrieval_ms: null,
      avg_llm_ms: null,
      fallback_rate: null,
      guard_block_rate: null,
    };
  }
}
