"use client";

import { Loader2, MessageSquare, RotateCcw, Send } from "lucide-react";
import Link from "next/link";
import { useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { MarkdownText } from "@/components/ui/markdown-text";
import { useAssistantChat } from "@/hooks/useAssistantChat";
import { cn } from "@/lib/cn";

type Props = {
  active: boolean;
  /** Fill drawer height (Assistant tab); default is compact embedded layout. */
  expanded?: boolean;
};

function PanelHeader({
  connected,
  onNew,
}: {
  connected: boolean;
  onNew: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 px-4 py-2">
      <div className="flex items-center gap-2 text-[11px] text-hx-muted">
        <span
          className={cn(
            "size-1.5 rounded-full",
            connected ? "bg-hx-success" : "bg-hx-muted/50",
          )}
          aria-hidden
        />
        {connected ? "Connected" : "Connecting…"}
        <span className="text-hx-muted/60">·</span>
        <span>Product help only</span>
      </div>
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-hx-muted transition hover:bg-hx-surface-elevated hover:text-hx-text"
        onClick={onNew}
      >
        <RotateCcw className="size-3" aria-hidden />
        New thread
      </button>
    </div>
  );
}

export function AssistantChatPanel({ active, expanded = false }: Props) {
  const {
    identityErr,
    messages,
    streaming,
    pending,
    connected,
    sendMessage,
    startNewSession,
  } = useAssistantChat(active);

  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [messages, streaming, pending]);

  function submit() {
    if (!sendMessage(draft)) return;
    setDraft("");
  }

  const awaiting = pending > 0;

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col",
        "border-t border-hx-border",
        expanded && "min-h-0 flex-1",
      )}
    >
      <PanelHeader connected={connected} onNew={startNewSession} />

      {identityErr && (
        <p className="px-4 py-2 text-xs text-hx-danger">{identityErr}</p>
      )}

      <div
        ref={scrollRef}
        className={cn(
          "scrollbar-hx flex-1 space-y-3 overflow-y-auto px-4 py-3",
          expanded ? "min-h-0" : "min-h-[10rem] max-h-[min(40vh,320px)]",
        )}
      >
        {messages.length === 0 && !streaming && !awaiting && (
          <p className="text-xs leading-relaxed text-hx-muted">
            Ask how a screen works, where to click, or what Mission Control / Execute / Signals
            do. This thread is separate from the main Chat tab.
          </p>
        )}
        {messages.map((m) => (
          <div
            key={`${m.role}-${m.at ?? "na"}-${m.content.length}-${m.content.slice(0, 32)}`}
            className={cn(
              "rounded-lg border px-3 py-2 text-xs leading-relaxed",
              m.role === "user"
                ? "ml-6 border-hx-accent/25 bg-hx-accent/5 text-hx-text"
                : "mr-4 border-hx-border bg-hx-bg/80 text-hx-muted",
            )}
          >
            {m.role === "assistant" ? (
              <MarkdownText muted className="text-xs">
                {m.content}
              </MarkdownText>
            ) : (
              m.content
            )}
          </div>
        ))}
        {streaming && (
          <div className="mr-4 rounded-lg border border-hx-border bg-hx-bg/80 px-3 py-2">
            <MarkdownText muted className="text-xs">
              {streaming}
            </MarkdownText>
          </div>
        )}
        {awaiting && !streaming && (
          <div className="flex items-center gap-2 text-xs text-hx-muted">
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            Thinking…
          </div>
        )}
      </div>

      <div className="space-y-2 border-t border-hx-border p-4">
        <label className="sr-only" htmlFor="hx-assistant-input">
          Message assistant
        </label>
        <textarea
          id="hx-assistant-input"
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Ask about the product…"
          disabled={!connected}
          className="w-full resize-none rounded-lg border border-hx-border bg-hx-bg px-3 py-2 text-sm text-hx-text placeholder:text-hx-muted focus:border-hx-accent focus:outline-none disabled:opacity-50"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            type="button"
            className="gap-1"
            disabled={!connected || !draft.trim()}
            onClick={submit}
          >
            <Send className="size-3.5" aria-hidden />
            Send
          </Button>
          <Link
            href="/chat"
            className="inline-flex items-center gap-1.5 rounded-md border border-hx-border px-3 py-1.5 text-xs font-medium text-hx-muted transition hover:bg-hx-surface-elevated hover:text-hx-text"
          >
            <MessageSquare className="size-3.5" aria-hidden />
            Open full Chat
          </Link>
        </div>
      </div>
    </div>
  );
}
