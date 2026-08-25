# Talk V2 Founder Validation Report

**Date:** 2026-08-21  
**Primary gate:** Can a founder use Hustronix ~30 minutes without us explaining it?  
**Talk architecture:** FROZEN during this validation (no Talk code patched).

---

## 0. Phase 0 — Inspection (pre-change)

### What is implemented?
Talk package under `apps/api/src/intelligence/talk/`: understanding, conversation state, retrieval plan, Company Brain retrieval, reasoning, response templates, optional LLM synthesis, follow-ups, response guard, orchestrator, observability.

### What is instrumented?
`talk_turn_traces`, response `trace`, `GET /api/intelligence/talk/traces`, `GET /api/os/metrics` → `talk`.

### Conversation context
In-process `TalkContext` keyed by `userId::conversationId` (topics, entities, situations, last answer/mode).

### Company Brain retrieval
`planTalkRetrieval` → ranked situations/evidence/decisions/signals (tenant-scoped). GENERAL skips retrieval.

### GENERAL / COMPANY / HYBRID / ACTION
Heuristic understanding in `talk-understanding.ts` + conversation state; ACTION routes to situation kernel.

### Governed actions
`shouldUseKernel` → `talkSituationKernel` / mutation gateway; brainstorm does not auto-mint decisions.

### Traces
`recentTalkTraces(userId)` / HTTP traces endpoint; also persisted on each turn.

### Safest isolated tenant
`db.createUser` + `resolveTenantContext` + business-language seed (same pattern as Talk tests). No production credentials.

---

## 1. Executive Verdict

**Could a founder use Hustronix for 30 minutes without us explaining it?**

### Verdict: **PARTIAL**

Named-customer investigation, hybrid sales strategy, teaching, metric honesty (when correctly classified), brainstorm (when phrased “brainstorm…”), governance refusal, and tenant isolation **work**.

But the **first natural company questions fail**:

> “what's going on with the company right now?”  
> “which customers should I be worried about?”

→ empty-evidence answers despite a seeded Company Brain.

A real founder would likely hit that wall in the first minutes and lose trust — even though later Northstar questions work.

**Methodology caveat:** This session was an **agent-proxy** founder conversation via `talkToHustronix` (sync/template path), not a live untrained human in the Talk UI. Zero builder interventions by protocol. A live human UI session is still required to fully close the independence claim.

---

## 2. Test Environment

| Field | Value |
|-------|--------|
| Timestamp | 2026-08-21T11:09:02.427Z |
| Founder user ID | `fv_903915260c` |
| Isolation A / B | `fv_a90391526` / `fv_b90391526` |
| Seed method | `ops/scripts/talk-v2-founder-validation-run.ts` (business language) |
| Situations | 4 |
| Signals | 9 |
| Decisions | 1 |
| Customers in seed | Northstar, Atlas, Meridian (+ teams Eng/Security/Legal) |
| Metrics in Brain | None (CAC/conversion intentionally absent) |
| Artifact | `data/founder-validation/talk-v2-founder-session-903915260c.json` |

No secrets in this report.

---

## 3. Session Summary

| Metric | Value |
|--------|--------|
| Session style | Free (16) + controlled probes (14) + isolation (1) |
| Founder turns | 30 (+1 isolation) |
| Builder interventions | **0** |
| Clarification requests from founder | 0 (proxy) |
| Path | Template fallback (~93% fallback_rate in summary; no live LLM synthesis) |

---

## 4. Exact Conversation Transcript

Full exact Q/A preserved in:

`data/founder-validation/talk-v2-founder-session-903915260c.json`

### Free session (abbreviated with exact openings)

| # | User | Assistant (opening) | CM |
|---|------|---------------------|-----|
| 1 | hi | Hey. What are you thinking through? | GENERAL |
| 2 | what's going on with the company right now? | I don't have enough company evidence… | COMPANY |
| 3 | which customers should I be worried about? | I don't have enough company evidence… | COMPANY |
| 4 | why is Northstar a problem? | Northstar is getting worse. Northstar's renewal looks shaky… | COMPANY |
| 5 | why? | Because of what we just covered: … | COMPANY |
| 6 | what evidence do you have? | …Slack · Aug 21 — “CS: Northstar logged three serious complaints…” | COMPANY |
| 7 | are you sure it's the product and not pricing? | What needs attention first is Northstar renewal risk… *(did not address pricing challenge)* | COMPANY |
| 8 | what else could explain this? | *(same attention dump)* | COMPANY |
| 9 | how can we increase sales? | Yes. I'd look at this from three angles: retention, conversion, and new demand… Northstar… | HYBRID |
| 10 | what would you do if you were me? | *(attention dump again)* | COMPANY |
| 11 | brainstorm some options | Here's what the company actually shows… I see 5 possible levers… | HYBRID |
| 12 | teach me enterprise sales | Absolutely. At a basic level, sales is… *(no company dump)* | GENERAL |
| 13 | okay but what does that mean for Northstar? | Northstar is getting worse… | COMPANY |
| 14 | what's our CAC? | I don't see a clear top attention thread yet… *(wrong template)* | COMPANY |
| 15 | what's blocking the launch? | What needs attention first is Northstar… *(wrong focus)* | COMPANY |
| 16 | let's do option 2 | Okay. Option 2 is… checks… not decision-ready yet. I won't mint… | HYBRID→gov |

Probes and isolation: see artifact JSON (turns 17–31).

---

## 5. Successful Behaviors

- Casual greeting without company dump  
- Focused Northstar investigation with real Slack/CRM snippets  
- Follow-up “why?” retains Northstar context  
- Evidence listing with human-readable sources  
- Hybrid “how can we increase sales?” = general levers + company evidence  
- “teach me enterprise sales” stays GENERAL  
- Topic return to Northstar after teaching  
- Explicit “brainstorm some options” → options, not auto-decision  
- “Create the decision” / option 2 → governance refuses unready mint  
- Tenant B cannot see SecretAcmeOnly  
- No fabricated CAC dollars when metric path works  
- No `DECISION_READY` / `gateOk` / `pattern_id` leaks in founder-facing text  

---

## 6. Confusing Behaviors

- Open company questions claim “not enough evidence” while Brain has 4 live situations  
- Challenge / “what else” / “what would you do” / “give me options” collapse into the same attention brief  
- Launch-blocker question answers with Northstar (sticky contamination)  
- CAC sometimes gets attention-template instead of missing-metric honesty  
- Mild internal phrasing: “ledger”, “Company Brain”, “not decision-ready”  

---

## 7. Retrieval Failures

### F1 — Open company scan retrieves nothing (P1 RETRIEVAL)

**User:** what's going on with the company right now?  
**Trace:** `company_qa_slice`, `retrieved_context_count: 0`, situations: 0  
**Observed:** empty-evidence message  
**Root cause:** Broad COMPANY_QA with no named entity + topic/relevance filter drops all seeded situations.  
**Severity:** P1 — kills first-minute trust.

### F2 — At-risk customers not retrieved (P1 RETRIEVAL + understanding)

**User:** which customers should I be worried about?  
**Trace:** same empty retrieval (`intent: company`, not `at_risk_customers`)  
**Root cause:** phrasing “worried about” ≠ “at risk” matcher; then same empty ranking.  

### F3 — Launch block contaminated by sticky Northstar (P1 RETRIEVAL / context)

**User:** what's blocking the launch?  
**Seeded:** Engineering → Security → Legal launch block  
**Retrieved/answered:** Northstar renewal  
**Root cause:** conversation entities still biased to Northstar; dependency/org plan not engaged (`organization: false`).  

---

## 8. Reasoning Failures

### F4 — Challenge ignored (P1 REASONING)

**User:** are you sure it's the product and not pricing?  
**Expected:** competing explanations (product vs pricing), evidence for/against  
**Got:** attention brief restating Northstar risk  
**Class:** REASONING / understanding (not COUNTERFACTUAL)

### F5 — “What else could explain this?” not counterfactual (P1 REASONING)

Same attention dump; `focusEntity` even became `Product` from entity extractor noise.

### F6 — Advice / options phrasing not treated as brainstorm (P1 REASONING / UX)

“what would you do if you were me?”, “What could we try?”, “Give me some options.” → attention dump.  
Explicit “brainstorm some options” works — founders shouldn’t need the magic word.

### F7 — Metric plan vs response mismatch (P1 REASONING)

“what's our CAC?” / “exact conversion rate” sometimes plan=`metric_lookup` but answer is attention/partial-outcome template, not missing-metric honesty.

---

## 9. UX Failures

### F8 — Repeated attention brief (P1 UX)

Multiple different questions produce near-identical “What needs attention first is Northstar…” copy → feels like a dashboard, not a conversation.

Mild jargon: “ledger”, “Company Brain” (P2 UX).

---

## 10. Company Brain Gaps

### F9 — No CAC / conversion metrics (P2 COMPANY BRAIN GAP)

Honest missing-metric answer is correct when it fires. Product ceiling until metrics land.

Outcomes/learning exist but are weakly surfaced in natural language.

---

## 11. Factuality Failures

- **No fabricated numeric CAC/MRR** observed.  
- **P0 factuality: 0**  
- Soft issue: attention briefs overstate “strongest signal” while recycling the same sentence as evidence (P2 presentation, not invented customers).

---

## 12. Conversation Memory Failures

- Retention for Northstar follow-ups: **pass**  
- Contamination on launch question: **fail** (F3)  
- Topic switch teach → GENERAL clear: **pass**  
- Return to Northstar: **pass**  

---

## 13. Topic Switching Failures

Teach enterprise sales correctly cleared company dump. Re-applying to Northstar worked. No additional topic-switch failure beyond sticky-entity contamination (F3).

---

## 14. Brainstorming Results

| Prompt | Result |
|--------|--------|
| brainstorm some options | Options + company evidence; not a decision |
| Give me some options / What could we try? | Failed → attention dump |
| let's do option 2 | Entered governed checks; refused unready mint |

**Brainstorm ≠ Decision:** preserved when brainstorm mode actually engaged.

---

## 15. Governance Results

- Unready create/option path refused minting — **PASS**  
- No brainstorm auto-decision — **PASS** (when brainstorm engaged)  
- Existing operating-loop / Talk governance suites: see §18  

---

## 16. Tenant Isolation Results

Tenant B asked about Acme; **SecretAcmeOnly never appeared** in answer or situations.  
**PASS** (no P0 cross-tenant leak).

---

## 17. Metrics

| Metric | Value | Notes |
|--------|-------|-------|
| Session duration (proxy) | ~minutes wall-clock; not a human 30m UI session | Methodology limit |
| Founder turns | 30 | +1 isolation |
| Builder interventions | 0 | Protocol |
| Independence ratio | 0 / 30 = **0** | Proxy only |
| Company-specific rate (free company/hybrid turns with relevant content) | ~0.71 | Includes contaminated answers |
| Supported/selective grounding on open company Q | **0.00** for turns 2–3 | Critical |
| Factuality (no invented metrics) | **1.00** | |
| Retrieval precision (named Northstar) | **~1.00** | |
| Retrieval precision (open company scan) | **0.00** | |
| Follow-up continuity (why/evidence) | **~0.70** | Challenge fails |
| Unexplained jargon count | 2–3 mild | ledger / Company Brain |
| Generic-only strategy answers | 0 when hybrid fired | |
| Governance failures | 0 | |

---

## 18. Trace Analysis (significant failures)

| Turn | Message | Trace | Root cause | Class | Sev |
|------|---------|-------|------------|-------|-----|
| 2 | what's going on… | plan company_qa_slice, rc=0 | Broad retrieve filters all sits | RETRIEVAL | P1 |
| 3 | which customers… | rc=0, intent company | Matcher + empty retrieve | RETRIEVAL | P1 |
| 7–8 | product vs pricing / what else | COMPANY_QA attention | Not counterfactual path | REASONING | P1 |
| 10,25,26 | what would you do / options | COMPANY_QA | Needs brainstorm/strategy | REASONING/UX | P1 |
| 14,29 | CAC / conversion | metric_lookup vs wrong render | Response routing | REASONING | P1 |
| 15 | blocking the launch | sticky Northstar, org=false | Context contamination | RETRIEVAL | P1 |
| 16,30 | option 2 / create | kernel ACTION | Correct refuse | EXPECTED | — |
| 31 | Acme isolation | no SecretAcmeOnly | Isolation OK | EXPECTED | — |

---

## 19. Recommended Fixes (evidence-backed only)

**Do not redesign Talk architecture.** Targeted hardening after freeze:

1. **Open company / attention retrieval:** when no entity, still return top-N worsening situations (turns 2–3).  
2. **At-risk phrasing:** map “worried about” → at-risk customers.  
3. **Counterfactual / challenge:** route “are you sure / what else / pricing vs product” to COUNTERFACTUAL, not attention.  
4. **Brainstorm synonyms:** “options”, “what could we try”, “what would you do” → brainstorm/strategy.  
5. **Topic override for blockers:** “blocking the launch” must prefer launch/dependency threads over sticky customer focus.  
6. **Metric render:** if plan reason is `metric_lookup`, always use missing-metric honesty template.  
7. **Company Brain:** add real CAC/conversion when available (product ceiling).  

Then **re-run this founder validation** (preferably with a live human).

---

## 20. Things NOT to Change

- GENERAL teaching path (no dump)  
- Focused Northstar investigation + evidence snippets  
- Hybrid sales structure when STRATEGY fires  
- Governance refusal for unready decisions  
- Tenant isolation  
- Response guard / mutation gateway / situation-engine / READY_GATES  
- Overall Talk V2 pipeline shape  

---

## 21. Final Grade

| Dimension | Score /100 |
|-----------|------------|
| Conversational quality | 58 |
| Company grounding | 55 |
| Factuality | 92 |
| Retrieval | 48 |
| Usability (founder independence) | 45* |
| Governance | 90 |
| Founder independence (human) | null* |

\*Proxy session; live human still required.

**Overall: 58 / 100**

---

## 22. Ship Decision

### **HARDEN AND RE-TEST**

Not ready for design partners until open-company retrieval and challenge/options routing are fixed and a **live human** zero-explanation session passes.

Do not ship on automated Talk tests alone.

---

## 23. Regression (post-validation; Talk unmodified)

| Suite | Result |
|-------|--------|
| test:talk-v2 | 12/12 |
| test:talk-general | 12/12 |
| test:talk-reasoning | 11/11 |
| test:talk-company-brain | 8/8 |
| test:talk-synthesis | 5/5 |
| test:operating-loop | 6/6 |
| test:hardening | 9/9 |
| test:production-readiness | 12/12 |
| test:org-intelligence | 2/2 |
| test:os-enforcement | 8/8 |

Automated suites pass. Founder validation still **PARTIAL** — that is the primary gate.
