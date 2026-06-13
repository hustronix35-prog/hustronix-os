# Ops

Operational scripts for local QA, migrations, smoke checks, report generation, and legacy one-off utilities.

Run scripts from the repository root through npm whenever possible:

```bash
npm run qa:ui
npm run security:launch
npm run db:pg:migrate
npm run smoke:intelligence
```

`ops/scripts/legacy` contains older one-off scripts kept for reference and manual recovery work.
