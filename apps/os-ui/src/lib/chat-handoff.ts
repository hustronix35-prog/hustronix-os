/** Handoff from docked AIComposer → Chat (`/chat`). */
export const CHAT_DRAFT_KEY = "hustronix_chat_composer_draft";

export function stashChatDraft(text: string) {
  try {
    sessionStorage.setItem(CHAT_DRAFT_KEY, text);
  } catch {
    /* ignore quota / private mode */
  }
}

export function takeChatDraft(): string | null {
  try {
    const draft = sessionStorage.getItem(CHAT_DRAFT_KEY);
    if (draft == null) return null;
    sessionStorage.removeItem(CHAT_DRAFT_KEY);
    return draft;
  } catch {
    return null;
  }
}

export function chatUrlForQuery(text: string): string {
  return `/chat?q=${encodeURIComponent(text.trim())}`;
}
