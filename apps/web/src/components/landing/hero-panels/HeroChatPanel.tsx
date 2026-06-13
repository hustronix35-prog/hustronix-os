"use client";

import { Brain, MessageSquare, Send } from "lucide-react";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { chatContext, chatTimeline } from "@/data/chat";
import { cn } from "@/lib/cn";
import { HeroPageHeader, HeroPanelBody } from "./shared";

/** Chat route , sessions rail, thread stream, composer (no dashboard card grid). */
export function HeroChatPanel() {
  const ctx = chatContext;
  const previewTimeline = chatTimeline.slice(0, 4);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-hx-bg">
      <HeroPageHeader
        variant="chat"
        title="Chat"
        subtitle="Each chat keeps its own history. Replies show up here as they are written."
        trailing={
          <StatusBadge variant="success" dot className="text-[7px] md:text-[8px]">
            Live
          </StatusBadge>
        }
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="flex w-[4.5rem] shrink-0 flex-col gap-1 border-r border-hx-border bg-hx-surface-elevated/20 px-1 py-2 md:w-20 md:px-1.5">
          <p className="px-0.5 text-[6px] font-semibold uppercase tracking-wider text-hx-muted md:text-[7px]">
            Recents
          </p>
          <div className="rounded-md border border-hx-accent/35 bg-hx-accent/10 p-1 text-[6px] font-semibold leading-tight text-hx-accent md:text-[7px]">
            {ctx.title.slice(0, 22)}…
          </div>
          <div className="rounded-md border border-hx-border p-1 text-[6px] text-hx-muted md:text-[7px]">
            Capacity review
          </div>
          <div className="rounded-md border border-hx-border p-1 text-[6px] text-hx-muted md:text-[7px]">
            Q2 pipeline
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <HeroPanelBody className="gap-2 p-2 md:gap-2.5 md:p-2.5">
            <div className="space-y-1.5 md:space-y-2">
              {previewTimeline.map((item, idx) => {
                const isUser = item.type === "signal" && idx === 0;
                const isAssistant =
                  item.type === "synthesis" || item.type === "decision";
                return (
                  <div
                    key={`${item.time}-${idx}`}
                    className={cn(
                      "flex",
                      isAssistant ? "justify-start" : "justify-end",
                    )}
                  >
                    <div
                      className={cn(
                        "max-w-[88%] rounded-lg px-2 py-1.5 md:max-w-[85%] md:px-2.5 md:py-2",
                        isUser &&
                          "rounded-br-sm border border-hx-border bg-hx-surface-elevated/60",
                        isAssistant &&
                          "rounded-bl-sm border border-hx-accent/25 bg-hx-accent/8",
                        item.type === "execution" &&
                          "border border-hx-success/30 bg-hx-success/5",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[6px] font-semibold uppercase tracking-wider text-hx-muted md:text-[7px]">
                          {item.type === "signal" && `Signal · ${item.source}`}
                          {item.type === "synthesis" && (
                            <span className="text-hx-accent">Synthesis</span>
                          )}
                          {item.type === "decision" && (
                            <span className="text-hx-success">Decision</span>
                          )}
                          {item.type === "execution" && "Execution"}
                        </span>
                        <span className="shrink-0 text-[6px] text-hx-muted md:text-[7px]">
                          {item.time}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[8px] leading-snug text-hx-text md:text-[9px]">
                        {"text" in item ? item.text : ""}
                      </p>
                      {item.type === "synthesis" && "bullets" in item && (
                        <ul className="mt-1 list-inside list-disc space-y-0.5 text-[7px] text-hx-muted md:text-[8px]">
                          {item.bullets.map((b) => (
                            <li key={b}>{b}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </HeroPanelBody>

          <div className="flex shrink-0 items-center gap-1.5 border-t border-hx-border bg-hx-surface-elevated/25 px-2 py-1.5 md:gap-2 md:px-2.5 md:py-2">
            <MessageSquare className="size-3 shrink-0 text-hx-muted md:h-3.5 md:w-3.5" />
            <div className="min-w-0 flex-1 rounded-md border border-hx-border bg-hx-bg px-2 py-1 text-[8px] text-hx-muted md:text-[9px]">
              Ask Hustronix about signals, capacity, or next steps…
            </div>
            <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-hx-accent/20 text-hx-accent md:h-8 md:w-8">
              <Send className="size-3 md:h-3.5 md:w-3.5" />
            </span>
          </div>
        </div>

        <aside className="hidden w-[5.5rem] shrink-0 flex-col border-l border-hx-border bg-hx-surface sm:flex md:w-24">
          <div className="border-b border-hx-border p-1.5 md:px-2 md:py-2">
            <p className="text-[7px] font-semibold text-hx-text md:text-[8px]">
              Context
            </p>
          </div>
          <div className="scrollbar-hide flex-1 space-y-1.5 overflow-y-auto p-1.5 md:p-2">
            <Card className="border-hx-border bg-hx-surface p-1.5 shadow-none md:p-2">
              <p className="text-[7px] font-bold text-hx-text md:text-[8px]">
                {ctx.title}
              </p>
              <p className="mt-0.5 line-clamp-3 text-[6px] leading-snug text-hx-muted md:text-[7px]">
                {ctx.description}
              </p>
            </Card>
            <div className="rounded-md border border-hx-border bg-hx-surface-elevated/40 px-1.5 py-1 md:px-2">
              <p className="text-[6px] font-semibold uppercase text-hx-muted md:text-[7px]">
                Memory
              </p>
              <p className="mt-0.5 line-clamp-2 text-[6px] text-hx-muted md:text-[7px]">
                {ctx.memory[0]}
              </p>
            </div>
            <div className="flex items-center gap-1 text-[6px] text-hx-muted md:text-[7px]">
              <Brain className="size-3 shrink-0" />
              {ctx.signalsTotal} signals
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
