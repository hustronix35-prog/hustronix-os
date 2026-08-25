# Validation cycle report — Aug 18, 2026

Targeted architectural corrections only: cursor-based signal pagination, canonical impact resolution for Talk, and validation reruns on benchmark + founder flow.

---

## 1. Stress test (5,000 artifacts)

Command: `npm run benchmark:company-reality -- --scale 5000`

Full metrics: [`stress-5k-report.md`](./stress-5k-report.md) · raw log: [`stress-5k-run.log`](./stress-5k-run.log)

| Metric | Result |
|---|---|
| Operational? | **Yes** — completed without crash or timeout |
| Total runtime | **277.3 s** |
| Ingest | 32.2 s |
| Detection | 245.2 s |
| Artifacts | 5,000 (98% noise) |
| Situations | 16 |
| Duplicate identities | 0 |
| Evidence links | 81 |
| Memory (RSS) | 328 MB |
| Heap used | 123 MB |
| Benchmark BUGs | **0** |

### Answer

The architecture now remains operational **and correct** at 5,000 messy artifacts:

- **14/14 discovery**
- **7/7 entity isolation**
- **12/12 readiness**
- **2/2 no-decision**
- **1/1 contradiction**
- **1/1 reopen**

### Fix shipped

The old `LIMIT 500` signal cap in `situation-engine.ts` was replaced with a **cursor-based batch scan** using stable ordering (`received_at/detected_at` + `id`) and shared situation state across batches. This keeps:

`signal ingest → entity indexing → candidate generation → situation resolution → evidence accumulation → temporal state → readiness → decision`

within one progressive run, instead of treating each page like an isolated intelligence pass.

---

## 2. Intelligence engine — frozen again

After the pagination correction, the core intelligence path is frozen again unless a new correctness bug appears:

- `situation-engine.ts`
- open-world engine
- readiness logic
- governance
- outcome learning

Baseline after freeze:

- **800 artifacts:** 0 BUGs, **87/100**
- **5,000 artifacts:** 0 BUGs, **87/100**

---

## 3. Founder Journey

Report: [`founder-journey-probe-report.md`](./founder-journey-probe-report.md)

Fresh tenant · 800 company-reality artifacts · zero HSOG prompts.

**Score: 15/16**

| Step | Class | Notes |
|---|---|---|
| Login | PASS | |
| Home / attention | PASS | |
| Ask what's wrong | PASS | Plain language |
| Why | PASS | |
| Show evidence | PASS | |
| Who is affected | **PASS** | Fixed via canonical impact resolver |
| What should we do | PASS | |
| What else could be true | **UX** | Hypotheses formatting still feels expert-heavy |
| Validate | PASS | |
| Can we execute | PASS | |
| Create decision | PASS | |
| Execute | PASS | |
| Tasks | PASS | |
| Complete | PASS | Correctly blocked until tasks are done |
| Outcome | PASS | |
| Learn | PASS | |

### UI / zero-explanation test

Dev stack is already running. Latest seeded tenant from the probe:

- User: `founder_5f629382`
- Password: `founder-journey-local`
- Prompt: *"Use Hustronix to figure out what needs attention and do something about it."*

Pass = founder independently understands **what is happening → why → who is affected → what to do → can we execute → did it work**.

---

## 4. Canonical impact + dependency explanation

Shipped:

- new canonical resolver: `apps/api/src/intelligence/impact-resolver.ts`
- Talk `impact` answer now traverses one graph:

`Situation → entity → affected people → affected teams → waiting_on → blocking team → evidence`

This fixed the founder probe’s **“Who is affected?”** step.

### Dependency limitation status

Report: [`limitation-probes-report.md`](./limitation-probes-report.md)

- **DB graph:** Engineering → Security and Security → Legal are inferred correctly enough to preserve direction.
- **Talk cold-start explanation:** still weak when no situation has formed around the dependency chain.

Verdict: **known limitation**, not a correctness bug.

---

## 5. Parallel Acme stories

Probe result:

- `customer_churn_risk` situation for Acme
- emergent `customer_health` situation for Acme
- evidence is still partially shared around implementation-delay language

Verdict: **known limitation / partial separation**

The system is no longer collapsing entity identity incorrectly, but it still does **not** support full multi-instance pattern identity like:

- `Acme + churn + crisis #1`
- `Acme + churn + crisis #2`

That remains a future architectural enhancement, not a regression blocker for current validation.

---

## 6. Regression status

All reruns pass:

```bash
npm run test:production-readiness   # 12/12
npm run test:operating-loop         # 6/6
npm run test:org-intelligence       # 2/2
npm run benchmark:company-reality   # 0 BUGs @ 800
npm run benchmark:company-reality -- --scale 5000   # 0 BUGs @ 5000
```

New regression added:

- signals beyond the first 500 still reach the same progressive situation state via cursor batching

---

## 7. Product value framing

Current defensible claim:

**Hustronix detects hidden execution risks and decision bottlenecks before they become expensive business problems.**

Validated now on:

- blind messy ingest
- no-decision path
- contradiction handling
- governed decision loop
- founder-style Talk flow
- 5k scale stability + correctness

---

## 8. Next steps

| # | Task | Status |
|---|---|---|
| 1 | 5k benchmark | **Done** |
| 2 | Founder Journey | **Done (API), 15/16** |
| 3 | Zero-explanation UI test | **Ready** |
| 4 | Dependencies + parallel stories | **Investigated** |
| 5 | Fix only genuine product bugs/UX | **Open** — hypotheses UX first |
| 6 | Re-run regressions | **Done** |
| 7 | Start 3–5 design partners | **Next** |

### Do not do next

- rebuild the intelligence engine
- add another LLM layer
- chase synthetic score inflation
- broaden scope before design-partner validation
