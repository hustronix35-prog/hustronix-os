"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet, getStoredUserId, getWsBase } from "@/lib/api";
import {
  readAssistantSessionMessages,
  readAssistantStickySession,
  writeAssistantSessionMessages,
  writeAssistantStickySession,
  type AssistantMsg,
} from "@/lib/assistantStorage";

export function useAssistantChat(enabled: boolean) {
  const [accountId, setAccountId] = useState<string | null>(null);
  const [identityErr, setIdentityErr] = useState<string | null>(null);
  const [messages, setMessages] = useState<AssistantMsg[]>([]);
  const [streaming, setStreaming] = useState("");
  const [pending, setPending] = useState(0);
  const [connected, setConnected] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const streamBuf = useRef("");
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await apiGet<{ user: { id: string } }>("/api/me");
        if (cancelled) return;
        setAccountId(data.user.id);
        setIdentityErr(null);
      } catch (e: unknown) {
        if (cancelled) return;
        setIdentityErr(e instanceof Error ? e.message : "Could not resolve account");
        setAccountId(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!accountId) return;
    const sticky = readAssistantStickySession(accountId);
    if (sticky?.startsWith("asst:")) {
      sessionIdRef.current = sticky;
      setSessionId(sticky);
      setMessages(readAssistantSessionMessages(accountId, sticky));
    }
  }, [accountId]);

  useEffect(() => {
    if (!accountId || !sessionId) return;
    writeAssistantSessionMessages(accountId, sessionId, messages);
  }, [messages, sessionId, accountId]);

  useEffect(() => {
    if (!accountId || !sessionId) return;
    writeAssistantStickySession(accountId, sessionId);
  }, [sessionId, accountId]);

  const appendAssistant = useCallback((text: string) => {
    streamBuf.current = "";
    setStreaming("");
    setPending((n) => Math.max(0, n - 1));
    setMessages((prev) => [
      ...prev,
      { role: "assistant", content: text, at: Date.now() },
    ]);
  }, []);

  useEffect(() => {
    if (!enabled || !accountId) {
      wsRef.current?.close();
      wsRef.current = null;
      setConnected(false);
      return;
    }

    const uid = (getStoredUserId() ?? "").trim();
    const qs =
      uid && uid !== "system" ? `?userId=${encodeURIComponent(uid)}` : "";
    const ws = new WebSocket(`${getWsBase()}${qs}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      const sid = sessionIdRef.current;
      if (sid?.startsWith("asst:")) {
        ws.send(JSON.stringify({ type: "load_session", sessionId: sid }));
      } else {
        ws.send(JSON.stringify({ type: "new_session", channel: "assistant" }));
      }
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as Record<string, unknown>;
        const t = msg.type as string;
        if (t === "history") {
          setPending(0);
          const data = msg.data as { role: string; content: string }[];
          setMessages(
            (data || []).map((m) => ({
              role: m.role === "user" ? "user" : "assistant",
              content: m.content,
            })),
          );
          return;
        }
        if (t === "session_created") {
          setPending(0);
          const sid = String(msg.sessionId ?? "");
          if (!sid.startsWith("asst:")) return;
          sessionIdRef.current = sid;
          setSessionId(sid);
          writeAssistantStickySession(accountId, sid);
          ws.send(JSON.stringify({ type: "load_session", sessionId: sid }));
          return;
        }
        if (t === "text_chunk") {
          streamBuf.current += String(msg.text ?? "");
          setStreaming(streamBuf.current);
          return;
        }
        if (t === "text" || t === "error") {
          appendAssistant(
            t === "error"
              ? String(msg.message ?? "Something went wrong.")
              : String(msg.text ?? ""),
          );
        }
      } catch {
        /* ignore */
      }
    };

    ws.onclose = () => {
      setConnected(false);
      setPending(0);
    };
    ws.onerror = () => {
      setConnected(false);
      setPending(0);
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [enabled, accountId, appendAssistant]);

  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !accountId) return false;
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return false;
      const sid = sessionIdRef.current;
      if (!sid?.startsWith("asst:")) return false;

      setMessages((prev) => [
        ...prev,
        { role: "user", content: trimmed, at: Date.now() },
      ]);
      streamBuf.current = "";
      setStreaming("");
      setPending((n) => n + 1);
      ws.send(
        JSON.stringify({
          type: "text",
          text: trimmed,
          sessionId: sid,
        }),
      );
      return true;
    },
    [accountId],
  );

  const startNewSession = useCallback(() => {
    if (!accountId) return;
    const prev = sessionIdRef.current;
    if (prev) writeAssistantSessionMessages(accountId, prev, messages);

    streamBuf.current = "";
    setStreaming("");
    setPending(0);
    setMessages([]);
    sessionIdRef.current = null;
    setSessionId(null);
    writeAssistantStickySession(accountId, null);

    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "new_session", channel: "assistant" }));
    }
  }, [accountId, messages]);

  return {
    accountId,
    identityErr,
    messages,
    streaming,
    pending,
    connected,
    sessionId,
    sendMessage,
    startNewSession,
  };
}
