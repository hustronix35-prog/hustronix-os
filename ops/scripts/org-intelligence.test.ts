/**
 * Org intelligence for the Teams surface.
 * Run: npm run test:org-intelligence
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { v4 as uuidv4 } from "uuid";
import { db } from "../../apps/api/src/database.js";
import { hashPassword } from "../../apps/api/src/auth/password.js";
import {
  buildOrgIntelligence,
  createOrgDependency,
  inferTeamName,
  initialsOf,
  seedDefaultTeams,
  workloadBand,
} from "../../apps/api/src/org/intelligence.js";

function ensureTenant(seed: string): string {
  const userId = `orgi${seed}`;
  if (!db.getUser(userId)) {
    db.createUser(userId, userId, hashPassword(`test-${userId}`));
  }
  return userId;
}

describe("org intelligence helpers", () => {
  it("infers teams from role, not generic Execution", () => {
    assert.equal(inferTeamName("Execution", "Sr. Engineer", "Arjun Mehta"), "Engineering");
    assert.equal(inferTeamName("Finance", "Analyst", "Vikram"), "Finance");
    assert.equal(inferTeamName("General", "QA Lead", "Neha"), "Engineering");
    assert.equal(initialsOf("Arjun Mehta"), "AM");
    assert.equal(workloadBand(91, "Over Capacity"), "High");
    assert.equal(workloadBand(40, "Healthy"), "Optimal");
  });
});

describe("org intelligence snapshot", () => {
  it("builds the tree, flags at-risk people, and syncs ledger dependencies", () => {
    const userId = ensureTenant(uuidv4().replace(/-/g, "").slice(0, 8));
    db.insertTeamRosterMember(userId, {
      name: "Arjun Mehta",
      email: `arjun.${uuidv4().slice(0, 6)}@hustronix.test`,
      role: "Sr. Engineer",
      team: "Engineering",
      capacity: "40h / week",
    });
    db.insertTeamRosterMember(userId, {
      name: "Neha Verma",
      email: `neha.${uuidv4().slice(0, 6)}@hustronix.test`,
      role: "QA Lead",
      team: "Engineering",
      capacity: "40h / week",
    });

    const decisionId = db.saveDecisionEvent(userId, {
      vow: `Ship payment integration ${uuidv4().slice(0, 6)}`,
      expected_outcomes: [{ metric: "Launch", target: "Aug 20" }],
      tasks: [
        { owner: "Arjun Mehta", type: "ACTION", weight: 3, success_condition: "Payment Integration" },
        { owner: "Neha Verma", type: "ACTION", weight: 1, success_condition: "QA Test Plan" },
      ],
    });
    const tasks = db.rawGet(
      `SELECT task_id, owner FROM execution_ledger WHERE decision_id = ?`,
      [decisionId],
    ) as Array<{ task_id: string; owner: string }>;
    const pay = tasks.find((t) => t.owner === "Arjun Mehta")!;
    const qa = tasks.find((t) => t.owner === "Neha Verma")!;
    db.rawRun(`UPDATE execution_ledger SET dependencies = ? WHERE task_id = ?`, [
      JSON.stringify([pay.task_id]),
      qa.task_id,
    ]);
    db.transitionExecutionState(pay.task_id, "BLOCKED", "Finance API credentials", true);

    seedDefaultTeams(userId);
    const org = buildOrgIntelligence(userId);

    assert.ok(org.tree.some((n) => n.name === "Leadership"));
    assert.ok(org.teams.some((t) => t.name === "Engineering" && t.peopleCount >= 1));
    assert.ok(org.people.some((p) => p.name === "Arjun Mehta" && p.team === "Engineering"));
    assert.ok(org.peopleAtRisk.some((p) => p.name === "Arjun Mehta"));
    assert.ok(org.dependencies.some((d) => d.toTeam === "Engineering" || d.fromTeam === "Engineering"));
    assert.equal(typeof org.snapshot.healthPct, "number");
    assert.ok(org.snapshot.people >= 2);

    const dep = createOrgDependency(userId, {
      fromTeam: "Finance",
      fromWork: "API credentials",
      toTeam: "Engineering",
      toWork: "Payment Integration",
      status: "AT_RISK",
    });
    const next = buildOrgIntelligence(userId);
    assert.ok(next.dependencies.some((d) => d.id === dep.id && d.status === "AT_RISK"));
    assert.ok(next.snapshot.depsAtRisk >= 1);
  });
});
