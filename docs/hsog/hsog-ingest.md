# HSOG → Hustronix OS ingest

HSOG (workspace `hsog`, repo `orgforge`) generates the Hustronix Systems enterprise benchmark. This OS consumes that corpus through the **existing** ingest seam — no parallel database.

```text
hsog os_ingest.json
        │  artifact → Slack/Jira/GitHub/Gmail/CRM/Meeting/Incident/HRIS/Finance
        ▼
ingestExternal()  →  external_signals
        │
        ├── entities + team_roster
        ├── DRAFT decisions + executions (optional ACTIVE)
        └── heuristic intelligence (no LLM)
```

## Run

```powershell
# optional: regenerate fixture from timelines (Python + PyYAML only)
cd D:\hsog\orgforge
python scripts\export_os_ingest.py

cd "D:\Hustronix OS"
npm run hsog:ingest -- --user spandan --start-sprint

# heavy company flow: real Slack/Jira/GitHub/Gmail/CRM/meeting ingest + parallel executions + HSOG grades
npm run hsog:heavy

# day-basis taste: ~3 months chronological (day N events → suggestions → decisions → executions → breaks)
npm run hsog:day-taste
npm run hsog:day-taste -- --through-day 132

# seed the login account you use in os-ui (4 months + executed look)
npm run hsog:seed-spandan
```

Default bundle: `D:\hsog\orgforge\benchmarks\hustronix-enterprise\fixtures\os_ingest.json`  
Override with `--bundle`, `HSOG_EXPORT`, or `HSOG_ROOT`.

Day-taste writes:
- `data/hsog-day-taste-scorecard.json` — full journal + grades
- [`hsog-day-taste-report.md`](./hsog-day-taste-report.md) — day-by-day narrative

`hsog:seed-spandan` wipes then chronologically seeds **spandan** through day 132, activates vows, marks tasks executed, and writes `data/hsog-seed-spandan.json`.

Tenant for taste: isolated `hsog_days` (wiped each run unless `--no-wipe`).
Seed for product UI: `spandan` via `npm run hsog:seed-spandan`.

That seed also sets `org.owner_user_id` / `org.role=owner`, finalizes executions (DONE + in-flight ACTIVE), and seeds Teams cross-dependencies so Analytics / Teams / Brain tabs show live ledger data.

Then log into os-ui (`http://localhost:3000`) as that user.

| Surface | What you should see |
|---|---|
| Home | Mission-control summary from ledger + signals |
| Decide | 8 scenario vows (one ACTIVE unless `--no-activate`) |
| Execute | Tasks owned by Imani / Renata / Jordan / … (`--start-sprint` ACTIVEs within capacity) |
| Alerts | Launch slip, Acme churn, SEV1, SignalGrid outage |

## Breaks and fixes

Full failure catalog (auditor mass-kill on backdated `detected_at`, one-ACTIVE-decision, capacity, MANUAL dump, retrieval vs facts): [`hsog-break-report.md`](./hsog-break-report.md).

Day-basis chronological taste (2–4 months, break probes, graded loop): [`hsog-day-taste-break-report.md`](./hsog-day-taste-break-report.md).

**Complete narrative (what happened, real vs scaffolding, grades, break catalog):** [`hsog-complete-performance-report.md`](./hsog-complete-performance-report.md).

## Invariants

- Signals never invent a second truth store. Idempotency key: `hsog:{artifact_id}`.
- `ingest_meta.integration_runtime = "hsog"` (Nango remains `"nango"`).
- Artifact types map to real source buckets (`SLACK`, `JIRA`, `GITHUB`, `CRM`, `MEETING`, …). Confluence is `MANUAL` + `confluence.page`, not Notion.
- Grace clock uses `received_at` (ingest wall time). `detected_at` stays event/sim time.
- Multiple ACTIVE vows allowed when NO-lists do not overlap (same auditor rule as production).
