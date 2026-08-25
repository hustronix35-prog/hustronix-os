# Founder Validation Harness — Implementation Report

**Date:** 2026-08-21  
**Goal:** Make a clean, reproducible, observable founder test of **current Talk V2.1** possible.  
**Constraint honored:** No Talk behavior changes. No Decision OS / READY_GATES / mutation gateway / learning changes.

---

## Files created

| Path | Purpose |
|------|---------|
| `ops/scripts/founder-validation/seed-company.ts` | Realistic B2B SaaS Company Brain seed (timeline + noise) |
| `ops/scripts/talk-founder-validation.ts` | Create isolated session + optional smoke/record/sync |
| `ops/scripts/export-founder-session.ts` | Export markdown report + scorecard stub |
| `ops/scripts/talk-founder-validation-harness.test.ts` | Harness integrity tests |
| `docs/qa/talk-v2-2-founder-validation.md` | Zero-explanation founder protocol |
| `docs/qa/founder-validation-observer-log.md` | Observer template |
| `docs/qa/founder-validation-harness-report.md` | This report |

## Files changed

| Path | Change |
|------|--------|
| `package.json` | `founder:validation`, `export:founder-session`, `test:founder-validation-harness` |

## Files intentionally untouched

- `apps/api/src/intelligence/talk/**` (behavior)
- `apps/api/src/intelligence/situation-engine.ts`
- READY_GATES / governance / mutation gateway / learning
- os-ui Talk UI (no coaching chips / no product tour changes)

## Dataset created (per session)

Customers: Northstar, Atlas, Meridian, CobaltWorks  

Threads: Northstar renewal risk; Atlas expansion stalled; Meridian health; pipeline coverage; Eng→Security→Legal launch block; CobaltWorks improving onboarding  

Noise: standup, positive CobaltWorks, finance close, routine sales note  

Timeline: ~18 days via `detected_at` / `received_at`  

Metrics: **CAC / conversion intentionally not seeded** (honest missing-data path)

Isolation probe tenant contains `SecretAcmeOnly` (not in founder tenant)

## Tenant isolation strategy

- Fresh `users` row + `resolveTenantContext`
- All seed rows scoped by `user_id`
- Separate isolation user for SecretAcmeOnly
- Harness test asserts founder situations never include SecretAcmeOnly

## Trace strategy

- Live UI: existing `talk_turn_traces` + `GET /api/intelligence/talk/traces`
- Harness: `recordFounderTurn` captures response `trace` into `data/founder-validation/<session-id>.json`
- `export:founder-session` syncs DB traces and writes report (no passwords in report)

## Export format

- `docs/qa/founder-validation/<session-id>-report.md`
- `data/founder-validation/<session-id>-scorecard.json` (scores null until human fill)

## Exact command to start founder validation

```bash
npm run founder:validation
```

Then log into os-ui with the printed credentials. Give the founder **only** the instruction in `docs/qa/talk-v2-2-founder-validation.md`.

Afterward:

```bash
npm run export:founder-session -- <session-id>
```

Optional harness smoke (not the human test):

```bash
npm run founder:validation -- --smoke
```

## Tests executed

| Suite | Result |
|-------|--------|
| test:founder-validation-harness | 5/5 |
| test:talk-v2 | 12/12 |
| test:talk-general | 12/12 |
| test:talk-reasoning | 11/11 |
| test:talk-company-brain | 8/8 |
| test:talk-synthesis | 5/5 |
| test:talk-v2-1 | 10/10 |
| test:operating-loop | 6/6 |

## Known limitations

- Live UI turns are best captured via DB traces after the fact; in-session JSON turns require `--record` or smoke path.
- Operator password is stored only under `data/founder-validation/` (gitignored via `/data/*`).
- Report rubric scores are blank until humans fill them — harness does not invent pass/fail.
- Founder `user_id` is kept ≤12 characters so default org slug provisioning stays unique (existing tenant-context behavior; harness workaround only).
- This harness does **not** run Founder Validation #2 automatically.

## Stop condition

Harness complete. **Do not** implement Talk fixes from hypothetical founder behavior. Wait for the live human session.
