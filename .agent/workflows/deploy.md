---
description: Deploy the Gravity Claw AI agent to Railway
---

1. Stop the active Railway instance to avoid Telegram Bot polling conflicts between live and local versions.
// turbo
2. Pause the active instance.
```bash
railway down
```

3. Type-check the project to verify that there are no TS errors before deploying.
// turbo
4. Run type checker.
```bash
npx tsc --noEmit
```

5. Deploy the application to Railway in detached mode. This triggers a Docker build on Railway.
// turbo
6. Start the deployment.
```bash
railway up --detach
```

7. Wait for approximately 60 to 90 seconds. The bot briefly goes offline during rebuild and then reconnects automatically.

8. Verify the deployment was successful by checking the logs for startup messages without traces of crashes.
// turbo
9. Check live logs.
```bash
railway logs --lines 100
```
