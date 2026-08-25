/**
 * One-shot: record a natural founder-style Talk session into an existing session_id.
 * Not a product tour — ordinary business questions only.
 */
import {
  loadFounderSession,
  recordFounderTurn,
  saveFounderSession,
} from "./talk-founder-validation.js";

const sessionId = process.argv[2];
if (!sessionId) {
  console.error("Usage: npx tsx ops/scripts/run-founder-session-turns.ts <session-id>");
  process.exit(1);
}

const questions = [
  "hi",
  "okay… so what is this thing actually for?",
  "what's going on with the company right now?",
  "which customers should I be worried about?",
  "tell me more about Northstar",
  "why is that happening?",
  "what evidence do you have?",
  "are you sure it's not just a pricing issue?",
  "what else could explain this?",
  "what about Atlas?",
  "what's blocking the launch?",
  "how can we increase sales?",
  "what would you do if you were me?",
  "what could we try?",
  "give me some options",
  "teach me the basics of enterprise sales",
  "okay, apply that to our situation",
  "what's our CAC?",
  "what changed recently?",
  "did our last decision on Northstar actually help?",
  "let's do option 2",
  "create the decision",
];

const m0 = loadFounderSession(sessionId);
m0.started_at = new Date().toISOString();
m0.status = "in_progress";
m0.notes.push(
  "Session turns recorded via ops/scripts/run-founder-session-turns.ts (agent-proxy founder). Not a live untrained human UI session.",
);
saveFounderSession(m0);

for (const q of questions) {
  const turn = recordFounderTurn(sessionId, q);
  console.log(`#${turn.turn_number} [${turn.context_mode}/${turn.mode}] ${q}`);
  console.log(turn.assistant_response.slice(0, 160).replace(/\n/g, " "));
  console.log("---");
}

const m = loadFounderSession(sessionId);
m.ended_at = new Date().toISOString();
m.status = "in_progress";
saveFounderSession(m);
console.log(JSON.stringify({ ok: true, session_id: sessionId, turns: m.turns.length }, null, 2));
