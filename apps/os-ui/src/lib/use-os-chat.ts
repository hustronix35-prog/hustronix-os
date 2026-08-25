"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getStoredUserId, getWsBase } from "./api";

export type OsChatMsg = {
  role: "user" | "assistant";
  content: string;
  actions?: { id: string; label: string; kind: string; prompt?: string }[];
  focusId?: string | null;
  decisionId?: string | null;
};

function freshSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `chat-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function useOsChat(enabled: boolean) {
  const [messages, setMessages] = useState<OsChatMsg[]>([]);
  const [streaming, setStreaming] = useState("");
  const [pending, setPending] = useState(false);
  const [connected, setConnected] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const wsRef = useRef<WebSocket | null>(null);
  const streamBuf = useRef("");
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  const ensureSessionId = useCallback((): string => {
    if (sessionIdRef.current) return sessionIdRef.current;
    const id = freshSessionId();
    sessionIdRef.current = id;
    setSessionId(id);
    return id;
  }, []);

  useEffect(() => {
    ensureSessionId();
  }, [ensureSessionId]);

  const appendAssistant = useCallback((text: string) => {
    streamBuf.current = "";
    setStreaming("");
    setPending(false);
    const content = text.trim();
    if (!content) return;
    setMessages((prev) => [...prev, { role: "assistant", content }]);
  }, []);

  const loadSession = useCallback((id: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "load_session", sessionId: id }));
  }, []);

  useEffect(() => {
    if (!enabled) {
      wsRef.current?.close();
      wsRef.current = null;
      setConnected(false);
      return;
    }
    const uid = (getStoredUserId() ?? "").trim();
    const qs = uid && uid !== "system" ? `?userId=${encodeURIComponent(uid)}` : "";
    const ws = new WebSocket(`${getWsBase()}${qs}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as Record<string, unknown>;
        const t = String(msg.type || "");
        if (t === "history") {
          const sid = String(msg.sessionId || "");
          if (sid && sid !== sessionIdRef.current) return;
          const data = msg.data as { role?: string; content?: string }[];
          setMessages(
            (data || [])
              .filter((m) => m.content)
              .map((m) => ({
                role: m.role === "user" ? "user" : "assistant",
                content: String(m.content),
              })),
          );
          return;
        }
        if (t === "text_chunk") {
          streamBuf.current += String(msg.text ?? "");
          setStreaming(streamBuf.current);
          return;
        }
        if (t === "text") {
          appendAssistant(String(msg.text ?? streamBuf.current));
          return;
        }
        if (t === "error") {
          appendAssistant(String(msg.message ?? msg.error ?? "Something went wrong."));
        }
      } catch {
        /* ignore */
      }
    };
    ws.onclose = () => {
      setConnected(false);
      setPending(false);
    };
    ws.onerror = () => {
      setConnected(false);
      setPending(false);
    };
    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [enabled, appendAssistant]);

  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return false;
      const sid = ensureSessionId();
      setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
      streamBuf.current = "";
      setStreaming("");
      setPending(true);
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        appendAssistant("Chat is not connected to the agent. Situation and actions still come from the ledger.");
        return true;
      }
      ws.send(JSON.stringify({ type: "text", text: trimmed, sessionId: sid, consoleMode: true }));
      return true;
    },
    [appendAssistant, ensureSessionId],
  );

  const newConversation = useCallback(() => {
    const id = freshSessionId();
    sessionIdRef.current = id;
    setSessionId(id);
    setMessages([]);
    setStreaming("");
    setPending(false);
  }, []);

  const pushUser = useCallback((text: string) => {
    setMessages((prev) => [...prev, { role: "user", content: text }]);
  }, []);

  const pushAssistant = useCallback((msg: Omit<OsChatMsg, "role">) => {
    setPending(false);
    setStreaming("");
    setMessages((prev) => [...prev, { role: "assistant", ...msg }]);
  }, []);

  const openSession = useCallback(
    (id: string) => {
      sessionIdRef.current = id;
      setSessionId(id);
      setStreaming("");
      setPending(false);
      loadSession(id);
    },
    [loadSession],
  );

  return {
    messages,
    streaming,
    pending,
    connected,
    sessionId,
    ensureSessionId,
    sendMessage,
    newConversation,
    openSession,
    pushUser,
    pushAssistant,
    setPending,
  };
}
