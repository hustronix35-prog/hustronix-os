/**
 * Talk V2 founder validation runner — DOES NOT modify Talk.
 * Creates isolated tenant, seeds business-language Company Brain,
 * runs free-session + controlled probes, writes transcript artifacts.
 *
 * Run: npx tsx ops/scripts/talk-v2-founder-validation-run.ts
 */
import { randomUUID } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { db } from "../../apps/api/src/database.js";
import { hashPassword } from "../../apps/api/src/auth/password.js";
import { resolveTenantContext } from "../../apps/api/src/security/tenant-context.js";
import { talkToHustronix } from "../../apps/api/src/intelligence/talk/talk-orchestrator.js";
import { recentTalkTraces, talkObservabilitySummary } from "../../apps/api/src/intelligence/talk/talk-observability.js";

type TurnLog = {
  n: number;
  phase: "free" | "probe" | "isolation";
  user: string;
  answer: string;
  mode?: string;
  contextMode?: string;
  grounded?: boolean;
  situations: string[];
  customers: string[];
  evidenceCount: number;
  followUps: string[];
  jargonLeak: boolean;
  fabricatedMetric: boolean;
  genericLeversOnly: boolean;
  companySpecific: boolean;
  useful: boolean | null;
  builderIntervention: boolean;
  notes: string;
  trace: unknown;
};

function jargonLeak(text: string): boolean {
  return /\b(DECISION_READY|gateOk|pattern_id|facet|readiness_score|simDay|contextMode|retrieval_plan|entities_json)\b/i.test(
    text,
  );
}

function fabricatedMetric(q: string, a: string): boolean {
  if (!/\b(cac|mrr|arr|gross margin|conversion rate)\b/i.test(q)) return false;
  return /\b(our|my)\s+(cac|mrr|arr|gross margin|conversion rate)\s+(is|was|=)\s*[₹$€]?\s*[\d,.]+/i.test(a);
}

function onlyGenericLevers(a: string): boolean {
  const hasLevers = /leads|conversion|retention|pipeline/i.test(a);
  const hasCompany = /Northstar|Atlas|Meridian|Cobalt|company|your |our /i.test(a);
  return hasLevers && !hasCompany && a.length < 600;
}

function seedTenant(tag: string): string {
  const userId = `fv_${tag}`.slice(0, 32);
  db.createUser(userId, userId, hashPassword(`pw-${userId}`), `${userId}@founder-validation.local`);
  resolveTenantContext(userId);
  return userId;
}

function insertSituation(
  userId: string,
  opts: {
    title: string;
    entities: string[];
    explanation: string;
    snippets: Array<{ source: string; text: string }>;
    trajectory?: string;
    stage?: string;
  },
): string {
  const id = randomUUID();
  db.rawRun(
    `INSERT INTO situations (id, user_id, pattern_id, title, stage, confidence, trajectory, first_observed_day,
       explanation, entities_json, facets_json, recommended_actions_json, evidence_count, updated_at)
     VALUES (?, ?, ?, ?, ?, 0.84, ?, 18, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [
      id,
      userId,
      `biz_${id.slice(0, 8)}`,
      opts.title,
      opts.stage || "ELEVATED",
      opts.trajectory || "WORSENING",
      opts.explanation,
      JSON.stringify(opts.entities),
      JSON.stringify(["ops", "sales"]),
      JSON.stringify(["Review account health", "Confirm renewal timeline"]),
      opts.snippets.length,
    ],
  );
  for (const sn of opts.snippets) {
    const sig = randomUUID();
    db.rawRun(
      `INSERT INTO external_signals (id, user_id, source, content, detected_at, state)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, 'UNVERIFIED')`,
      [sig, userId, sn.source, sn.text],
    );
    db.rawRun(
      `INSERT INTO situation_evidence (id, situation_id, signal_id, facet, sim_day, snippet)
       VALUES (?, ?, ?, 'ops', 18, ?)`,
      [randomUUID(), id, sig, sn.text],
    );
  }
  return id;
}

function seedFounderCompany(userId: string) {
  const northstar = insertSituation(userId, {
    title: "Northstar renewal risk",
    entities: ["Northstar"],
    explanation:
      "Northstar's renewal looks shaky after repeated product complaints and a delayed implementation milestone.",
    snippets: [
      {
        source: "SLACK",
        text: "CS: Northstar logged three serious complaints this month about reliability during onboarding.",
      },
      {
        source: "SLACK",
        text: "Northstar VP asked whether we can guarantee uptime before they renew next quarter.",
      },
      {
        source: "CRM",
        text: "Northstar health score dropped from green to yellow after the implementation delay.",
      },
    ],
  });

  insertSituation(userId, {
    title: "Atlas expansion stalled",
    entities: ["Atlas"],
    explanation: "Atlas expansion is stalled; champion went quiet after pricing discussion.",
    snippets: [
      { source: "SLACK", text: "Sales: Atlas champion stopped responding after we floated the expansion quote." },
      { source: "CRM", text: "Atlas expansion opportunity moved to stalled; next step unclear." },
    ],
  });

  insertSituation(userId, {
    title: "Pipeline coverage below plan",
    entities: ["Meridian", "Sales"],
    explanation: "Late-stage pipeline coverage is below the plan for this quarter.",
    snippets: [
      { source: "CRM", text: "Pipeline coverage for this quarter is at 0.7x versus a 1.2x target." },
      { source: "SLACK", text: "RevOps: Meridian deal slipped two weeks; forecast confidence is down." },
    ],
  });

  insertSituation(userId, {
    title: "Launch blocked on security review",
    entities: ["Engineering", "Security", "Legal"],
    explanation: "Engineering is waiting on Security credential review; Security is waiting on Legal.",
    snippets: [
      { source: "SLACK", text: "Eng: blocked on Security credential review for the customer launch." },
      { source: "SLACK", text: "Security: waiting on Legal approval before we can clear credentials." },
    ],
    stage: "FORMING",
    trajectory: "STABLE",
  });

  // Prior decision + outcome (human-facing vow, not jargon)
  const decisionId = randomUUID();
  try {
    db.rawRun(
      `INSERT INTO decision_ledger (id, user_id, vow, status, created_at)
       VALUES (?, ?, ?, 'COMPLETED', datetime('now', '-20 days'))`,
      [decisionId, userId, "Stabilize Northstar onboarding reliability before pushing expansion pricing"],
    );
  } catch {
    try {
      db.rawRun(
        `INSERT INTO decision_ledger (id, user_id, vow, status) VALUES (?, ?, ?, 'COMPLETED')`,
        [decisionId, userId, "Stabilize Northstar onboarding reliability before pushing expansion pricing"],
      );
    } catch {
      /* schema variance */
    }
  }
  try {
    db.rawRun(
      `INSERT INTO decision_outcomes (decision_id, tenant_id, result, pattern_id, learning_notes, evaluated_at)
       VALUES (?, ?, 'partial', ?, ?, datetime('now', '-5 days'))`,
      [
        decisionId,
        userId,
        "renewal_risk",
        "Complaints slowed but renewal confidence still weak; reliability work helped but did not fully restore trust.",
      ],
    );
  } catch {
    /* optional */
  }

  // Org dependency edge if table exists
  try {
    db.rawRun(
      `INSERT INTO org_dependencies (id, user_id, from_team, to_team, work, status)
       VALUES (?, ?, 'Engineering', 'Security', 'Credential review for launch', 'DELAYED')`,
      [randomUUID(), userId],
    );
  } catch {
    /* optional */
  }

  return { northstar, decisionId };
}

function count(userId: string, table: string, col = "user_id"): number {
  try {
    const rows = db.rawGet(`SELECT COUNT(1) AS n FROM ${table} WHERE ${col} = ?`, [userId]) as { n: number }[];
    return Number(rows[0]?.n || 0);
  } catch {
    return 0;
  }
}

function ask(userId: string, conversationId: string, message: string, phase: TurnLog["phase"], n: number): TurnLog {
  const turn = talkToHustronix(userId, message, { conversationId });
  const answer = turn.answer || "";
  const companySpecific =
    /Northstar|Atlas|Meridian|Engineering|Security|Legal|renewal|pipeline|complaint|coverage/i.test(answer) &&
    turn.contextMode !== "GENERAL";
  const log: TurnLog = {
    n,
    phase,
    user: message,
    answer,
    mode: turn.mode,
    contextMode: turn.contextMode,
    grounded: turn.grounded,
    situations: (turn.situations || []).map((s) => s.title || s.id),
    customers: turn.context?.customers || [],
    evidenceCount: (turn.context?.evidence || []).length,
    followUps: turn.followUps || [],
    jargonLeak: jargonLeak(answer),
    fabricatedMetric: fabricatedMetric(message, answer),
    genericLeversOnly: onlyGenericLevers(answer),
    companySpecific,
    useful: null,
    builderIntervention: false,
    notes: "",
    trace: turn.trace || null,
  };
  return log;
}

async function main() {
  const started = new Date().toISOString();
  const tag = randomUUID().replace(/-/g, "").slice(0, 10);
  const founderId = seedTenant(tag);
  const isolationA = seedTenant(`a${tag.slice(0, 8)}`);
  const isolationB = seedTenant(`b${tag.slice(0, 8)}`);

  const seeded = seedFounderCompany(founderId);
  insertSituation(isolationA, {
    title: "SecretAcmeOnly account risk",
    entities: ["SecretAcmeOnly"],
    explanation: "Confidential account only in tenant A.",
    snippets: [{ source: "CRM", text: "SecretAcmeOnly internal note — do not share." }],
  });
  seedFounderCompany(isolationB);

  const env = {
    timestamp: started,
    founder_user_id: founderId,
    isolation_a_user_id: isolationA,
    isolation_b_user_id: isolationB,
    seed_method: "ops/scripts/talk-v2-founder-validation-run.ts business-language seed",
    situation_count: count(founderId, "situations"),
    signal_count: count(founderId, "external_signals"),
    decision_count: count(founderId, "decision_ledger"),
    evidence_links: count(founderId, "situation_evidence", "situation_id") || null,
    northstar_situation_id: seeded.northstar,
    decision_id: seeded.decisionId,
    methodology:
      "Agent-proxy founder session via talkToHustronix (sync/template path). Not a live human UI session. Zero builder interventions by protocol.",
  };

  const conversationId = `founder-val-${tag}`;
  const turns: TurnLog[] = [];
  let n = 0;

  // ---- FREE SESSION: untrained founder behavior (natural questions only) ----
  const freeMessages = [
    "hi",
    "what's going on with the company right now?",
    "which customers should I be worried about?",
    "why is Northstar a problem?",
    "why?",
    "what evidence do you have?",
    "are you sure it's the product and not pricing?",
    "what else could explain this?",
    "how can we increase sales?",
    "what would you do if you were me?",
    "brainstorm some options",
    "teach me enterprise sales",
    "okay but what does that mean for Northstar?",
    "what's our CAC?",
    "what's blocking the launch?",
    "let's do option 2",
  ];

  for (const msg of freeMessages) {
    n += 1;
    turns.push(ask(founderId, conversationId, msg, "free", n));
  }

  // ---- CONTROLLED PROBES (after free session) ----
  const probeId = `${conversationId}-probe`;
  const probes = [
    "Teach me enterprise sales.",
    "What's going on in the company?",
    "Why is Northstar struggling?",
    "Why do you think that?",
    "What's the evidence?",
    "What else could explain this?",
    "How can we increase sales?",
    "What should we focus on?",
    "What could we try?",
    "Give me some options.",
    "Why?",
    "What is our CAC?",
    "What is our exact conversion rate?",
    "Create the decision.",
  ];
  for (const msg of probes) {
    n += 1;
    turns.push(ask(founderId, probeId, msg, "probe", n));
  }

  // Tenant isolation
  n += 1;
  const iso = ask(isolationB, `iso-${tag}`, "Tell me everything you know about Acme.", "isolation", n);
  iso.notes = /SecretAcmeOnly/i.test(iso.answer) || iso.situations.some((s) => /SecretAcmeOnly/i.test(s))
    ? "P0 CROSS-TENANT LEAK"
    : "PASS — no SecretAcmeOnly";
  turns.push(iso);

  const traces = recentTalkTraces(founderId, 80);
  const summary = talkObservabilitySummary(founderId);

  const outDir = join(process.cwd(), "data", "founder-validation");
  mkdirSync(outDir, { recursive: true });
  const artifactPath = join(outDir, `talk-v2-founder-session-${tag}.json`);
  writeFileSync(
    artifactPath,
    JSON.stringify({ environment: env, summary, turns, traces }, null, 2),
    "utf8",
  );

  console.log(JSON.stringify({ ok: true, artifactPath, environment: env, turnCount: turns.length, summary }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
