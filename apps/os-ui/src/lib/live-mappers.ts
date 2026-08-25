import type { ExecutionRow, LedgerDecision, McExecution, MissionSummary, SignalPreview, TeamMetrics } from "./api";
import type { FocusItem, Metric, ScheduleItem } from "./types";

export function firstName(display: string | undefined, fallback = "there"): string {
  const t = (display || "").trim();
  if (!t) return fallback;
  return t.split(/\s+/)[0];
}

export function greetingForHour(d = new Date()): string {
  const h = d.getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export function confidencePct(c: number | null | undefined): number | null {
  if (c == null || Number.isNaN(Number(c))) return null;
  const n = Number(c);
  return n <= 1 ? Math.round(n * 100) : Math.round(n);
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const raw = iso.includes("T") ? iso : iso.replace(" ", "T");
  const t = new Date(raw);
  if (Number.isNaN(t.getTime())) return iso;
  const diff = Date.now() - t.getTime();
  const m = Math.round(diff / 60000);
  if (Math.abs(m) < 1) return "just now";
  if (Math.abs(m) < 60) return `${Math.abs(m)}m ago`;
  const h = Math.round(m / 60);
  if (Math.abs(h) < 24) return `${Math.abs(h)}h ago`;
  return `${Math.abs(Math.round(h / 24))}d ago`;
}

export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const raw = iso.includes("T") ? iso : iso.replace(" ", "T");
  const t = new Date(raw);
  if (Number.isNaN(t.getTime())) return iso;
  return t.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function openDecisionCount(list: LedgerDecision[]): number {
  return list.filter((d) => d.status === "DRAFT" || d.status === "UNDER_REVIEW").length;
}

export type SignalFact = { label: string; value: string };

export type ParsedSignalContent = {
  event: string | null;
  title: string;
  body: string;
  facts: SignalFact[];
};

const SIGNAL_TITLE_KEYS = ["summary", "title", "subject", "message", "text"];
const SIGNAL_BODY_KEYS = ["health_note", "body", "description", "note", "snippet"];
const SIGNAL_SKIP_KEYS = new Set([...SIGNAL_TITLE_KEYS, ...SIGNAL_BODY_KEYS]);
const SIGNAL_ATTR_LABELS: Record<string, string> = {
  objectid: "Object",
  object_id: "Object",
  status: "Status",
  assignee: "Assignee",
  scenario: "Scenario",
  channel: "Channel",
  user: "User",
  state: "State",
  meeting: "Meeting",
};

function humanizeSignalKey(key: string): string {
  const mapped = SIGNAL_ATTR_LABELS[key.toLowerCase()];
  if (mapped) return mapped;
  return key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function humanizeSnake(value: string): string {
  if (!/^[a-z0-9]+(_[a-z0-9]+)+$/.test(value)) return value;
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function unescapeJsonString(value: string): string {
  return value.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function parseEmbeddedJson(text: string): { obj: Record<string, unknown> | null; prefix: string } {
  const i = text.indexOf("{");
  if (i < 0) return { obj: null, prefix: text };
  const slice = text.slice(i).trim();
  try {
    const parsed = JSON.parse(slice) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { obj: parsed as Record<string, unknown>, prefix: text.slice(0, i).trim() };
    }
  } catch {
    const obj: Record<string, unknown> = {};
    const re = /"([A-Za-z0-9_]+)"\s*:\s*"((?:\\.|[^"\\])*)"/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(slice))) obj[match[1]] = unescapeJsonString(match[2]);
    if (Object.keys(obj).length) return { obj, prefix: text.slice(0, i).trim() };
  }
  return { obj: null, prefix: text };
}

function splitHeadBody(text: string): { head: string; body: string } {
  const nl = text.indexOf("\n");
  if (nl < 0) return { head: text.trim(), body: "" };
  return { head: text.slice(0, nl).trim(), body: text.slice(nl + 1).trim() };
}

function parseHeadAttrs(head: string): { leftover: string; attrs: SignalFact[] } {
  const facts: SignalFact[] = [];
  const re =
    /([A-Za-z_][\w]*)=(?:"([^"]*)"|'([^']*)'|(\S+(?:\s+(?![A-Za-z_][\w]*=)\S+)*))/g;
  const stripped = head.replace(re, (_all, key: string, dq?: string, sq?: string, bare?: string) => {
    const value = (dq ?? sq ?? bare ?? "").trim();
    if (value && value !== "?") facts.push({ label: humanizeSignalKey(key), value });
    return " ";
  });
  return { leftover: stripped.replace(/\s+/g, " ").trim(), attrs: facts };
}

function pullLabeledLines(text: string): { body: string; facts: SignalFact[] } {
  const facts: SignalFact[] = [];
  const kept: string[] = [];
  for (const line of text.split("\n")) {
    const match = line.match(/^\s*(Ground truth|Entities|Scenario)\s*:\s*(.+)\s*$/i);
    if (match) {
      const kind = match[1].toLowerCase();
      facts.push({
        label: kind === "ground truth" ? "Ground truth" : kind === "entities" ? "Entities" : "Scenario",
        value: kind === "scenario" ? humanizeSnake(match[2].trim()) : match[2].trim(),
      });
    } else kept.push(line);
  }
  return { body: kept.join("\n").trim(), facts };
}

function stringifySignalValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Ingest often packs `[event] key=value {json}` into `content`. Surface a headline, note, and facts. */
export function parseSignalContent(raw: string | null | undefined): ParsedSignalContent {
  const source = (raw || "").trim();
  if (!source) return { event: null, title: "", body: "", facts: [] };

  let rest = source;
  let event: string | null = null;
  const tag = rest.match(/^\[([^\]]+)\]\s*/);
  if (tag) {
    event = tag[1];
    rest = rest.slice(tag[0].length);
  }

  const { obj, prefix } = parseEmbeddedJson(rest);
  const { head, body: afterHead } = splitHeadBody(prefix);
  const { leftover, attrs } = parseHeadAttrs(head);
  const facts: SignalFact[] = [...attrs];
  let title = "";
  let body = afterHead;

  if (obj) {
    for (const key of SIGNAL_TITLE_KEYS) {
      const value = stringifySignalValue(obj[key]);
      if (value) {
        title = value;
        break;
      }
    }
    for (const key of SIGNAL_BODY_KEYS) {
      const value = stringifySignalValue(obj[key]);
      if (value) {
        body = [body, value].filter(Boolean).join("\n");
        break;
      }
    }
    for (const [key, value] of Object.entries(obj)) {
      if (SIGNAL_SKIP_KEYS.has(key)) continue;
      const text = stringifySignalValue(value);
      if (!text || text === "{}" || text === "[]") continue;
      facts.push({
        label: humanizeSignalKey(key),
        value: key.toLowerCase() === "scenario" ? humanizeSnake(text) : text,
      });
    }
  }

  const titleLine = body.match(/^Title:\s*(.+)$/m);
  if (!title && titleLine) {
    title = titleLine[1].trim();
    body = body.replace(/^Title:\s*.+$/m, "").trim();
  }

  if (leftover) {
    if (/^[A-Z][A-Z0-9]+-\d+$/.test(leftover) || (leftover.length < 40 && !leftover.includes(" "))) {
      facts.unshift({
        label: /^[A-Z][A-Z0-9]+-\d+$/.test(leftover) ? "Issue" : "Object",
        value: leftover,
      });
    } else if (!title) {
      title = leftover;
    } else {
      body = [leftover, body].filter(Boolean).join("\n");
    }
  }

  const labeled = pullLabeledLines(body);
  body = labeled.body;
  facts.push(...labeled.facts);

  if (title && body) {
    const compactTitle = title.replace(/\s+/g, " ").trim();
    const lines = body.split("\n");
    if (lines[0]?.replace(/\s+/g, " ").trim() === compactTitle) {
      body = lines.slice(1).join("\n").trim();
    }
  }

  if (!title) {
    const first = body.split("\n").map((line) => line.trim()).find(Boolean);
    if (first && first.length < 160 && !first.startsWith("{")) {
      title = first;
      body = body
        .split("\n")
        .slice(1)
        .join("\n")
        .trim();
    } else {
      title = event?.replace(/[_:.]/g, " ").trim() || source.slice(0, 120);
    }
  }

  const seen = new Set<string>();
  const uniqueFacts = facts.filter((fact) => {
    const key = `${fact.label}|${fact.value}`;
    if (seen.has(key) || fact.value === title) return false;
    seen.add(key);
    return true;
  });

  return { event, title, body, facts: uniqueFacts };
}

export function signalHeadline(raw: string | null | undefined): string {
  const parsed = parseSignalContent(raw);
  return parsed.title || (raw || "").replace(/\s+/g, " ").slice(0, 90);
}

export type FounderDecisionBrief = {
  summary: string;
  happening: string;
  why: string[];
  who: string[];
  next: string[];
  alternatives: string[];
  sources: string[];
  confidencePct: number | null;
  trajectory: string | null;
  impact: string | null;
};

const STAGE_PLAIN: Record<string, string> = {
  AWARENESS: "just appearing",
  FORMING: "still forming",
  ELEVATED: "getting serious",
  DECISION_READY: "ready for a decision",
  DECIDED: "already decided",
  RESOLVED: "resolved",
};

const TRAJ_PLAIN: Record<string, string> = {
  WORSENING: "getting worse",
  IMPROVING: "improving",
  STABLE: "holding steady",
};

const SOURCE_PLAIN: Record<string, string> = {
  slack: "Slack",
  gmail: "email",
  email: "email",
  crm: "CRM",
  hubspot: "CRM",
  jira: "Jira",
  github: "GitHub",
  linear: "Linear",
  meeting: "meetings",
  meetings: "meetings",
  calendar: "calendar",
  notion: "Notion",
  intercom: "Intercom",
};

const ENGINE_NOISE =
  /\b(situation_id|situation_object_id|signal_ids?|institutional_version|readiness_score|coverage_score|DECISION_READY|\[object Object\])\b/i;

function looksLikeUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
}

function stripEntityType(label: string): string {
  return label.replace(/\s*\((customer|product|team|person|project|other|org|company)\)\s*/gi, "").trim();
}

function humanizeSource(raw: string): string {
  const key = raw.trim().toLowerCase();
  return SOURCE_PLAIN[key] || raw.trim();
}

function joinAnd(items: string[]): string {
  const uniq = [...new Set(items.filter(Boolean))];
  if (uniq.length <= 1) return uniq[0] || "";
  if (uniq.length === 2) return `${uniq[0]} and ${uniq[1]}`;
  return `${uniq.slice(0, -1).join(", ")}, and ${uniq[uniq.length - 1]}`;
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  return null;
}

function asStringList(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item.trim();
        if (item && typeof item === "object") {
          const o = item as Record<string, unknown>;
          return String(o.label ?? o.name ?? o.entity_label ?? "").trim();
        }
        return "";
      })
      .filter(Boolean);
  }
  if (typeof value === "string") return value.split(/[,;]/).map((part) => part.trim()).filter(Boolean);
  return [];
}

function uniqueKeep(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const text = item.replace(/\s+/g, " ").trim();
    if (!text || text === "[object Object]" || looksLikeUuid(text) || ENGINE_NOISE.test(text)) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function taskLine(item: unknown): string {
  if (!item || typeof item !== "object") {
    const text = String(item || "").trim();
    return text && text !== "[object Object]" ? text : "";
  }
  const o = item as Record<string, unknown>;
  const owner = String(o.owner ?? "").trim();
  const action = String(o.success_condition ?? o.work ?? o.label ?? o.type ?? "").trim();
  if (owner && action) return `${owner}: ${action}`;
  return action || owner;
}

function parseKvDump(text: string): Record<string, unknown> | null {
  if (!/(situation_id|trajectory|proposed_tasks|ranked_hypotheses|explanation)\s*:/.test(text)) return null;
  const obj: Record<string, unknown> = {};
  for (const part of text.split(/\s*;\s*(?=[A-Za-z_][\w]*\s*:)/)) {
    const match = part.match(/^([A-Za-z_][\w]*)\s*:\s*([\s\S]*)$/);
    if (!match) continue;
    obj[match[1]] = match[2].trim();
  }
  return Object.keys(obj).length ? obj : null;
}

function parseEngineExplanation(text: string): {
  title: string;
  sources: string[];
  entities: string[];
  evidenceCount: number | null;
  days: number | null;
  trajectory: string | null;
  confidencePct: number | null;
} {
  const titleMatch = text.match(
    /^(?:AWARENESS|FORMING|ELEVATED|DECISION_READY|DECIDED|RESOLVED):\s*(.+?)\.(?:\s|$)/,
  );
  const sourcesMatch = text.match(/Sources:\s*([^.]*)/i);
  const entitiesMatch = text.match(/Entities:\s*([^.]*)/i);
  const evidenceMatch = text.match(/Evidence:\s*(\d+)\s*signals?\s*across\s*(\d+)/i);
  const trajMatch = text.match(/Trajectory:\s*([A-Z_]+)/i);
  const confMatch = text.match(/Confidence:\s*(\d+)\s*%/i);
  return {
    title: titleMatch?.[1]?.trim() || "",
    sources: asStringList(sourcesMatch?.[1]).map(humanizeSource),
    entities: asStringList(entitiesMatch?.[1]).map(stripEntityType),
    evidenceCount: evidenceMatch ? Number(evidenceMatch[1]) : null,
    days: evidenceMatch ? Number(evidenceMatch[2]) : null,
    trajectory: trajMatch?.[1] || null,
    confidencePct: confMatch ? Number(confMatch[1]) : null,
  };
}

function emptyBrief(summary = ""): FounderDecisionBrief {
  return {
    summary,
    happening: summary,
    why: [],
    who: [],
    next: [],
    alternatives: [],
    sources: [],
    confidencePct: null,
    trajectory: null,
    impact: null,
  };
}

function fromOutcomeArray(list: unknown[]): string {
  return list
    .map((item) => {
      if (item && typeof item === "object") {
        const o = item as Record<string, unknown>;
        const metric = String(o.metric ?? o.name ?? o.label ?? "").trim();
        const target = String(o.target ?? o.value ?? "").trim();
        return target ? `${metric} — ${target}` : metric;
      }
      return String(item);
    })
    .filter(Boolean)
    .join("; ");
}

function parseLedgerBlob(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    const embedded = parseEmbeddedJson(raw).obj;
    if (embedded) return embedded;
    return parseKvDump(raw) || raw;
  }
}

/** Turn ledger JSON / engine memos into a founder-readable brief. */
export function founderDecisionBrief(raw: string | null | undefined): FounderDecisionBrief {
  if (!raw?.trim()) return emptyBrief();
  const parsed = parseLedgerBlob(raw.trim());
  if (parsed == null) return emptyBrief();

  if (typeof parsed === "string") {
    const cleaned = parsed.replace(/\s+/g, " ").trim();
    if (!ENGINE_NOISE.test(cleaned) && !cleaned.includes("[object Object]")) return emptyBrief(cleaned);
    const kv = parseKvDump(cleaned);
    if (kv) return founderDecisionBrief(JSON.stringify(kv));
    return emptyBrief(cleaned.replace(/\[object Object\]/g, "").replace(/\s+/g, " ").trim());
  }

  if (Array.isArray(parsed)) return emptyBrief(fromOutcomeArray(parsed));

  const obj = asRecord(parsed);
  if (!obj) return emptyBrief(String(parsed));

  const explained =
    typeof obj.explanation === "string"
      ? parseEngineExplanation(obj.explanation)
      : {
          title: "",
          sources: [] as string[],
          entities: [] as string[],
          evidenceCount: null as number | null,
          days: null as number | null,
          trajectory: null as string | null,
          confidencePct: null as number | null,
        };

  const title =
    String(obj.title ?? "").trim() ||
    explained.title ||
    (typeof obj.situation_id === "string" ? humanizeSnake(String(obj.situation_id)) : "");
  const stage = String(obj.stage ?? "").trim().toUpperCase();
  const trajKey = String(obj.trajectory ?? explained.trajectory ?? "").trim().toUpperCase();
  const trajectory = TRAJ_PLAIN[trajKey] || null;
  const confRaw = obj.confidence ?? obj.confidence_0_1;
  let conf = explained.confidencePct;
  if (typeof confRaw === "number" && Number.isFinite(confRaw)) {
    conf = confRaw <= 1 ? Math.round(confRaw * 100) : Math.round(confRaw);
  }

  const who = uniqueKeep([...asStringList(obj.entities), ...explained.entities].map(stripEntityType));
  const sources = uniqueKeep([...asStringList(obj.sources), ...explained.sources].map(humanizeSource));
  const proposed = Array.isArray(obj.proposed_tasks) ? obj.proposed_tasks : [];
  const recommended = Array.isArray(obj.recommended_actions) ? obj.recommended_actions : [];
  const next = uniqueKeep([...proposed.map(taskLine), ...recommended.map(taskLine)]).slice(0, 6);
  const graph = Array.isArray(obj.evidence_graph) ? obj.evidence_graph : [];
  const snippets = uniqueKeep(
    graph.map((item) => {
      if (!item || typeof item !== "object") return "";
      return String((item as Record<string, unknown>).description ?? "")
        .replace(/^Day\s+\d+\s*:\s*/i, "")
        .trim();
    }),
  )
    .filter((line) => !/Facets:|Coverage:|Readiness:|Calibration:|Evidence dimensions/i.test(line))
    .slice(0, 3);
  const hyps = Array.isArray(obj.ranked_hypotheses) ? obj.ranked_hypotheses : [];
  const alternatives = uniqueKeep(
    hyps
      .filter((item) => item && typeof item === "object" && String((item as Record<string, unknown>).id) !== "h_primary")
      .map((item) => String((item as Record<string, unknown>).statement ?? "").trim())
      .filter((line) => line.length > 24 && line.length < 220),
  ).slice(0, 2);

  const why = uniqueKeep([
    explained.evidenceCount && explained.days
      ? `${explained.evidenceCount} related ${explained.evidenceCount === 1 ? "message" : "messages"} over ${explained.days} day${explained.days === 1 ? "" : "s"}${
          sources.length ? ` from ${joinAnd(sources)}` : ""
        }.`
      : sources.length
        ? `Seen in ${joinAnd(sources)}.`
        : "",
    ...snippets,
  ]);

  const situation = title.replace(/\.$/, "");
  const trajBit = trajectory ? ` is ${trajectory}` : situation ? " needs a decision" : "";
  let happening = "";
  if (who[0] && situation) happening = `${who[0]} — ${situation}${trajBit}.`;
  else if (situation) happening = `${situation}${trajBit}.`;
  else if (who[0]) happening = `${who[0]}${trajBit}.`;
  if (happening && STAGE_PLAIN[stage]) {
    happening = `${happening.replace(/\.$/, "")}. It's ${STAGE_PLAIN[stage]}.`;
  }
  if (!happening) happening = why[0] || next[0] || "";

  const impact = who[0] || (situation ? situation.split("/")[0].trim() : null);
  const summary = [happening, why[0], next[0] ? `If approved: ${next[0]}` : ""].filter(Boolean).join(" ");

  if (!summary) {
    const human = String(obj.summary ?? obj.message ?? obj.detail ?? "").trim();
    return emptyBrief(human);
  }

  return {
    summary,
    happening,
    why,
    who,
    next,
    alternatives,
    sources,
    confidencePct: conf,
    trajectory,
    impact,
  };
}

/** Ledger blobs are often JSON; rec cards should show prose, not keys or `[object Object]`. */
export function readableLedgerText(raw: string | null | undefined): string {
  if (!raw?.trim()) return "";
  return founderDecisionBrief(raw).summary || raw.trim();
}

export function recsFromLedgerDecisions(list: LedgerDecision[]) {
  const open = list.filter((d) => d.status === "DRAFT" || d.status === "UNDER_REVIEW");
  const pick = open.length ? open : list.filter((d) => d.status === "ACTIVE");
  return pick.slice(0, 8).map((d, index) => {
    const brief = founderDecisionBrief(d.decision_reasoning);
    const conf = brief.confidencePct ?? confidencePct(d.confidence);
    return {
      title: d.vow,
      explanation:
        brief.summary ||
        readableLedgerText(d.expected_outcomes) ||
        `Status ${d.status.replace(/_/g, " ")} on the decision ledger.`,
      status: d.status.replace(/_/g, " "),
      statusTone: (d.status === "UNDER_REVIEW" ? "medium" : "info") as "info" | "medium",
      confidence: conf ?? 0,
      impact: brief.impact || (d.status === "ACTIVE" ? "Active" : "Review"),
      impactDetail: brief.trajectory || "",
      effort: "Review",
      rank: String(index + 1).padStart(2, "0"),
      decisionId: d.id,
    };
  });
}

export function tabsFromBrainCounts(counts: {
  people: number;
  projects: number;
  customers: number;
  decisions: number;
  meetings: number;
  documents: number;
  signals: number;
  integrations: number;
}) {
  return [
    { label: "All", href: "/brain", count: null as number | null },
    { label: "Graph", href: "/brain/graph", count: null as number | null },
    { label: "People", href: "/brain/people", count: counts.people },
    { label: "Projects", href: "/brain/projects", count: counts.projects },
    { label: "Decisions", href: "/decide", count: counts.decisions },
    { label: "Meetings", href: "/brain/meetings", count: counts.meetings },
    { label: "Customers", href: "/brain/customers", count: counts.customers },
    { label: "Documents", href: "/brain/documents", count: counts.documents },
    { label: "Signals", href: "/signals", count: counts.signals },
  ];
}

export function entityCardsFromCounts(counts: {
  people: number;
  projects: number;
  customers: number;
  decisions: number;
  meetings: number;
  documents: number;
}) {
  return [
    { label: "People", count: counts.people, href: "/brain/people", icon: "users", tone: "purple" as const },
    { label: "Projects", count: counts.projects, href: "/brain/projects", icon: "folder", tone: "info" as const },
    { label: "Customers", count: counts.customers, href: "/brain/customers", icon: "building", tone: "low" as const },
    { label: "Decisions", count: counts.decisions, href: "/decide", icon: "gavel", tone: "medium" as const },
    { label: "Meetings", count: counts.meetings, href: "/brain/meetings", icon: "calendar", tone: "cyan" as const },
    { label: "Documents", count: counts.documents, href: "/brain/documents", icon: "file", tone: "high" as const },
  ];
}

export function homeMetricsFromSummary(
  s: MissionSummary,
  openDecisions: number,
  unreadAlerts: number,
): Metric[] {
  const blocked = s.executionSummary.blocked;
  const total = s.executionSummary.total || 0;
  const active = s.executionSummary.active || 0;
  const health = total
    ? Math.max(0, Math.min(100, Math.round((active / total) * 100) - blocked * 8))
    : unreadAlerts || openDecisions ? 62 : 100;
  const risks = blocked + (s.unverifiedSignalCount ? 1 : 0) + (unreadAlerts ? 1 : 0);
  return [
    {
      label: "Execution health",
      value: `${health}%`,
      subtitle: total ? `${active} active of ${total}` : "No work on ledger",
      status: health >= 70 ? "healthy" : health >= 50 ? "high" : "critical",
      icon: "check",
    },
    {
      label: "Active risks",
      value: risks,
      subtitle: unreadAlerts ? `${unreadAlerts} unread` : "Needs attention",
      status: risks ? "high" : "healthy",
      icon: "warning",
    },
    {
      label: "Decisions pending",
      value: openDecisions,
      subtitle: openDecisions ? "Need a commit" : "None waiting",
      status: openDecisions ? "critical" : "healthy",
      icon: "alert",
    },
    {
      label: "Blocked work",
      value: blocked,
      subtitle: "Execution ledger",
      status: blocked ? "high" : "healthy",
      icon: "calendar",
    },
  ];
}

const FOCUS_ICONS = ["rocket", "users", "tag", "building"] as const;

export function focusFromExecutions(rows: McExecution[]): FocusItem[] {
  const byInitiative = new Map<string, McExecution[]>();
  for (const e of rows) {
    const k = e.decision_vow || e.success_condition || e.task_id;
    const list = byInitiative.get(k) ?? [];
    list.push(e);
    byInitiative.set(k, list);
  }
  return [...byInitiative.entries()].slice(0, 4).map(([title, tasks], i) => {
    const worst = tasks.some((t) => t.status === "BLOCKED")
      ? "BLOCKED"
      : tasks.some((t) => t.status === "PENDING")
        ? "PENDING"
        : tasks.some((t) => t.status === "ACTIVE")
          ? "ACTIVE"
          : tasks[0]?.status ?? "";
    return {
      id: tasks[0]?.task_id || title,
      title,
      status: worst === "BLOCKED" ? "Blocked" : worst === "PENDING" ? "Pending" : worst === "ACTIVE" ? "Active" : worst,
      statusTone: worst === "BLOCKED" ? "at-risk" : worst === "PENDING" ? "pending" : "info",
      progress: worst === "BLOCKED" ? 15 : worst === "PENDING" ? 35 : worst === "ACTIVE" ? 60 : 100,
      due: tasks[0]?.owner ?? "",
      icon: FOCUS_ICONS[i % FOCUS_ICONS.length],
    };
  });
}

export function scheduleFromSignals(signals: SignalPreview[]): ScheduleItem[] {
  return signals.slice(0, 4).map((s, i) => ({
    time: formatWhen(s.detected_at),
    title: (s.content || s.source).slice(0, 90),
    badge: [s.source, s.source_subtype || s.runtime, s.state].filter(Boolean).join(" · "),
    highlight: i === 0,
  }));
}

export function executeMetricsFromSummary(s: MissionSummary): Metric[] {
  const { total, active, pending, blocked, done } = s.executionSummary;
  const pct = (n: number) => (total ? `${Math.round((n / total) * 100)}% of ledger` : "No executions");
  return [
    { label: "Executed", value: done, subtitle: pct(done), status: "healthy" },
    { label: "In flight", value: active + pending, subtitle: pct(active + pending), status: "info" },
    { label: "Pending", value: pending, subtitle: pct(pending), status: "at-risk" },
    { label: "Blocked", value: blocked, subtitle: pct(blocked), status: "critical" },
  ];
}

export function activeDecisionsFromLedger(rows: ExecutionRow[]) {
  const byVow = new Map<string, ExecutionRow[]>();
  for (const r of rows) {
    const k = r.decision_vow || r.decision_id || r.task_id;
    const list = byVow.get(k) ?? [];
    list.push(r);
    byVow.set(k, list);
  }
  return [...byVow.entries()]
    .map(([title, tasks]) => {
      const blocked = tasks.some((t) => t.status === "BLOCKED");
      const doneN = tasks.filter((t) => t.status.toUpperCase() === "DONE").length;
      const openN = tasks.filter((t) =>
        ["ACTIVE", "PENDING", "BLOCKED"].includes(t.status.toUpperCase()),
      ).length;
      const progress = Math.round(
        ((doneN + tasks.filter((t) => t.status.toUpperCase() === "ACTIVE").length * 0.5) /
          Math.max(1, tasks.length)) *
          100,
      );
      const killedN = tasks.filter((t) => t.status.toUpperCase() === "KILLED").length;
      const decisionId = tasks[0]?.decision_id || "";
      const decisionStatus = String(tasks[0]?.decision_status || "").toUpperCase();
      const completionEligible =
        decisionStatus === "ACTIVE" &&
        tasks.length > 0 &&
        doneN === tasks.length &&
        killedN === 0 &&
        openN === 0;
      const started = tasks.map((t) => t.started_at || t.last_update).filter(Boolean).sort()[0];
      const status = blocked
        ? "At Risk"
        : openN === 0 && doneN > 0
          ? "Executed"
          : doneN > 0
            ? "Executing"
            : "On Track";
      return {
        title,
        decisionId,
        completionEligible,
        start: relativeTime(started),
        progress,
        status,
        due: relativeTime(tasks[0]?.last_update),
        avatars: [...new Set(tasks.map((t) => initials(t.owner || "?")))].slice(0, 3),
        _sort: openN > 0 ? 0 : 1,
        _progress: progress,
      };
    })
    .sort((a, b) => a._sort - b._sort || b._progress - a._progress)
    .slice(0, 8)
    .map(({ _sort: _s, _progress: _p, ...row }) => row);
}

/** ponytail: 3-segment bar from load% — over = above 100, optimal = used, under = leftover. */
export function capacityRowsFromTeams(t: TeamMetrics) {
  return t.deptBars.map((row) => {
    const pct = Math.max(0, row.pct);
    const over = pct > 100 ? Math.min(40, pct - 100) : 0;
    const used = Math.min(100, pct);
    const optimal = Math.max(0, used - over);
    const under = Math.max(0, 100 - used);
    return { team: row.dept, over, optimal, under };
  });
}

export function blockersFromLedger(rows: ExecutionRow[]) {
  return rows
    .filter((r) => r.status.toUpperCase() === "BLOCKED")
    .slice(0, 6)
    .map((r) => {
      let note = r.success_condition || "";
      try {
        const reasons = r.blocked_reasons ? JSON.parse(r.blocked_reasons) : [];
        if (Array.isArray(reasons) && reasons.length) note = reasons.map(String).join(", ");
      } catch {
        /* keep success_condition */
      }
      return {
        title: r.decision_vow || r.success_condition || r.task_id,
        severity: "Critical" as const,
        since: relativeTime(r.last_update),
        owner: initials(r.owner || "?"),
        note: note || "Blocked on ledger",
      };
    });
}

export function openDecisionRows(
  list: LedgerDecision[],
  owner: string,
): Array<{
  id: string;
  title: string;
  type: string;
  owner: string;
  impact: "High" | "Medium" | "Low";
  deadline: string;
  age: string;
  status: string;
}> {
  return list.map((d) => {
    const conf = confidencePct(d.confidence) ?? 0;
    return {
      id: d.id,
      title: d.vow,
      type: d.status.replace(/_/g, " "),
      owner,
      impact: conf >= 80 ? "High" : conf >= 50 ? "Medium" : "Low",
      deadline: formatWhen(d.created_at),
      age: relativeTime(d.created_at),
      status: d.status.replace(/_/g, " "),
    };
  });
}

const STAGE_ORDER = ["DRAFT", "UNDER_REVIEW", "ACTIVE", "COMPLETED", "REVERSED"] as const;
const STAGE_LABEL: Record<(typeof STAGE_ORDER)[number], string> = {
  DRAFT: "Draft",
  UNDER_REVIEW: "Under review",
  ACTIVE: "Active",
  COMPLETED: "Completed",
  REVERSED: "Reversed",
};

export function stageBarsFromDecisions(list: LedgerDecision[]) {
  const counts = new Map<string, number>();
  for (const d of list) counts.set(d.status, (counts.get(d.status) || 0) + 1);
  const max = Math.max(1, list.length);
  return STAGE_ORDER.map((s) => ({
    label: STAGE_LABEL[s],
    value: counts.get(s) || 0,
    max,
  }));
}

export function decisionHealth(
  list: LedgerDecision[],
  exec: { active: number; pending: number; blocked: number; total: number },
) {
  const n = list.length;
  const active = list.filter((d) => d.status === "ACTIVE" || d.status === "COMPLETED").length;
  const review = list.filter((d) => d.status === "UNDER_REVIEW").length;
  const draft = list.filter((d) => d.status === "DRAFT").length;
  const ring = n
    ? Math.max(0, Math.min(100, Math.round((active / n) * 100) - (exec.blocked ? 8 : 0)))
    : exec.total
      ? Math.round((exec.active / exec.total) * 100)
      : 0;
  return {
    ring,
    label: !n && !exec.total ? "Empty" : ring >= 70 ? "Good" : ring >= 40 ? "Watch" : "At Risk",
    tone: !n && !exec.total ? "info" : ring >= 70 ? "good" : ring >= 40 ? "at-risk" : "critical",
    healthy: n ? Math.round((active / n) * 100) : 0,
    atRisk: n ? Math.round((review / n) * 100) : 0,
    blocked: exec.total ? Math.round((exec.blocked / exec.total) * 100) : 0,
    pending: n ? Math.round((draft / n) * 100) : 0,
  };
}

export function recentFromDecisions(list: LedgerDecision[]) {
  return list.slice(0, 6).map((d) => {
    const brief = founderDecisionBrief(d.decision_reasoning);
    return {
      id: d.id,
      title: d.vow,
      result:
        d.status === "COMPLETED" || d.status === "ACTIVE"
          ? "Approved"
          : d.status === "REVERSED"
            ? "Rejected"
            : d.status.replace(/_/g, " "),
      date: relativeTime(d.created_at),
      detail:
        brief.summary ||
        readableLedgerText(d.expected_outcomes) ||
        `Status ${d.status.replace(/_/g, " ")} on the decision ledger.`,
      confidence: brief.confidencePct ?? confidencePct(d.confidence) ?? undefined,
    };
  });
}

function ledgerPanelItem(d: LedgerDecision, progressFallback: number) {
  const brief = founderDecisionBrief(d.decision_reasoning);
  return {
    id: d.id,
    title: d.vow,
    stage: d.status.replace(/_/g, " "),
    progress: confidencePct(d.confidence) ?? progressFallback,
    detail:
      brief.summary ||
      readableLedgerText(d.expected_outcomes) ||
      `Status ${d.status.replace(/_/g, " ")} on the decision ledger.`,
    confidence: brief.confidencePct ?? confidencePct(d.confidence) ?? undefined,
  };
}

export function splitDecisionPanels(list: LedgerDecision[]) {
  const strategic = list
    .filter((d) => d.status === "ACTIVE" || d.status === "COMPLETED")
    .slice(0, 4)
    .map((d) => ledgerPanelItem(d, 50));
  const operational = list
    .filter((d) => d.status === "DRAFT" || d.status === "UNDER_REVIEW")
    .slice(0, 4)
    .map((d) => ledgerPanelItem(d, 30));
  return { strategic, operational };
}

const MAP_TONES = ["purple", "blue", "green"] as const;

export type ExecutionMapRow = {
  id: string;
  tone: string;
  objective: { title: string; pct: number };
  project: string;
  milestones: Array<{ name: string; pct: number }>;
  tasks: { label: string; pct: number };
  signal: { label: string; delta: string };
  detail: string;
};

export function mapRowsFromLedger(rows: ExecutionRow[]): ExecutionMapRow[] {
  const byVow = new Map<string, ExecutionRow[]>();
  for (const r of rows) {
    const k = r.decision_vow || r.decision_id || r.task_id;
    const list = byVow.get(k) ?? [];
    list.push(r);
    byVow.set(k, list);
  }
  return [...byVow.entries()].slice(0, 8).map(([vow, tasks], i) => {
    const doneN = tasks.filter((t) => t.status === "DONE").length;
    const pct = Math.round(((doneN + tasks.filter((t) => t.status === "ACTIVE").length * 0.5) / Math.max(1, tasks.length)) * 100);
    const blocked = tasks.find((t) => t.status === "BLOCKED");
    const decisionId = tasks[0]?.decision_id || vow;
    const typeLabel = tasks[0]?.type?.replace(/_/g, " ");
    const projectLabel =
      typeLabel && !/^action$/i.test(typeLabel.trim())
        ? typeLabel
        : vow.length > 36
          ? `${vow.slice(0, 36)}…`
          : vow;
    return {
      id: `${decisionId}:${i}`,
      tone: MAP_TONES[i % MAP_TONES.length],
      objective: { title: vow, pct },
      project: projectLabel,
      milestones: tasks.slice(0, 2).map((t) => ({
        name: (t.success_condition || t.type || t.task_id).slice(0, 42),
        pct: t.status === "DONE" ? 100 : t.status === "ACTIVE" ? 60 : t.status === "BLOCKED" ? 20 : 30,
      })),
      tasks: { label: `${doneN} / ${tasks.length}`, pct },
      signal: {
        label: blocked ? `Blocked · ${blocked.owner}` : `${tasks[0]?.owner || "—"} · ${tasks[0]?.status}`,
        delta: relativeTime(tasks[0]?.last_update),
      },
      detail: `${tasks.length} tasks · ${[...new Set(tasks.map((t) => t.owner))].join(", ")}`,
    };
  });
}
