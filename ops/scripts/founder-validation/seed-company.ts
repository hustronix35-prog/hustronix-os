/**
 * Founder validation Company Brain seed — business language only.
 * Does NOT modify Talk / Decision OS. Used only by validation harness.
 */
import { randomUUID } from "node:crypto";
import { db } from "../../../apps/api/src/database.js";

export type SeedCounts = {
  situations: number;
  signals: number;
  evidence: number;
  decisions: number;
  outcomes: number;
  teams: number;
  dependencies: number;
  customers: string[];
};

function daysAgo(n: number): string {
  const d = new Date(Date.now() - n * 24 * 60 * 60 * 1000);
  return d.toISOString().replace("T", " ").slice(0, 19);
}

function insertSignal(
  userId: string,
  opts: { source: string; content: string; detectedAt: string },
): string {
  const id = randomUUID();
  db.rawRun(
    `INSERT INTO external_signals (id, user_id, source, content, detected_at, received_at, state)
     VALUES (?, ?, ?, ?, ?, ?, 'UNVERIFIED')`,
    [id, userId, opts.source, opts.content, opts.detectedAt, opts.detectedAt],
  );
  return id;
}

function insertSituation(
  userId: string,
  opts: {
    title: string;
    entities: string[];
    explanation: string;
    trajectory?: string;
    stage?: string;
    updatedAt: string;
    evidence: Array<{ source: string; text: string; detectedAt: string }>;
  },
): string {
  const id = randomUUID();
  db.rawRun(
    `INSERT INTO situations (id, user_id, pattern_id, title, stage, confidence, trajectory, first_observed_day,
       explanation, entities_json, facets_json, recommended_actions_json, evidence_count, updated_at)
     VALUES (?, ?, ?, ?, ?, 0.82, ?, NULL, ?, ?, ?, ?, ?, ?)`,
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
      JSON.stringify(["Review account health", "Confirm owners"]),
      opts.evidence.length,
      opts.updatedAt,
    ],
  );
  for (const ev of opts.evidence) {
    const sig = insertSignal(userId, {
      source: ev.source,
      content: ev.text,
      detectedAt: ev.detectedAt,
    });
    db.rawRun(
      `INSERT INTO situation_evidence (id, situation_id, signal_id, facet, sim_day, snippet)
       VALUES (?, ?, ?, 'ops', NULL, ?)`,
      [randomUUID(), id, sig, ev.text],
    );
  }
  return id;
}

function ensureTeam(userId: string, name: string, sortOrder: number) {
  try {
    db.rawRun(
      `INSERT OR IGNORE INTO org_teams (id, user_id, name, parent_id, sort_order)
       VALUES (?, ?, ?, NULL, ?)`,
      [randomUUID(), userId, name, sortOrder],
    );
  } catch {
    /* schema may vary */
  }
}

function ensureDependency(userId: string, fromTeam: string, toTeam: string, fromWork: string, toWork: string) {
  try {
    db.rawRun(
      `INSERT INTO org_dependencies (id, user_id, from_team, from_work, to_team, to_work, status, source)
       VALUES (?, ?, ?, ?, ?, ?, 'DELAYED', 'manual')`,
      [randomUUID(), userId, fromTeam, fromWork, toTeam, toWork],
    );
  } catch {
    /* optional */
  }
}

/**
 * Seed a small B2B SaaS company brain for founder validation.
 * Timeline spans ~18 days with real detected_at stamps.
 */
export function seedFounderCompanyBrain(userId: string): SeedCounts {
  const customers = ["Northstar", "Atlas", "Meridian", "CobaltWorks"];
  const teams = ["Engineering", "Sales", "Customer Success", "Security", "Legal", "Finance"];
  teams.forEach((t, i) => ensureTeam(userId, t, i));

  ensureDependency(
    userId,
    "Engineering",
    "Security",
    "Customer launch credentials",
    "Credential review",
  );
  ensureDependency(userId, "Security", "Legal", "Credential review", "Legal approval for access policy");

  // Noise / routine (unlinked or light)
  insertSignal(userId, {
    source: "SLACK",
    content: "Standup: sprint board looks healthy; two tickets closed yesterday.",
    detectedAt: daysAgo(17),
  });
  insertSignal(userId, {
    source: "SLACK",
    content: "CS: CobaltWorks onboarding call went well — they liked the new dashboard.",
    detectedAt: daysAgo(15),
  });
  insertSignal(userId, {
    source: "CRM",
    content: "Finance closed month-end books without issues.",
    detectedAt: daysAgo(10),
  });
  insertSignal(userId, {
    source: "SLACK",
    content: "Sales: Meridian expansion deck draft shared for review (no urgency).",
    detectedAt: daysAgo(8),
  });

  insertSituation(userId, {
    title: "Northstar renewal risk",
    entities: ["Northstar"],
    explanation:
      "Northstar's renewal looks shaky after repeated reliability complaints during onboarding and a delayed implementation milestone.",
    updatedAt: daysAgo(2),
    evidence: [
      {
        source: "SLACK",
        text: "CS: Northstar logged a serious reliability complaint during onboarding.",
        detectedAt: daysAgo(18),
      },
      {
        source: "SLACK",
        text: "Eng: Northstar implementation milestone slipped a week because of connector timeouts.",
        detectedAt: daysAgo(14),
      },
      {
        source: "SLACK",
        text: "CS: Northstar escalated again — three serious complaints this month about reliability.",
        detectedAt: daysAgo(11),
      },
      {
        source: "CRM",
        text: "Northstar health score moved from green to yellow after the implementation delay.",
        detectedAt: daysAgo(7),
      },
      {
        source: "SLACK",
        text: "Northstar VP asked whether we can guarantee uptime before they renew next quarter.",
        detectedAt: daysAgo(4),
      },
      {
        source: "CRM",
        text: "Northstar mentioned they are also evaluating another vendor for the same workflow.",
        detectedAt: daysAgo(2),
      },
    ],
  });

  insertSituation(userId, {
    title: "Atlas expansion stalled",
    entities: ["Atlas"],
    explanation: "Atlas expansion stalled after the pricing discussion; the champion went quiet.",
    trajectory: "WORSENING",
    updatedAt: daysAgo(3),
    evidence: [
      {
        source: "SLACK",
        text: "Sales: Atlas champion stopped responding after we floated the expansion quote.",
        detectedAt: daysAgo(9),
      },
      {
        source: "CRM",
        text: "Atlas expansion opportunity moved to stalled; next step unclear.",
        detectedAt: daysAgo(3),
      },
    ],
  });

  insertSituation(userId, {
    title: "Meridian account health slipping",
    entities: ["Meridian"],
    explanation: "Meridian usage and CS health markers have been drifting down over the last two weeks.",
    updatedAt: daysAgo(1),
    evidence: [
      {
        source: "CRM",
        text: "Meridian weekly active seats down vs prior month.",
        detectedAt: daysAgo(12),
      },
      {
        source: "SLACK",
        text: "CS: Meridian success check-in flagged declining adoption in two teams.",
        detectedAt: daysAgo(5),
      },
      {
        source: "CRM",
        text: "Meridian health marker now yellow; renewal still months out but trend is down.",
        detectedAt: daysAgo(1),
      },
    ],
  });

  insertSituation(userId, {
    title: "Pipeline coverage below plan",
    entities: ["Sales", "Meridian"],
    explanation: "Late-stage pipeline coverage is below the quarterly plan; forecast confidence is down.",
    updatedAt: daysAgo(2),
    evidence: [
      {
        source: "CRM",
        text: "Pipeline coverage for this quarter is at 0.7x versus a 1.2x target.",
        detectedAt: daysAgo(6),
      },
      {
        source: "SLACK",
        text: "RevOps: Meridian deal slipped two weeks; forecast confidence is down.",
        detectedAt: daysAgo(2),
      },
    ],
  });

  insertSituation(userId, {
    title: "Launch blocked on security review",
    entities: ["Engineering", "Security", "Legal"],
    explanation:
      "Engineering is waiting on Security's credential review for the customer launch; Security is waiting on Legal approval.",
    trajectory: "STABLE",
    stage: "FORMING",
    updatedAt: daysAgo(1),
    evidence: [
      {
        source: "SLACK",
        text: "Eng: blocked on Security credential review for the customer launch.",
        detectedAt: daysAgo(5),
      },
      {
        source: "SLACK",
        text: "Security: waiting on Legal approval before we can clear credentials.",
        detectedAt: daysAgo(3),
      },
      {
        source: "SLACK",
        text: "Legal: access policy review still in queue for the launch credentials request.",
        detectedAt: daysAgo(1),
      },
    ],
  });

  // Positive / completed thread (noise + balance)
  insertSituation(userId, {
    title: "CobaltWorks onboarding progressing",
    entities: ["CobaltWorks"],
    explanation: "CobaltWorks onboarding is on track after a strong kickoff.",
    trajectory: "IMPROVING",
    stage: "FORMING",
    updatedAt: daysAgo(4),
    evidence: [
      {
        source: "SLACK",
        text: "CS: CobaltWorks kickoff completed; next training session scheduled.",
        detectedAt: daysAgo(13),
      },
      {
        source: "CRM",
        text: "CobaltWorks onboarding checklist 70% complete.",
        detectedAt: daysAgo(4),
      },
    ],
  });

  const decisionId = randomUUID();
  try {
    db.rawRun(
      `INSERT INTO decision_ledger (id, user_id, vow, status, created_at)
       VALUES (?, ?, ?, 'COMPLETED', ?)`,
      [
        decisionId,
        userId,
        "Stabilize Northstar onboarding reliability before pushing expansion pricing",
        daysAgo(20),
      ],
    );
  } catch {
    try {
      db.rawRun(`INSERT INTO decision_ledger (id, user_id, vow, status) VALUES (?, ?, ?, 'COMPLETED')`, [
        decisionId,
        userId,
        "Stabilize Northstar onboarding reliability before pushing expansion pricing",
      ]);
    } catch {
      /* optional */
    }
  }
  try {
    db.rawRun(
      `INSERT INTO decision_outcomes (decision_id, tenant_id, result, pattern_id, learning_notes, evaluated_at)
       VALUES (?, ?, 'partial', ?, ?, ?)`,
      [
        decisionId,
        userId,
        "renewal_stability",
        "Complaints slowed briefly but renewal confidence remains weak; reliability work helped without fully restoring trust.",
        daysAgo(5),
      ],
    );
  } catch {
    /* optional */
  }

  // Intentionally NO CAC / conversion metrics seeded — honest missing-data path.

  return countSeed(userId, customers);
}

export function countSeed(userId: string, customers: string[]): SeedCounts {
  const n = (sql: string, params: unknown[] = []) => {
    try {
      const rows = db.rawGet(sql, params) as { n: number }[];
      return Number(rows[0]?.n || 0);
    } catch {
      return 0;
    }
  };
  return {
    situations: n(`SELECT COUNT(1) AS n FROM situations WHERE user_id = ?`, [userId]),
    signals: n(`SELECT COUNT(1) AS n FROM external_signals WHERE user_id = ?`, [userId]),
    evidence: n(
      `SELECT COUNT(1) AS n FROM situation_evidence se
        INNER JOIN situations s ON s.id = se.situation_id WHERE s.user_id = ?`,
      [userId],
    ),
    decisions: n(`SELECT COUNT(1) AS n FROM decision_ledger WHERE user_id = ?`, [userId]),
    outcomes: n(`SELECT COUNT(1) AS n FROM decision_outcomes WHERE tenant_id = ?`, [userId]),
    teams: n(`SELECT COUNT(1) AS n FROM org_teams WHERE user_id = ?`, [userId]),
    dependencies: n(`SELECT COUNT(1) AS n FROM org_dependencies WHERE user_id = ?`, [userId]),
    customers,
  };
}
