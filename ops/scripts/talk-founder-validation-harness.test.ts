/**
 * Founder validation harness integrity — does NOT assert Talk answer quality.
 * Run: npm run test:founder-validation-harness
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "../../apps/api/src/database.js";
import {
  createFounderValidationSession,
  loadFounderSession,
  recordFounderTurn,
  sessionPath,
} from "./talk-founder-validation.js";

describe("Founder validation harness", () => {
  it("creates isolated tenant with realistic seed counts", () => {
    const m = createFounderValidationSession({ tag: `h${Date.now().toString(36).slice(-8)}` });
    assert.match(m.session_id, /^fvs_/);
    assert.ok(existsSync(sessionPath(m.session_id)));
    assert.ok(m.seed.situations >= 5, `situations=${m.seed.situations}`);
    assert.ok(m.seed.signals >= 10, `signals=${m.seed.signals}`);
    assert.ok(m.seed.evidence >= 8, `evidence=${m.seed.evidence}`);
    assert.ok(m.seed.customers.includes("Northstar"));
    assert.ok(m.seed.customers.includes("CobaltWorks"));
    assert.equal(m.status, "ready");
    assert.ok(m.operator_password.length > 8);
    assert.ok(!m.operator_password.includes(" "));
  });

  it("seed uses business language without HSOG jargon in signals", () => {
    const m = createFounderValidationSession({ tag: `j${Date.now().toString(36).slice(-8)}` });
    const rows = db.rawGet(
      `SELECT content FROM external_signals WHERE user_id = ? LIMIT 40`,
      [m.founder_user_id],
    ) as { content: string }[];
    const blob = rows.map((r) => r.content).join("\n");
    assert.doesNotMatch(blob, /\bDECISION_READY\b/);
    assert.doesNotMatch(blob, /\bgateOk\b/);
    assert.doesNotMatch(blob, /\bpattern_id\b/);
    assert.doesNotMatch(blob, /\bHSOG\b/);
  });

  it("tenant isolation: founder cannot see SecretAcmeOnly situation titles", () => {
    const m = createFounderValidationSession({ tag: `i${Date.now().toString(36).slice(-8)}` });
    const founderSits = db.rawGet(`SELECT title FROM situations WHERE user_id = ?`, [m.founder_user_id]) as {
      title: string;
    }[];
    assert.ok(!founderSits.some((s) => /SecretAcmeOnly/i.test(s.title)));
    const isoSits = db.rawGet(`SELECT title FROM situations WHERE user_id = ?`, [m.isolation_probe_user_id]) as {
      title: string;
    }[];
    assert.ok(isoSits.some((s) => /SecretAcmeOnly/i.test(s.title)));
  });

  it("session recording appends turns with traces (smoke path)", () => {
    const m = createFounderValidationSession({ tag: `s${Date.now().toString(36).slice(-8)}` });
    recordFounderTurn(m.session_id, "hi");
    const turn = recordFounderTurn(m.session_id, "what's going on with the company?");
    const loaded = loadFounderSession(m.session_id);
    assert.equal(loaded.turns.length, 2);
    assert.equal(loaded.turns[0].user_message, "hi");
    assert.ok(loaded.turns[1].assistant_response.length > 10);
    assert.ok(turn.context_mode || turn.mode);
    // Harness integrity: overview should retrieve something for seeded brain
    assert.ok(
      (turn.retrieved_situations?.length || 0) > 0 || (turn.retrieved_evidence || 0) > 0 || turn.grounded === true,
      "seeded brain should be visible to Talk without harness patching Talk",
    );
  });

  it("manifest never writes secrets into docs path by create alone", () => {
    const m = createFounderValidationSession({ tag: `d${Date.now().toString(36).slice(-8)}` });
    const raw = readFileSync(sessionPath(m.session_id), "utf8");
    assert.match(raw, /operator_password/);
    const docsProbe = join(process.cwd(), "docs", "qa", "founder-validation", `${m.session_id}.json`);
    assert.equal(existsSync(docsProbe), false);
  });
});
