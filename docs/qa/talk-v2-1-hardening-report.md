# Talk V2.1 Founder Hardening

**Date:** 2026-08-21  
**Scope:** Understanding + focus + retrieval plan + response routing only. Decision OS untouched.

## Result vs Founder Test #1

| Failure from Test #1 | After V2.1 (session `5bb8631240`) |
|---|---|
| Open company → 0 retrieval | **PASS** — overview retrieves Northstar, pipeline, Atlas, launch |
| Worry about customers | **PASS** — Northstar, Meridian, Atlas |
| Are you sure / pricing | **PASS** — COUNTERFACTUAL / challenge |
| What else could explain | **PASS** — alternative_hypotheses + Northstar focus |
| What would you do | **PASS** — STRATEGY / recommendation |
| Brainstorm synonyms | **PASS** (automated + session) |
| Launch after Northstar | **PASS** — Engineering → Security → Legal |
| CAC / conversion metric | **PASS** — honest missing-metric, no attention dump |

## Artifacts

- Routing contract: `docs/architecture/talk-routing-contract.md`
- Tests: `ops/scripts/talk-v2-1-founder-hardening.test.ts` → **10/10**
- Re-run session: `data/founder-validation/talk-v2-founder-session-5bb8631240.json`
- Scorecard: `data/talk-v2-1-scorecard.json`

## Remaining (P2 / next)

- Challenge “Evidence against” sometimes recycles a supporting snippet (reasoning polish)
- Customer-risk list can include team names from launch situations
- Live human Founder Validation #2 still required
- Company Brain metrics still thin (honest absence is correct)

## Regression

| Suite | Result |
|-------|--------|
| test:talk-v2-1 | 10/10 |
| test:talk-v2 | 12/12 |
| test:talk-general | 12/12 |
| test:talk-reasoning | 11/11 |
| test:talk-company-brain | 8/8 |

## Estimated founder score move

Agent-proxy re-run of the same problematic questions: roughly **58 → ~84** (routing fixed; depth/Brain still the ceiling).

**Ship posture:** HARDEN complete for P1 routing → **Founder Validation #2 (live human)** next. Not design-partner ship until live session.
