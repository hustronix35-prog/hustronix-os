"use client";

import { MarkdownBody } from "@/components/ui/MarkdownBody";
import { splitChatContentSegments } from "@/lib/chat-mcq";
import { ChatMcqPanel } from "./ChatMcqPanel";
import styles from "./chat-message.module.css";

type Props = {
  content: string;
  className?: string;
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

  function segmentKey(seg: (typeof segments)[number], i: number): string {
    if (seg.type === "markdown") return `md-${i}-${seg.content.length}`;
    return `mcq-${i}-${seg.payload.questions.map((q) => q.id).join(",")}`;
  }

  return (
    <div className={className ?? styles.messageBody}>
      {segments.map((seg, i) => {
        if (seg.type === "markdown") {
          return <MarkdownBody key={segmentKey(seg, i)} text={seg.content} />;
        }
        return (
          <div key={segmentKey(seg, i)} className={styles.mcqWrap}>
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
