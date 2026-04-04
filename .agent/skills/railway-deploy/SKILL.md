---
name: railway-deploy
description: Handle the full pause -> test -> deploy -> verify cycle for Railway deployments.
---
# Railway Deployment Agent Skill

You are equipped with the knowledge to safely deploy Gravity Claw to Railway.

## The Deployment Cycle

When the user asks you to "deploy", you must follow these steps precisely to ensure zero downtime and no telegram polling conflicts.

1. **Pause Railway (Enter Dev Mode)**
   Before deploying or testing locally, you must pause the remote service, otherwise two bot instances will simultaneously poll Telegram and fight over messages.
   Run: `railway down`

2. **Type-Check**
   Always verify the build is safe.
   Run: `npx tsc --noEmit`
   If errors occur, fix them locally with the user before proceeding.

3. **Deploy**
   Trigger the remote build process.
   Run: `railway up --detach`

4. **Verify**
   Wait approximately 60-90 seconds, then check the logs to ensure the bot connected successfully without crashing.
   Run: `railway logs --lines 100`
   Look for: `✅ Soul loaded`, `✅ Connected as @...`, `✅ Heartbeat scheduled`.

## Troubleshooting
- If the build fails: Review `railway logs --lines 100` for npm or TS errors.
- If messages go to the wrong place: The old instance might still be running. Ensure `railway down` ran successfully.
- Note: SQLite (`gravity-claw.db`) will reset on every deploy because the Railway filesystem is ephemeral. Pinecone memory persists.
