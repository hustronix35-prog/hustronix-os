# Talk routing contract (V2.2 conversational hardening)

Talk architecture remains frozen. This document is the **speech-act → retrieval → response** contract for understanding and routing only.

Do **not** treat this as a second intent engine or Talk V3. Decision OS / mutation gateway / READY_GATES stay authoritative for ACTION.

## Precedence

```text
1. Explicit governed ACTION ("create the decision", "execute", "reverse the decision")
2. Product orientation ("what is this?", "what is Hustronix for?") → GENERAL, no company dump
3. Conversational decision outcome ("did that decision help?") → COMPANY_QA / decision_outcome (not ACTION)
4. Focused evidence ask with sticky subject ("what evidence do you have?")
5. Temporal delta ("what changed recently?")
6. Explicit new topic override ("what's blocking the launch?")
7. Speech act on current focus (challenge, what else, why)
8. Semantic operation (overview, customer risk, metric, learn, brainstorm, recommend)
9. Named entity investigation
10. Sticky conversation focus
11. Global company context
```

## Routing matrix

| User behavior | Semantic operation | Mode / objective | Retrieval |
|---|---|---|---|
| What is this / Hustronix / what do you do? | Product orientation | `GENERAL` / `product_orientation` | None |
| What's going on? / What's happening in the company? | Company overview | `COMPANY_QA` / `company_overview` | Company-wide worsening + elevated + blockers (no entity required) |
| What changed recently? / what's getting worse? | Temporal delta | `COMPANY_QA` / `temporal_delta` | Recent situations, outcomes, deps, signals |
| Did our last decision help? / what did we learn? | Outcome evaluation | `COMPANY_QA` / `decision_outcome` | Decision + outcome + post trajectory (**not** mutation) |
| Who should I worry about? / at risk / unhealthy | Customer risk | `COMPANY_QA` / `customer_risk` | Customers with negative / worsening situations |
| Why? | Explain | `FOLLOWUP` / deepen=why | Current focus |
| What evidence? / show me the proof | Focused evidence | `FOLLOWUP` / `focused_evidence` | **Preserve sticky entity**; provenance sources only |
| Are you sure? / Could it be pricing? / What else could explain this? | Challenge / alternatives | `COUNTERFACTUAL` | Current focus; **no fabricated evidence-against** |
| What would you do (if you were me)? | Recommendation | `STRATEGY` / `recommendation` | Current focus / company slice |
| What should we do / focus on? | Recommendation / attention | `STRATEGY` or attention | Selective company |
| What could we try? / Give me options / How could we approach this? | Explore / brainstorm | `BRAINSTORM` / `ideate` | Current focus / company |
| Brainstorm… | Explore | `BRAINSTORM` | Same |
| What's blocking the launch / X? | Bottleneck | `COMPANY_QA` / `bottleneck` | Explicit topic + dependencies; **suspend sticky customer** |
| What's our CAC / conversion rate? | Metric lookup | `COMPANY_QA` / `company_metric` | Metrics only → honest missing if absent |
| Teach me X | Learning | `LEARN` / GENERAL | None |
| Apply that to us / our situation | Hybrid learn | `LEARN` / HYBRID / `learn_with_company` | Prior topic + selective company |
| Let's do option 2 / Create the decision | Commit | ACTION → kernel | Governed Decision OS |
| Reverse the decision | Governed reverse | `OUTCOME` / ACTION | Mutation gateway |

## Explore vs recommend vs commit

```text
EXPLORE   → possibilities (not decisions)
RECOMMEND → ranked advice (not decisions)
COMMIT    → governed Decision OS only
```

## Retrieval rules

- `entity = NONE` + overview / risk scan → **company-wide retrieval**, never “retrieve nothing.”
- Sticky focus yields to **explicit topic override**.
- Challenge / “what else” uses **conversation subject**, not incidental entity tokens (e.g. “product”).
- `reason = metric_lookup` → metric answer path only (never attention brief).

## Response shapes (founder-facing)

| Operation | Shape |
|---|---|
| Overview | Answer → why → 2–3 threads → optional next step |
| Challenge | Current view → alternative → for/against → what would distinguish |
| Recommendation | Recommendation → why → evidence → trade-offs |
| Brainstorm | Possibilities → trade-offs → preferred option → ask whether to pursue |
| Metric | Figure or honest missing data |
| Learn | Concept → example → optional company application |

Internal labels (`contextMode`, `pattern_id`, etc.) stay out of founder copy unless asked.
