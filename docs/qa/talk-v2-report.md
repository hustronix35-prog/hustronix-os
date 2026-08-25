# Talk V2 — Company-Aware Conversational Intelligence

**Date:** 2026-08-21  
**Scope:** Main Hustronix OS Talk surface (`apps/api/src/intelligence/talk/`) + os-ui Talk placeholder  
**Not in scope:** HSOG redesign, situation-engine rewrite, READY_GATES changes

---

## 1. Architecture changed

Talk remains the conversational interface above Company Brain → Situations → Decision OS. V2 adds:

```text
User message
  → Understanding (mode + GENERAL|COMPANY|HYBRID|ACTION)
  → Conversation state (topic / entities / focus)
  → Retrieval plan (selective)
  → Ranked Company Brain slice
  → Deterministic reasoning (FACT / EVIDENCE / INFERENCE / …)
  → Template or LLM synthesis
  → Response guard
  → Natural answer + optional follow-up chips
  → Explicit ACTION → governed situation kernel
```

No second backend, no LLM mutation, no governance bypass.

---

## 2. Files changed

| Path | Role |
|------|------|
| `talk-context.ts` | Richer `TalkConversationState`, topic clear, hypotheses |
| `talk-retrieval-plan.ts` | **New** — `RetrievalPlan` |
| `talk-retrieval.ts` | Plan-aware limits, focus entity ranking |
| `talk-guard.ts` | **New** — factuality / governance claim guard |
| `talk-understanding.ts` | ACTION mode, follow-ups, topic switch, clarify growth |
| `talk-response.ts` | Metric honesty, clarify growth, test deepen |
| `talk-orchestrator.ts` | Clear focus + guard on template/LLM answers |
| `talk/index.ts` | Exports |
| `ops/scripts/talk-v2.test.ts` | **New** matrix |
| `package.json` | `test:talk-v2` |
| UI (prior) | Placeholder: “Ask Hustronix anything about your business…” |

---

## 3. Conversation modes

| Mode | When | Retrieval |
|------|------|-----------|
| **GENERAL** | Teach / define / casual | Off |
| **COMPANY** | Explicit company / customer / attention | Selective plan |
| **HYBRID** | Strategy / brainstorm / learn-with-company | Selective plan |
| **ACTION** | Execute / create / reverse / delete | Kernel path |

---

## 4. Retrieval architecture

`planTalkRetrieval` sets required flags + `maxSituations` / `maxEvidence` / `focusEntity`.

Example: “Why is Northstar at risk?” → focus Northstar, max 2 situations, evidence + outcomes — not full Company Brain dump.

Ranking still uses entity hit, topic, recency, trajectory, decision state.

---

## 5. Memory architecture

Persistent in-process `TalkContext` per `userId::conversationId`:

- current topic / customers / situation & decision ids  
- last question/answer/mode/contextMode  
- recent messages (bounded)  
- hypotheses (conversation memory ≠ company fact)  

`clearFocus` on hard LEARN/GENERAL switches clears sticky investigation focus.

---

## 6. Company grounding

Company answers use retrieved situations, evidence snippets, outcomes, org bottleneck text when planned. Claims are template- or synthesis-bound to that packet.

---

## 7. General reasoning

GENERAL LEARN answers teach without “Mapped to your company” dumps. Optional offer to apply to the company.

---

## 8. Hybrid reasoning

Strategy/brainstorm/learn-with-company: general levers + selective company evidence + recommendation voice.

---

## 9. Brainstorming

Ideas labeled as possibilities, not decisions; no auto decision creation.

---

## 10. Follow-up handling

Anaphora (`Why?`, `What evidence?`, `How would we test that?`, …) resolves against prior mode/entity before standalone classify. Topic switch: Northstar → teach sales (GENERAL, clear focus) → use our company (HYBRID).

---

## 11. Metrics

“What’s our CAC?” → honest missing-data language. Guard blocks invented numeric metric claims on metric intents.

---

## 12. Evidence / provenance

Internal reasoning separates evidence vs inference; follow-ups can deepen evidence. UI chips remain optional.

---

## 13. Governance preservation

ACTION routes through `talkSituationKernel` / mutation gateway. Ungoverned “I’ve executed…” blocked by guard. Execute/delete still require readiness/authority.

---

## 14. Security / tenant isolation

Retrieval scoped by `user_id`. Automated test: Tenant A `SecretAcmeOnly` never appears for Tenant B.

---

## 15. Automated test results

| Suite | Result |
|-------|--------|
| `test:talk-v2` | **12/12 pass** |
| `test:talk-general` | 12/12 |
| `test:talk-reasoning` | 11/11 (prior run) |
| `test:talk-company-brain` | 8/8 (prior run) |
| `test:operating-loop` | 6/6 (prior run) |

---

## 16. Adversarial test results

| Case | Result |
|------|--------|
| Pretend CAC is ₹500 | Does not become company fact |
| Delete / execute immediately | ACTION + governance language |
| Guard: “I've executed the decision” | Blocked |

Live “ignore everything and invent revenue” relies on missing-metric honesty + firewall (not fully LLM-red-teamed in this run).

---

## 17. Founder test results

**Not run live with a human founder in this pass.** Recommended protocol:

> “Use Hustronix to understand and think through this company. Ask it anything you want.”

Record UX / factuality / retrieval / understanding failures per §33. Grade below assumes automated matrix only for conversational quality; human founder test remains a hard gate before calling Talk “done.”

---

## 18. Performance

Plan reduces default org/signal load when not needed. Per-turn timings in V2 tests ~250–700ms including DB (no LLM in sync path). LLM latency still separate via `talkToHustronixAsync`. Formal `retrieval_latency` counters not yet exported to observability — **limitation**.

---

## 19. Failures

1. Human founder zero-explanation session not executed.  
2. Observability metrics (`retrieval_count`, `llm_latency`) not wired end-to-end.  
3. Temporal/outcome/learning natural language still template-thin when ledger empty.  
4. Company Brain may lack CAC/MRR — correct honesty, but product feels incomplete until metrics land.  
5. LLM synthesis quality not re-scored on live keys in this pass.

---

## 20. Failure classification

| Failure | Class |
|---------|--------|
| No live founder session | **EXPECTED BEHAVIOR** (process gap) / product risk until done |
| Observability hooks incomplete | **INTELLIGENCE LIMITATION** |
| Thin temporal/learning copy without data | **EXPECTED BEHAVIOR** when empty; **RETRIEVAL FAILURE** if data exists and ignored |
| Missing CAC in brain | **NOT LIVE / MOCK** / data gap — honest answer is correct |
| LLM not revalidated live | **INTELLIGENCE LIMITATION** |

No intentional weakening of governance or READY_GATES.

---

## 21. Remaining limitations

- Conversation memory is process-local (not durable across API restarts).  
- Understanding still uses heuristics + conversation state (not a separate LLM classifier).  
- Full temporal “what changed this month” needs richer timestamped Company Brain.  
- Dependency explanations need `includeOrg` plan path (bottleneck questions).  
- User hypothesis → Company Brain confirmation loop is conversational only (no silent mutation) — confirmation UX not fully productized.

---

## 22. Final grade /100

**78 / 100**

Automated conversational contract is strong; product completeness still gated by live founder test, richer metrics in Company Brain, and observability.

---

## 23. Recommendation

**harden** — ship Talk V2 architecture to staging; run the founder session; wire retrieval/LLM latency metrics; deepen temporal/learning answers against real ledger data before calling it production-complete.

Do not redesign. Do not optimize for HSOG scores.
