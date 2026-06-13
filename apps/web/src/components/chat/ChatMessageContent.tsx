"use client";

import { MarkdownText } from "@/components/ui/markdown-text";
import { splitChatContentSegments } from "@/lib/chat-mcq";
import { ChatMcqPanel } from "./ChatMcqPanel";

type Props = {
  content: string;
  className?: string;
  /** Disable MCQ clicks while assistant is replying. */
  mcqDisabled?: boolean;
  onMcqSubmit?: (message: string) => void;
};

export function ChatMessageContent({
  content,
  className,
  mcqDisabled,
  onMcqSubmit,
}: Props) {
  const segments = splitChatContentSegments(content);

  function segmentKey(seg: (typeof segments)[number]): string {
    if (seg.type === "markdown") {
      const head = seg.content.slice(0, 48);
      return `md-${seg.content.length}-${head}`;
    }
    const qIds = seg.payload.questions.map((q) => q.id).join(",");
    return `mcq-${qIds}`;
  }

  return (
    <div className={className}>
      {segments.map((seg) => {
        if (seg.type === "markdown") {
          return (
            <MarkdownText key={segmentKey(seg)} className="text-sm">
              {seg.content}
            </MarkdownText>
          );
        }
        return (
          <div key={segmentKey(seg)} className="my-3">
            <ChatMcqPanel
              payload={seg.payload}
              disabled={mcqDisabled || !onMcqSubmit}
              onSubmit={(msg) => onMcqSubmit?.(msg)}
            />
          </div>
        );
      })}
    </div>
  );
}
