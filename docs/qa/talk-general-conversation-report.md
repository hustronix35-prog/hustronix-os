# Talk General Conversation Report

**Date:** 2026-08-21  
**Scope:** GENERAL / COMPANY / HYBRID Talk orchestration  
**Grade:** **A−** (core contract met; LLM synthesis still optional fallback)

---

## 1. What changed

Talk no longer forces every message into a Situation dump.

- **GENERAL** questions (teach / define / “what is CAC?”) get natural answers **without** injecting company situation lists.
- **COMPANY** questions retrieve and answer from Company Brain with provenance.
- **HYBRID** questions (e.g. “how can I increase sales?”) combine general judgment + selective company context (deduped accounts, not four Northstar bullets).
- Governed execution path unchanged (`situation-chat` kernel).
- UI copy: “Ask Hustronix anything about your business…”

## 2. Files changed

| Area | Path |
|------|------|
| Understanding | `apps/api/src/intelligence/talk/talk-understanding.ts` (new) |
| Intent re-export | `apps/api/src/intelligence/talk/talk-intent.ts` |
| Conversation alias | `apps/api/src/intelligence/talk/talk-conversation.ts` (new) |
| Retrieval | `apps/api/src/intelligence/talk/talk-retrieval.ts` |
| Reasoning | `apps/api/src/intelligence/talk/talk-reasoning.ts` |
| Response | `apps/api/src/intelligence/talk/talk-response.ts` |
| Follow-ups | `apps/api/src/intelligence/talk/talk-followups.ts` |
| Orchestrator | `apps/api/src/intelligence/talk/talk-orchestrator.ts` |
| Synthesis | `apps/api/src/intelligence/talk/talk-synthesis.ts` |
| Package index | `apps/api/src/intelligence/talk/index.ts` |
| API | `apps/api/src/server.ts` (`contextMode` on `/api/intelligence/talk`) |
| UI | `apps/os-ui/src/app/chat/page.tsx`, `apps/os-ui/src/lib/mock-data.ts` |
| Tests | `ops/scripts/talk-general.test.ts` (new), updates to talk-reasoning / company-brain |
| Script | `package.json` → `test:talk-general` |

**Not touched:** `situation-engine.ts`, READY_GATES, causal validation, mutation gateway.

## 3. Architecture changes

```
message
  → classifyTalkIntent (mode + contextMode GENERAL|COMPANY|HYBRID)
  → skip Company Brain if GENERAL / CASUAL
  → retrieveTalkContext (ranked slice) if COMPANY/HYBRID
  → reasonAboutCompany (evidence vs inference vs recommendation)
  → renderTalkAnswer (natural prose; no dumps for LEARN)
  → optional LLM synthesis (HYBRID/COMPANY only; template fallback)
  → governed kernel only for explicit actions / option select
```

Internal modes include `LEARN`, `GENERAL`, existing strategy/investigation/brainstorm/etc.  
`contextMode` is returned on the Talk API; not shown as jargon in founder copy.

## 4. General question results

| Prompt | Result |
|--------|--------|
| hi | Casual greeting; 0 situations |
| What is CAC? | Definition; no Northstar dump |
| teach me basics of sales | Demand / conversion / retention teaching; offer to use company next; **no** “Mapped to your company right now” |

## 5. Company question results

| Prompt | Result |
|--------|--------|
| Why is Northstar at risk? | COMPANY mode; Northstar situation + evidence |
| What is our CAC? | COMPANY metric path; acknowledges missing metric when absent |
| Which customers are at risk? | Lists worsening customers from context |

## 6. Hybrid question results

| Prompt | Result |
|--------|--------|
| How can I increase sales? | Opens with retention/conversion/demand; then selective company sketch (deduped accounts) |
| Teach me sales using our company | Teaching + mapped examples |

## 7. Brainstorming results

Multiple numbered levers; “possibilities, not decisions”; company evidence when available; no auto decision.

## 8. Follow-up conversation results

“Why?” after sales strategy retains prior thread. Contextual follow-up chips for LEARN / STRATEGY / investigation.

## 9. Topic-switch results

Northstar/strategy thread → “Teach me enterprise sales” → LEARN GENERAL; company dump cleared.

## 10. Company factuality / provenance

Company claims still flow from retrieved situations / `EvidenceReference` / outcomes. GENERAL answers explicitly treated as operating knowledge, not ledger claims. Missing company metrics say so plainly.

## 11. Security / tenant isolation

`test:talk-general` includes cross-tenant check: Tenant B never sees Tenant A’s `SecretAcmeOnly` situation.

## 12. Governance regression

Execute without ready decision still blocked. Option select still routes to create_decision kernel. `test:operating-loop` **6/6 pass**.

## 13. Existing test results

| Suite | Result |
|-------|--------|
| `npm run test:talk-general` | **12/12 pass** |
| `npm run test:talk-reasoning` | **11/11 pass** |
| `npm run test:talk-company-brain` | **8/8 pass** |
| `npm run test:talk-synthesis` | **5/5 pass** |
| `npm run test:operating-loop` | **6/6 pass** |

Not re-run in this pass (unchanged kernel): hardening, production-readiness, wave3-learning, org-intelligence, os-enforcement, Company Reality Benchmark — recommended before release cut.

## 14. Founder test results

Automated coverage of free-form flow (hi → teach → hybrid → investigate → counterfactual → execute gate → tenant isolation). Full human zero-explanation walk still recommended on a fresh tenant with real LLM keys.

## 15. Screenshots / representative conversations

### Conversation A — hi
**User:** hi  
**Assistant:** Hey. What are you thinking through?  
*(no situations)*

### Conversation B — teach me basics of sales
**User:** teach me basics of sales  
**Assistant:** Absolutely. At a basic level, sales is… Demand / Conversion / Retention…  
If you want, I can use your actual pipeline and customers as examples next.  
*(no situation list)*

### Conversation C — increase sales → why
**User:** How can I increase sales?  
**Assistant:** Yes. I'd look at this from three angles: retention, conversion, and new demand. Looking at your company… *(selective accounts)*  
**User:** Why?  
**Assistant:** Continues from prior thread (FOLLOWUP).

### Conversation D — Northstar
**User:** Why is Northstar at risk?  
**Assistant:** Northstar-grounded investigation + evidence language.

### Conversation E — teach using company
**User:** Teach me sales using our company as an example.  
**Assistant:** Concept first, then HYBRID mapping to live threads.

### Conversation F — brainstorm → option 2
**User:** Brainstorm ways to increase sales.  
**Assistant:** Numbered levers; not decisions.  
**User:** Let's do option 2.  
**Assistant:** Enters governed decision path (existing kernel).

## 16. Failures

None in Talk suites run above.

## 17. Failure classification

N/A this run.

## 18. Before / after

| Before | After |
|--------|--------|
| “teach me basics of sales” → primer + long repetitive Northstar/Atlas/Meridian dump | Primer only + optional offer to use company |
| STRATEGY / COMPANY_QA shared one 3-point playbook | HYBRID strategy vs LEARN vs COMPANY paths diverge |
| Every sales-ish ask felt like a situation brief | ContextMode gates retrieval |

## 19. Final grade

**A−**

Strengths: GENERAL/COMPANY/HYBRID contract, no LEARN dumps, governance intact, tenant isolation test, operating-loop green.  
Gaps: full regression matrix not re-run; founder live LLM taste pass still manual; metric questions (our CAC) still thin until metrics land in Company Brain.

## 20. Remaining work

1. Run full regression list from the feature spec before ship.  
2. Optional: richer GENERAL knowledge pack (more concepts than sales/CAC/funnel).  
3. Optional: surface human provenance chips in os-ui when `contextMode === "COMPANY"|"HYBRID"`.  
4. Live founder zero-explanation session with LLM synthesis on.

---

## Product principle check

| Contract | Status |
|----------|--------|
| GENERAL → answer naturally | ✅ |
| COMPANY → Company Brain | ✅ |
| HYBRID → knowledge + Brain | ✅ |
| Brainstorm → possibilities + constraints | ✅ |
| Follow-up → conversation memory | ✅ |
| Action → existing Decision OS | ✅ |
| No forced Situation mapping | ✅ |
