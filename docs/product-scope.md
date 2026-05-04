# Product scope (trim target)

**Chosen direction: demo-full**

Keep the **enforcement kernel** (SQLite ledger, auditor cron, execution gates) as the source of truth, and retain the **demo-complete surface area**: web UI + WebSocket coordinator, LLM supervisor + tools, Telegram/Slack scaffolding, and mock connection capabilities in `connections_manager`.

**Rationale:** The repo already couples UX and enforcement; splitting them is a larger refactor than this phase. Enforcement-minimal (ledger + auditor + thin API only) remains available later by deleting agent/UI paths once boundaries are explicit.

**Does not imply:** Shipping pm_pack skills or scratch probes as product—they stay out of tracked runtime via `.gitignore` (scratch/, tmp/, skills/pm_pack/, logs, generated audit PNGs, and optional root planning markdown listed there). This `docs/` folder keeps short policy notes tracked.