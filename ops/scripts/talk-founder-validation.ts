/**
 * Founder validation harness — create isolated tenant + session manifest.
 * Does NOT modify Talk behavior. Does NOT coach the founder.
 *
 * Usage:
 *   npm run founder:validation
 *   npm run founder:validation -- --smoke   # integrity smoke only (not the human test)
 */
import { randomUUID } from "node:crypto";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { db } from "../../apps/api/src/database.js";
import { hashPassword } from "../../apps/api/src/auth/password.js";
import { resolveTenantContext } from "../../apps/api/src/security/tenant-context.js";
import { talkToHustronix } from "../../apps/api/src/intelligence/talk/talk-orchestrator.js";
import { recentTalkTraces } from "../../apps/api/src/intelligence/talk/talk-observability.js";
import { seedFounderCompanyBrain, type SeedCounts } from "./founder-validation/seed-company.js";

export type FounderSessionManifest = {
  schema: "hustronix.founder_validation.v1";
  session_id: string;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  founder_user_id: string;
  username: string;
  /** OPERATOR ONLY — never ship to customer reports */
  operator_password: string;
  email: string;
  conversation_id: string;
  isolation_probe_user_id: string;
  seed: SeedCounts;
  seed_method: string;
  status: "ready" | "in_progress" | "exported" | "smoke_complete";
  turns: FounderTurnRecord[];
  notes: string[];
};

export type FounderTurnRecord = {
  turn_number: number;
  timestamp: string;
  user_message: string;
  assistant_response: string;
  context_mode?: string;
  intent?: string;
  mode?: string;
  focus_entity?: string | null;
  focus_situation?: string | null;
  retrieval_plan?: unknown;
  retrieved_situations?: string[];
  retrieved_entities?: string[];
  retrieved_evidence?: number;
  retrieved_decisions?: number;
  trace_id?: string | null;
  latency_ms?: number | null;
  guard_result?: boolean | null;
  fallback?: boolean | null;
  path?: string | null;
  grounded?: boolean;
};

function sessionDir(): string {
  const dir = join(process.cwd(), "data", "founder-validation");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function sessionPath(sessionId: string): string {
  return join(sessionDir(), `${sessionId}.json`);
}

export function createFounderValidationSession(opts?: { tag?: string }): FounderSessionManifest {
  // Keep userId ≤ 12 chars so default org slug `org-${userId.slice(0,12)}` stays unique
  // (tenant-context provision uses a 12-char slug prefix).
  const tag = (opts?.tag || randomUUID().replace(/-/g, "")).slice(0, 10);
  const sessionId = `fvs_${tag}`;
  const userId = `fv${tag}`.slice(0, 12);
  const username = userId;
  const password = `Fv-${tag}-Validate`;
  const email = `${userId}@founder-validation.local`;

  db.createUser(userId, username, hashPassword(password), email);
  try {
    resolveTenantContext(userId);
  } catch {
    // Talk remains tenant-scoped by user_id even if org provision races.
  }

  const seed = seedFounderCompanyBrain(userId);

  const isoTag = randomUUID().replace(/-/g, "").slice(0, 10);
  const isoId = `fi${isoTag}`.slice(0, 12);
  try {
    db.createUser(isoId, isoId, hashPassword(`iso-${isoTag}`), `${isoId}@founder-validation.local`);
    try {
      resolveTenantContext(isoId);
    } catch {
      /* optional */
    }
    db.rawRun(
      `INSERT INTO situations (id, user_id, pattern_id, title, stage, confidence, trajectory, first_observed_day,
         explanation, entities_json, facets_json, recommended_actions_json, evidence_count)
       VALUES (?, ?, ?, 'SecretAcmeOnly private thread', 'ELEVATED', 0.5, 'STABLE', NULL, ?, ?, ?, ?, 0)`,
      [
        randomUUID(),
        isoId,
        `priv_${isoTag.slice(0, 6)}`,
        "Confidential tenant-only account.",
        JSON.stringify(["SecretAcmeOnly"]),
        JSON.stringify(["ops"]),
        JSON.stringify([]),
      ],
    );
  } catch {
    /* best-effort isolation fixture */
  }

  const manifest: FounderSessionManifest = {
    schema: "hustronix.founder_validation.v1",
    session_id: sessionId,
    created_at: new Date().toISOString(),
    started_at: null,
    ended_at: null,
    founder_user_id: userId,
    username,
    operator_password: password,
    email,
    conversation_id: `founder-live-${tag}`,
    isolation_probe_user_id: isoId,
    seed,
    seed_method: "ops/scripts/founder-validation/seed-company.ts",
    status: "ready",
    turns: [],
    notes: [
      "Give the founder ONLY the instruction in docs/qa/talk-v2-2-founder-validation.md",
      "Do not coach. Observer uses docs/qa/founder-validation-observer-log.md",
      "After the session: npm run export:founder-session -- " + sessionId,
    ],
  };

  writeFileSync(sessionPath(sessionId), JSON.stringify(manifest, null, 2), "utf8");
  return manifest;
}

export function loadFounderSession(sessionId: string): FounderSessionManifest {
  const p = sessionPath(sessionId);
  if (!existsSync(p)) throw new Error(`Session not found: ${p}`);
  return JSON.parse(readFileSync(p, "utf8")) as FounderSessionManifest;
}

export function saveFounderSession(manifest: FounderSessionManifest): void {
  writeFileSync(sessionPath(manifest.session_id), JSON.stringify(manifest, null, 2), "utf8");
}

/** Append a Talk turn into the session file (for smoke / API-recorded sessions). */
export function recordFounderTurn(
  sessionId: string,
  message: string,
): FounderTurnRecord {
  const manifest = loadFounderSession(sessionId);
  if (!manifest.started_at) {
    manifest.started_at = new Date().toISOString();
    manifest.status = "in_progress";
  }
  const turn = talkToHustronix(manifest.founder_user_id, message, {
    conversationId: manifest.conversation_id,
  });
  const trace = turn.trace as
    | {
        retrieval_plan?: unknown;
        retrieved_situations?: string[];
        retrieved_entities?: string[];
        retrieved_evidence?: number;
        total_latency_ms?: number;
        response_guard_ok?: boolean;
        fallback_used?: boolean;
        path?: string;
        intent?: string;
        context_mode?: string;
        mode?: string;
      }
    | undefined;

  const record: FounderTurnRecord = {
    turn_number: manifest.turns.length + 1,
    timestamp: new Date().toISOString(),
    user_message: message,
    assistant_response: turn.answer,
    context_mode: turn.contextMode || trace?.context_mode,
    intent: trace?.intent || turn.intent,
    mode: turn.mode || trace?.mode,
    focus_entity: turn.context?.customers?.[0] || null,
    focus_situation: turn.situations?.[0]?.id || turn.focus_id || null,
    retrieval_plan: trace?.retrieval_plan || null,
    retrieved_situations: trace?.retrieved_situations || turn.context?.situations || [],
    retrieved_entities: trace?.retrieved_entities || turn.context?.customers || [],
    retrieved_evidence: trace?.retrieved_evidence ?? (turn.context?.evidence?.length || 0),
    retrieved_decisions: Array.isArray((trace as any)?.retrieval_plan)
      ? undefined
      : undefined,
    trace_id: null,
    latency_ms: trace?.total_latency_ms ?? null,
    guard_result: trace?.response_guard_ok ?? null,
    fallback: trace?.fallback_used ?? null,
    path: trace?.path ?? null,
    grounded: turn.grounded,
  };
  manifest.turns.push(record);
  saveFounderSession(manifest);
  return record;
}

/** Pull DB traces into the session after a live UI run. */
export function syncTracesFromDb(sessionId: string): FounderSessionManifest {
  const manifest = loadFounderSession(sessionId);
  const traces = recentTalkTraces(manifest.founder_user_id, 100);
  manifest.notes.push(`Synced ${traces.length} talk_turn_traces at ${new Date().toISOString()}`);
  (manifest as FounderSessionManifest & { db_traces?: unknown }).db_traces = traces;
  if (!manifest.ended_at) manifest.ended_at = new Date().toISOString();
  saveFounderSession(manifest);
  return manifest;
}

function printOperatorCard(m: FounderSessionManifest) {
  console.log(`
════════════════════════════════════════════════════════════
 HUSTRONIX FOUNDER VALIDATION — SESSION READY
════════════════════════════════════════════════════════════
 session_id:     ${m.session_id}
 username:       ${m.username}
 password:       ${m.operator_password}
 user_id:        ${m.founder_user_id}
 conversation:   ${m.conversation_id}

 Seed: ${m.seed.situations} situations, ${m.seed.signals} signals,
       ${m.seed.evidence} evidence links, ${m.seed.decisions} decisions,
       ${m.seed.dependencies} dependencies
 Customers: ${m.seed.customers.join(", ")}

 Founder instruction (ONLY):
   See docs/qa/talk-v2-2-founder-validation.md

 Observer:
   docs/qa/founder-validation-observer-log.md

 After session:
   npm run export:founder-session -- ${m.session_id}

 Manifest:
   data/founder-validation/${m.session_id}.json
════════════════════════════════════════════════════════════
`);
}

import { pathToFileURL } from "node:url";

function main() {
  const args = process.argv.slice(2);
  const smoke = args.includes("--smoke");
  const sync = args.find((a) => a.startsWith("--sync="));
  const sessionArg = args.find((a) => a.startsWith("--session="));

  if (sync) {
    const id = sync.split("=")[1];
    syncTracesFromDb(id);
    console.log(JSON.stringify({ ok: true, action: "sync", session_id: id }, null, 2));
    return;
  }

  if (sessionArg && args.includes("--record")) {
    const id = sessionArg.split("=")[1];
    const msg = args.filter((a) => !a.startsWith("--")).join(" ") || "hi";
    const turn = recordFounderTurn(id, msg);
    console.log(JSON.stringify({ ok: true, action: "record", turn }, null, 2));
    return;
  }

  const manifest = createFounderValidationSession();
  printOperatorCard(manifest);

  if (smoke) {
    // Harness integrity only — not the human founder test protocol.
    recordFounderTurn(manifest.session_id, "hi");
    recordFounderTurn(manifest.session_id, "what's going on with the company?");
    const m = loadFounderSession(manifest.session_id);
    m.status = "smoke_complete";
    m.ended_at = new Date().toISOString();
    saveFounderSession(m);
    console.log(
      JSON.stringify(
        {
          ok: true,
          action: "smoke",
          session_id: m.session_id,
          turns: m.turns.length,
          seed: m.seed,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(JSON.stringify({ ok: true, action: "create", session_id: manifest.session_id, seed: manifest.seed }, null, 2));
  }
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entry || import.meta.url === entry.replace(/\.ts$/, ".ts")) {
  main();
}