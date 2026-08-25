# Company Reality Benchmark

Blind ingest · **no simDay** · no scenario labels in payload.

Artifacts: **800** (90% noise)
Ingest: 8408ms · Detect: 92632ms

## Metrics

| Metric | Result |
|---|---|
| Discovery | 14/14 |
| Entity isolation (churn) | 7/7 clean |
| Readiness (should-ready) | 12/12 |
| False-ready | 2 |
| De-escalation | 1/1 |
| Reopen | 1/1 |
| No-decision path | 2/2 |
| Contradiction handling | 1/1 |
| Evidence quality | 87% |

## Stories

| Story | Disc | Ready | Resolve | Reopen | Leaks | Stage | Traj | Ev |
|---|:---:|:---:|:---:|:---:|:---:|---|---|---:|
| Acme renewal / churn risk | ✓ | ✓ | — | — | — | DECIDED | WORSENING | 88% |
| Northstar renewal / churn risk | ✓ | ✓ | — | — | — | DECIDED | WORSENING | 88% |
| Meridian renewal / churn risk | ✓ | ✓ | — | — | — | DECIDED | WORSENING | 88% |
| Atlas renewal / churn risk | ✓ | ✓ | — | — | — | DECIDED | WORSENING | 88% |
| CobaltWorks renewal / churn risk | ✓ | ✓ | — | — | — | DECIDED | WORSENING | 88% |
| HelixBio complaints then recovery | ✓ | — | ✓ | — | — | RESOLVED | IMPROVING | 80% |
| Kaldera contradictory renewal signals | ✓ | — | — | — | — | RESOLVED | IMPROVING | 100% |
| SignalGrid recurring outage | ✓ | ✓ | — | ✓ | — | DECIDED | WORSENING | 100% |
| NexusAI launch / GA slip | ✓ | ✓ | — | — | — | DECIDED | WORSENING | 100% |
| Security incident / audit exception | ✓ | ✓ | — | — | — | DECIDED | WORSENING | 100% |
| Hiring freeze / headcount exceptions | ✓ | ✓ | — | — | — | DECIDED | STABLE | 100% |
| Forecast / coverage miss | ✓ | ✓ | — | — | — | DECIDED | WORSENING | 0% |
| SentryLine enterprise deal red flags | ✓ | ✓ | — | — | — | DECIDED | STABLE | 100% |
| FlowOps feature quality regression | ✓ | ✓ | — | — | — | DECIDED | WORSENING | 100% |
| Engineering blocked on Security credentials | FP | FP | — | — | — | DECIDED | WORSENING | 0% |
| Acme implementation (parallel) | FP | FP | — | — | — | DECIDED | WORSENING | 33% |

## Product score (draft): **87/100**

## Failure register

| Failure | Evidence | Root cause | Class | Fix? | Regression |
|---|---|---|:---:|:---:|---|
| Premature readiness: Engineering blocked on Security credent | stage=DECIDED trajectory=WORSENING | Unexpected DECISION_READY | LIMITATION | no | — |
| Premature readiness: Acme implementation (parallel) | stage=DECIDED trajectory=WORSENING | Unexpected DECISION_READY | LIMITATION | no | — |

**0 BUG(s)** · 2 LIMITATION · 0 EXPECTED
