# HSOG day-taste — break & grade report

**Run:** `npm run hsog:day-taste -- --through-day 132`  
**Tenant:** `hsog_days`  
**Scorecard:** `data/hsog-day-taste-scorecard.json` · [`hsog-day-taste-report.md`](./hsog-day-taste-report.md)

## Overall grade: **A (92/100)**

| Component | Score |
|---|---:|
| Day fidelity | 100 |
| Decision timing | 100 |
| Break resilience | 100 (50/50) |
| Corpus survival | 100 |
| Retrieval accuracy | 83 (B · 3.33/4 · 6/6 pass) |
| Execution motion | 48 (capacity gating BLOCKED correctly) |

## Fixes shipped

1. **Duplicate ACTIVE same vow** — commit rejects already-ACTIVE and same-vow ACTIVE duplicates.
2. **Corpus kill** — `mutationKillSignal` refuses HSOG evidence.
3. **Forecast / freeze retrieval** — recoverable prose on ingest + native rubric types.
4. **Re-run wipe** — clears `external_event_dedup` + dependent tables.
5. **Day-sim** — prefer ACTIVE vow; capacity probe grades per-owner overrun only.

## Commands

```powershell
npm run hsog:day-taste -- --through-day 132
npm run test:os-enforcement
```
