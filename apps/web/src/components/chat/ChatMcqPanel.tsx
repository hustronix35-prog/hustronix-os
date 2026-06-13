"use client";

import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import {
  formatMcqAnswers,
  type ChatMcqPayload,
  type ChatMcqQuestion,
} from "@/lib/chat-mcq";

type Props = {
  payload: ChatMcqPayload;
  disabled?: boolean;
  onSubmit: (message: string) => void;
};

function QuestionBlock({
  question,
  disabled,
  instantSubmit,
  selection,
  onPick,
}: {
  question: ChatMcqQuestion;
  disabled?: boolean;
  instantSubmit: boolean;
  selection: string | string[] | undefined;
  onPick: (questionId: string, optionId: string) => void;
}) {
  const selectedSet = useMemo(() => {
    if (!selection) return new Set<string>();
    return new Set(Array.isArray(selection) ? selection : [selection]);
  }, [selection]);

  return (
    <div className="rounded-lg border border-hx-border/80 bg-hx-surface-elevated/50 p-3">
      <p className="text-sm font-medium leading-snug text-hx-text">{question.prompt}</p>
      <div className="mt-2.5 flex flex-col gap-1.5">
        {question.options.map((opt, idx) => {
          const letter = String.fromCharCode(65 + idx);
          const active = selectedSet.has(opt.id);
          return (
            <button
              key={opt.id}
              type="button"
              disabled={disabled}
              aria-pressed={active}
              onClick={() => onPick(question.id, opt.id)}
              className={cn(
                "flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left text-sm transition",
                active
                  ? "border-hx-accent/60 bg-hx-accent/15 text-hx-text ring-1 ring-hx-accent/40"
                  : "border-hx-border/70 bg-hx-bg/80 text-hx-text hover:border-hx-accent/35 hover:bg-hx-surface-elevated",
                disabled && "cursor-not-allowed opacity-60",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md text-xs font-bold",
                  active ? "bg-hx-accent text-hx-bg" : "bg-hx-surface text-hx-muted",
                )}
              >
                {letter}
              </span>
              <span className="min-w-0 flex-1 leading-snug">{opt.label}</span>
            </button>
          );
        })}
      </div>
      {!instantSubmit && question.multi ? (
        <p className="mt-2 text-[11px] text-hx-muted">Select all that apply, then submit below.</p>
      ) : null}
    </div>
  );
}

export function ChatMcqPanel({ payload, disabled, onSubmit }: Props) {
  const [selections, setSelections] = useState<Record<string, string | string[]>>({});
  const instantSubmit = payload.questions.length === 1 && !payload.questions[0]?.multi;

  const allAnswered = payload.questions.every((q) => {
    const s = selections[q.id];
    if (q.multi) return Array.isArray(s) && s.length > 0;
    return typeof s === "string" && s.length > 0;
  });

  const handlePick = useCallback(
    (questionId: string, optionId: string) => {
      if (disabled) return;
      const q = payload.questions.find((x) => x.id === questionId);
      if (!q) return;

      setSelections((prev) => {
        if (q.multi) {
          const cur = prev[questionId];
          const arr = Array.isArray(cur) ? [...cur] : cur ? [cur] : [];
          const i = arr.indexOf(optionId);
          if (i >= 0) arr.splice(i, 1);
          else arr.push(optionId);
          return { ...prev, [questionId]: arr };
        }
        return { ...prev, [questionId]: optionId };
      });

      if (instantSubmit && !q.multi) {
        onSubmit(
          formatMcqAnswers(payload, {
            ...selections,
            [questionId]: optionId,
          }),
        );
      }
    },
    [disabled, instantSubmit, onSubmit, payload, selections],
  );

  const submitAll = useCallback(() => {
    if (!allAnswered || disabled) return;
    onSubmit(formatMcqAnswers(payload, selections));
  }, [allAnswered, disabled, onSubmit, payload, selections]);

  return (
    <div className="space-y-3">
      {payload.questions.map((q) => (
        <QuestionBlock
          key={q.id}
          question={q}
          disabled={disabled}
          instantSubmit={instantSubmit}
          selection={selections[q.id]}
          onPick={handlePick}
        />
      ))}
      {!instantSubmit ? (
        <Button
          type="button"
          variant="primary"
          size="sm"
          className="w-full sm:w-auto"
          disabled={!allAnswered || disabled}
          onClick={submitAll}
        >
          Send answers
        </Button>
      ) : null}
    </div>
  );
}
