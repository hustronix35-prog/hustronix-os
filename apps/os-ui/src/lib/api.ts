/**
 * Live API client for the OS UI.
 * Talks to apps/api via same-origin `/api/*` (Next rewrite) or NEXT_PUBLIC_API_URL.
 * Falls back to mock-data when unauthenticated / offline so screens stay populated.
 */

import type { Alert, KGEdge, KGNode } from "./types";
import { moreAlerts } from "./mock-data";
import { analyticsMock } from "./analytics-mock";
import type { AnalyticsRange, AnalyticsSummary } from "./analytics-types";

export type { AnalyticsRange, AnalyticsSummary, AnalyticsKpi, AnalyticsSlice } from "./analytics-types";
export { analyticsMock } from "./analytics-mock";

export function getApiBase(): string {
  const env = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
  if (env) return env;
  if (typeof window !== "undefined") return "";
  return (
    process.env.API_PROXY_TARGET?.replace(/\/$/, "") || "http://127.0.0.1:3005"
  );
}

export function getWsBase(): string {
  const ws = process.env.NEXT_PUBLIC_WS_URL?.replace(/\/$/, "");
  if (ws) return ws.endsWith("/ws") ? ws : `${ws}/ws`;
  const http = getApiBase();
  if (http) return http.replace(/^http/, "ws") + (http.includes("/ws") ? "" : "/ws");
  if (typeof window !== "undefined") {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    if (process.env.NEXT_PUBLIC_UNIFIED_SERVER === "1") {
      return `${proto}://${window.location.host}/ws`;
    }
    const port = process.env.NEXT_PUBLIC_API_PORT || "3005";
    return `${proto}://${window.location.hostname}:${port}/ws`;
  }
  return "ws://127.0.0.1:3005/ws";
}

export function getStoredUserId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem("hustronix_userId");
}

export function setStoredUserId(id: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem("hustronix_userId", id);
}

export function clearStoredUserId() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem("hustronix_userId");
}

export function buildApiHeaders(): HeadersInit {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  const key = process.env.NEXT_PUBLIC_API_KEY?.trim();
  if (key) {
    h["x-api-key"] = key;
    const uid = getStoredUserId();
    if (uid) h["x-user-id"] = uid;
  }
  return h;
}

function apiUnreachableMessage(): string {
  return "Hustronix is still starting. Wait a few seconds and try again.";
}

export function isApiUnreachableError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /still starting|not running or is restarting|Failed to fetch|NetworkError|ECONNREFUSED|ECONNRESET|load failed/i.test(
    message,
  );
}

export async function withApiRetry<T>(fn: () => Promise<T>, attempts = 4, delayMs = 600): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (!isApiUnreachableError(err) || i === attempts - 1) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs * (i + 1)));
    }
  }
  throw last;
}

function parseApiError(body: string): string {
  const t = String(body || "").trim();
  if (!t || /^internal server error/i.test(t) || t.startsWith("<!DOCTYPE") || t.startsWith("<html")) {
    return apiUnreachableMessage();
  }
  try {
    const j = JSON.parse(t) as { error?: string };
    return j.error || t;
  } catch {
    if (t.startsWith("Unexpected token")) return apiUnreachableMessage();
    return t.slice(0, 180);
  }
}

/** Parse JSON from an API response; never throw SyntaxError on HTML/text 500s. */
export async function readApiJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  const t = text.trim();
  if (!t) {
    throw new Error(res.ok ? "Empty response from the API." : apiUnreachableMessage());
  }
  try {
    return JSON.parse(t) as T;
  } catch {
    throw new Error(parseApiError(t));
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${getApiBase()}${path}`, {
    headers: buildApiHeaders(),
    credentials: "include",
  });
  if (!res.ok) throw new Error(parseApiError(await res.text()) || res.statusText);
  return res.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${getApiBase()}${path}`, {
    method: "POST",
    headers: buildApiHeaders(),
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "include",
  });
  if (!res.ok) throw new Error(parseApiError(await res.text()) || res.statusText);
  return res.json() as Promise<T>;
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${getApiBase()}${path}`, {
    method: "PATCH",
    headers: buildApiHeaders(),
    body: JSON.stringify(body),
    credentials: "include",
  });
  if (!res.ok) throw new Error(parseApiError(await res.text()) || res.statusText);
  return res.json() as Promise<T>;
}

export async function clearAuthSession(): Promise<void> {
  try {
    await fetch(`${getApiBase()}/api/auth/logout`, {
      method: "POST",
      headers: buildApiHeaders(),
      credentials: "include",
    });
  } catch {
    /* best-effort */
  }
  clearStoredUserId();
}

export async function apiDelete<T>(path: string): Promise<T> {
  const res = await fetch(`${getApiBase()}${path}`, {
    method: "DELETE",
    headers: buildApiHeaders(),
    credentials: "include",
  });
  if (!res.ok) throw new Error(parseApiError(await res.text()) || res.statusText);
  return res.json() as Promise<T>;
}

async function liveOrNull<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

export type LedgerDecision = {
  id: string;
  vow: string;
  status: string;
  confidence: number | null;
  created_at: string;
  expected_outcomes?: string;
  decision_reasoning?: string;
};

export type ExecutionSummaryCounts = {
  total: number;
  active: number;
  pending: number;
  blocked: number;
  done: number;
  activeOrPending: number;
};

export type MissionCapacity = {
  capacity: number;
  currentLoad: number;
  loadPct: number;
  owner: string;
};

export type McExecution = {
  task_id: string;
  owner: string;
  weight: number;
  status: string;
  success_condition: string | null;
  last_update: string;
  decision_vow: string | null;
};

export type SignalPreview = {
  id: string;
  source: string;
  source_subtype?: string | null;
  runtime?: string | null;
  content: string;
  detected_at: string;
  received_at?: string | null;
  grace_expires_at: string | null;
  state: string;
};

export type EvidenceAccuracy = {
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
  tested: { method: string; rubric: string; channels: string[]; note: string };
};

export type MissionSummary = {
  decision: LedgerDecision | null;
  executionSummary: ExecutionSummaryCounts;
  capacity: MissionCapacity;
  decisionOwner: { userId: string; displayName: string };
  mcExecutions: McExecution[];
  signalsPreview: SignalPreview[];
  unverifiedSignalCount: number;
};

export type MeDto = {
  user: { id: string; username: string; email: string | null };
  profile: {
    displayName: string;
    role: string;
    email: string;
    department: string;
    bio: string;
    phone: string;
    location: string;
  };
  org: { name: string; role: string | null };
  stats: {
    decisionsCreated: number;
    executionsOwned: number;
    signalsLinked: number;
    successRatePct: number;
  };
};

export type ExecutionRow = {
  task_id: string;
  decision_id: string;
  owner: string;
  type: string;
  weight: number;
  status: string;
  success_condition: string | null;
  blocked_reasons: string | null;
  last_update: string;
  started_at: string | null;
  completed_at: string | null;
  decision_vow: string | null;
  decision_status?: string | null;
};

export type TeamMetrics = {
  metrics: {
    members: number;
    utilization: number;
    atRisk: number;
    overCapacity: number;
    aggregateBudget: number;
  };
  members: Array<{ id: string; name: string; role: string; team: string; loadPct: number; status: string }>;
  donut: { usedPct: number; availablePct: number; overPct: number };
  deptBars: Array<{ dept: string; pct: number }>;
  insights: string[];
};

function asDecision(raw: unknown): LedgerDecision | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  if (d.id == null && d.vow == null) return null;
  return {
    id: String(d.id ?? ""),
    vow: String(d.vow ?? ""),
    status: String(d.status ?? ""),
    confidence: d.confidence == null ? null : Number(d.confidence),
    created_at: String(d.created_at ?? ""),
    expected_outcomes: d.expected_outcomes != null ? String(d.expected_outcomes) : undefined,
    decision_reasoning: d.decision_reasoning != null ? String(d.decision_reasoning) : undefined,
  };
}

export async function fetchMissionSummary(): Promise<MissionSummary | null> {
  const raw = await liveOrNull(() => apiGet<Record<string, unknown>>("/api/mission-control/summary"));
  if (!raw) return null;
  const exec = (raw.executionSummary ?? {}) as Record<string, number>;
  const cap = (raw.capacity ?? {}) as Record<string, unknown>;
  const owner = (raw.decisionOwner ?? {}) as Record<string, unknown>;
  return {
    decision: asDecision(raw.decision),
    executionSummary: {
      total: Number(exec.total || 0),
      active: Number(exec.active || 0),
      pending: Number(exec.pending || 0),
      blocked: Number(exec.blocked || 0),
      done: Number(exec.done || 0),
      activeOrPending: Number(exec.activeOrPending || 0),
    },
    capacity: {
      capacity: Number(cap.capacity || 0),
      currentLoad: Number(cap.currentLoad || 0),
      loadPct: Number(cap.loadPct || 0),
      owner: String(cap.owner || "system"),
    },
    decisionOwner: {
      userId: String(owner.userId || ""),
      displayName: String(owner.displayName || ""),
    },
    mcExecutions: Array.isArray(raw.mcExecutions)
      ? (raw.mcExecutions as Record<string, unknown>[]).map((e) => ({
          task_id: String(e.task_id ?? ""),
          owner: String(e.owner ?? ""),
          weight: Number(e.weight || 0),
          status: String(e.status ?? ""),
          success_condition: e.success_condition != null ? String(e.success_condition) : null,
          last_update: String(e.last_update ?? ""),
          decision_vow: e.decision_vow != null ? String(e.decision_vow) : null,
        }))
      : [],
    signalsPreview: Array.isArray(raw.signalsPreview)
      ? (raw.signalsPreview as Record<string, unknown>[]).map((s) => ({
          id: String(s.id ?? ""),
          source: String(s.source ?? ""),
          source_subtype: s.source_subtype != null ? String(s.source_subtype) : null,
          runtime: s.runtime != null ? String(s.runtime) : null,
          content: String(s.content ?? ""),
          detected_at: String(s.detected_at ?? ""),
          received_at: s.received_at != null ? String(s.received_at) : null,
          grace_expires_at: s.grace_expires_at != null ? String(s.grace_expires_at) : null,
          state: String(s.state ?? ""),
        }))
      : [],
    unverifiedSignalCount: Number(raw.unverifiedSignalCount || 0),
  };
}

export async function fetchEvidenceAccuracy(): Promise<EvidenceAccuracy | null> {
  return liveOrNull(() => apiGet<EvidenceAccuracy>("/api/evidence/accuracy"));
}

export async function fetchMe(): Promise<MeDto | null> {
  const data = await liveOrNull(() =>
    apiGet<{
      user?: { id?: string; username?: string; email?: string | null };
      profile?: {
        displayName?: string;
        role?: string;
        email?: string;
        department?: string;
        bio?: string;
        phone?: string;
        location?: string;
      };
      org?: { name?: string; role?: string | null };
      stats?: {
        decisionsCreated?: number;
        executionsOwned?: number;
        signalsLinked?: number;
        successRatePct?: number;
      };
    }>("/api/me"),
  );
  if (!data?.user?.id) return null;
  return {
    user: {
      id: String(data.user.id),
      username: String(data.user.username || data.user.id),
      email: data.user.email ?? null,
    },
    profile: {
      displayName: String(data.profile?.displayName || data.user.username || data.user.id),
      role: String(data.profile?.role || data.org?.role || ""),
      email: String(data.profile?.email || data.user.email || ""),
      department: String(data.profile?.department || ""),
      bio: String(data.profile?.bio || ""),
      phone: String(data.profile?.phone || ""),
      location: String(data.profile?.location || ""),
    },
    org: { name: String(data.org?.name || ""), role: data.org?.role ?? null },
    stats: {
      decisionsCreated: Number(data.stats?.decisionsCreated || 0),
      executionsOwned: Number(data.stats?.executionsOwned || 0),
      signalsLinked: Number(data.stats?.signalsLinked || 0),
      successRatePct: Number(data.stats?.successRatePct || 0),
    },
  };
}

export async function patchMe(profile: {
  displayName?: string;
  bio?: string;
  email?: string;
  phone?: string;
  location?: string;
  department?: string;
  role?: string;
}): Promise<{ success: boolean; updated: number }> {
  return apiPatch("/api/me", { profile });
}

export async function fetchSettingsMap(): Promise<Record<string, string> | null> {
  const data = await liveOrNull(() => apiGet<{ settings: Record<string, string> }>("/api/settings"));
  return data?.settings ?? null;
}

export async function saveSettingsBulk(
  settings: Record<string, string>,
): Promise<{ success: boolean; updated: number }> {
  return apiPost("/api/settings/bulk", { settings });
}

export async function fetchDecisions(status?: string): Promise<LedgerDecision[] | null> {
  const q = status ? `?status=${encodeURIComponent(status)}` : "";
  const data = await liveOrNull(() =>
    apiGet<{ decisions: Array<Record<string, unknown>> }>(`/api/decisions${q}`),
  );
  if (!data) return null;
  return (data.decisions ?? []).map((d) => ({
    id: String(d.id),
    vow: String(d.vow ?? ""),
    status: String(d.status ?? ""),
    confidence: d.confidence == null ? null : Number(d.confidence),
    created_at: String(d.created_at ?? ""),
    expected_outcomes: d.expected_outcomes != null ? String(d.expected_outcomes) : undefined,
    decision_reasoning: d.decision_reasoning != null ? String(d.decision_reasoning) : undefined,
  }));
}

export type DecisionDetailView = {
  id: string;
  slug: string;
  title: string;
  type: string;
  subtitle: string;
  description: string;
  descriptionFull: string;
  narrative: {
    reasoning: string;
    outcomes: Array<{ metric: string; target: string }>;
    constraints: string[];
    reversal: string[];
  };
  graph: { nodes: KGNode[]; edges: KGEdge[] };
  owner: { name: string; initials: string };
  team: string;
  priority: string;
  status: string;
  health: number;
  lastUpdated: string;
  progress: number;
  progressLabel: string;
  targetDate: string;
  impact: string;
  impactLabel: string;
  impactConfidence: number;
  impactTone: string;
  daysToTarget: number;
  daysRisk: string;
  budgetUsed: number;
  budgetTotal: number;
  budgetPct: number;
  budgetStatus: string;
  healthTrend: string;
  tabs: Array<{ label: string; count?: number }>;
  phases: Array<{ name: string; start: number; end: number; progress: number }>;
  timelineMonths: string[];
  todayIndex: number;
  meetings: Array<{ title: string; when: string; avatars: string[] }>;
  activity: Array<{ text: string; who: string; when: string; tone?: string }>;
  radar: Array<{ label: string; value: number }>;
  risks: Array<{ title: string; meta: string; priority: string }>;
  stakeholders: Array<{ name: string; role: string; initials: string }>;
  executions: Array<{
    task_id: string;
    status: string;
    owner: string;
    type: string;
    weight: number;
    success_condition: string | null;
    blocked_reasons: string | null;
    last_update: string | null;
  }>;
  signals: Array<{
    id: string;
    source: string;
    content: string;
    state: string;
    detected_at: string | null;
    source_subtype?: string | null;
    external_id?: string | null;
    owner?: string | null;
    openTargets: Array<{ label: string; url: string; section: string }>;
  }>;
};

export async function fetchDecisionDetail(idOrSlug: string): Promise<DecisionDetailView | null> {
  const key = String(idOrSlug || "").trim();
  if (!key) return null;
  return liveOrNull(() => apiGet<DecisionDetailView>(`/api/decisions/${encodeURIComponent(key)}`));
}

export type ClarificationView = {
  id: string;
  taskId: string;
  decisionId: string | null;
  owner: string;
  trigger: string;
  questionType: string;
  question: string;
  reason: string;
  requestedFields: string[];
  status: string;
  answer: string | null;
  extractedClaims: unknown;
  committedMutations: unknown;
  rejectedClaims: unknown;
  createdAt: string;
  answeredAt: string | null;
  committedAt: string | null;
};

export async function fetchOpenClarifications(): Promise<ClarificationView[] | null> {
  const data = await liveOrNull(() =>
    apiGet<{ clarifications?: Array<Record<string, unknown>> }>("/api/execution/clarifications?status=OPEN"),
  );
  if (!data) return null;
  return (data.clarifications ?? []).map((row) => ({
    id: String(row.id ?? ""),
    taskId: String(row.taskId ?? ""),
    decisionId: row.decisionId != null ? String(row.decisionId) : null,
    owner: String(row.owner ?? ""),
    trigger: String(row.trigger ?? ""),
    questionType: String(row.questionType ?? ""),
    question: String(row.question ?? ""),
    reason: String(row.reason ?? ""),
    requestedFields: Array.isArray(row.requestedFields) ? row.requestedFields.map(String) : [],
    status: String(row.status ?? ""),
    answer: row.answer != null ? String(row.answer) : null,
    extractedClaims: row.extractedClaims ?? null,
    committedMutations: row.committedMutations ?? null,
    rejectedClaims: row.rejectedClaims ?? null,
    createdAt: String(row.createdAt ?? ""),
    answeredAt: row.answeredAt != null ? String(row.answeredAt) : null,
    committedAt: row.committedAt != null ? String(row.committedAt) : null,
  }));
}

export async function answerClarification(
  id: string,
  answer: string,
): Promise<{
  clarification: ClarificationView;
  claims: unknown[];
  extractSource: string;
  committed: unknown[];
  rejected: unknown[];
} | null> {
  return liveOrNull(() =>
    apiPost(`/api/execution/clarifications/${encodeURIComponent(id)}/answer`, { answer }),
  );
}

export async function dismissClarification(id: string): Promise<ClarificationView | null> {
  const data = await liveOrNull(() =>
    apiPost<{ clarification: ClarificationView }>(
      `/api/execution/clarifications/${encodeURIComponent(id)}/dismiss`,
    ),
  );
  return data?.clarification ?? null;
}

export async function fetchExecutionLedger(scope?: "all"): Promise<ExecutionRow[] | null> {
  const q = scope === "all" ? "?scope=all" : "";
  const data = await liveOrNull(() =>
    apiGet<{ executions: Array<Record<string, unknown>> }>(`/api/execution/ledger${q}`),
  );
  if (!data) return null;
  return (data.executions ?? []).map((e) => ({
    task_id: String(e.task_id ?? ""),
    decision_id: String(e.decision_id ?? ""),
    owner: String(e.owner ?? ""),
    type: String(e.type ?? ""),
    weight: Number(e.weight || 0),
    status: String(e.status ?? ""),
    success_condition: e.success_condition != null ? String(e.success_condition) : null,
    blocked_reasons: e.blocked_reasons != null ? String(e.blocked_reasons) : null,
    last_update: String(e.last_update ?? ""),
    started_at: e.started_at != null ? String(e.started_at) : null,
    completed_at: e.completed_at != null ? String(e.completed_at) : null,
    decision_vow: e.decision_vow != null ? String(e.decision_vow) : null,
    decision_status: e.decision_status != null ? String(e.decision_status) : null,
  }));
}

export async function fetchTeamMetrics(): Promise<TeamMetrics | null> {
  const data = await liveOrNull(() =>
    apiGet<{
      metrics?: Record<string, unknown>;
      members?: Array<Record<string, unknown>>;
      donut?: Record<string, number>;
      deptBars?: Array<{ dept?: string; pct?: number }>;
      insights?: string[];
    }>("/api/metrics/teams"),
  );
  if (!data) return null;
  const m = data.metrics ?? {};
  const donut = data.donut ?? {};
  return {
    metrics: {
      members: Number(m.members || 0),
      utilization: Number(m.utilization || 0),
      atRisk: Number(m.atRisk || 0),
      overCapacity: Number(m.overCapacity || 0),
      aggregateBudget: Number(m.aggregateBudget || 0),
    },
    members: (data.members ?? []).map((row) => ({
      id: String(row.id ?? ""),
      name: String(row.name ?? ""),
      role: String(row.role ?? ""),
      team: String(row.team ?? ""),
      loadPct: Number(row.loadPct || 0),
      status: String(row.status ?? ""),
    })),
    donut: {
      usedPct: Number(donut.usedPct || 0),
      availablePct: Number(donut.availablePct || 0),
      overPct: Number(donut.overPct || 0),
    },
    deptBars: (data.deptBars ?? []).map((b) => ({ dept: String(b.dept || "owner"), pct: Number(b.pct || 0) })),
    insights: Array.isArray(data.insights) ? data.insights : [],
  };
}

export type BrainCounts = {
  people: number;
  projects: number;
  customers: number;
  decisions: number;
  meetings: number;
  documents: number;
  signals: number;
  integrations: number;
};

export type BrainGraphNode = {
  id: string;
  kind: "goal" | "initiative" | "decision" | "execution" | "signal" | "metric" | "customer";
  tone: "gold" | "red" | "orange" | "purple" | "blue" | "green";
  title: string;
  subtitle?: string;
  x: number;
  y: number;
  pill?: { label: string; tone: string };
  risky?: boolean;
  center?: boolean;
  why?: string;
  confidence?: string;
  href?: string;
  openLabel?: string;
};

export type BrainGraphEdge = {
  from: string;
  to: string;
  kind: "requires" | "blocks" | "influences" | "related" | "drives" | "depends" | "affects" | "contributes";
  label?: string;
  pct?: string;
};

export type BrainRecommendation = {
  id: string | null;
  title: string;
  explanation: string;
  status: string;
  confidence: number | null;
  impact: string;
};

export type BrainSummary = {
  counts: BrainCounts;
  sources: Array<{ name: string; connected: boolean }>;
  graph: { nodes: BrainGraphNode[]; edges: BrainGraphEdge[] };
  recommendations: BrainRecommendation[];
  meetings: Array<{ id: string; title: string; occurred_at: string | null; attendees: string }>;
};

export async function fetchBrainSummary(): Promise<BrainSummary | null> {
  const data = await liveOrNull(() => apiGet<BrainSummary>("/api/brain/summary"));
  if (!data?.counts) return null;
  return {
    counts: {
      people: Number(data.counts.people || 0),
      projects: Number(data.counts.projects || 0),
      customers: Number(data.counts.customers || 0),
      decisions: Number(data.counts.decisions || 0),
      meetings: Number(data.counts.meetings || 0),
      documents: Number(data.counts.documents || 0),
      signals: Number(data.counts.signals || 0),
      integrations: Number(data.counts.integrations || 0),
    },
    sources: Array.isArray(data.sources)
      ? data.sources.map((s) => ({ name: String(s.name), connected: Boolean(s.connected) }))
      : [],
    graph: {
      nodes: Array.isArray(data.graph?.nodes) ? data.graph.nodes : [],
      edges: Array.isArray(data.graph?.edges) ? data.graph.edges : [],
    },
    recommendations: Array.isArray(data.recommendations) ? data.recommendations : [],
    meetings: Array.isArray(data.meetings) ? data.meetings : [],
  };
}

export async function fetchEntities(
  type: string,
): Promise<
  Array<{
    id: string;
    label: string;
    type: string;
    confidence: number;
    metadata: Record<string, unknown>;
    freshness_at?: string | null;
  }> | null
> {
  const data = await liveOrNull(() =>
    apiGet<{ entities?: Array<Record<string, unknown>> }>(`/api/entities?type=${encodeURIComponent(type)}&limit=100`),
  );
  if (!data) return null;
  return (data.entities ?? []).map((e) => {
    let metadata: Record<string, unknown> = {};
    const raw = e.metadata_json ?? e.metadata;
    if (raw && typeof raw === "object") metadata = raw as Record<string, unknown>;
    else if (typeof raw === "string") {
      try {
        metadata = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        metadata = {};
      }
    }
    return {
      id: String(e.id ?? ""),
      label: String(e.label ?? e.ref_id ?? e.id ?? ""),
      type: String(e.type ?? type),
      confidence: Number(e.confidence || 0),
      metadata,
      freshness_at: e.freshness_at != null ? String(e.freshness_at) : null,
    };
  });
}

/* ------------------------------ Alerts → notifications ------------------------------ */

type ApiNotification = {
  id: string;
  kind: string;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
};

function notifToAlert(n: ApiNotification): Alert & { id: string } {
  const kind = (n.kind || "").toLowerCase();
  const severity: Alert["severity"] =
    kind.includes("critical") || kind.includes("error")
      ? "Critical"
      : kind.includes("clarification") || kind.includes("warn")
        ? "High"
        : kind.includes("info")
          ? "Info"
          : "Medium";
  const created = n.createdAt ? new Date(n.createdAt) : new Date();
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const group: Alert["group"] = created >= start ? "Today" : "Yesterday";
  return {
    id: n.id,
    title: n.title || "Notification",
    severity,
    description: n.body || "",
    tags: [n.kind || "system"].filter(Boolean),
    time: created.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    action: n.readAt ? "Read" : "Acknowledge",
    group,
    unread: !n.readAt,
  };
}

const alertIdByTitle = new Map<string, string>();

/** Live notifications only. `null` = API failed (caller may use mock). `[]` = none. */
export async function fetchNotifications(limit = 50): Promise<Alert[] | null> {
  const data = await liveOrNull(() =>
    apiGet<{ notifications: ApiNotification[] }>(`/api/notifications?limit=${limit}`),
  );
  if (!data) return null;
  const mapped = (data.notifications ?? []).map(notifToAlert);
  for (const a of mapped) if (a.id) alertIdByTitle.set(a.title, a.id);
  return mapped;
}

export async function fetchMoreAlerts(): Promise<Alert[]> {
  const live = await fetchNotifications();
  return live ?? moreAlerts;
}

export async function markAllNotificationsRead(): Promise<boolean> {
  const res = await liveOrNull(() => apiPost<{ success?: boolean }>("/api/notifications/read-all"));
  return Boolean(res?.success);
}

async function markNotificationRead(title: string): Promise<{ ok: boolean }> {
  let id = alertIdByTitle.get(title);
  if (!id) {
    const data = await liveOrNull(() =>
      apiGet<{ notifications: ApiNotification[] }>("/api/notifications?limit=50"),
    );
    const hit = data?.notifications.find((n) => n.title === title);
    id = hit?.id;
  }
  if (!id) return { ok: true };
  await liveOrNull(() => apiPost(`/api/notifications/${id}/read`));
  return { ok: true };
}

export async function acknowledgeAlert(title: string): Promise<{ ok: boolean }> {
  return markNotificationRead(title);
}

export async function dismissAlert(title: string): Promise<{ ok: boolean }> {
  return markNotificationRead(title);
}

/** ponytail: no snooze API — mark read (same as dismiss). */
export async function snoozeAlert(title: string): Promise<{ ok: boolean }> {
  return markNotificationRead(title);
}

/* ----------------------------- Decisions ----------------------------- */

export type DecisionVerdict = "approved" | "rejected" | "deferred";

export type DecisionRequiredItem = {
  id: string;
  entity_id: string;
  dimension: string;
  severity: string;
  status: string;
  confidence: number;
  decision_id: string | null;
  decision_vow: string | null;
  decision_status: string | null;
  explanation: string | null;
};

export async function fetchDecisionRequired(): Promise<DecisionRequiredItem[]> {
  const data = await liveOrNull(() =>
    apiGet<{ items: DecisionRequiredItem[] }>("/api/reconciliation/decision-required"),
  );
  return Array.isArray(data?.items) ? data.items : [];
}

export type EntitySnapshot = {
  entity_id: string;
  dimension: string;
  state: string;
  value: string | null;
  confidence: number;
};

export type ReconConflict = {
  id: string;
  entity_id: string;
  dimension: string;
  conflict_type: string;
  severity: string;
  status: string;
  confidence: number;
};

export async function fetchReconciliationState(): Promise<EntitySnapshot[]> {
  const data = await liveOrNull(() =>
    apiGet<{ snapshots: EntitySnapshot[] }>("/api/reconciliation/state"),
  );
  return Array.isArray(data?.snapshots) ? data.snapshots : [];
}

export async function fetchReconciliationConflicts(): Promise<ReconConflict[]> {
  const data = await liveOrNull(() =>
    apiGet<{ conflicts: ReconConflict[] }>("/api/reconciliation/conflicts"),
  );
  return Array.isArray(data?.conflicts) ? data.conflicts : [];
}

export type OrgStateSectionItem = {
  id?: string;
  label?: string;
  entity_id?: string;
  severity?: string;
  statement?: string;
  content?: string;
  type?: string;
  confidence?: number;
};

export type OrganizationStateDto = {
  risks?: { items?: OrgStateSectionItem[] };
  blockers?: { items?: OrgStateSectionItem[] };
  commitments?: { items?: OrgStateSectionItem[] };
  activeDecisions?: { items?: OrgStateSectionItem[] };
  meta?: { version?: number; compiled_at?: string };
};

export async function fetchOrganizationState(): Promise<OrganizationStateDto | null> {
  const data = await liveOrNull(() =>
    apiGet<{ state: OrganizationStateDto }>("/api/state/current"),
  );
  return data?.state ?? null;
}

export type ExecutionPlanExistingWork = {
  source: string;
  externalId: string | null;
  label: string;
  url: string | null;
  taskId: string | null;
};

export type ExecutionPlanAction = {
  taskId: string;
  label: string;
  owner: string;
  status: string;
  kind: "ready" | "in_progress" | "blocked" | "needs_clarification" | "done" | "killed";
  weight: number;
  incompleteDeps: number;
  blockedReasons: string[];
  clarification: { trigger: string; questionType: string } | null;
  existingWork: ExecutionPlanExistingWork[];
};

export type ExecutionPlan = {
  decisionId: string;
  vow: string;
  status: string;
  actions: ExecutionPlanAction[];
  counts: {
    total: number;
    ready: number;
    inProgress: number;
    blocked: number;
    needsClarification: number;
    done: number;
    owners: number;
    dependencies: number;
    existingWork: number;
    ownerConflicts: number;
  };
  owners: Array<{
    owner: string;
    activeWeight: number;
    pendingWeight: number;
    capacity: number;
    conflict: boolean;
  }>;
  existingWork: ExecutionPlanExistingWork[];
  readinessPct: number;
  recommendedNext: string;
};

export async function fetchExecutionPlan(decisionId: string): Promise<ExecutionPlan | null> {
  const id = String(decisionId || "").trim();
  if (!id) return null;
  const data = await liveOrNull(() =>
    apiGet<{ plan: ExecutionPlan }>(`/api/decisions/${encodeURIComponent(id)}/execution-plan`),
  );
  return data?.plan ?? null;
}

export type OrchestrationAction = {
  id: string;
  decisionId: string;
  executionId: string | null;
  actionType: string;
  targetSystem: string;
  reason: string;
  owner: string | null;
  risk: string;
  policyResult: "ALLOW" | "REQUIRE_APPROVAL" | "DENY";
  status: string;
  externalId: string | null;
  error: string | null;
  intent: Record<string, unknown>;
};

export type OrchestrationSummary = {
  decisionId: string;
  vow: string;
  status: string;
  readinessPct: number;
  recommendedNext: string;
  counts: {
    actions: number;
    existing: number;
    missing: number;
    meetings: number;
    clarifications: number;
    people: number;
    awaitingApproval: number;
    completed: number;
    blockedConnector: number;
  };
  people: string[];
  actions: OrchestrationAction[];
};

export async function fetchOrchestration(decisionId: string): Promise<OrchestrationSummary | null> {
  const id = String(decisionId || "").trim();
  if (!id) return null;
  const data = await liveOrNull(() =>
    apiGet<{ orchestration: OrchestrationSummary }>(`/api/decisions/${encodeURIComponent(id)}/orchestration`),
  );
  return data?.orchestration ?? null;
}

export async function runOrchestration(decisionId: string): Promise<OrchestrationSummary | null> {
  const id = String(decisionId || "").trim();
  if (!id) return null;
  const data = await liveOrNull(() =>
    apiPost<{ orchestration: OrchestrationSummary }>(`/api/decisions/${encodeURIComponent(id)}/orchestration/run`, {}),
  );
  return data?.orchestration ?? null;
}

export async function authorizeOrchestrationAction(
  actionId: string,
): Promise<{ action: OrchestrationAction; orchestration: OrchestrationSummary | null } | null> {
  const id = String(actionId || "").trim();
  if (!id) return null;
  return liveOrNull(() =>
    apiPost(`/api/orchestration/actions/${encodeURIComponent(id)}/authorize`, {}),
  );
}

export type ProposedAction = {
  id: string;
  type: "start_task" | "commit_decision" | "open_clarification";
  label: string;
  owner: string;
  gate: "ready" | "waiting";
  detail: string;
  decisionId?: string;
  taskId?: string;
  href?: string;
};

export type OrgConsole = {
  focus: { decisionId: string; vow: string; status: string; confidence: number | null } | null;
  plan: ExecutionPlan | null;
  risks: Array<{
    taskId: string;
    label: string;
    owner: string;
    status: string;
    blockedReasons: string[];
    evidence: Array<{ source: string; label: string; content: string; when: string | null; url: string | null }>;
    blocking: string[];
  }>;
  people: Array<{
    owner: string;
    name: string;
    team: string;
    role: string;
    loadPct: number;
    status: string;
    active: number;
    pending: number;
    blocked: number;
    waitingOn: string[];
    blocking: string[];
    focus: string[];
  }>;
  teams: Array<{ name: string; healthPct: number; members: number; blocked: number }>;
  nodes: Array<{ id: string; label: string; owner: string; status: string }>;
  edges: Array<{ from: string; to: string }>;
  proposed: ProposedAction[];
  counts: { people: number; teams: number; initiatives: number };
  policyNote: string;
};

export type OrgIntelligence = {
  snapshot: {
    people: number;
    teams: number;
    initiatives: number;
    healthPct: number;
    healthDelta: number;
    overloaded: number;
    depsAtRisk: number;
  };
  teams: Array<{
    id: string;
    name: string;
    parentId: string | null;
    healthPct: number;
    workload: "High" | "Medium" | "Optimal" | "Low";
    atRisk: number;
    members: Array<{ name: string; initials: string; owner: string }>;
    peopleCount: number;
  }>;
  tree: Array<{
    id: string;
    name: string;
    peopleCount: number;
    children: OrgIntelligence["tree"];
  }>;
  peopleAtRisk: OrgPersonCard[];
  people: OrgPersonCard[];
  dependencies: Array<{
    id: string;
    fromTeam: string;
    fromWork: string;
    toTeam: string;
    toWork: string;
    status: "ON_TRACK" | "AT_RISK" | "DELAYED";
    source: "ledger" | "manual";
    executionId: string | null;
  }>;
  workload: { high: number; medium: number; optimal: number; low: number };
  recentChanges: Array<{
    id: string;
    kind: string;
    actor: string | null;
    summary: string;
    createdAt: string;
  }>;
  ownership: Array<{
    owner: string;
    name: string;
    team: string;
    work: string;
    status: string;
    criticalPath: boolean;
  }>;
};

export type OrgPersonCard = {
  owner: string;
  name: string;
  role: string;
  team: string;
  email: string;
  loadPct: number;
  status: string;
  workload: "High" | "Medium" | "Optimal" | "Low";
  active: number;
  pending: number;
  blocked: number;
  waitingOn: string[];
  blocking: string[];
  focus: string[];
  reportsTo: string | null;
  initials: string;
  criticalPath: boolean;
};

export async function fetchOrgIntelligence(): Promise<OrgIntelligence | null> {
  const data = await liveOrNull(() => apiGet<{ org: OrgIntelligence }>("/api/org/intelligence"));
  return data?.org ?? null;
}

export async function createOrgDependency(body: {
  fromTeam: string;
  fromWork?: string;
  toTeam: string;
  toWork?: string;
  status?: "ON_TRACK" | "AT_RISK" | "DELAYED";
}): Promise<OrgIntelligence | null> {
  const data = await liveOrNull(() => apiPost<{ org: OrgIntelligence }>("/api/org/dependencies", body));
  return data?.org ?? null;
}

export async function fetchOrgConsole(decisionId?: string | null): Promise<OrgConsole | null> {
  const q = decisionId ? `?decisionId=${encodeURIComponent(decisionId)}` : "";
  const data = await liveOrNull(() => apiGet<{ console: OrgConsole }>(`/api/console${q}`));
  return data?.console ?? null;
}

export async function executeConsoleActions(
  actions: ProposedAction[],
): Promise<{ results: Array<{ id: string; ok: boolean; detail: string }>; console: OrgConsole | null } | null> {
  return liveOrNull(() =>
    apiPost("/api/console/execute", {
      actions: actions.map((a) => ({
        id: a.id,
        type: a.type,
        taskId: a.taskId,
        decisionId: a.decisionId,
      })),
    }),
  );
}

export async function commitDecision(
  title: string,
  verdict: DecisionVerdict,
  decisionId?: string | null,
): Promise<{ ok: boolean; verdict: DecisionVerdict; plan?: ExecutionPlan | null }> {
  if (verdict !== "approved") {
    // ponytail: ledger commit only activates; reject/defer stay client-side until API grows statuses
    return { ok: true, verdict };
  }
  if (decisionId) {
    const res = await apiPost<{ executionPlan?: ExecutionPlan | null }>("/api/decisions/commit", { decisionId });
    return { ok: true, verdict, plan: res.executionPlan ?? null };
  }
  const list = (await fetchDecisions()) ?? [];
  const hit =
    list.find((d) => d.vow === title) ||
    list.find((d) => d.vow.toLowerCase().includes(title.toLowerCase()));
  if (!hit) return { ok: false, verdict };
  const res = await apiPost<{ executionPlan?: ExecutionPlan | null }>("/api/decisions/commit", { decisionId: hit.id });
  return { ok: true, verdict, plan: res.executionPlan ?? null };
}

export async function completeDecision(decisionId: string): Promise<{ ok: boolean; status?: string; error?: string }> {
  try {
    const res = await apiPost<{ success?: boolean; status?: string; error?: string }>("/api/decisions/complete", {
      decisionId,
    });
    if (res?.success === false || (res as { error?: string })?.error) {
      return { ok: false, error: String((res as { error?: string }).error || "complete failed") };
    }
    return { ok: true, status: res?.status ?? "COMPLETED" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "complete failed" };
  }
}

export type AttentionItem = {
  rank: number;
  kind: string;
  title: string;
  why: string;
  talkPrompt: string;
  href: string;
};

export type AttentionBrief = {
  headline: string;
  items: AttentionItem[];
};

export async function fetchAttentionBrief(): Promise<AttentionBrief | null> {
  return liveOrNull(() => apiGet<AttentionBrief>("/api/intelligence/attention"));
}

export type TeamsIntelligence = {
  summary: string;
  bottlenecks: Array<{
    team: string;
    blocked_by: string[];
    blocking: string[];
    open_situations: string[];
    open_situation_ids?: string[];
    at_risk_decisions: number;
    overload_people: string[];
    critical_path: boolean;
    evidence?: string[];
  }>;
  cross_team_edges: Array<{
    from: string;
    to: string;
    work: string;
    status: string;
    source: string;
    evidence?: string[];
  }>;
};

export async function fetchTeamsIntelligence(): Promise<TeamsIntelligence | null> {
  const data = await liveOrNull(() =>
    apiGet<{ intelligence: TeamsIntelligence }>("/api/org/teams/intelligence"),
  );
  return data?.intelligence ?? null;
}

/* ----------------------------- Assistant ----------------------------- */

export type TalkAction = {
  id: string;
  label: string;
  kind: "followup" | "create" | "execute" | string;
  prompt?: string;
};

export type TalkTurn = {
  question: string;
  grounded: boolean;
  intent?: string;
  focus_id: string | null;
  decision_id: string | null;
  answer: string;
  actions: TalkAction[];
  situations: Array<{
    id: string;
    title: string;
    stage: string;
    confidence: number;
    trajectory: string;
    decision_id: string | null;
  }>;
  mode?: string;
  followUps?: string[];
  context?: { situations: string[]; customers: string[]; evidence: string[] };
};

export async function talkToHustronix(
  question: string,
  opts?: {
    focusId?: string | null;
    conversationId?: string | null;
    action?:
      | "create_decision"
      | "execute"
      | "complete"
      | "reverse"
      | "validate"
      | "hypotheses"
      | "instrumentation"
      | "feasibility"
      | "outcome"
      | "learn"
      | null;
  },
): Promise<TalkTurn | null> {
  return liveOrNull(() =>
    apiPost<TalkTurn>("/api/intelligence/talk", {
      message: question,
      conversationId: opts?.conversationId || undefined,
      focus_id: opts?.focusId || undefined,
      action: opts?.action || undefined,
    }),
  );
}

export async function askHustronix(question: string): Promise<{ answer: string }> {
  const turn = await talkToHustronix(question);
  if (turn?.answer) return { answer: turn.answer };
  return {
    answer: "Sign in to load live situation context. Ask what's going wrong in the company.",
  };
}

/* ------------------------------ Analytics ------------------------------ */

export async function fetchAnalyticsSummary(
  range: AnalyticsRange = "7d",
): Promise<{ data: AnalyticsSummary; live: boolean; partial: boolean }> {
  const data = await liveOrNull(() =>
    apiGet<AnalyticsSummary>(`/api/analytics/summary?range=${encodeURIComponent(range)}`),
  );
  if (data && (data.overview || data.execution || data.decisions)) {
    const partial = !(data.overview && data.execution && data.decisions);
    return { data: { ...analyticsMock, ...data, range }, live: true, partial };
  }
  return { data: { ...analyticsMock, range }, live: false, partial: false };
}

/* ------------------------------ Misc ------------------------------ */

export async function saveView(name: string): Promise<{ ok: boolean }> {
  // ponytail: persist as settings key instead of new /api/views
  const key = `PREF.saved_view.${name.replace(/\W+/g, "_").slice(0, 40)}`;
  const res = await liveOrNull(() =>
    apiPost("/api/settings/bulk", { settings: { [key]: new Date().toISOString() } }),
  );
  return { ok: Boolean(res) };
}
