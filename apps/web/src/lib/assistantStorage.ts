/**
 * Browser persistence for header AI Assistant (separate from main Chat).
 */

import { getStoredUserId } from "@/lib/api";

export type AssistantMsg = {
  role: "user" | "assistant";
  content: string;
  at?: number;
};

const PREFIX = "hustronix.assistant";

function resolveUserId(explicit: string | null | undefined): string | null {
  const id = explicit?.trim();
  if (id) return id;
  const fromLs = (getStoredUserId() ?? "").trim();
  if (!fromLs || fromLs === "system") return null;
  return fromLs;
}

export function assistantLocalStorageKeys(userId: string) {
  const uid = userId.trim();
  return {
    stickySession: `${PREFIX}.sticky_session:${uid}`,
    sessionMessages: (sessionId: string) =>
      `${PREFIX}.session_messages:${uid}:${sessionId}`,
  };
}

export function readAssistantStickySession(userId: string): string | null {
  if (typeof window === "undefined") return null;
  const uid = resolveUserId(userId);
  if (!uid) return null;
  try {
    const raw = localStorage.getItem(assistantLocalStorageKeys(uid).stickySession);
    return raw?.trim() || null;
  } catch {
    return null;
  }
}

export function writeAssistantStickySession(
  userId: string,
  sessionId: string | null,
): void {
  if (typeof window === "undefined") return;
  const uid = resolveUserId(userId);
  if (!uid) return;
  try {
    const key = assistantLocalStorageKeys(uid).stickySession;
    if (!sessionId) localStorage.removeItem(key);
    else localStorage.setItem(key, sessionId);
  } catch {
    /* ignore */
  }
}

export function readAssistantSessionMessages(
  userId: string,
  sessionId: string,
): AssistantMsg[] {
  if (typeof window === "undefined") return [];
  const uid = resolveUserId(userId);
  if (!uid || !sessionId) return [];
  try {
    const raw = localStorage.getItem(
      assistantLocalStorageKeys(uid).sessionMessages(sessionId),
    );
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m): m is AssistantMsg =>
        !!m &&
        typeof m === "object" &&
        (m as AssistantMsg).role !== undefined &&
        typeof (m as AssistantMsg).content === "string",
    );
  } catch {
    return [];
  }
}

export function writeAssistantSessionMessages(
  userId: string,
  sessionId: string,
  messages: AssistantMsg[],
): void {
  if (typeof window === "undefined") return;
  const uid = resolveUserId(userId);
  if (!uid || !sessionId) return;
  try {
    localStorage.setItem(
      assistantLocalStorageKeys(uid).sessionMessages(sessionId),
      JSON.stringify(messages.slice(-80)),
    );
  } catch {
    /* ignore */
  }
}

export function clearAssistantSessionMessages(
  userId: string,
  sessionId: string,
): void {
  if (typeof window === "undefined") return;
  const uid = resolveUserId(userId);
  if (!uid) return;
  try {
    localStorage.removeItem(
      assistantLocalStorageKeys(uid).sessionMessages(sessionId),
    );
  } catch {
    /* ignore */
  }
}
