/**
 * Per-account chat persistence in the browser. All keys include `userId`;
 * never read/write unscoped `hustronix.chat.*` keys (see `purgeLegacyUnscopedChatBrowserStorage`).
 */

import { getStoredUserId } from "@/lib/api";

export type ChatMsg = {
  role: "user" | "assistant";
  content: string;
  /** Client-side ordering / display time (ms since epoch). */
  at?: number;
};

export type ChatRecentSession = {
  id: string;
  title: string;
  updatedAt: number;
};

const PREFIX = "hustronix.chat";

/** Exact keys written before per-user namespacing (cross-account leak risk). */
const LEGACY_LOCAL_EXACT = new Set([
  `${PREFIX}.recents`,
  `${PREFIX}.sticky_session`,
  `${PREFIX}.session_messages`,
]);

/** Session UI keys written before per-user namespacing. */
const LEGACY_SESSION_EXACT = new Set([
  `${PREFIX}.panel_ctx`,
  `${PREFIX}.panel_insp`,
  `${PREFIX}.inspector_tab`,
  `${PREFIX}.recents_expanded`,
  `${PREFIX}.seed`,
]);

function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function resolvePersistUserId(explicit: string | null | undefined): string | null {
  const id = explicit?.trim();
  if (id) return id;
  const fromLs = (getStoredUserId() ?? "").trim();
  if (!fromLs || fromLs === "system") return null;
  return fromLs;
}

function sessionMessagesPartKey(userId: string, sessionId: string): string {
  return `${PREFIX}.session_messages:${userId}:${sessionId}`;
}

/**
 * LocalStorage key builders — every value includes `userId` in the key string.
 */
export function chatLocalStorageKeys(userId: string) {
  const uid = userId.trim();
  return {
    recents: `${PREFIX}.recents:${uid}`,
    stickySession: `${PREFIX}.sticky_session:${uid}`,
    /** Per-user JSON map `Record<sessionId, ChatMsg[]>` used for migration from older layouts. */
    sessionMessages: `${PREFIX}.session_messages:${uid}`,
  };
}

/**
 * SessionStorage key builders — scoped per `userId`.
 */
export function chatSessionStorageKeys(userId: string) {
  const uid = userId.trim();
  const k = (suffix: string) => `${PREFIX}.${suffix}:${uid}`;
  return {
    panelCtx: k("panel_ctx"),
    panelInsp: k("panel_insp"),
    inspectorTab: k("inspector_tab"),
    recentsExpanded: k("recents_expanded"),
    seed: k("seed"),
  };
}

export function readRecents(userId: string): ChatRecentSession[] {
  if (typeof window === "undefined") return [];
  const uid = resolvePersistUserId(userId);
  if (!uid) return [];
  try {
    const raw = localStorage.getItem(chatLocalStorageKeys(uid).recents);
    if (!raw) return [];
    const parsed = safeJsonParse<unknown>(raw, null);
    if (!Array.isArray(parsed)) return [];
    const out: ChatRecentSession[] = [];
    for (const r of parsed) {
      if (
        r &&
        typeof r === "object" &&
        typeof (r as ChatRecentSession).id === "string" &&
        typeof (r as ChatRecentSession).title === "string" &&
        typeof (r as ChatRecentSession).updatedAt === "number"
      ) {
        out.push(r as ChatRecentSession);
      }
    }
    return out.slice(0, 50);
  } catch {
    return [];
  }
}

export function writeRecents(userId: string, list: ChatRecentSession[]): void {
  if (typeof window === "undefined") return;
  const uid = resolvePersistUserId(userId);
  if (!uid) return;
  try {
    localStorage.setItem(chatLocalStorageKeys(uid).recents, JSON.stringify(list.slice(0, 50)));
  } catch {
    /* ignore quota / private mode */
  }
}

export function readStickySessionId(userId: string): string | null {
  if (typeof window === "undefined") return null;
  const uid = resolvePersistUserId(userId);
  if (!uid) return null;
  try {
    const v = localStorage.getItem(chatLocalStorageKeys(uid).stickySession);
    if (v == null || v === "") return null;
    return v;
  } catch {
    return null;
  }
}

export function writeStickySessionId(userId: string, sessionId: string | null): void {
  if (typeof window === "undefined") return;
  const uid = resolvePersistUserId(userId);
  if (!uid) return;
  try {
    const key = chatLocalStorageKeys(uid).stickySession;
    if (sessionId == null || sessionId === "") {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, sessionId);
    }
  } catch {
    /* ignore */
  }
}

export function readStoredSessionMessages(userId: string, sessionId: string): ChatMsg[] {
  if (typeof window === "undefined") return [];
  const uid = resolvePersistUserId(userId);
  if (!uid) return [];
  try {
    const direct = localStorage.getItem(sessionMessagesPartKey(uid, sessionId));
    if (direct) {
      const arr = safeJsonParse<unknown>(direct, null);
      if (Array.isArray(arr)) return arr as ChatMsg[];
    }
    const monoRaw = localStorage.getItem(chatLocalStorageKeys(uid).sessionMessages);
    if (!monoRaw) return [];
    const map = safeJsonParse<Record<string, ChatMsg[]>>(monoRaw, {});
    const msgs = map[sessionId];
    return Array.isArray(msgs) ? msgs : [];
  } catch {
    return [];
  }
}

export function writeStoredSessionMessages(
  userId: string,
  sessionId: string,
  messages: ChatMsg[],
): void {
  if (typeof window === "undefined") return;
  const uid = resolvePersistUserId(userId);
  if (!uid) return;
  try {
    localStorage.setItem(sessionMessagesPartKey(uid, sessionId), JSON.stringify(messages));
  } catch {
    /* ignore */
  }
}

export function deleteStoredSessionMessages(userId: string, sessionId: string): void {
  if (typeof window === "undefined") return;
  const uid = resolvePersistUserId(userId);
  if (!uid) return;
  try {
    localStorage.removeItem(sessionMessagesPartKey(uid, sessionId));
    const monoKey = chatLocalStorageKeys(uid).sessionMessages;
    const monoRaw = localStorage.getItem(monoKey);
    if (!monoRaw) return;
    const map = safeJsonParse<Record<string, ChatMsg[]>>(monoRaw, {});
    if (Object.prototype.hasOwnProperty.call(map, sessionId)) {
      delete map[sessionId];
      if (Object.keys(map).length === 0) {
        localStorage.removeItem(monoKey);
      } else {
        localStorage.setItem(monoKey, JSON.stringify(map));
      }
    }
  } catch {
    /* ignore */
  }
}

function storageKeysSnapshot(storage: Storage): string[] {
  const keys: string[] = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k) keys.push(k);
    }
  } catch {
    return keys;
  }
  return keys;
}

function removeStorageKey(storage: Storage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/**
 * Removes pre-namespacing chat keys so another account on the same browser
 * cannot read prior chat artifacts. Safe to call repeatedly.
 *
 * Cleans:
 * - `hustronix.chat.recents`, `hustronix.chat.sticky_session`, `hustronix.chat.session_messages` (no suffix)
 * - Unscoped session keys: `hustronix.chat.panel_ctx`, `panel_insp`, `inspector_tab`, `recents_expanded`, `seed`
 * - `hustronix.chat.session_messages:<single>` when the stored JSON is an array (legacy per-session blob without user id)
 */
export function purgeLegacyUnscopedChatBrowserStorage(): void {
  if (typeof window === "undefined") return;

  for (const k of LEGACY_LOCAL_EXACT) {
    removeStorageKey(localStorage, k);
  }
  for (const k of LEGACY_SESSION_EXACT) {
    removeStorageKey(sessionStorage, k);
  }

  const scan = (storage: Storage) => {
    for (const key of storageKeysSnapshot(storage)) {
      if (!key.startsWith(`${PREFIX}.session_messages:`)) continue;
      const rest = key.slice(`${PREFIX}.session_messages:`.length);
      if (rest.includes(":")) continue;
      if (!rest) continue;
      try {
        const raw = storage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          removeStorageKey(storage, key);
        }
      } catch {
        /* ignore malformed */
      }
    }
  };
  scan(localStorage);
  scan(sessionStorage);
}

/**
 * Clears all hustronix chat browser state for one account (logout, session revoke, “system user”).
 */
export function clearChatBrowserStorageForUser(userId: string): void {
  if (typeof window === "undefined") return;
  const uid = userId?.trim();
  if (!uid) return;
  try {
    const lk = chatLocalStorageKeys(uid);
    removeStorageKey(localStorage, lk.recents);
    removeStorageKey(localStorage, lk.stickySession);
    removeStorageKey(localStorage, lk.sessionMessages);
    const partPrefix = `${PREFIX}.session_messages:${uid}:`;
    for (const key of storageKeysSnapshot(localStorage)) {
      if (key.startsWith(partPrefix)) {
        removeStorageKey(localStorage, key);
      }
    }
  } catch {
    /* ignore */
  }
  try {
    const sk = chatSessionStorageKeys(uid);
    for (const key of Object.values(sk)) {
      removeStorageKey(sessionStorage, key);
    }
  } catch {
    /* ignore */
  }
}
