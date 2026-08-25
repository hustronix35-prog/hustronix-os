/** Persisted Hustronix Assistant (slide-over) conversations. */

export type AssistantMsg = { role: "user" | "assistant"; text: string };
export type AssistantSession = {
  id: string;
  title: string;
  when: string;
  messages: AssistantMsg[];
};

export const ASSISTANT_SESSIONS_KEY = "hustronix_assistant_sessions";

export function readAssistantSessions(fallback: AssistantSession[]): AssistantSession[] {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(ASSISTANT_SESSIONS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as AssistantSession[];
    if (!Array.isArray(parsed) || !parsed.length) return fallback;
    return parsed.filter((s) => s?.id && Array.isArray(s.messages));
  } catch {
    return fallback;
  }
}

export function writeAssistantSessions(sessions: AssistantSession[]) {
  try {
    window.localStorage.setItem(ASSISTANT_SESSIONS_KEY, JSON.stringify(sessions.slice(0, 20)));
  } catch {
    /* ignore quota */
  }
}

/** Build a Chat handoff prompt from an assistant thread. */
export function assistantContinuePrompt(session: AssistantSession): string {
  const users = session.messages.filter((m) => m.role === "user").map((m) => m.text.trim()).filter(Boolean);
  if (!users.length) return "";
  const last = users[users.length - 1];
  if (users.length === 1) return last;
  return `Continue this Assistant thread.\n\nEarlier:\n${users
    .slice(0, -1)
    .map((t) => `- ${t}`)
    .join("\n")}\n\nLatest: ${last}`;
}
