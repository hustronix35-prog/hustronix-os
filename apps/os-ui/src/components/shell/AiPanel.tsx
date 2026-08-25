"use client";

import { ArrowLeft, ArrowUpRight, History, Send, SquarePen, X } from "@/components/icons";
import { HustronixMark } from "@/components/brand/HustronixMark";
import { MarkdownBody } from "@/components/ui/MarkdownBody";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { askHustronix } from "@/lib/api";
import {
  assistantContinuePrompt,
  readAssistantSessions,
  writeAssistantSessions,
  type AssistantMsg,
  type AssistantSession,
} from "@/lib/assistant-history";
import { chatUrlForQuery } from "@/lib/chat-handoff";
import styles from "./shell.module.css";

const GREETING: AssistantMsg = {
  role: "assistant",
  text: "Hi — I'm connected to your Company Brain. Ask me about decisions, risks, execution, or anything happening across Hustronix.",
};

const starters = [
  "What changed overnight?",
  "Why is the launch at risk?",
  "Prepare board meeting brief",
  "Show customer risks",
];

const seedSessions: AssistantSession[] = [
  { id: "current", title: "New chat", when: "Now", messages: [GREETING] },
];

function clock() {
  return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function AiPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [sessions, setSessions] = useState<AssistantSession[]>(seedSessions);
  const [activeId, setActiveId] = useState("current");
  const [view, setView] = useState<"chat" | "history">("chat");
  const [value, setValue] = useState("");
  const [thinking, setThinking] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stored = readAssistantSessions(seedSessions);
    setSessions(stored);
    setActiveId(stored[0]?.id ?? "current");
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    writeAssistantSessions(sessions);
  }, [sessions, hydrated]);

  const active = sessions.find((s) => s.id === activeId) ?? sessions[0];
  const historyBox = useMemo(
    () => sessions.filter((s) => s.messages.some((m) => m.role === "user")).slice(0, 6),
    [sessions],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [active?.messages, thinking, view]);

  const appendToActive = (msg: AssistantMsg, title?: string) => {
    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeId
          ? {
              ...s,
              when: clock(),
              title: title && (s.title === "New chat" || !s.title) ? title : s.title,
              messages: [...s.messages, msg],
            }
          : s,
      ),
    );
  };

  const send = async (question: string) => {
    const trimmed = question.trim();
    if (!trimmed || thinking) return;
    setValue("");
    const title = trimmed.length > 42 ? `${trimmed.slice(0, 42)}…` : trimmed;
    appendToActive({ role: "user", text: trimmed }, title);
    setThinking(true);
    const { answer } = await askHustronix(trimmed);
    appendToActive({ role: "assistant", text: answer });
    setThinking(false);
  };

  const newChat = () => {
    const existing = sessions.find((s) => s.title === "New chat" && s.messages.length <= 1);
    if (existing) {
      setActiveId(existing.id);
    } else {
      const id = `chat-${Date.now()}`;
      setSessions((prev) => [{ id, title: "New chat", when: "Now", messages: [GREETING] }, ...prev]);
      setActiveId(id);
    }
    setView("chat");
  };

  const openSession = (id: string) => {
    setActiveId(id);
    setView("chat");
  };

  const continueInChat = () => {
    if (!active) return;
    const prompt = assistantContinuePrompt(active);
    onClose();
    if (prompt) router.push(chatUrlForQuery(prompt));
    else router.push("/chat");
  };

  if (!open) return null;

  return (
    <div className={styles.aiOverlay}>
      <button type="button" className={styles.aiBackdrop} aria-label="Close assistant" onClick={onClose} />
      <aside className={styles.aiPanel} role="dialog" aria-label="Hustronix Assistant">
        <header className={styles.aiHead}>
          <div className={styles.aiTitle}>
            {view === "history" ? (
              <button
                type="button"
                className={styles.aiHeadBtn}
                aria-label="Back to chat"
                onClick={() => setView("chat")}
              >
                <ArrowLeft size={15} />
              </button>
            ) : (
              <span className={styles.aiSpark}>
                <HustronixMark size={22} />
              </span>
            )}
            <div>
              <strong>{view === "history" ? "Chat history" : "Hustronix Assistant"}</strong>
              <small>
                {view === "history"
                  ? `${sessions.length} conversation${sessions.length === 1 ? "" : "s"} saved`
                  : "Saved here · continue anytime in Chat"}
              </small>
            </div>
          </div>
          <div className={styles.aiHeadActions}>
            <button
              type="button"
              className={styles.aiContinueBtn}
              onClick={continueInChat}
              title="Open this thread in Chat"
            >
              Continue in Chat
              <ArrowUpRight size={13} />
            </button>
            <button
              type="button"
              className={styles.aiHeadBtn}
              data-active={view === "history" ? "true" : "false"}
              aria-label="Chat history"
              title="Chat history"
              onClick={() => setView((v) => (v === "history" ? "chat" : "history"))}
            >
              <History size={15} />
            </button>
            <button
              type="button"
              className={styles.aiHeadBtn}
              aria-label="New chat"
              title="New chat"
              onClick={newChat}
            >
              <SquarePen size={15} />
            </button>
            <button type="button" className={styles.aiClose} aria-label="Close" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        </header>

        {view === "history" ? (
          <div className={styles.aiHistory}>
            {sessions.map((session) => {
              const lastMsg = session.messages[session.messages.length - 1];
              return (
                <div key={session.id} className={styles.aiHistCard}>
                  <button
                    type="button"
                    className={styles.aiHistItem}
                    data-active={session.id === activeId ? "true" : "false"}
                    onClick={() => openSession(session.id)}
                  >
                    <div className={styles.aiHistTop}>
                      <strong>{session.title}</strong>
                      <time>{session.when}</time>
                    </div>
                    <p>{lastMsg?.text}</p>
                    <small>{Math.max(session.messages.length - 1, 0)} messages</small>
                  </button>
                  <button
                    type="button"
                    className={styles.aiHistContinue}
                    onClick={() => {
                      const prompt = assistantContinuePrompt(session);
                      onClose();
                      if (prompt) router.push(chatUrlForQuery(prompt));
                      else router.push("/chat");
                    }}
                  >
                    Continue in Chat
                    <ArrowUpRight size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <>
            {historyBox.length ? (
              <div className={styles.aiHistoryBox} aria-label="Saved assistant history">
                <div className={styles.aiHistoryBoxHead}>
                  <span>History</span>
                  <button type="button" className={styles.linkLike} onClick={() => setView("history")}>
                    View all
                  </button>
                </div>
                <div className={styles.aiHistoryBoxList}>
                  {historyBox.map((session) => (
                    <button
                      key={session.id}
                      type="button"
                      className={styles.aiHistoryChip}
                      data-active={session.id === activeId ? "true" : "false"}
                      onClick={() => openSession(session.id)}
                    >
                      <strong>{session.title}</strong>
                      <time>{session.when}</time>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className={styles.aiThread} ref={threadRef}>
              {(active?.messages ?? []).map((m, i) => (
                <div key={i} className={styles.aiMsg} data-role={m.role}>
                  <div className={styles.aiBubble}>
                    <MarkdownBody text={m.text} />
                  </div>
                </div>
              ))}
              {thinking ? (
                <div className={styles.aiMsg} data-role="assistant">
                  <p className={styles.aiThinking}>Analyzing company brain…</p>
                </div>
              ) : null}
            </div>

            {(active?.messages.length ?? 0) <= 1 ? (
              <div className={styles.aiStarters}>
                {starters.map((s) => (
                  <button key={s} type="button" onClick={() => void send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            ) : null}

            <form
              className={styles.aiInputRow}
              onSubmit={(e) => {
                e.preventDefault();
                void send(value);
              }}
            >
              <input
                placeholder="Ask Hustronix anything..."
                value={value}
                onChange={(e) => setValue(e.target.value)}
                autoFocus
              />
              <button type="submit" aria-label="Send" disabled={thinking}>
                <Send size={15} />
              </button>
            </form>
          </>
        )}
      </aside>
    </div>
  );
}
