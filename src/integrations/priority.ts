/**
 * Ordered rollout for wiring real-world activity into `external_signals`.
 * Slack Events API → POST `/api/integrations/slack/events` (see `slackEvents.ts`).
 * Telegram removed from core stack; GitHub/Jira backlog.
 */
export const SIGNAL_INGESTION_PRIORITY = ["SLACK", "GITHUB", "JIRA", "MANUAL"] as const;
export type SignalIngestionSource = (typeof SIGNAL_INGESTION_PRIORITY)[number];
