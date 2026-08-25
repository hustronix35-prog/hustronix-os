"use client";

import {
  AlertTriangle,
  Brain,
  Check,
  CircleHelp,
  Clock,
  FileText,
  Scale,
  GitBranch,
  ListChecks,
  Lock,
  Mic,
  Paperclip,
  Plus,
  Search,
  Send,
  Sparkles,
  Type,
} from "@/components/icons";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { AppShell, StatusIcon, TopBar } from "@/components/shell/AppShell";
import { HustronixMark } from "@/components/brand/HustronixMark";
import { Panel, PanelHeader, StatusPill } from "@/components/ui/Primitives";
import { useToast } from "@/components/ui/Interactions";
import {
  executeConsoleActions,
  fetchDecisions,
  fetchOrgConsole,
  talkToHustronix,
  type OrgConsole,
  type ProposedAction,
} from "@/lib/api";
import { openDecisionCount } from "@/lib/live-mappers";
import {
  chatCapabilities,
  chatDemoActions,
  chatDemoBlocker,
  chatDemoFindings,
  chatSeedRecents,
  chatStarters,
  profile,
} from "@/lib/mock-data";
import { useOsChat } from "@/lib/use-os-chat";
import { takeChatDraft } from "@/lib/chat-handoff";
import { ChatMessageContent } from "@/components/chat/ChatMessageContent";
import styles from "../pages.module.css";

const MEMORY_KEY = "hustronix_chat_memory";
const RECENTS_KEY = "hustronix_os_chat_recents";

type ChatRecent = { id: string; title: string; summary: string; when: string; day?: "today" | "week" };

const starterIcons: Record<string, ComponentType<{ size?: number }>> = {
  alert: AlertTriangle,
  search: Search,
  gavel: Scale,
  tasks: ListChecks,
  clock: Clock,
  file: FileText,
};

function readRecents(): ChatRecent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    const parsed = raw ? (JSON.parse(raw) as ChatRecent[]) : [];
    return Array.isArray(parsed) ? parsed.filter((r) => r?.id && r?.title) : [];
  } catch {
    return [];
  }
}

function writeRecents(items: ChatRecent[]) {
  try {
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(items.slice(0, 12)));
  } catch {
    /* ignore quota */
  }
}

function formatClock(d = new Date()) {
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function ownerRole(owner: string, people: OrgConsole["people"] | undefined) {
  const hit = people?.find((p) => p.owner === owner || p.name === owner);
  return hit?.role || hit?.team || "Owner";
}

function ChatPageInner() {
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const {
    messages,
    streaming,
    pending,
    sessionId,
    ensureSessionId,
    sendMessage: _sendMessage,
    newConversation,
    openSession,
    pushUser,
    pushAssistant,
    setPending,
  } = useOsChat(true);
  const [value, setValue] = useState("");
  const [consoleState, setConsoleState] = useState<OrgConsole | null>(null);
  const [pendingDecisions, setPendingDecisions] = useState(0);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Array<{ id: string; ok: boolean; detail: string }>>([]);
  const [memory, setMemory] = useState(true);
  const [listening, setListening] = useState(false);
  const [recents, setRecents] = useState<ChatRecent[]>([]);
  const [view, setView] = useState<"home" | "thread">("home");
  const [railTab, setRailTab] = useState<"history" | "context">("history");
  const [selected, setSelected] = useState<string[]>([]);
  const [showWidgets, setShowWidgets] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const homeInputRef = useRef<HTMLInputElement>(null);
  const threadInputRef = useRef<HTMLTextAreaElement>(null);
  const seeded = useRef(false);
  const draftApplied = useRef(false);
  const focusIdRef = useRef<string | null>(null);
  /** Bumps on New chat / supersede so late Talk responses cannot leave the composer locked. */
  const talkGenRef = useRef(0);

  useEffect(() => {
    setRecents(readRecents());
    try {
      const stored = window.localStorage.getItem(MEMORY_KEY);
      if (stored === "0") setMemory(false);
    } catch {
      /* ignore */
    }
    const draft = takeChatDraft();
    if (draft) {
      draftApplied.current = true;
      setValue(draft);
    }
  }, []);

  useEffect(() => {
    if (!draftApplied.current) return;
    if (messages.length > 0) setView("thread");
  }, [messages.length]);

  useEffect(() => {
    if (!draftApplied.current) return;
    const el = view === "thread" ? threadInputRef.current : homeInputRef.current;
    const t = window.setTimeout(() => {
      el?.focus();
      if (el && "setSelectionRange" in el) {
        const n = el.value.length;
        try {
          el.setSelectionRange(n, n);
        } catch {
          /* ignore */
        }
      }
    }, 40);
    return () => window.clearTimeout(t);
  }, [view]);

  useEffect(() => {
    Promise.all([fetchOrgConsole(), fetchDecisions()]).then(([c, decisions]) => {
      if (c) setConsoleState(c);
      if (decisions) setPendingDecisions(openDecisionCount(decisions));
    });
  }, []);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streaming, pending, showWidgets]);

  useEffect(() => {
    const firstUser = messages.find((m) => m.role === "user");
    const lastAsst = [...messages].reverse().find((m) => m.role === "assistant");
    if (!firstUser) return;
    setRecents((prev) => {
      const existing = prev.find((r) => r.id === sessionId);
      const next: ChatRecent = {
        id: sessionId,
        title: firstUser.content.slice(0, 90),
        summary: lastAsst ? lastAsst.content.replace(/\s+/g, " ").slice(0, 88) : "Working from the ledger…",
        when: existing?.when || formatClock(),
        day: "today",
      };
      const merged = [next, ...prev.filter((r) => r.id !== sessionId)].slice(0, 12);
      writeRecents(merged);
      return merged;
    });
  }, [messages, sessionId]);

  useEffect(() => {
    if (!messages.some((m) => m.role === "assistant") && !streaming) return;
    setShowWidgets(true);
  }, [messages, streaming]);

  const planRows = useMemo(() => {
    const live = consoleState?.proposed ?? [];
    if (live.length) {
      return live.map((a, i) => ({
        id: a.id,
        label: a.label,
        owner: a.owner,
        role: ownerRole(a.owner, consoleState?.people),
        impact: a.detail.slice(0, 42) || (a.gate === "ready" ? "Ready on ledger" : "Needs clarification"),
        priority: (a.gate === "ready" && i < 2 ? "High" : "Medium") as "High" | "Medium",
        gate: a.gate as "ready" | "waiting",
        action: a as ProposedAction,
      }));
    }
    return chatDemoActions.map((a) => ({
      ...a,
      gate: "ready" as const,
      action: null as ProposedAction | null,
    }));
  }, [consoleState]);

  useEffect(() => {
    setSelected(planRows.filter((r) => r.gate === "ready" || !r.action).map((r) => r.id));
  }, [planRows]);

  const findings = useMemo(() => {
    const risks = consoleState?.risks ?? [];
    if (risks.length) {
      return risks.slice(0, 3).map((r) => {
        const why = r.blockedReasons[0] || r.status;
        return `${r.label}${why ? ` — ${why}` : ""}`;
      });
    }
    return chatDemoFindings;
  }, [consoleState]);

  const blockerChain = useMemo(() => {
    const top = consoleState?.risks?.[0];
    if (top) {
      return [top.owner || "Owner", top.label, ...(top.blocking.slice(0, 1) || ["Downstream"])];
    }
    return chatDemoBlocker.chain;
  }, [consoleState]);

  const blockerHref = useMemo(() => {
    const top = consoleState?.risks?.[0];
    if (consoleState?.focus?.decisionId) {
      return `/execute?decision=${encodeURIComponent(consoleState.focus.decisionId)}`;
    }
    if (top?.taskId) return `/execute?task=${encodeURIComponent(top.taskId)}`;
    return chatDemoBlocker.href;
  }, [consoleState]);

  const send = (text: string, opts?: { action?: "create_decision" | "execute" | "complete" | "reverse" | "validate" | "hypotheses" | "instrumentation" | "feasibility" | "outcome" | "learn" }) => {
    const trimmed = text.trim();
    if (!trimmed && !opts?.action) return;
    if (pending) return;
    setValue("");
    setView("thread");
    setShowWidgets(false);
    const fallback =
      opts?.action === "execute"
        ? "Execute it."
        : opts?.action === "complete"
          ? "Mark as done."
          : opts?.action === "reverse"
            ? "It didn't work. Reverse this decision."
            : opts?.action === "feasibility"
              ? "Can we actually execute this?"
              : opts?.action === "outcome"
                ? "Did it work?"
                : opts?.action === "learn"
                  ? "What did we learn?"
          : opts?.action === "validate"
          ? "Validate the next check."
          : opts?.action === "hypotheses"
            ? "What else could be true?"
            : opts?.action === "instrumentation"
              ? "Instrumentation is OK."
              : "Create the decision.";
    if (trimmed) pushUser(trimmed);
    else pushUser(fallback);
    const gen = ++talkGenRef.current;
    setPending(true);
    void (async () => {
      try {
        const turn = await talkToHustronix(trimmed || fallback, {
          focusId: focusIdRef.current,
          conversationId: ensureSessionId(),
          action: opts?.action || null,
        });
        if (gen !== talkGenRef.current) return;
        if (!turn) {
          pushAssistant({ content: "Could not reach Hustronix. Sign in so Talk can read the situation ledger." });
          return;
        }
        if (turn.focus_id) focusIdRef.current = turn.focus_id;
        else if (!opts?.action) focusIdRef.current = null;
        pushAssistant({
          content: turn.answer,
          actions: turn.actions,
          focusId: turn.focus_id,
          decisionId: turn.decision_id,
        });
      } catch (err) {
        if (gen !== talkGenRef.current) return;
        pushAssistant({
          content: err instanceof Error ? err.message : "Talk to Hustronix failed.",
        });
      } finally {
        if (gen === talkGenRef.current) setPending(false);
      }
    })();
  };

  const onTalkAction = (a: { id: string; label: string; kind: string; prompt?: string }) => {
    if (a.kind === "create") send("Create the decision.", { action: "create_decision" });
    else if (a.kind === "execute") send("Execute it.", { action: "execute" });
    else if (a.kind === "complete") send(a.prompt || "Mark as done.", { action: "complete" });
    else if (a.kind === "reverse") send(a.prompt || "It didn't work. Reverse this decision.", { action: "reverse" });
    else if (a.kind === "feasibility") send(a.prompt || "Can we actually execute this?", { action: "feasibility" });
    else if (a.kind === "outcome") send(a.prompt || "Did it work?", { action: "outcome" });
    else if (a.kind === "learn") send(a.prompt || "What did we learn?", { action: "learn" });
    else if (a.kind === "validate") send(a.prompt || "Validate the next check.", { action: "validate" });
    else if (a.kind === "hypotheses") send(a.prompt || "What else could be true?", { action: "hypotheses" });
    else if (a.kind === "instrumentation") send(a.prompt || "Instrumentation is OK.", { action: "instrumentation" });
    else send(a.prompt || a.label);
  };

  useEffect(() => {
    const q = searchParams.get("q")?.trim();
    if (!q || seeded.current) return;
    seeded.current = true;
    setView("thread");
    send(q);
    // Auto-send deep links once. Do not re-bind to `connected` or every send() identity —
    // reconnect / New chat must not re-lock the composer from a stale ?q=.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const viewAnalysis = () => {
    router.push(blockerHref);
  };

  const editPlan = () => {
    const decisionId = consoleState?.focus?.decisionId;
    router.push(decisionId ? `/execute?decision=${encodeURIComponent(decisionId)}` : "/execute");
  };

  const runSelected = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const fresh = await fetchOrgConsole();
      if (fresh) setConsoleState(fresh);

      const proposed = fresh?.proposed ?? consoleState?.proposed ?? [];
      const selectedLive = proposed.filter((a) => a.gate === "ready" && selected.includes(a.id));
      const fallbackLive = proposed.filter((a) => a.gate === "ready");
      const toRun = selectedLive.length ? selectedLive : fallbackLive;

      if (!toRun.length) {
        toast("Open Tasks to approve", {
          description: "No ledger-ready actions in this plan yet — continue on Execute.",
        });
        editPlan();
        return;
      }

      const out = await executeConsoleActions(toRun);
      if (!out) {
        toast("Execute failed", { description: "Could not reach the API.", tone: "danger" });
        return;
      }
      setResults(out.results);
      if (out.console) setConsoleState(out.console);
      const okN = out.results.filter((r) => r.ok).length;
      toast("Approved & executed", {
        description: `${okN} ledger action${okN === 1 ? "" : "s"} applied.`,
      });
    } finally {
      setBusy(false);
    }
  };

  const listen = () => {
    const w = window as unknown as {
      SpeechRecognition?: new () => {
        lang: string;
        interimResults: boolean;
        onresult: ((ev: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => void) | null;
        onerror: (() => void) | null;
        onend: (() => void) | null;
        start: () => void;
      };
      webkitSpeechRecognition?: new () => {
        lang: string;
        interimResults: boolean;
        onresult: ((ev: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => void) | null;
        onerror: (() => void) | null;
        onend: (() => void) | null;
        start: () => void;
      };
    };
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) {
      toast("Voice unavailable", { description: "This browser does not support speech input." });
      return;
    }
    const rec = new SR();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.onresult = (ev) => {
      const said = ev.results[0]?.[0]?.transcript?.trim();
      if (said) setValue((v) => (v ? `${v} ${said}` : said));
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    setListening(true);
    rec.start();
  };

  const startNewChat = () => {
    talkGenRef.current += 1;
    focusIdRef.current = null;
    seeded.current = true;
    setValue("");
    setShowWidgets(false);
    setResults([]);
    setPending(false);
    setView("home");
    newConversation();
    if (searchParams.get("q")) {
      router.replace("/chat");
    }
    window.setTimeout(() => homeInputRef.current?.focus(), 40);
  };

  const inThread = view === "thread";
  const shownRecents = recents.length ? recents : chatSeedRecents.map((r, i) => ({
    ...r,
    day: (i === 0 ? "today" : "week") as "today" | "week",
  }));
  const todayRecents = shownRecents.filter((r) => r.day !== "week");
  const weekRecents = shownRecents.filter((r) => r.day === "week");
  const risks = consoleState?.risks ?? [];
  const live = Boolean(consoleState);
  const riskCount = risks.length;
  const riskNames = risks.slice(0, 3).map((r) => r.label).join(", ");
  const displayRiskCount = live ? riskCount : 3;
  const displayRiskNames = risks.length
    ? riskNames
    : live
      ? "No blocked executions on the ledger."
      : "Q3 Launch, Payment Integration, Marketing Campaign";
  const displayPending = live ? pendingDecisions : 5;
  const suggested = (consoleState?.proposed ?? []).slice(0, 3);
  const lastAssistantIndex = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return i;
    }
    return -1;
  })();

  const homeComposer = (
    <form
      className={styles.chatAsk}
      onClick={() => homeInputRef.current?.focus()}
      onSubmit={(e) => {
        e.preventDefault();
        send(value);
      }}
    >
      <input
        ref={homeInputRef}
        type="text"
        name="hustronix-talk"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        placeholder="Ask Hustronix anything about your business…"
        aria-label="Message Hustronix"
        aria-busy={pending || undefined}
        autoComplete="off"
        autoCorrect="off"
        spellCheck
      />
      <button
        type="button"
        className={styles.chatAskMic}
        aria-label={listening ? "Listening" : "Voice input"}
        aria-pressed={listening}
        onClick={(e) => {
          e.stopPropagation();
          listen();
        }}
      >
        <Mic size={16} />
      </button>
      <button type="submit" className={styles.chatAskSend} disabled={pending || !value.trim()} aria-label="Send">
        <Send size={15} />
      </button>
    </form>
  );

  const threadComposer = (
    <form
      className={styles.chatComposer}
      onSubmit={(e) => {
        e.preventDefault();
        send(value);
      }}
    >
      <textarea
        ref={threadInputRef}
        name="hustronix-talk-thread"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Ask Hustronix anything about your business…"
        aria-label="Message Hustronix"
        aria-busy={pending || undefined}
        rows={2}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send(value);
          }
        }}
      />
      <div className={styles.chatComposerBar}>
        <div className={styles.chatComposerTools}>
          <button
            type="button"
            className={styles.chatToolBtn}
            aria-label="Add attachment"
            disabled
            title="File attachments are not available yet"
          >
            <Plus size={15} />
          </button>
          <button
            type="button"
            className={styles.chatToolBtn}
            aria-label="Formatting"
            disabled
            title="Composer formatting is not available yet"
          >
            <Type size={15} />
          </button>
          <button
            type="button"
            className={styles.chatToolBtn}
            aria-label="Attach file"
            disabled
            title="File upload is not available yet"
          >
            <Paperclip size={15} />
          </button>
          <button type="button" className={styles.chatToolBtn} aria-label="Decision graph" onClick={() => send("Show the decision graph for this blocker")}>
            <GitBranch size={15} />
          </button>
        </div>
        <div className={styles.chatComposerRight}>
          <button
            type="button"
            className={styles.chatAskMic}
            aria-label={listening ? "Listening" : "Voice input"}
            aria-pressed={listening}
            onClick={listen}
          >
            <Mic size={16} />
          </button>
          <button type="submit" className={styles.chatAskSend} disabled={pending || !value.trim()} aria-label="Send">
            <Send size={15} />
          </button>
        </div>
      </div>
    </form>
  );

  const analysisWidgets = showWidgets && !pending && !streaming ? (
    <div className={styles.chatWidgets}>
      <ol className={styles.chatFindings}>
        {findings.map((line, i) => (
          <li key={`finding-${i}`}>
            <span>{i + 1}</span>
            <p>{line}</p>
          </li>
        ))}
      </ol>

      <div className={styles.chatBlocker}>
        <header>
          <strong>Top Blocker</strong>
        </header>
        <div className={styles.chatBlockerChain}>
          {blockerChain.map((node, i) => (
            <span key={`${node}-${i}`}>
              {i > 0 ? <em aria-hidden>→</em> : null}
              <b>{node}</b>
            </span>
          ))}
        </div>
        <button type="button" className={styles.chatBlockerBtn} onClick={viewAnalysis}>
          View Analysis
        </button>
      </div>

      <div className={styles.chatPlan}>
        <header>
          <Sparkles size={15} />
          <strong>
            {planRows.filter((r) => r.gate === "ready").length || planRows.length} Actions Ready for Approval
          </strong>
        </header>
        <div className={styles.chatPlanTable}>
          <div className={styles.chatPlanHead}>
            <span>Action</span>
            <span>Owner</span>
            <span>Impact</span>
            <span>Priority</span>
          </div>
          {planRows.map((row) => {
            const on = selected.includes(row.id);
            return (
              <label key={row.id} className={styles.chatPlanRow} data-on={on ? "true" : "false"}>
                <span className={styles.chatPlanAction}>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() =>
                      setSelected((prev) => (on ? prev.filter((id) => id !== row.id) : [...prev, row.id]))
                    }
                  />
                  <span className={styles.chatPlanIcon}>
                    <ListChecks size={13} />
                  </span>
                  <strong>{row.label}</strong>
                </span>
                <span className={styles.chatPlanOwner}>
                  <b>{row.owner}</b>
                  <em>{row.role}</em>
                </span>
                <span>
                  <StatusPill label={row.impact} tone="low" />
                </span>
                <span>
                  <StatusPill label={row.priority} tone={row.priority === "High" ? "critical" : "high"} />
                </span>
              </label>
            );
          })}
        </div>
        <footer>
          <button type="button" className={styles.chatPlanGhost} onClick={editPlan}>
            Edit Plan
          </button>
          <button
            type="button"
            className={styles.chatPlanPrimary}
            disabled={busy || !selected.length}
            onClick={() => void runSelected()}
          >
            <Sparkles size={14} />
            {busy ? "Executing…" : "Approve & Execute"}
          </button>
        </footer>
        {results.length ? (
          <ul className={styles.consoleResults}>
            {results.map((r) => (
              <li key={r.id} data-ok={r.ok ? "true" : "false"}>
                {r.ok ? "Done" : "Blocked"}: {r.detail}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  ) : null;
  void analysisWidgets;

  return (
    <AppShell
      topBar={
        <TopBar
          title="Talk"
          subtitle="Ask anything about your company."
          titleIcon={<HustronixMark size={26} title="Hustronix" />}
          showAsk={false}
          showSearch={false}
          trailing={
            <>
              <button
                type="button"
                className={styles.chatMemory}
                aria-pressed={memory}
                onClick={() => {
                  const next = !memory;
                  setMemory(next);
                  try {
                    window.localStorage.setItem(MEMORY_KEY, next ? "1" : "0");
                  } catch {
                    /* ignore */
                  }
                }}
              >
                <Brain size={15} />
                Memory {memory ? "On" : "Off"}
              </button>
              <Link href="/help" className={styles.chatIconBtn} aria-label="Help">
                <CircleHelp size={16} />
              </Link>
              <button type="button" className={styles.chatNew} onClick={startNewChat}>
                <Plus size={15} />
                New chat
              </button>
            </>
          }
        />
      }
    >
      <div className={styles.chatLayout} data-mode={inThread ? "thread" : "home"}>
        <div className={styles.chatMain}>
          {inThread ? (
            <div className={styles.chatThreadShell}>
              <div className={styles.chatThread} ref={threadRef}>
                {messages.map((m, i) => (
                  <div key={`${m.role}-${i}`} className={styles.chatBubbleRow} data-role={m.role}>
                    {m.role === "assistant" ? (
                      <span className={styles.chatAvatarHx} aria-hidden>
                        <HustronixMark size={26} />
                      </span>
                    ) : null}
                    <div className={styles.chatBubbleCol}>
                      <div className={styles.chatBubble}>
                        {m.role === "assistant" ? (
                          <ChatMessageContent
                            content={m.content}
                            mcqDisabled={pending || Boolean(streaming)}
                            onMcqSubmit={(msg) => send(msg)}
                          />
                        ) : (
                          <p>{m.content}</p>
                        )}
                      </div>
                      {m.role === "assistant" && i === lastAssistantIndex && m.actions?.length ? (
                        <div className={styles.talkActions}>
                          {m.actions.map((a) => (
                            <button
                              key={a.id}
                              type="button"
                              className={styles.talkAction}
                              disabled={pending}
                              onClick={() => onTalkAction(a)}
                            >
                              {a.label}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    {m.role === "user" ? (
                      <span className={styles.chatAvatarUser} aria-hidden>
                        {profile.initials}
                      </span>
                    ) : null}
                  </div>
                ))}
                {streaming || pending ? (
                  <div className={styles.chatBubbleRow} data-role="assistant">
                    <span className={styles.chatAvatarHx} aria-hidden>
                      <HustronixMark size={26} />
                    </span>
                    <div className={styles.chatBubble}>
                      {streaming ? (
                        <ChatMessageContent content={streaming} mcqDisabled />
                      ) : (
                        <p>Working from the ledger…</p>
                      )}
                    </div>
                  </div>
                ) : null}
                {!messages.length && !streaming && !pending ? (
                  <p className={styles.emptyHint}>Ask anything to start this conversation.</p>
                ) : null}
              </div>
              <div className={styles.chatThreadFoot}>
                {threadComposer}
                <p className={styles.chatDisclaimer}>
                  Talk is the conversational interface to the Company Brain. When you ask Hustronix to act, governance still controls execution.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className={styles.chatHero}>
                <p className={styles.chatHello}>Ask Hustronix anything about your business…</p>
                {homeComposer}
              </div>

              <section className={styles.chatSection} aria-labelledby="chat-starters-label">
                <h2 id="chat-starters-label">Examples — not a limited vocabulary</h2>
                <div className={styles.chatStarters}>
                  {chatStarters.map((item) => {
                    const Icon = starterIcons[item.icon] ?? Sparkles;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={styles.chatStarter}
                        onClick={() => send(item.prompt)}
                      >
                        <span className={styles.chatStarterIcon}>
                          <Icon size={15} />
                        </span>
                        <span>
                          <strong>{item.title}</strong>
                          <em>{item.prompt}</em>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className={styles.chatSection} aria-labelledby="chat-recents-label">
                <h2 id="chat-recents-label">Recent conversations</h2>
                <div className={styles.chatRecents}>
                  {shownRecents.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={styles.chatRecent}
                      onClick={() => {
                        if (item.id.startsWith("seed:")) send(item.title);
                        else {
                          setView("thread");
                          openSession(item.id);
                        }
                      }}
                    >
                      <span className={styles.chatStarterIcon}>
                        <Sparkles size={15} />
                      </span>
                      <span>
                        <strong>{item.title}</strong>
                        <em>{item.summary}</em>
                      </span>
                      <time>{item.when}</time>
                    </button>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>

        <aside className={styles.chatRail}>
          {inThread ? (
            <Panel className={styles.chatHistPanel} padded={false}>
              <div className={styles.chatRailTabs} role="tablist" aria-label="Chat side panel">
                <button
                  type="button"
                  role="tab"
                  aria-selected={railTab === "history"}
                  data-on={railTab === "history" ? "true" : "false"}
                  onClick={() => setRailTab("history")}
                >
                  History
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={railTab === "context"}
                  data-on={railTab === "context" ? "true" : "false"}
                  onClick={() => setRailTab("context")}
                >
                  Context
                </button>
              </div>

              {railTab === "history" ? (
                <div className={styles.chatHistBody}>
                  <div className={styles.chatHistGroup}>
                    <h3>Today</h3>
                    {(todayRecents.length ? todayRecents : shownRecents.slice(0, 1)).map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={styles.chatHistItem}
                        data-active={item.id === sessionId ? "true" : "false"}
                        onClick={() => {
                          if (item.id.startsWith("seed:")) send(item.title);
                          else {
                            setView("thread");
                            openSession(item.id);
                          }
                        }}
                      >
                        <span className={styles.chatHistIcon}>
                          <Sparkles size={13} />
                        </span>
                        <span>
                          <strong>{item.title}</strong>
                          <time>{item.when}</time>
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className={styles.chatHistGroup}>
                    <h3>Last 7 Days</h3>
                    {(weekRecents.length ? weekRecents : shownRecents.slice(1)).map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={styles.chatHistItem}
                        data-active={item.id === sessionId ? "true" : "false"}
                        onClick={() => {
                          if (item.id.startsWith("seed:")) send(item.title);
                          else {
                            setView("thread");
                            openSession(item.id);
                          }
                        }}
                      >
                        <span className={styles.chatHistIcon}>
                          <Sparkles size={13} />
                        </span>
                        <span>
                          <strong>{item.title}</strong>
                          <time>{item.when}</time>
                        </span>
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className={styles.chatHistAll}
                    onClick={startNewChat}
                  >
                    <Clock size={14} />
                    View All History
                  </button>
                </div>
              ) : (
                <div className={styles.chatHistBody}>
                  <div className={styles.chatContextBlock}>
                    <h3>Focus</h3>
                    <p>{consoleState?.focus?.vow || "No active decision on the ledger."}</p>
                  </div>
                  <div className={styles.chatContextBlock}>
                    <h3>Next</h3>
                    <p>{consoleState?.plan?.recommendedNext || "Ask Hustronix to recommend the next commit."}</p>
                  </div>
                  <p className={styles.consolePolicy}>{consoleState?.policyNote}</p>
                </div>
              )}
            </Panel>
          ) : (
            <>
              <Panel>
                <PanelHeader title="Hustronix Insights" />
                <div className={styles.chatInsightList}>
                  <Link
                    href="/chat?q=What%20is%20going%20wrong%20in%20the%20company%3F"
                    className={styles.chatInsight}
                  >
                    <StatusIcon tone="critical">
                      <AlertTriangle size={15} />
                    </StatusIcon>
                    <span>
                      <strong>{displayRiskCount} Risks Detected</strong>
                      <em>{displayRiskNames}</em>
                    </span>
                  </Link>
                  <Link
                    href="/chat?q=What%20should%20we%20do%3F"
                    className={styles.chatInsight}
                  >
                    <StatusIcon tone="medium">
                      <Clock size={15} />
                    </StatusIcon>
                    <span>
                      <strong>{displayPending} Decisions Pending</strong>
                      <em>Ask Hustronix what to do next</em>
                    </span>
                  </Link>
                </div>
              </Panel>

              <Panel>
                <PanelHeader title="Suggested Actions" />
                <ul className={styles.chatActions}>
                  {(suggested.length
                    ? suggested.map((a) => ({
                        id: a.id,
                        title: a.label,
                        detail: a.detail,
                        href: a.href || "/execute",
                        ready: a.gate === "ready",
                        action: a,
                      }))
                    : [
                        {
                          id: "pay",
                          title: "What's going wrong in the company?",
                          detail: "Ranked live situations",
                          href: "/chat?q=What%27s%20going%20wrong%20in%20the%20company%3F",
                          ready: false,
                          action: null as ProposedAction | null,
                        },
                        {
                          id: "who",
                          title: "Who is affected?",
                          detail: "Teams and bottlenecks",
                          href: "/chat?q=Who%20is%20affected%3F",
                          ready: false,
                          action: null as ProposedAction | null,
                        },
                        {
                          id: "do",
                          title: "What should we do?",
                          detail: "Recommend, then validate and execute",
                          href: "/chat?q=What%20should%20we%20do%3F",
                          ready: false,
                          action: null as ProposedAction | null,
                        },
                      ]
                  ).map((row) => (
                    <li key={row.id}>
                      <span>
                        <strong>{row.title}</strong>
                        <em>{row.detail}</em>
                      </span>
                      {row.ready && row.action ? (
                        <button
                          type="button"
                          className={styles.link}
                          disabled={busy}
                          onClick={() => void executeConsoleActions([row.action!]).then((out) => {
                            if (out?.console) setConsoleState(out.console);
                          })}
                        >
                          Approve
                        </button>
                      ) : (
                        <Link href={row.href} className={styles.link}>
                          View
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </Panel>

              <Panel>
                <PanelHeader title="Hustronix Can" />
                <ul className={styles.chatCan}>
                  {chatCapabilities.map((cap) => (
                    <li key={cap}>
                      <Check size={14} />
                      {cap}
                    </li>
                  ))}
                </ul>
              </Panel>

              <Panel className={styles.chatControl}>
                <div className={styles.chatControlHead}>
                  <StatusIcon tone="medium">
                    <Lock size={15} />
                  </StatusIcon>
                  <div>
                    <strong>Execution Control</strong>
                    <p>Approve before executing actions.</p>
                  </div>
                </div>
              </Panel>
            </>
          )}
        </aside>
      </div>
    </AppShell>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={null}>
      <ChatPageInner />
    </Suspense>
  );
}
