# Hustronix Intelligence v1 — complete report

**Date:** 15 August 2026  
**Milestone:** **Hustronix Intelligence v1** — a credible early Decision Intelligence & Execution System  
**v2 target:** Open-world organizational intelligence, including outcome → evaluation → learning  
**Primary corpus:** HSOG enterprise fixtures (`os_ingest.json`, 118 artifacts, 8 scenarios, days 18–132)  
**Honest test path:** blind customer ingest (`ingestExternal`) with ground truth **never** written into the OS

Do **not** headline the ~95 day-taste score. That is triggered Decision OS absorption.

---

## 1. Verdict

Hustronix has crossed the threshold from **triggered Decision OS** to a **credible early Decision Intelligence & Execution System**.

Ingestion, ledger, execution, tenant isolation, and governance are strong. The Situation engine notices, accumulates, and becomes decision-ready on all eight HSOG stories without playbooks. It also discovers stories it was never taught as HSOG scenarios — first with a generic theme lexicon (4/4), then **without that lexicon** (open-world 7/7). It is **not** fully autonomous company intelligence: elevated is still skipped, Teams/deps/capacity remain shallow, Chat is grounded but not yet the product loop, and outcome learning does not retune gates.

> **The architecture is now basically the right one. Do not rebuild it. The remaining work is product quality and generalization, not a new brain.**

```text
Signals → Entities / Graph → Candidate hypotheses → Evidence clusters
       → Temporal progression → Trajectory + confidence → Decision readiness
       → Decision → Execution → Outcome   ← still scaffolded
```

---

## 2. Current state

| Area | Status | Read |
|---|---|---|
| Ingestion | 🟢 | Strong — 118/118 blind insert |
| Signals / ledger | 🟢 | Strong |
| Governance | 🟢 | **Very strong — 53/53** |
| Situation awareness | 🟢 | 8/8 HSOG + 4/4 lexicon-unseen + **7/7 open-world** |
| Evidence synthesis | 🟢 | **0.87** after honest attach (was 0.82). Remaining misses are off-facet — **not forced** |
| Temporal reasoning | 🟢 | **1.00** — forming/elevated recorded even on same-cycle ready |
| Generalization (theme lexicon) | 🟢 | **4/4 unseen** (HelixBio / PayOrbit / Northwind / LatticeOps) |
| Open-world (no theme lexicon) | 🟢 | **7/7 discover, 4/4 ready, 2/2 resolve, 0 false-ready, 5/5 chat** |
| De-escalation | 🟢 | HSOG unseen 2/2 + open-world 2/2 |
| Action quality | 🟢 | **8/8** HSOG; **4/4** open-world DRAFTs |
| Chat grounding | 🟢 | Talk to Hustronix wired; 5/5 + 5/5 grounding suites |
| Teams intelligence | 🟡 | Exists; UI/depth remain |
| Dependencies | 🟡 | Improving, still heuristic |
| Capacity | 🟡 | Abstract |
| Outcome learning | 🔴/🟡 | Scaffolded — **the remaining architectural frontier** |

---

## 3. What an evaluator should see

Not dashboards. Not day-taste 95. This sequence:

1. **Blind HSOG** — 8/8 situations discovered and decision-ready  
2. **Progressive intelligence** — evidence **0.87**, avg lead **+11.4d** (SignalGrid still dominates; Acme **0d**)  
3. **Unseen (theme lexicon)** — 4/4 without HSOG scenario IDs  
4. **Open-world (no theme lexicon)** — 7/7 including conflict held at ELEVATED and two stories that resolve without a decision  
5. **De-escalation** — 2/2 + 2/2  
6. **Governance** — 53/53 adversarial probes  
7. **Talk to Hustronix** — “What is happening with Acme, why, who is affected, and what should I do?” then Situation → Evidence → Teams → Decision → Execution  

That last step is the product. Do not make it look like Slack.

---

## 4. Architecture (do not rewrite)

```text
RAW ARTIFACTS (Slack / Jira / Gmail / CRM / GitHub / …)
        ↓
INGEST  ingestExternal() → external_signals          🟢 Strong
        ↓
ENTITY / EVENT GRAPH  signal_entities, co-occurrence  🟡 Promising
        ↓
CANDIDATES  keywords propose (do not decide)          🟡 Still material on HSOG
        ↓
ATTACH  same customer/product + graph + facet bridge  🟢 Tightened; leftover GT gaps are off-facet
        ↓
EMERGENT CLUSTERS  generic theme lexicon              🟢 4/4 (keep as regression)
        ↓
OPEN-WORLD  entity + polarity only                    🟢 7/7 (no theme catalog)
        ↓
EVIDENCE CLUSTER  facets, sources, timeline           🟢 0.87
        ↓
READINESS  multi-factor; IMPROVING de-escalates       🟡 Calibrated
        ↓
SITUATION OBJECT → DRAFT Decision (only at ready)     🟢 Strong
        ↓
EXECUTION + GOVERNANCE                                🟢 Very strong
        ↓
OUTCOME / learning_log                                🟡 Scaffolded — does not retune gates
```

**API:** `GET /api/intelligence/situations`, `GET /api/intelligence/situations/:id`, `POST /api/intelligence/situations/ask`, `GET /api/org/teams/intelligence`

---

## 5. Progressive intelligence (blind HSOG)

**Generated:** 2026-08-15 (after missing-evidence investigation)  
**Command:** `npm run hsog:customer-path:intelligence`

| Metric | Score | Notes |
|---|---:|---|
| Detection (awareness) | 1.00 | 8/8 |
| Evidence synthesis | **0.87** | Was 0.82. Stretch 0.85 met **without** forcing off-facet artifacts |
| Temporal (forming or elevated) | **1.00** | Path recorded even when ready lands in the same cycle |
| Action quality | 1.00 | 8/8 |
| Avg lead (ready vs declaration) | **+11.4d** | Unchanged — we did not slow readiness |

| Scenario | Aware | Forming | Elevated | Ready | Decl | Lead | Hit |
|---|---:|---:|---:|---:|---:|---:|---:|
| SignalGrid | 18 | 30 | 30 | 30 | 83 | +53d | **86%** |
| NexusAI | 20 | 20 | 38 | 84 | 84 | 0d | 90% |
| Acme | 30 | 35 | 46 | 46 | 46 | 0d | 88% |
| Forecast | 35 | 35 | 46 | 46 | 58 | +12d | 82% |
| SentryLine | 40 | 40 | 62 | 62 | 73 | +11d | 82% |
| SEV1 | 44 | 44 | 51 | 51 | 51 | 0d | **88%** |
| FlowOps | 60 | 71 | 71 | 71 | 86 | +15d | **86%** |
| Hiring | 100 | 108 | 108 | 108 | 108 | 0d | 93% |

Acme **0d** = ready on the health-drop declaration, not “churn on day 30.”

---

## 6. Missing evidence — investigated, not chased

Question for each miss: **why wasn’t this attached?** If architectural, fix. If irrelevant, leave it.

| Scenario | Before | After | What we attached | What we refused |
|---|---:|---:|---|---|
| SignalGrid | 71% | 86% | Kafka lag auto-muted (on-theme; phrase `kafka lag`) | d82 Acme “larger telemetry dataset” — Acme-centric, no infra language. Forcing it would bleed Acme ↔ SignalGrid |
| SEV1 | 77% | 88% | “access evidence incomplete” / inverted `evidence incomplete` | d66 “exception needed for Acme debugging” — no access/audit/SIEM language |
| FlowOps | 71% | 86% | “nested approval” (corpus uses a space; catalog had `nested-approval`) | d77 “limited rollout to beta customers” — product-scope chatter, not regression evidence |

A looser “any facet on an open situation” bridge was tried and **reverted**: it more than doubled SentryLine evidence by pulling Acme CRM `deal.propertyChange` and NexusAI “audit-complete” notes. That is score-chasing. The remaining 0.13 is mostly **correct non-attachment**.

Reproduce investigation (uses last `hsog_cust_intel` tenant):

```powershell
npm run hsog:missing-evidence
```

---

## 7. Generalization with theme lexicon (keep as regression)

**Command:** `npm run hsog:generalization`

HelixBio DSAR, PayOrbit vendor, Northwind budget, LatticeOps delivery — **no HSOG scenario IDs**.

- Discovery **4/4**
- De-escalation **2/2**
- Chat **5/5**

**Caveat (still true):** `EMERGENT_THEMES` assists. This suite is no longer the hardest bar.

---

## 8. Open-world (the new hardest bar)

**Command:** `npm run hsog:open-world`  
**Engine:** entity + polarity only. No scenario ID, theme label, theme lexicon, predefined pattern, or playbook. Different terminology from HSOG. Mixed sources, ambient noise, conflicting evidence, stories that resolve without a decision.

| Story | Discover | Ready | Resolve | Notes |
|---|:---:|:---:|:---:|---|
| MeridianRail overtime | ✓ | ✓ | — | Labor pressure, not hiring-freeze language |
| VoltHarbor pack-line hold | ✓ | ✓ | — | Stop-ship / cell swelling |
| CedarPath smoke closure | ✓ | — | ✓ | Reopened; **no unnecessary decision** |
| Quinlan Labs stipend duplicates | ✓ | ✓ | — | Finance anomaly, not AP/vendor invoice |
| BrambleNet peering congestion | ✓ | ✓ | — | Not Kafka/SignalGrid |
| Kestrel Fund observer | ✓ | — | — | Rumour vs denial → **ELEVATED**, not ready |
| Amberly Studio intern reversal | ✓ | — | ✓ | Pulled then reinstated |
| Ambient noise (cafeteria / parking) | — | — | — | **No situation** |

- Discovery **7/7**
- Decision readiness **4/4** (only stories that should ready)
- De-escalation **2/2**
- False positives **0**
- Action usefulness **4/4**
- Chat **5/5** (MeridianRail / VoltHarbor / Quinlan / BrambleNet / CedarPath)

Evidence **1.00** on this corpus is expected: every story artifact names the entity. It is **not** comparable to HSOG 0.87. What matters is: no theme catalog, conflict held, noise ignored, resolve without DRAFT.

---

## 9. Talk to Hustronix (P0 product — wired)

The interface is not Slack-with-AI. `/chat` is the front door:

> Talk to Hustronix about what’s happening in the company.

**User:** What’s going wrong in the company?  
**Hustronix:** ranked live situations (stage, trajectory, confidence)

Then chips:

- What evidence supports that? → timeline  
- Who is affected? → teams / people  
- What should we do? → recommended action  
- Create the decision → DRAFT on the ledger  
- Execute it → commit + governed tasks  

API: `POST /api/intelligence/situations/ask` with optional `focus_id` and `action: create_decision | execute`.

---

## 10. v2 — Open-world organizational intelligence

v2 should encounter something never seen and construct:

```text
What is happening?
        ↓ Who/what is involved?
        ↓ What evidence supports it?
        ↓ How is it changing?
        ↓ How serious is it?
        ↓ Does this require a decision?
        ↓ What should we do?
        ↓ Did it work?          ← remaining architectural frontier
```

The missing loop:

```text
Signal → Situation → Decision → Execution → Outcome → Evaluation → Learning
                                                         └─ retunes Situation / Readiness
```

Today: `learning_log` on decide/resolve exists and **does not** change thresholds.

---

## 11. Remaining work

Priority is **productization first**, then intelligence polish, then v2. Do not treat these as equal.

**Plan to close the five remaining gaps:** [`operating-loop-plan.md`](./operating-loop-plan.md) — Talk as OS → Teams graph → real capacity → outcome learning → honest evidence. Do not rebuild the engine.

### P0 — Evaluator-ready product

**Talk to Hustronix** is the front door.

```text
ASK → UNDERSTAND → EVIDENCE → IMPACT → RECOMMEND → CREATE DECISION → EXECUTE
```

Live path: `/chat` calls `POST /api/intelligence/situations/ask` (Situation objects), not a Slack-like agent window. Follow-up chips: evidence, who is affected, what should we do, create the decision, execute it.

### P0 — Intelligence polish

**Situation progression recording** — forming → elevated → ready are stamped even when they happen in the same cycle. Do not artificially delay readiness.

### P1

1. Teams intelligence in the Teams tab (bottleneck + owners, not a roster)  
2. Workflow dependency graph with evidence on every edge  
3. Harder open-world: renamed entities, “the account”, incomplete names  

### P2 — v2 frontier

4. Company Reality Benchmark (500–2,000 artifacts, no scenario labels)  
5. Outcome → evaluation → learning that retunes readiness  
6. Real capacity  

### Do not spend cycles on

Rebuilding the ledger, redesigning governance, more playbooks, day-taste 95, extra dashboards, forcing unrelated evidence, situation-specific rules.

---

## 12. Safe vs not safe to claim

**Safe**

- Decision OS with governance, tenant isolation, and execution enforcement.  
- Blind ingest into Situation objects; DRAFT only at decision-ready.  
- 8/8 HSOG progressive ready; useful actions 8/8.  
- Unseen discovery with and **without** a theme lexicon.  
- Correct de-escalation when the story improves.  
- Chat grounded on Situation objects.

**Not safe**

- Fully autonomous multi-hop organizational AGI.  
- That day-taste ~95 measures intelligence.  
- That +11.4d average lead is the product KPI (SignalGrid dominates; Acme 0d is the honest customer-risk story).  
- That open-world evidence 1.00 generalizes to messy 100+ artifact corpora.  
- Outcome learning that improves next week’s decisions.

---

## 13. Reproduce

```powershell
npm run hsog:export-blind
npm run hsog:customer-path:intelligence
npm run hsog:missing-evidence
npm run hsog:generalization
npm run hsog:open-world
# OS/governance only when changing ledger/auth:
npm run hsog:full-system
```

| Area | Path |
|---|---|
| Progressive engine | `apps/api/src/intelligence/situation-engine.ts` |
| Open-world engine | `apps/api/src/intelligence/open-world-engine.ts` |
| Theme-lexicon emergent | `apps/api/src/intelligence/emergent-situations.ts` |
| Entity resolver | `apps/api/src/intelligence/entity-resolver.ts` |
| Chat | `apps/api/src/intelligence/situation-chat.ts` |
| Open-world corpus/eval | `apps/api/src/integrations/hsog/openWorldCorpus.ts`, `openWorldEval.ts` |
| Missing evidence | `apps/api/src/integrations/hsog/evidenceMiss.ts` |
| Latest numbers | [`hsog-intelligence-lead-report.md`](./hsog-intelligence-lead-report.md), [`hsog-open-world-report.md`](./hsog-open-world-report.md), [`hsog-missing-evidence.md`](./hsog-missing-evidence.md) |

---

## 14. Bottom line

You are no longer primarily fighting an architecture problem.

**Hustronix Intelligence v1** can ingest, govern, detect, become ready, act, and generalize — including to names and problems it was never taught, without a theme catalog.

The product front door is **Talk to Hustronix**. The next architectural milestone is Outcome → Evaluation → Learning. The next scientific milestone is a messier Company Reality Benchmark — not another HSOG score squeeze.
