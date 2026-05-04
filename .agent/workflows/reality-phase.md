# Hustronix Reality Phase Workflow

This workflow defines the operational steps for the **Reality Phase** (User Validation and Feedback loop).

## 1. Installation & Setup
- [ ] Run `npx prisma db push --accept-data-loss` to reset the database to the Execution Layer V1 schema.
- [ ] Connect a Slack workspace by setting `slackBotToken` and `slackWorkspaceId` in the `Organization` record.
- [ ] Configure `escalation_user_id` for targeted pings.
- [ ] Point Slack Event and Interactive Webhooks to your deployed instance.

## 2. Tracking Core Metrics & Success Threshold
Monitor the success of the execution reinforcement layer using this single metric:
> **Metric:** `tasks_completed_due_to_hustronix / total_tasks_created`

**Success Threshold (V1 Goal):**
- **Completion Rate ≥ 30%** (System is driving action)
- **Ignore Rate ≤ 40%** (System is not annoying)

Track this by querying the `ExecutionLog` for `ACTION_TAKEN` (type `done`) vs `TASK_CREATED`.

## 3. Observational Audit
Weekly review of the `ExecutionLog` and Slack threads to identify:
- **Nudge fatigue:** Are users ignoring nudges after the 1st attempt?
- **Extraction noise:** Are tasks being created from non-decisions (low confidence)?
- **Friction points:** Are users clicking "Ignore" frequently?

## 4. Iteration Loop (Reality vs. Ideas)
- **Fix based on behavior:** If nudges are ignored, adjust the `nudge-generator.ts` tone or `impact_score` threshold.
- **Deduplication tuning:** If duplicate tasks appear, tighten the keyword overlap threshold in `slack-parser.ts`.
- **Confidence Calibration:** If noise is high, raise the confidence gate above `0.7`.

## 5. External Expansion
Once the internal completion rate exceeds 50% for 2 consecutive weeks, move to **External Validation**:
- Identify 1 external team.
- Onboard them to the "Money Loop".
- Measure their behavioral change.
