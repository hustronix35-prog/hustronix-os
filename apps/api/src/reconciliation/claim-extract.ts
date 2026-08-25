import { parseClaimReady } from "../integrations/claimReady.js";
import { resolveEntityForSignal } from "./entity-resolve.js";
import type { CandidateClaim, ClaimIntent, ClaimState, StateDimension } from "./types.js";

function parseAffectedSystems(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function normalizeSource(source: string, subtype?: string | null): string {
  const sub = String(subtype || "").toLowerCase();
  if (sub.includes("meeting") || source.toLowerCase() === "meeting") return "meeting";
  return String(source || "manual").toLowerCase();
}

function detectIntent(content: string): ClaimIntent {
  const c = content.trim();
  if (/\?/.test(c) || /^(could|should|can)\s+we\b/i.test(c)) return "QUESTION";
  if (/\b(maybe|probably|i think|we should|let'?s consider)\b/i.test(c)) return "PROPOSAL";
  if (/\b(we will|confirmed|decided|approved|launch is)\b/i.test(c)) return "DECISION";
  if (/\b(i'?ll|we'?ll|by friday|commit to|promise)\b/i.test(c)) return "COMMITMENT";
  return "OBSERVATION";
}

function makeClaim(
  entity: { entityId: string; entityLabel: string },
  dimension: StateDimension,
  state: ClaimState | null,
  value: string,
  extras: Partial<CandidateClaim> & { intent: ClaimIntent },
): CandidateClaim {
  return {
    entityId: entity.entityId,
    entityLabel: entity.entityLabel,
    dimension,
    predicate: extras.predicate ?? "status",
    value,
    state,
    intent: extras.intent,
    confidence: extras.confidence ?? 0.7,
    specificity: extras.specificity ?? 0.7,
    directness: extras.directness ?? 0.7,
  };
}

function statusToken(raw: string | null | undefined): string {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ");
}

function workItemState(token: string): ClaimState | null {
  const t = statusToken(token);
  if (!t) return null;
  if (/\b(done|complete|completed|closed|resolved|merged)\b/.test(t)) return "COMPLETE";
  if (/\b(in progress|started|open|opened|reopened)\b/.test(t)) return "IN_PROGRESS";
  if (/\b(blocked|blocker|blocking|hold|waiting)\b/.test(t)) return "BLOCKED";
  if (/\b(todo|to do|not started|backlog)\b/.test(t)) return "NOT_STARTED";
  return null;
}

/**
 * Heuristic claim extraction — Phase 1 substrate.
 * LLM extract is gated off by default (RECONCILIATION_LLM).
 * Prefers claim-ready ingest_meta (event/current/entity_id) over displayText regex.
 */
export function extractClaimsHeuristic(params: {
  tenantId: string;
  userId: string;
  source: string;
  content: string;
  affectedSystemsJson?: string | null;
  opClassification?: string | null;
  sourceSubtype?: string | null;
  ingestMeta?: string | null;
}): CandidateClaim[] {
  const source = normalizeSource(params.source, params.sourceSubtype);
  const content = String(params.content || "");
  const lower = content.toLowerCase();
  const affected = parseAffectedSystems(params.affectedSystemsJson);
  const ready = parseClaimReady(params.ingestMeta);
  const intent = detectIntent(content);
  const entity = resolveEntityForSignal({
    tenantId: params.tenantId,
    userId: params.userId,
    content,
    affectedSystems: affected,
    ingestMeta: params.ingestMeta,
  });

  const out: CandidateClaim[] = [];
  const event = statusToken(ready.event || ready.current || "");
  const current = statusToken(ready.current || ready.event || "");

  if (source === "github") {
    const merged =
      event === "merged" ||
      current === "merged" ||
      /\b(merged|merge commit|successfully merged)\b/i.test(content);
    const opened = event === "opened" || current === "open" || current === "opened";
    const closed = event === "closed" || current === "closed";
    if (merged || (closed && /\bmerged\b/i.test(content))) {
      out.push(
        makeClaim(entity, "IMPLEMENTATION", "COMPLETE", "COMPLETE", {
          intent: "OBSERVATION",
          specificity: 1,
          directness: 1,
          confidence: 0.9,
        }),
        makeClaim(entity, "CODE_INTEGRATION", "COMPLETE", "COMPLETE", {
          intent: "OBSERVATION",
          specificity: 1,
          directness: 1,
          confidence: 0.92,
        }),
      );
    } else if (opened) {
      out.push(
        makeClaim(entity, "CODE_INTEGRATION", "IN_PROGRESS", "IN_PROGRESS", {
          intent: "OBSERVATION",
          specificity: 0.85,
          directness: 1,
          confidence: 0.8,
        }),
      );
    } else if (/\b(merged|merge commit|successfully merged)\b/i.test(content) || /pr\s*#?\d+/i.test(content)) {
      /** Content-only fallback for tests / legacy rows without claim-ready meta. */
      if (/\bmerged\b/i.test(content)) {
        out.push(
          makeClaim(entity, "IMPLEMENTATION", "COMPLETE", "COMPLETE", {
            intent: "OBSERVATION",
            specificity: 0.9,
            directness: 0.85,
            confidence: 0.85,
          }),
          makeClaim(entity, "CODE_INTEGRATION", "COMPLETE", "COMPLETE", {
            intent: "OBSERVATION",
            specificity: 0.9,
            directness: 0.85,
            confidence: 0.88,
          }),
        );
      }
    }
  }

  if (source === "jira" || source === "linear") {
    const fromMeta = workItemState(ready.current || ready.event);
    const fromText = workItemState(content);
    const st = fromMeta || fromText;
    if (st === "COMPLETE") {
      out.push(
        makeClaim(entity, "TASK_STATUS", "COMPLETE", "COMPLETE", {
          intent: "OBSERVATION",
          specificity: fromMeta ? 0.95 : 0.88,
          directness: 1,
          confidence: 0.88,
        }),
      );
    } else if (st === "IN_PROGRESS") {
      out.push(
        makeClaim(entity, "TASK_STATUS", "IN_PROGRESS", "IN_PROGRESS", {
          intent: "OBSERVATION",
          specificity: 0.9,
          directness: 1,
        }),
      );
    } else if (st === "BLOCKED") {
      out.push(
        makeClaim(entity, "TASK_STATUS", "BLOCKED", "BLOCKED", {
          intent: "OBSERVATION",
          specificity: 0.9,
          directness: 1,
        }),
      );
    }
  }

  if (source === "meeting") {
    const kind = String(ready.event || ready.current || params.sourceSubtype || "").toLowerCase();
    if (kind.includes("commitment")) {
      out.push(
        makeClaim(entity, "DEADLINE", null, content.slice(0, 120), {
          predicate: "commitment",
          intent: "COMMITMENT",
          specificity: 0.85,
          directness: 0.8,
          confidence: 0.8,
        }),
      );
    }
    if (kind.includes("blocker") || kind.includes("constraint")) {
      out.push(
        makeClaim(entity, "DEPENDENCY", "BLOCKED", "BLOCKED", {
          intent: "ASSERTION",
          specificity: 0.85,
          directness: 0.8,
          confidence: 0.8,
        }),
      );
    }
    if (kind.includes("decision")) {
      out.push(
        makeClaim(entity, "DECISION", null, content.slice(0, 80), {
          predicate: "decision",
          intent: "DECISION",
          specificity: 0.8,
          directness: 0.75,
        }),
      );
    }
  }

  if (source === "slack" || source === "meeting" || source === "manual" || source === "google") {
    const stateIntent =
      intent === "QUESTION" || intent === "PROPOSAL" ? intent : "OBSERVATION";

    const blockedLang =
      /\b(blocked|blocker|blocking|still blocked|isn'?t ready|not ready|hasn'?t configured|isn'?t configured|waiting on)\b/i.test(
        lower,
      );
    const oauthLang = /\b(oauth|customer|configurat|api key|external)\b/i.test(lower);
    const launchLang = /\b(launch|ship|go.?live)\b/i.test(lower);

    if (blockedLang) {
      if (oauthLang) {
        out.push(
          makeClaim(entity, "CUSTOMER_READINESS", "BLOCKED", "BLOCKED", {
            intent: stateIntent,
            specificity: 0.85,
            directness: source === "meeting" ? 0.75 : 0.55,
            confidence: 0.8,
          }),
          makeClaim(entity, "DEPENDENCY", "BLOCKED", "BLOCKED", {
            intent: stateIntent,
            specificity: 0.8,
            directness: source === "meeting" ? 0.7 : 0.55,
            confidence: 0.75,
          }),
        );
        if (launchLang) {
          out.push(
            makeClaim(entity, "LAUNCH_READINESS", "AT_RISK", "AT_RISK", {
              intent: source === "meeting" ? "ASSERTION" : stateIntent,
              specificity: 0.8,
              directness: source === "meeting" ? 0.7 : 0.55,
              confidence: 0.78,
            }),
          );
        }
      } else if (launchLang) {
        out.push(
          makeClaim(entity, "LAUNCH_READINESS", "BLOCKED", "BLOCKED", {
            intent: stateIntent,
            specificity: 0.8,
            directness: 0.55,
          }),
        );
      } else {
        out.push(
          makeClaim(entity, "TASK_STATUS", "BLOCKED", "BLOCKED", {
            intent: stateIntent,
            specificity: 0.65,
            directness: 0.5,
          }),
        );
      }
    }

    if (/\b(cannot launch|can'?t launch|not ready to launch|launch readiness)\b/i.test(lower)) {
      out.push(
        makeClaim(entity, "LAUNCH_READINESS", "BLOCKED", "BLOCKED", {
          intent: source === "meeting" ? "ASSERTION" : stateIntent,
          specificity: 0.85,
          directness: source === "meeting" ? 0.7 : 0.55,
        }),
      );
    }

    const friday =
      /\b(launch|ship).{0,40}\bfriday\b|\bfriday\b.{0,40}\b(launch|ship)\b/i.test(content);
    const monday =
      /\b(launch|ship).{0,40}\bmonday\b|\bmonday\b.{0,40}\b(launch|ship)\b|\bpostpon/i.test(
        content,
      );
    const decisionIntent = /\b(confirmed|decided|approved|will|postpon)\b/i.test(content)
      ? ("DECISION" as const)
      : ("ASSERTION" as const);

    if (friday && intent !== "QUESTION" && intent !== "PROPOSAL") {
      out.push(
        makeClaim(entity, "DEADLINE", null, "FRIDAY", {
          predicate: "launch_date",
          intent: decisionIntent,
          specificity: 0.7,
          directness: source === "meeting" ? 0.75 : 0.55,
        }),
        makeClaim(entity, "DECISION", null, "LAUNCH_FRIDAY", {
          predicate: "launch_date",
          intent: decisionIntent,
          specificity: 0.7,
          directness: source === "meeting" ? 0.75 : 0.55,
        }),
      );
    }
    if (monday && intent !== "QUESTION" && intent !== "PROPOSAL") {
      out.push(
        makeClaim(entity, "DEADLINE", null, "MONDAY", {
          predicate: "launch_date",
          intent: decisionIntent,
          specificity: 0.7,
          directness: source === "meeting" ? 0.75 : 0.55,
        }),
        makeClaim(entity, "DECISION", null, "LAUNCH_MONDAY", {
          predicate: "launch_date",
          intent: decisionIntent,
          specificity: 0.7,
          directness: source === "meeting" ? 0.75 : 0.55,
        }),
      );
    }

    if (/\b(done|shipped|completed|finished|merged)\b/i.test(lower) && source === "slack") {
      out.push(
        makeClaim(entity, "TASK_STATUS", "COMPLETE", "COMPLETE", {
          intent: "OBSERVATION",
          specificity: 0.45,
          directness: 0.4,
          confidence: 0.55,
        }),
      );
    }
  }

  if (source === "meeting") {
    for (const c of out) {
      if (c.dimension === "DECISION" || c.dimension === "LAUNCH_READINESS" || c.dimension === "DEADLINE") {
        c.directness = Math.max(c.directness, 0.7);
        c.specificity = Math.max(c.specificity, 0.75);
      }
    }
  }

  const seen = new Set<string>();
  return out.filter((c) => {
    const k = `${c.dimension}|${c.value}|${c.state}|${c.intent}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export { resolveEntityForSignal } from "./entity-resolve.js";
