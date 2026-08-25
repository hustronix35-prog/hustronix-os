# Company Reality Stress Test (5000 artifacts)

Generated: 2026-08-18T08:14:00.598Z

| Metric | Value |
|---|---|
| artifact_count | 5000 |
| signal_count | 5000 |
| situation_count | 16 |
| duplicate_identity_groups | 0 |
| duplicate_situation_rows | 0 |
| evidence_links | 81 |
| ingest_ms | 32171 |
| detect_ms | 245156 |
| total_ms | 277327 |
| detect_passes | 90 |
| ms_per_detect_pass | 2724 |
| ms_per_artifact_ingest | 6 |
| memory_rss_mb | 328 |
| memory_heap_used_mb | 123 |
| crashes | 0 |
| timeouts | 0 |
| benchmark_bugs | 0 |
| false_positives | 2 |

## Correctness (same corpus ground truth)

# Company Reality Benchmark

Blind ingest · **no simDay** · no scenario labels in payload.

Artifacts: **5000** (98% noise)
Ingest: 32171ms · Detect: 245156ms

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
