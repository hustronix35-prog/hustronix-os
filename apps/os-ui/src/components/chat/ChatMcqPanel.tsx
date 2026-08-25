"use client";

import { useCallback, useMemo, useState } from "react";
import {
  formatMcqAnswers,
  type ChatMcqPayload,
  type ChatMcqQuestion,
} from "@/lib/chat-mcq";
import styles from "./chat-message.module.css";

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
    <div className={styles.mcqBlock}>
      <p className={styles.mcqPrompt}>{question.prompt}</p>
      <div className={styles.mcqOptions}>
        {question.options.map((opt, idx) => {
          const letter = String.fromCharCode(65 + idx);
          const active = selectedSet.has(opt.id);
          return (
            <button
              key={opt.id}
              type="button"
              disabled={disabled}
              aria-pressed={active}
              data-active={active ? "true" : "false"}
              className={styles.mcqOption}
              onClick={() => onPick(question.id, opt.id)}
            >
              <span className={styles.mcqLetter}>{letter}</span>
              <span>{opt.label}</span>
            </button>
          );
        })}
      </div>
      {!instantSubmit && question.multi ? (
        <p className={styles.mcqHint}>Select all that apply, then submit below.</p>
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
    <div className={styles.mcqPanel}>
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
        <button
          type="button"
          className={styles.mcqSubmit}
          disabled={!allAnswered || disabled}
          onClick={submitAll}
        >
          Send answers
        </button>
      ) : null}
    </div>
  );
}
