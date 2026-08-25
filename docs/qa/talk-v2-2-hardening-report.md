# Talk V2.2 Conversational Hardening Report

**Date:** 2026-08-21  
**Prior score:** 78/100 agent-proxy (`fvs_4bbd4134d3`)  
**Re-validation session:** `fvs_41d231cd25` (agent-proxy, post-hardening)  
**Scope:** Targeted Talk conversation / retrieval / response fixes only. Architecture frozen.

## 1. Files changed

| File | Change |
|---|---|
| `apps/api/src/intelligence/talk/talk-understanding.ts` | Orientation, evidence ask, temporal, decision-outcome, apply-to-company, challenge phrasing |
| `apps/api/src/intelligence/talk/talk-retrieval-plan.ts` | Plans for `temporal_delta`, `decision_outcome`, `focused_evidence`, `learn_with_company` |
| `apps/api/src/intelligence/talk/talk-retrieval.ts` | Temporal prefer-worsening retrieval hint |
| `apps/api/src/intelligence/talk/talk-response.ts` | Orientation, focused evidence, polarity-safe challenge, temporal, outcome, metric usefulness, template variety |
| `apps/api/src/intelligence/talk/talk-evidence.ts` | `provenanceLines`, founder-facing `stripJargon` |
| `apps/api/src/intelligence/talk/talk-orchestrator.ts` | Stop routing conversational evidence follow-ups through situation kernel |
| `apps/api/src/intelligence/talk/talk-reasoning.ts` | Softer uncertainty copy (no “signal”) |
| `docs/architecture/talk-routing-contract.md` | V2.2 precedence + matrix |
| `ops/scripts/talk-v2-2-hardening.test.ts` | New failure matrix (20 tests) |
| `ops/scripts/talk-v2-1-founder-hardening.test.ts` | Metric assertion updated for new honest copy |
| `package.json` | `test:talk-v2-2` |

**Not touched:** `situation-engine.ts`, READY_GATES, governance / mutation gateway, Decision OS kernel rules.

## 2. Failure → fix mapping

| # | Founder failure | Pipeline locus | Fix |
|---|---|---|---|
| P1.1 | “what is this for?” → company overview | Understanding defaulted to `company_overview` | `product_orientation` → GENERAL, no retrieval, short product answer |
| P1.2 | “what evidence?” after Northstar → overview / kernel trail | Anaphora miss + kernel evidence path on sticky situation | `focused_evidence` FOLLOWUP; preserve `focusEntity`; brain path only; provenance bullets |
| P1.3 | Fake evidence-against (supporting Slack as against) | Response used `evidence[1]` as against | Explicit polarity; honest “no strong evidence against” + distinguishers |
| P1.4 | LEARN → “apply that” → overview | Apply regex incomplete / late | Early `learn_with_company` HYBRID; preserve topic; selective company sketch |
| P1.5 | “what changed recently?” → overview | No temporal objective | `temporal_delta` plan + chronological summary |
| P1.6 | “did last decision help?” → investigation / ACTION | Broad OUTCOME ACTION regex | Conversational `decision_outcome` (not mutation); decision + outcome + trajectory; status ≠ failure proof |
| P2.7 | CAC useful honesty | Metric copy thin / jargon | “I don’t have a reliable CAC… To calculate it I need…” |
| P2.8 | Founder jargon | Templates + stripJargon | Replace Company Brain / decision-ready / ledger in answers |
| P2.9 | Template repetition | Same openers | Intent-specific openings (orientation / evidence / temporal / outcome / overview) |

## 3. Tests added

`npm run test:talk-v2-2` — **20/20 pass**

Covers: orientation ×5, focused evidence, counterfactual polarity, learn→apply, temporal ×3, outcome ×4, metric ×2, conversation switching, governance unchanged.

## 4. Regression results

| Suite | Result |
|---|---|
| `test:talk-v2` | 12/12 |
| `test:talk-general` | 12/12 |
| `test:talk-reasoning` | 11/11 |
| `test:talk-company-brain` | 8/8 |
| `test:talk-synthesis` | 5/5 |
| `test:talk-v2-1` | 10/10 |
| `test:talk-v2-2` | 20/20 |
| `test:operating-loop` | 6/6 |
| `test:hardening` | 9/9 |
| `test:production-readiness` | 12/12 |
| `test:org-intelligence` | 2/2 |
| `test:wave3-learning` | 10/10 |

## 5. Before / after (agent-proxy)

| Question | Before (78 session) | After (`fvs_41d231cd25`) |
|---|---|---|
| what is this for? | Company overview dump | Product orientation, no Northstar/Atlas |
| what evidence? (after Northstar) | Company-wide overview | Northstar Slack/CRM provenance list |
| are you sure it's pricing? | Supporting complaint as “against” | Honest: no strong against + distinguishers |
| apply that to our situation | Overview | HYBRID apply of sales layers + company threads |
| what changed recently? | Overview | “Three things changed recently…” |
| did last decision help? | Situation investigation | Decision + measured partial + caution on status≠failure |
| what's our CAC? | Honest missing (jargon) | Honest missing + what is needed to calculate |

## 6. Remaining limitations

- Temporal answers still rank live worsening threads; true timestamp deltas are only as good as seed/signal timestamps.
- Outcome quality depends on seeded decision/outcome rows; many tenants will still get “not enough evidence yet.”
- Polarity classification is conservative heuristic (does not invent against); will not auto-label subtle contradictions.
- Some follow-up lines can still feel template-adjacent (`nextThought` / uncertainties).
- Agent-proxy is not a live untrained founder UI session.
- LEARN apply can still pull sticky customer entities from prior turns (by design for continuity); team-label sticky focus is suppressed.

## 7. Recommendation

**Yes — run live Founder Validation #2** with an untrained founder and the instruction-only protocol (`docs/qa/talk-v2-2-founder-validation.md`).

Do **not** coach. Critical natural probes should include orientation, focused evidence, pricing challenge, temporal, learn→apply, decision outcome, and CAC.

Ship gate: HARDEN AND RE-TEST is satisfied for agent-proxy; **live human** remains the bar before calling the conversational layer “founder-ready.”
