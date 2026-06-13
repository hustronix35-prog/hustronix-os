"use client";

import {
  Brain,
  Check,
  CheckCircle2,
  ClipboardList,
  ChevronDown,
  ChevronRight,
  Clock,
  History,
  LayoutPanelLeft,
  Loader2,
  MessageSquare,
  MessagesSquare,
  MoreHorizontal,
  PencilLine,
  Plus,
  ScanSearch,
  Send,
  Settings,
  Trash2,
  User,
  XCircle,
  Zap,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ChatMessageContent } from "@/components/chat/ChatMessageContent";
import { MarkdownText } from "@/components/ui/markdown-text";
import { hasChatMcqBlock } from "@/lib/chat-mcq";
import { SectionTitle } from "@/components/ui/section-title";
import { StatusBadge } from "@/components/ui/status-badge";
import { chatTimeline } from "@/data/chat";
import {
  chatLocalStorageKeys,
  chatSessionStorageKeys,
  deleteStoredSessionMessages,
  purgeLegacyUnscopedChatBrowserStorage,
  readRecents,
  readStickySessionId,
  readStoredSessionMessages,
  writeRecents,
  writeStickySessionId,
  writeStoredSessionMessages,
  type ChatMsg,
  type ChatRecentSession,
} from "@/lib/chatStorage";
import { apiGet, getStoredUserId, getWsBase } from "@/lib/api";
import { cn } from "@/lib/cn";

const FALLBACK_STEPS = [
  "Collecting",
  "Processing",
  "Decision Ready",
  "Executing",
] as const;

function deriveSessionTitle(messages: ChatMsg[]): string {
  const u = messages.find((m) => m.role === "user");
  const raw = u?.content?.trim() ?? "";
  if (!raw) return "New chat";
  const oneLine = raw.split(/\n/)[0]?.trim() ?? raw;
  return oneLine.length > 56 ? `${oneLine.slice(0, 54)}…` : oneLine;
}

function formatChatTime(at?: number): string | null {
  if (at == null || !Number.isFinite(at)) return null;
  try {
    return new Date(at).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return null;
  }
}

/** Only surface ledger / execution CTAs for substantive operational replies , not errors or idle chatter. */
function shouldOfferLedgerActions(text: string): boolean {
  const t = text.trim();
  if (t.length < 80) return false;
  const lower = t.toLowerCase();
  if (
    /^\[error\]|could not reach any configured llm|model id was rejected|check anthropic_api_key/i.test(
      t,
    )
  ) {
    return false;
  }
  if (
    /\b(no steps to execute|nothing new to execute|no action taken|there are no steps|there is nothing new|no steps are pending|nothing is pending confirmation)\b/i.test(
      t,
    )
  ) {
    return false;
  }
  if (
    /\b(standing by for|bring me that number|only input that unlocks|no prior proposal is visible|please clarify one of the following|before i proceed, i need)\b/i.test(
      lower,
    )
  ) {
    return false;
  }
  if (
    /\b(execution chain|operational status|signal gates|task id\b|log_strategic_decision|pending downstream|recommendation:\s*kill|confirm kills)\b/i.test(
      lower,
    )
  ) {
    return true;
  }
  const hexIds = t.match(/\b[a-f0-9]{8}\b/gi);
  if (hexIds && hexIds.length >= 4) return true;
  return false;
}

type ChatSidebarPayload = {
  context: {
    title: string;
    description: string;
    decisionStatus: string | null;
    decisionId: string | null;
  };
  signals: {
    total: number;
    bySource: { name: string; count: number; source: string }[];
  };
  pipeline: {
    stepIndex: number;
    steps: string[];
  };
  memory: string[];
  inspector: {
    title: string;
    why: string;
    factors: string[];
    impact: string;
    roi: string;
    confidence: number;
  } | null;
};

export default function ChatClient() {
  const { push } = useRouter();
  const [assistantExpanded, setAssistantExpanded] = useState<Record<string, boolean>>({});
  const [input, setInput] = useState("");
  /** Cursor-style plan turn: agent asks clarifying questions before ledger/tools. */
  const [planMode, setPlanMode] = useState(false);
  const [live, setLive] = useState<ChatMsg[]>([]);
  const [streaming, setStreaming] = useState("");
  /** User messages sent awaiting one assistant completion (text / error). */
  const [pendingReplies, setPendingReplies] = useState(0);
  const [connected, setConnected] = useState(false);
  const [sessionId, setSessionId] = useState("default");
  const wsRef = useRef<WebSocket | null>(null);
  const streamBuf = useRef("");
  const sessionIdRef = useRef("default");
  const transcriptScrollRef = useRef<HTMLDivElement>(null);
  const historyScrollRef = useRef<HTMLDivElement>(null);
  const recentsMenuRef = useRef<HTMLDivElement>(null);

  const [showContext, setShowContext] = useState(true);
  const [showInspector, setShowInspector] = useState(true);
  const [inspectorPanel, setInspectorPanel] = useState<"decision" | "history">(
    "decision",
  );
  const [recents, setRecents] = useState<ChatRecentSession[]>([]);
  const [recentsExpanded, setRecentsExpanded] = useState(true);
  const [recentsMenuId, setRecentsMenuId] = useState<string | null>(null);
  /** Authenticated account for namespaced chat browser storage (from `/api/me`). */
  const [chatAccountId, setChatAccountId] = useState<string | null>(null);
  const [chatIdentityErr, setChatIdentityErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await apiGet<{ user: { id: string } }>("/api/me");
        if (cancelled) return;
        purgeLegacyUnscopedChatBrowserStorage();
        setChatAccountId(data.user.id);
        setChatIdentityErr(null);
      } catch (e: unknown) {
        if (cancelled) return;
        setChatIdentityErr(e instanceof Error ? e.message : "Could not resolve account");
        setChatAccountId(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!chatAccountId) return;
    try {
      const sk = chatSessionStorageKeys(chatAccountId);
      const c = sessionStorage.getItem(sk.panelCtx);
      const i = sessionStorage.getItem(sk.panelInsp);
      if (c !== null) setShowContext(c === "1");
      if (i !== null) setShowInspector(i === "1");
    } catch {
      /* ignore */
    }
  }, [chatAccountId]);

  useEffect(() => {
    if (!chatAccountId) return;
    try {
      const sk = chatSessionStorageKeys(chatAccountId);
      sessionStorage.setItem(sk.panelCtx, showContext ? "1" : "0");
      sessionStorage.setItem(sk.panelInsp, showInspector ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [showContext, showInspector, chatAccountId]);

  useEffect(() => {
    if (!chatAccountId) return;
    try {
      const sk = chatSessionStorageKeys(chatAccountId);
      const t = sessionStorage.getItem(sk.inspectorTab);
      if (t === "history" || t === "decision") setInspectorPanel(t);
    } catch {
      /* ignore */
    }
  }, [chatAccountId]);

  useEffect(() => {
    if (!chatAccountId) return;
    try {
      const sk = chatSessionStorageKeys(chatAccountId);
      sessionStorage.setItem(sk.inspectorTab, inspectorPanel);
    } catch {
      /* ignore */
    }
  }, [inspectorPanel, chatAccountId]);

  useEffect(() => {
    if (!chatAccountId) return;
    if (live.length === 0) return;
    writeStoredSessionMessages(chatAccountId, sessionId, live);
  }, [live, sessionId, chatAccountId]);

  useEffect(() => {
    if (!chatAccountId) return;
    if (sessionId === "default") return;
    const t = window.setTimeout(() => {
      setLive((prev) => {
        if (prev.length > 0) return prev;
        const stored = readStoredSessionMessages(chatAccountId, sessionId);
        return stored.length ? stored : prev;
      });
    }, 700);
    return () => window.clearTimeout(t);
  }, [sessionId, chatAccountId]);

  useEffect(() => {
    if (!chatAccountId) return;
    let list = readRecents(chatAccountId);
    if (list.length === 0 && typeof window !== "undefined") {
      try {
        const raw = localStorage.getItem(chatLocalStorageKeys(chatAccountId).sessionMessages);
        if (raw) {
          const map = JSON.parse(raw) as Record<string, ChatMsg[]>;
          list = Object.entries(map)
            .filter(
              ([id, msgs]) =>
                id !== "default" && Array.isArray(msgs) && msgs.length > 0,
            )
            .map(([id, msgs]) => ({
              id,
              title: deriveSessionTitle(msgs),
              updatedAt: Math.max(
                0,
                ...msgs.map((m) => (typeof m.at === "number" ? m.at : 0)),
              ),
            }))
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .slice(0, 50);
          if (list.length) writeRecents(chatAccountId, list);
        }
      } catch {
        /* ignore */
      }
    }
    setRecents(list);
    try {
      const sk = chatSessionStorageKeys(chatAccountId);
      const ex = sessionStorage.getItem(sk.recentsExpanded);
      if (ex === "0") setRecentsExpanded(false);
    } catch {
      /* ignore */
    }
  }, [chatAccountId]);

  useEffect(() => {
    if (!chatAccountId) return;
    if (!sessionId || sessionId === "default") return;
    setRecents((prev) => {
      const title = deriveSessionTitle(live);
      const next = prev.filter((r) => r.id !== sessionId);
      next.unshift({
        id: sessionId,
        title,
        updatedAt: Date.now(),
      });
      next.sort((a, b) => b.updatedAt - a.updatedAt);
      const trimmed = next.slice(0, 50);
      writeRecents(chatAccountId, trimmed);
      return trimmed;
    });
  }, [live, sessionId, chatAccountId]);

  useEffect(() => {
    if (!chatAccountId) return;
    try {
      const sk = chatSessionStorageKeys(chatAccountId);
      sessionStorage.setItem(sk.recentsExpanded, recentsExpanded ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [recentsExpanded, chatAccountId]);

  useEffect(() => {
    if (recentsMenuId === null) return;
    const close = (e: MouseEvent) => {
      const el = recentsMenuRef.current;
      if (el && !el.contains(e.target as Node)) setRecentsMenuId(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [recentsMenuId]);

  useEffect(() => {
    if (inspectorPanel !== "history") setRecentsMenuId(null);
  }, [inspectorPanel]);

  useEffect(() => {
    if (!chatAccountId) return;
    const sticky = readStickySessionId(chatAccountId);
    if (!sticky) return;
    sessionIdRef.current = sticky;
    setSessionId(sticky);
    setLive(readStoredSessionMessages(chatAccountId, sticky));
  }, [chatAccountId]);

  useEffect(() => {
    if (!chatAccountId) return;
    if (!sessionId || sessionId === "default") return;
    writeStickySessionId(chatAccountId, sessionId);
  }, [sessionId, chatAccountId]);

  const [sidebar, setSidebar] = useState<ChatSidebarPayload | null>(null);
  const [sidebarErr, setSidebarErr] = useState<string | null>(null);

  const loadSidebar = useCallback(async () => {
    try {
      const data = await apiGet<ChatSidebarPayload>("/api/chat/sidebar");
      setSidebar(data);
      setSidebarErr(null);
    } catch (e: unknown) {
      setSidebarErr(e instanceof Error ? e.message : "Could not load sidebar");
    }
  }, []);

  useEffect(() => {
    void loadSidebar();
    const id = window.setInterval(() => void loadSidebar(), 45_000);
    return () => window.clearInterval(id);
  }, [loadSidebar]);

  useEffect(() => {
    void loadSidebar();
  }, [sessionId, loadSidebar]);

  useEffect(() => {
    setAssistantExpanded({});
  }, [sessionId]);

  const appendAssistantFinal = useCallback(
    (text: string) => {
      streamBuf.current = "";
      setStreaming("");
      setPendingReplies((n) => Math.max(0, n - 1));
      setLive((prev) => [
        ...prev,
        { role: "assistant", content: text, at: Date.now() },
      ]);
      void loadSidebar();
    },
    [loadSidebar],
  );

  const sendUserPayload = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!chatAccountId) return false;
      if (
        !trimmed ||
        !wsRef.current ||
        wsRef.current.readyState !== WebSocket.OPEN
      ) {
        return false;
      }
      setLive((prev) => [
        ...prev,
        { role: "user", content: trimmed, at: Date.now() },
      ]);
      streamBuf.current = "";
      setStreaming("");
      setPendingReplies((n) => n + 1);
      wsRef.current.send(
        JSON.stringify({
          type: "text",
          text: trimmed,
          sessionId: sessionIdRef.current,
          ...(planMode ? { planMode: true } : {}),
        }),
      );
      void loadSidebar();
      return true;
    },
    [loadSidebar, chatAccountId, planMode],
  );

  const activateRecent = useCallback(
    (id: string) => {
      if (!chatAccountId) return;
      if (id === sessionId) {
        setRecentsMenuId(null);
        return;
      }
      streamBuf.current = "";
      setStreaming("");
      setPendingReplies(0);
      sessionIdRef.current = id;
      setSessionId(id);
      writeStickySessionId(chatAccountId, id);
      setRecentsMenuId(null);
      setLive(readStoredSessionMessages(chatAccountId, id));
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "load_session", sessionId: id }));
      }
    },
    [sessionId, chatAccountId],
  );

  const deleteRecentSession = useCallback(
    (id: string) => {
      if (!chatAccountId) return;
      setRecentsMenuId(null);
      deleteStoredSessionMessages(chatAccountId, id);
      setRecents((prev) => {
        const next = prev.filter((r) => r.id !== id);
        writeRecents(chatAccountId, next);
        if (id === sessionId) {
          const pick = next[0]?.id;
          window.setTimeout(() => {
            streamBuf.current = "";
            setStreaming("");
            setPendingReplies(0);
            if (pick) {
              sessionIdRef.current = pick;
              setSessionId(pick);
              setLive(readStoredSessionMessages(chatAccountId, pick));
              wsRef.current?.send(
                JSON.stringify({ type: "load_session", sessionId: pick }),
              );
            } else {
              writeStickySessionId(chatAccountId, null);
              setLive([]);
              wsRef.current?.send(JSON.stringify({ type: "new_session" }));
            }
          }, 0);
        }
        return next;
      });
    },
    [sessionId, chatAccountId],
  );

  useEffect(() => {
    if (!chatAccountId) return;
    // Rely on `hustronix_session` cookie for WS auth. Do not send `?userId=system`
    // (the localStorage default): when the cookie is not visible to the WS host,
    // that used to collapse every browser onto the shared `system` message bucket.
    const uid = (getStoredUserId() ?? "").trim();
    const qs =
      uid && uid !== "system"
        ? `?userId=${encodeURIComponent(uid)}`
        : "";
    const url = `${getWsBase()}${qs}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      const sid = sessionIdRef.current;
      const resume = sid && sid !== "default" && sid.length >= 8;
      if (resume) {
        ws.send(JSON.stringify({ type: "load_session", sessionId: sid }));
      } else {
        ws.send(JSON.stringify({ type: "new_session" }));
      }
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as Record<string, unknown>;
        const t = msg.type as string;
        if (t === "history") {
          setPendingReplies(0);
          const data = msg.data as { role: string; content: string }[];
          setLive(
            (data || []).map((m) => ({
              role: m.role === "user" ? "user" : "assistant",
              content: m.content,
            })),
          );
          return;
        }
        if (t === "session_created") {
          setPendingReplies(0);
          const sid = msg.sessionId as string;
          sessionIdRef.current = sid;
          setSessionId(sid);
          writeStickySessionId(chatAccountId, sid);
          ws.send(JSON.stringify({ type: "load_session", sessionId: sid }));
          return;
        }
        if (t === "text_chunk") {
          const chunk = String(msg.text ?? "");
          streamBuf.current += chunk;
          setStreaming(streamBuf.current);
          return;
        }
        if (t === "text") {
          appendAssistantFinal(String(msg.text ?? ""));
          return;
        }
        if (t === "error") {
          appendAssistantFinal(String(msg.message ?? "Something went wrong."));
          return;
        }
      } catch {
        /* ignore */
      }
    };

    ws.onclose = () => {
      setConnected(false);
      setPendingReplies(0);
    };
    ws.onerror = () => {
      setConnected(false);
      setPendingReplies(0);
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [appendAssistantFinal, chatAccountId]);

  useEffect(() => {
    if (!chatAccountId) return;
    try {
      const sk = chatSessionStorageKeys(chatAccountId);
      const raw = sessionStorage.getItem(sk.seed);
      if (!raw) return;
      sessionStorage.removeItem(sk.seed);
      const parsed = JSON.parse(raw) as { hint?: string };
      const hint = typeof parsed.hint === "string" ? parsed.hint.trim() : "";
      if (!hint) return;
      setInput((prev) => {
        const p = prev.trim();
        return p ? `${hint}\n${p}` : hint;
      });
    } catch {
      /* ignore */
    }
  }, [chatAccountId]);

  useLayoutEffect(() => {
    const el = transcriptScrollRef.current;
    if (!el) return;
    const snap = () => {
      el.scrollTop = el.scrollHeight;
    };
    requestAnimationFrame(() => requestAnimationFrame(snap));
  }, [live, streaming, pendingReplies, sessionId]);

  useLayoutEffect(() => {
    if (inspectorPanel !== "history") return;
    const el = historyScrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [live, streaming, sessionId, inspectorPanel]);

  function prependComposer(prefix: string) {
    setInput((prev) => {
      const p = prev.trim();
      return p ? `${prefix}\n${p}` : prefix;
    });
  }

  function sendText() {
    const text = input.trim();
    if (!sendUserPayload(text)) return;
    setInput("");
  }

  const ins = sidebar?.inspector;
  const signalBadges = (sidebar?.signals.bySource ?? []).slice(0, 6);

  const ctxLedger = (() => {
    if (sidebarErr) return { label: "Sync error", variant: "danger" as const };
    if (!sidebar) return { label: "Loading", variant: "neutral" as const };
    const st = sidebar.context.decisionStatus;
    if (!st) return { label: "No decision", variant: "neutral" as const };
    const variantMap: Record<
      string,
      "success" | "warning" | "accent" | "neutral"
    > = {
      ACTIVE: "success",
      DRAFT: "warning",
      UNDER_REVIEW: "warning",
      COMPLETED: "accent",
    };
    const variant = variantMap[st] ?? "neutral";
    const label =
      st === "UNDER_REVIEW"
        ? "Review"
        : st === "DRAFT"
          ? "Draft"
          : st.replace(/_/g, " ");
    return { label, variant };
  })();

  const awaitingAssistant = pendingReplies > 0;
  const lastLive = live.length > 0 ? live[live.length - 1] : null;
  const showExecConfirmation =
    lastLive?.role === "assistant" &&
    !streaming &&
    !awaitingAssistant &&
    shouldOfferLedgerActions(lastLive.content);

  function openExecuteFromChat() {
    push("/execute?tab=ACTIVE&from=chat");
  }

  function confirmExecuteAndNavigate() {
    try {
      sessionStorage.setItem("hx_execute_banner_from_chat", "1");
    } catch {
      /* ignore */
    }
    void sendUserPayload(
      "[Execution confirmation] Proceed with the proposed steps as discussed.",
    );
    openExecuteFromChat();
  }

  function confirmExecuteInChatOnly() {
    void sendUserPayload(
      "[Execution confirmation] Proceed with the proposed steps as discussed.",
    );
  }

  function holdExecute() {
    void sendUserPayload(
      "[Execution hold] Do not execute yet , I need to revisit scope or constraints.",
    );
  }

  return (
    <>
    {chatIdentityErr && (
      <div className="shrink-0 border-b border-hx-border bg-red-950/30 px-4 py-2 text-sm text-red-200 lg:px-6">
        {chatIdentityErr}
      </div>
    )}
    {!chatIdentityErr && chatAccountId === null && (
      <div className="shrink-0 border-b border-hx-border px-4 py-2 text-sm text-hx-muted lg:px-6">
        Resolving account…
      </div>
    )}
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-hx-border px-4 py-2.5 lg:px-6 lg:py-3">
        <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <MessageSquare className="size-4 shrink-0 text-hx-accent" />
              <h1 className="text-lg font-bold tracking-wide text-hx-text sm:text-xl">Chat</h1>
              <StatusBadge variant={connected ? "success" : "danger"} dot>
                {connected ? "Live" : "Offline"}
              </StatusBadge>
            </div>
            <p className="mt-0 text-xs leading-tight text-hx-muted sm:text-[13px] sm:leading-snug">
              Each chat keeps its own history. Replies show up here as they are written.
            </p>
          </div>
          <div className="flex max-w-full items-center justify-start gap-1.5 max-sm:flex-wrap sm:shrink-0 sm:flex-nowrap sm:justify-end [&>button]:shrink-0">
            <Button
              variant={showContext ? "outlineGold" : "outline"}
              size="sm"
              type="button"
              data-tour="chat-context"
              title={
                showContext ? "Hide context panel (more room for chat)" : "Show context panel"
              }
              onClick={() => setShowContext((v) => !v)}
              className="gap-1.5"
            >
              <LayoutPanelLeft className="size-4 shrink-0" />
              <span className="hidden sm:inline">Context</span>
            </Button>
            <Button
              variant={showInspector ? "outlineGold" : "outline"}
              size="sm"
              type="button"
              title={
                showInspector
                  ? "Hide decision inspector (more room for chat)"
                  : "Show decision inspector"
              }
              onClick={() => setShowInspector((v) => !v)}
              className="gap-1.5"
            >
              <ScanSearch className="size-4 shrink-0" />
              <span className="hidden sm:inline">Inspector</span>
            </Button>
            <Button
              variant="outlineGold"
              size="sm"
              type="button"
              onClick={() => {
                if (!chatAccountId) return;
                writeStickySessionId(chatAccountId, null);
                streamBuf.current = "";
                setStreaming("");
                setPendingReplies(0);
                setLive([]);
                sessionIdRef.current = "default";
                setSessionId("default");
                wsRef.current?.send(JSON.stringify({ type: "new_session" }));
              }}
            >
              <Plus className="size-4" />
              New Context
            </Button>
            <Button
              variant="outline"
              size="sm"
              type="button"
              title="Open workspace settings"
              onClick={() => push("/settings")}
            >
              <Settings className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              type="button"
              title="Insert follow-up timestamp hint"
              onClick={() =>
                prependComposer(
                  `[Follow-up ${new Date().toISOString().slice(0, 16)}] `,
                )
              }
            >
              <Clock className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Main + side panels: flex-1 fills space above the composer (no fake padding band) */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden lg:flex-row lg:items-stretch">
        <aside
          data-tour="chat-context"
          className={cn(
            "scrollbar-hide flex min-h-0 shrink-0 flex-col overscroll-contain border-b border-hx-border bg-hx-bg transition-[width,opacity,border-color] duration-300 ease-out",
            showContext
              ? "scrollbar-hide max-h-[38vh] w-full overflow-y-auto lg:max-h-full lg:w-72 lg:border-b-0 lg:border-r"
              : "hidden lg:flex lg:h-auto lg:max-h-full lg:w-0 lg:min-w-0 lg:overflow-hidden lg:border-0 lg:opacity-0 lg:pointer-events-none",
          )}
        >
          <div className="flex min-w-[18rem] flex-col gap-4 p-4 lg:min-w-0 lg:p-6">
          <Card>
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold text-hx-text">Context</h2>
              <StatusBadge variant={ctxLedger.variant} dot>
                {ctxLedger.label}
              </StatusBadge>
            </div>
            {sidebarErr && (
              <p className="mt-2 text-xs text-hx-danger">{sidebarErr}</p>
            )}
            <p className="mt-2 font-medium leading-snug text-hx-text">
              {sidebar?.context.title ?? (sidebarErr ? "Could not sync" : "Loading…")}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-hx-muted">
              {sidebar?.context.description ??
                "Pulls your latest decision vow and outcomes from the ledger."}
            </p>
          </Card>

          <Card>
            <div className="flex items-center justify-between">
              <SectionTitle>Active Signals</SectionTitle>
              <span className="text-lg font-bold text-hx-accent">
                {sidebar?.signals.total ?? ","}
              </span>
            </div>
            <ul className="mt-3 space-y-2 text-sm">
              {!sidebar ? (
                <li className="py-2 text-hx-muted">Loading…</li>
              ) : sidebar.signals.bySource.length === 0 ? (
                <li className="py-2 text-xs text-hx-muted">
                  No UNVERIFIED / GRACE signals for your tenant.
                </li>
              ) : (
                sidebar.signals.bySource.map((s) => (
                  <li
                    key={s.source}
                    className="flex justify-between border-b border-hx-border border-opacity-50 py-2 last:border-0"
                  >
                    <span className="text-hx-muted">{s.name}</span>
                    <span className="font-medium">{s.count}</span>
                  </li>
                ))
              )}
            </ul>
          </Card>

          <Card>
            <SectionTitle>Decision State</SectionTitle>
            <p className="mt-1 text-[11px] text-hx-muted">
              Derived from ledger + execution load (refreshes automatically).
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {(() => {
                const pipeList =
                  sidebar?.pipeline.steps?.length === 4
                    ? sidebar.pipeline.steps
                    : [...FALLBACK_STEPS];
                const activeIdx = sidebar?.pipeline.stepIndex ?? 0;
                return pipeList.map((s, i) => (
                  <div key={s} className="flex items-center gap-2">
                    <span
                      className={cn(
                        "rounded-full px-2 py-1 text-xs font-semibold",
                        i === activeIdx
                          ? "bg-hx-accent/20 text-hx-accent"
                          : "bg-hx-surface-elevated text-hx-muted",
                      )}
                    >
                      {s}
                    </span>
                    {i < pipeList.length - 1 && (
                      <span className="text-hx-muted">→</span>
                    )}
                  </div>
                ));
              })()}
            </div>
          </Card>

          <Card>
            <SectionTitle>Memory Snapshot</SectionTitle>
            <ul className="mt-3 list-inside list-disc space-y-2 text-sm text-hx-muted">
              {(sidebar?.memory?.length
                ? sidebar.memory
                : [
                    "No core memory yet , the agent saves facts with remember_fact.",
                  ]
              ).map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </Card>
          </div>
        </aside>

        <main
          className={cn(
            "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-b border-hx-border bg-hx-bg lg:min-w-0 lg:border-b-0",
            showInspector && "lg:border-r",
          )}
        >
          <div
            ref={transcriptScrollRef}
            className="scrollbar-hide flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 pt-6 pb-4 sm:px-6"
          >
            <div
              className={cn(
                "w-full min-w-0 transition-[max-width] duration-300 ease-out",
                !showContext && !showInspector
                  ? "mx-auto max-w-[min(80rem,80vw)]"
                  : "max-w-full",
              )}
            >
            {live.length === 0 && !streaming && !awaitingAssistant ? (
              <div className="flex min-h-[min(42vh,22rem)] flex-col items-center justify-center px-4 py-12 text-center sm:py-16">
                <p className="max-w-lg text-balance text-xl font-medium tracking-tight text-hx-text sm:text-2xl">
                  {"You're all set,let's get started."}
                </p>
                <p className="mt-3 max-w-md text-sm leading-relaxed text-hx-muted">
                  {
                    "What would you like to explore first? Type below and we will pick it up from there."
                  }
                </p>
              </div>
            ) : null}
            {live.length > 0 || streaming || awaitingAssistant ? (
            <section aria-label="Chat timeline" className="shrink-0">
              <p className="text-xs font-semibold uppercase tracking-widest text-hx-muted">
                Timeline
              </p>
              <p className="mt-1 text-[11px] text-hx-muted">
                Session <span className="font-mono text-hx-text">{sessionId.slice(0, 8)}</span>
                … · One rail , signals, synthesis, decisions, and your messages.
              </p>
              <div className="relative mt-6 space-y-6 border-l border-hx-border pl-6">
                <div className="relative">
                  <span className="absolute -left-[25px] top-0 size-3 rounded-full border-2 border-hx-border bg-hx-bg" />
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-hx-muted">
                    Context snapshot
                  </p>
                </div>
                {chatTimeline.map((ev) => (
                  <div key={`demo-${ev.type}-${ev.time}-${ev.text}`} className="relative">
                    <span className="absolute -left-[25px] top-1 flex size-3 rounded-full border-2 border-hx-accent bg-hx-bg" />
                    <p className="text-xs text-hx-muted">{ev.time}</p>
                    {ev.type === "signal" && (
                      <Card className="mt-2">
                        <div className="flex items-center gap-2 text-sm text-hx-muted">
                          <MessagesSquare className="size-4" />
                          {ev.source}
                        </div>
                        <p className="mt-2 text-sm text-hx-text">{ev.text}</p>
                      </Card>
                    )}
                    {ev.type === "synthesis" && (
                      <Card className="mt-2 border-hx-accent/30">
                        <div className="flex items-center gap-2 font-semibold text-hx-text">
                          <Brain className="size-4 text-hx-accent" />
                          {ev.text}
                        </div>
                        {"bullets" in ev &&
                          ev.bullets?.map((b) => (
                            <p key={b} className="mt-2 text-sm text-hx-muted">
                              • {b}
                            </p>
                          ))}
                      </Card>
                    )}
                    {ev.type === "decision" && (
                      <Card className="mt-2">
                        <p className="font-semibold text-hx-accent">{ev.text}</p>
                        {"confidence" in ev && (
                          <p className="mt-2 text-sm text-hx-muted">
                            Confidence {ev.confidence}%
                          </p>
                        )}
                      </Card>
                    )}
                    {ev.type === "execution" && (
                      <Card className="mt-2">
                        <p className="font-medium text-hx-text">{ev.text}</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            variant="outlineGold"
                            size="sm"
                            type="button"
                            onClick={() => push("/execute")}
                          >
                            View Actions
                          </Button>
                          <StatusBadge variant="warning">Ready to Execute</StatusBadge>
                        </div>
                      </Card>
                    )}
                  </div>
                ))}

                {(live.length > 0 || streaming || awaitingAssistant) && (
                  <div className="relative pt-2">
                    <span className="absolute -left-[25px] top-3 size-3 rounded-full border-2 border-dashed border-hx-accent/60 bg-hx-bg" />
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-hx-accent">
                      This session
                    </p>
                  </div>
                )}

                {live.map((m) => {
                  const t = formatChatTime(m.at);
                  return (
                    <div
                      key={`${sessionId}-${m.at ?? "n"}-${m.role}-${m.content.length}`}
                      className="relative"
                    >
                      <span
                        className={cn(
                          "absolute -left-[25px] top-1 flex size-3 rounded-full border-2 bg-hx-bg",
                          m.role === "user"
                            ? "border-hx-muted"
                            : "border-hx-accent",
                        )}
                      />
                      <p className="text-xs text-hx-muted">
                        {t ?? ","}
                      </p>
                      {m.role === "user" ? (
                        <Card className="mt-2 border-hx-accent/35 bg-hx-surface-elevated">
                          <div className="flex items-center gap-2 text-sm text-hx-muted">
                            <User className="size-4" />
                            You
                          </div>
                          <MarkdownText className="mt-2 text-sm text-hx-text">
                            {m.content}
                          </MarkdownText>
                        </Card>
                      ) : (
                        <Card className="mt-2 border-hx-accent/30 bg-hx-bg">
                          <div className="flex items-center gap-2 text-sm font-semibold text-hx-text">
                            <Brain className="size-4 text-hx-accent" />
                            Assistant
                          </div>
                          {(() => {
                            const msgKey = `${sessionId}-${m.at ?? "n"}-${m.role}-${m.content.length}`;
                            const long = m.content.length > 2200;
                            const expanded = assistantExpanded[msgKey] ?? false;
                            return (
                              <div className="relative mt-2">
                                <div
                                  className={cn(
                                    long &&
                                      !expanded &&
                                      "max-h-[min(26rem,52vh)] overflow-hidden",
                                  )}
                                >
                                  <ChatMessageContent
                                    className="text-sm"
                                    content={m.content}
                                    mcqDisabled={awaitingAssistant}
                                    onMcqSubmit={(msg) => {
                                      void sendUserPayload(msg);
                                    }}
                                  />
                                </div>
                                {long && !expanded ? (
                                  <div
                                    className="pointer-events-none absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-hx-bg via-hx-bg/85 to-transparent"
                                    aria-hidden
                                  />
                                ) : null}
                                {long ? (
                                  <button
                                    type="button"
                                    className="relative z-[1] mt-2 text-xs font-medium text-hx-accent underline-offset-2 hover:underline"
                                    onClick={() =>
                                      setAssistantExpanded((prev) => ({
                                        ...prev,
                                        [msgKey]: !expanded,
                                      }))
                                    }
                                  >
                                    {expanded ? "Show less" : "Show full reply"}
                                  </button>
                                ) : null}
                              </div>
                            );
                          })()}
                        </Card>
                      )}
                    </div>
                  );
                })}
                {awaitingAssistant && !streaming && (
                  <div className="relative">
                    <span className="absolute -left-[25px] top-1 flex size-3 animate-pulse rounded-full border-2 border-hx-accent bg-hx-accent/30" />
                    <p className="text-xs text-hx-muted">Thinking</p>
                    <Card className="mt-2 border-hx-accent/25 bg-hx-bg">
                      <div className="flex items-center gap-2 text-sm font-medium text-hx-text">
                        <Loader2
                          className="size-4 shrink-0 animate-spin text-hx-accent"
                          aria-hidden
                        />
                        <span className="text-hx-muted">
                          Working through your request…
                        </span>
                      </div>
                    </Card>
                  </div>
                )}
                {streaming && (
                  <div className="relative">
                    <span className="absolute -left-[25px] top-1 flex size-3 animate-pulse rounded-full border-2 border-hx-accent bg-hx-accent/30" />
                    <p className="text-xs text-hx-muted">Live</p>
                    <Card className="mt-2 border-hx-accent/30 bg-hx-bg">
                      <div className="flex items-center gap-2 text-sm font-semibold text-hx-text">
                        <Loader2
                          className="size-4 shrink-0 animate-spin text-hx-accent"
                          aria-hidden
                        />
                        Writing…
                      </div>
                      {hasChatMcqBlock(streaming) ? (
                        <ChatMessageContent
                          className="mt-2 text-sm opacity-95"
                          content={streaming}
                          mcqDisabled
                        />
                      ) : (
                        <MarkdownText className="mt-2 text-sm opacity-95">
                          {streaming}
                        </MarkdownText>
                      )}
                    </Card>
                  </div>
                )}
              </div>
            </section>
            ) : null}
            </div>
          </div>
        </main>

        <aside
          data-tour="chat-inspector"
          className={cn(
            "flex min-h-0 shrink-0 flex-col overflow-hidden border-t border-hx-border bg-hx-surface transition-[width,opacity,border-color] duration-300 ease-out",
            showInspector
              ? "max-h-[40vh] w-full lg:flex lg:h-auto lg:max-h-none lg:w-80 lg:flex-col lg:border-l lg:border-t-0"
              : "hidden lg:flex lg:w-0 lg:min-w-0 lg:max-h-full lg:overflow-hidden lg:border-0 lg:opacity-0 lg:pointer-events-none",
          )}
        >
          <div className="shrink-0 border-b border-hx-border bg-hx-surface px-3 py-2.5 lg:px-4">
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <SectionTitle className="min-w-0 flex-1">Decision Inspector</SectionTitle>
              <div
                className="flex shrink-0 rounded-lg border border-hx-border bg-hx-surface-elevated p-0.5"
                role="tablist"
                aria-label="Inspector panel"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={inspectorPanel === "decision"}
                  className={cn(
                    "rounded-md px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition",
                    inspectorPanel === "decision"
                      ? "bg-hx-accent/20 text-hx-accent"
                      : "text-hx-muted hover:text-hx-text",
                  )}
                  onClick={() => setInspectorPanel("decision")}
                >
                  Decision
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={inspectorPanel === "history"}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition",
                    inspectorPanel === "history"
                      ? "bg-hx-accent/20 text-hx-accent"
                      : "text-hx-muted hover:text-hx-text",
                  )}
                  onClick={() => setInspectorPanel("history")}
                >
                  <History className="size-3.5" aria-hidden />
                  History
                  {recents.length > 0 ? (
                    <span className="tabular-nums text-[10px] opacity-80">
                      ({recents.length})
                    </span>
                  ) : null}
                </button>
              </div>
            </div>
            {inspectorPanel === "decision" ? (
              <>
                <p className="mt-2 text-base font-semibold leading-snug text-hx-accent sm:text-lg">
                  {ins?.title ??
                    (sidebar === null
                      ? "Loading…"
                      : "No decision in ledger yet")}
                </p>
                {sidebarErr && (
                  <p className="mt-0.5 text-xs text-hx-danger">{sidebarErr}</p>
                )}
              </>
            ) : (
              <p className="mt-2 text-xs leading-snug text-hx-muted">
                Recent conversations in this browser , pick one to continue, or use{" "}
                <span className="font-medium text-hx-text">New Context</span> above.
              </p>
            )}
          </div>
          {inspectorPanel === "decision" ? (
            <div className="scrollbar-hide max-h-[40vh] min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 text-sm lg:max-h-none lg:min-h-0">
              <div>
                <p className="text-xs font-semibold uppercase text-hx-muted">
                  Why this decision?
                </p>
                <MarkdownText muted className="mt-1 text-sm leading-relaxed">
                  {ins?.why ??
                    "Connect to the API to sync the active or latest decision from your ledger."}
                </MarkdownText>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-hx-muted">
                  Signals Used
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {signalBadges.length > 0 ? (
                    signalBadges.map((s) => (
                      <span
                        key={s.source}
                        title={`${s.name}: ${s.count}`}
                        className="flex size-9 items-center justify-center rounded-full border border-hx-border text-xs font-bold text-hx-accent"
                      >
                        {s.name.slice(0, 1).toUpperCase()}
                      </span>
                    ))
                  ) : (
                    <p className="text-xs text-hx-muted">No signal sources in queue.</p>
                  )}
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-hx-muted">
                  Key Factors
                </p>
                <ul className="mt-2 space-y-2">
                  {(ins?.factors?.length
                    ? ins.factors
                    : [
                        "Log a decision with constraints and outcomes in Mission Control.",
                      ]
                  ).map((f) => (
                    <li key={f} className="flex gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-hx-accent" />
                      <MarkdownText muted variant="inline" className="flex-1 text-sm">
                        {f}
                      </MarkdownText>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-hx-muted">
                  Impact
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <StatusBadge
                    variant={
                      ins?.impact === "High"
                        ? "danger"
                        : ins?.impact === "Medium"
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {ins?.impact ?? ","}
                  </StatusBadge>
                  <span className="text-hx-muted">
                    {ins?.roi ?? ","}
                  </span>
                </div>
              </div>
              <div>
                <div className="mb-1 flex justify-between text-xs text-hx-muted">
                  <span>Confidence</span>
                  <span>{ins?.confidence ?? 0}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-hx-surface-elevated">
                  <div
                    className="h-full rounded-full bg-hx-accent"
                    style={{ width: `${Math.min(100, ins?.confidence ?? 0)}%` }}
                  />
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-hx-muted">
                  Related
                </p>
                <button
                  type="button"
                  onClick={() => push("/mission-control")}
                  className="mt-2 text-left text-sm font-semibold text-hx-accent hover:underline"
                >
                  Open Mission Control for full ledger →
                </button>
              </div>
            </div>
          ) : (
            <div
              ref={historyScrollRef}
              className="scrollbar-hide flex max-h-[40vh] min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overscroll-contain lg:max-h-none"
              role="tabpanel"
              aria-label="Recent chats"
            >
              <div ref={recentsMenuRef} className="flex min-h-0 flex-1 flex-col p-2 lg:px-3">
                <button
                  type="button"
                  onClick={() => setRecentsExpanded((e) => !e)}
                  className="mb-1 flex w-full shrink-0 items-center justify-between rounded-md px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-hx-muted transition hover:bg-hx-surface-elevated hover:text-hx-text"
                  aria-expanded={recentsExpanded}
                >
                  <span>Recents</span>
                  {recentsExpanded ? (
                    <ChevronDown className="size-3.5 shrink-0 opacity-70" aria-hidden />
                  ) : (
                    <ChevronRight className="size-3.5 shrink-0 opacity-70" aria-hidden />
                  )}
                </button>
                {recentsExpanded ? (
                  <ul className="flex flex-col gap-0.5 pb-2">
                    {recents.length === 0 ? (
                      <li className="p-2 text-xs leading-relaxed text-hx-muted">
                        Chats you open or start appear here. Titles follow your first message.
                        Stored locally in this browser (up to 50 threads).
                      </li>
                    ) : (
                      recents.map((r) => {
                        const active = r.id === sessionId;
                        return (
                          <li key={r.id} className="group">
                            <div
                              className={cn(
                                "flex min-h-[2.25rem] items-center rounded-md transition-colors",
                                active
                                  ? "bg-hx-surface-elevated"
                                  : "hover:bg-hx-surface-elevated/70",
                              )}
                            >
                              <button
                                type="button"
                                onClick={() => activateRecent(r.id)}
                                className={cn(
                                  "min-w-0 flex-1 truncate rounded-md py-1.5 pl-2 pr-1 text-left text-sm",
                                  active ? "text-hx-text" : "text-hx-text/90",
                                )}
                                title={r.title}
                              >
                                {r.title}
                              </button>
                              <button
                                type="button"
                                className={cn(
                                  "mr-0.5 shrink-0 rounded p-1 text-hx-muted transition hover:bg-hx-bg/50 hover:text-hx-text",
                                  active || recentsMenuId === r.id
                                    ? "opacity-100"
                                    : "opacity-0 group-hover:opacity-100 focus:opacity-100",
                                )}
                                aria-label={`More actions: ${r.title}`}
                                aria-expanded={recentsMenuId === r.id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setRecentsMenuId((m) => (m === r.id ? null : r.id));
                                }}
                              >
                                <MoreHorizontal className="size-4" aria-hidden />
                              </button>
                            </div>
                            {recentsMenuId === r.id ? (
                              <div
                                role="menu"
                                className="mt-0.5 rounded-md border border-hx-border bg-hx-bg/90 py-0.5 shadow-inner"
                              >
                                <button
                                  role="menuitem"
                                  type="button"
                                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-hx-danger hover:bg-hx-danger/10"
                                  onClick={() => deleteRecentSession(r.id)}
                                >
                                  <Trash2 className="size-3.5 shrink-0" aria-hidden />
                                  Delete chat
                                </button>
                              </div>
                            ) : null}
                          </li>
                        );
                      })
                    )}
                  </ul>
                ) : null}
              </div>
            </div>
          )}
        </aside>
        </div>
      </div>

      <div
        data-tour="chat-input"
        className="z-50 shrink-0 border-t border-hx-border bg-hx-surface/95 px-4 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-[0_-8px_28px_rgba(0,0,0,0.45)] backdrop-blur-sm lg:px-8"
        aria-label="Chat composer"
      >
          <div className="mx-auto flex w-full max-w-none flex-col gap-1.5 sm:gap-2">
            {showExecConfirmation ? (
              <div
                className="rounded-lg border border-hx-accent/40 bg-hx-surface-elevated px-3 py-2 sm:px-4"
                role="region"
                aria-label="Ledger actions"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                  <p className="min-w-0 text-[11px] leading-snug text-hx-muted">
                    <span className="font-semibold text-hx-text">Ledger</span> , One strip per
                    operational reply. Confirm here or continue in{" "}
                    <span className="text-hx-accent">Execute</span>.
                  </p>
                  <div className="flex shrink-0 flex-wrap gap-1.5">
                    <Button
                      variant="primary"
                      size="sm"
                      type="button"
                      className="gap-1"
                      title="Send confirmation and open Execute tab"
                      onClick={() => void confirmExecuteAndNavigate()}
                    >
                      <CheckCircle2 className="size-3.5 shrink-0" aria-hidden />
                      Confirm → Execute
                    </Button>
                    <Button
                      variant="outlineGold"
                      size="sm"
                      type="button"
                      className="gap-1"
                      title="Send confirmation without leaving chat"
                      onClick={() => void confirmExecuteInChatOnly()}
                    >
                      <Check className="size-3.5 shrink-0" aria-hidden />
                      Confirm
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      type="button"
                      className="gap-1"
                      title="Adjust scope before executing"
                      onClick={() =>
                        prependComposer("Before we execute, I want to adjust:\n")
                      }
                    >
                      <PencilLine className="size-3.5 shrink-0" aria-hidden />
                      Refine
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      type="button"
                      className="gap-1"
                      title="Pause execution"
                      onClick={() => void holdExecute()}
                    >
                      <XCircle className="size-3.5 shrink-0" aria-hidden />
                      Hold
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}
            <div className="flex min-w-0 flex-row items-stretch gap-2">
              <textarea
                rows={2}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (!awaitingAssistant) sendText();
                  }
                }}
                placeholder={
                  planMode
                    ? "Plan mode , describe the goal; the agent will ask clarifying questions first…"
                    : live.length === 0 && !streaming && !awaitingAssistant
                      ? "Ask anything"
                      : "Describe a problem, signal, or decision..."
                }
                className="min-h-[3.75rem] min-w-0 flex-1 resize-none rounded-lg border border-hx-border bg-hx-surface-elevated px-3 py-2 text-sm leading-snug text-hx-text placeholder:text-hx-muted focus:border-hx-accent focus:outline-none focus:ring-1 focus:ring-hx-accent"
              />
              <Button
                variant="primary"
                size="md"
                type="button"
                aria-label={
                  awaitingAssistant
                    ? "Assistant is responding"
                    : "Send message"
                }
                aria-busy={awaitingAssistant}
                title={
                  !connected
                    ? "Connect to send"
                    : awaitingAssistant
                      ? "Assistant is responding…"
                      : "Send (Enter)"
                }
                disabled={!input.trim() || !connected || awaitingAssistant}
                onClick={() => sendText()}
                className="w-11 shrink-0 rounded-lg px-0 py-2 shadow-sm sm:w-12"
              >
                {awaitingAssistant ? (
                  <Loader2
                    className="size-4 shrink-0 animate-spin sm:h-5 sm:w-5"
                    aria-hidden
                  />
                ) : (
                  <Send className="size-4 shrink-0 sm:h-5 sm:w-5" aria-hidden />
                )}
              </Button>
            </div>
          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
            <div className="flex flex-wrap gap-1.5">
            <Button
              variant="outline"
              size="sm"
              type="button"
              title="Insert checklist marker"
              onClick={() => prependComposer("- [ ] ")}
            >
              +
            </Button>
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => push("/signals")}
            >
              Attach Signal
            </Button>
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => prependComposer("[Slack thread context] ")}
            >
              Slack Thread
            </Button>
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => {
                const el = document.createElement("input");
                el.type = "file";
                el.accept = "text/*,.md,.txt";
                el.onchange = () => {
                  const f = el.files?.[0];
                  if (!f) return;
                  void f.text().then((t) =>
                    prependComposer(
                      `[Uploaded: ${f.name}]\n${t.slice(0, 8000)}`,
                    ),
                  );
                };
                el.click();
              }}
            >
              Upload File
            </Button>
            </div>
            <div className="flex flex-wrap gap-1.5 sm:justify-end">
              <Button
                variant={planMode ? "primary" : "outline"}
                size="sm"
                type="button"
                title="Plan mode , ask clarifying questions before decisions or execution (like Cursor Plan)"
                aria-pressed={planMode}
                onClick={() => setPlanMode((v) => !v)}
              >
                <ClipboardList className="size-4" aria-hidden />
                Plan
              </Button>
              <Button
                variant="outline"
                size="sm"
                type="button"
                onClick={() =>
                  prependComposer(
                    "Analyze risks, assumptions, and unknowns for:\n",
                  )
                }
              >
                Analyze
              </Button>
              <Button
                variant="outline"
                size="sm"
                type="button"
                onClick={() =>
                  prependComposer(
                    "Propose a decision with explicit tradeoffs:\n",
                  )
                }
              >
                Decide
              </Button>
              <Button
                variant="primary"
                size="sm"
                type="button"
                onClick={() =>
                  prependComposer(
                    "List minimal concrete execution steps with owners:\n",
                  )
                }
              >
                <Zap className="size-4" />
                Execute
              </Button>
            </div>
          </div>
          </div>
      </div>
    </div>
    </>
  );
}
