/** Interactive MCQ blocks embedded in assistant chat (` ```hx-mcq ` `` JSON). */

export type ChatMcqOption = {
  id: string;
  label: string;
};

export type ChatMcqQuestion = {
  id: string;
  prompt: string;
  options: ChatMcqOption[];
  /** When true, user may pick multiple options before submit. */
  multi?: boolean;
};

export type ChatMcqPayload = {
  version: 1;
  questions: ChatMcqQuestion[];
};

export type ChatContentSegment =
  | { type: "markdown"; content: string }
  | { type: "mcq"; payload: ChatMcqPayload };

const HX_MCQ_FENCE = /```hx-mcq\s*\n?([\s\S]*?)```/gi;

function normalizePayload(raw: unknown): ChatMcqPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const questions = o.questions;
  if (!Array.isArray(questions) || questions.length === 0) return null;

  const normalized: ChatMcqQuestion[] = [];
  for (const q of questions) {
    if (!q || typeof q !== "object") continue;
    const row = q as Record<string, unknown>;
    const id = String(row.id ?? "").trim();
    const prompt = String(row.prompt ?? "").trim();
    const opts = row.options;
    if (!id || !prompt || !Array.isArray(opts) || opts.length < 2) continue;
    const options: ChatMcqOption[] = [];
    for (const opt of opts) {
      if (!opt || typeof opt !== "object") continue;
      const or = opt as Record<string, unknown>;
      const oid = String(or.id ?? "").trim();
      const label = String(or.label ?? "").trim();
      if (oid && label) options.push({ id: oid, label });
    }
    if (options.length < 2) continue;
    normalized.push({
      id,
      prompt,
      options,
      multi: row.multi === true,
    });
  }
  if (normalized.length === 0) return null;
  return { version: 1, questions: normalized };
}

export function parseChatMcqPayload(jsonText: string): ChatMcqPayload | null {
  try {
    return normalizePayload(JSON.parse(jsonText.trim()));
  } catch {
    return null;
  }
}

/** Drop an unfinished ```hx-mcq fence while the model is still streaming. */
export function stripIncompleteMcqFence(content: string): string {
  const text = content ?? "";
  const open = text.toLowerCase().lastIndexOf("```hx-mcq");
  if (open < 0) return text;
  const after = text.slice(open + "```hx-mcq".length);
  if (after.includes("```")) return text;
  const head = text.slice(0, open).trimEnd();
  return head ? `${head}\n\n_Loading choices…_` : "_Loading choices…_";
}

/** Split assistant copy into markdown + interactive MCQ segments. */
export function splitChatContentSegments(content: string): ChatContentSegment[] {
  const text = stripIncompleteMcqFence(content ?? "");
  const segments: ChatContentSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  HX_MCQ_FENCE.lastIndex = 0;

  while ((match = HX_MCQ_FENCE.exec(text)) !== null) {
    const before = text.slice(lastIndex, match.index).trim();
    if (before) segments.push({ type: "markdown", content: before });

    const payload = parseChatMcqPayload(match[1] ?? "");
    if (payload) segments.push({ type: "mcq", payload });
    else {
      // Broken JSON — show a readable fallback instead of raw fence + braces
      segments.push({
        type: "markdown",
        content: "_Choice block could not be parsed. Reply in plain text if needed._",
      });
    }
    lastIndex = match.index + match[0].length;
  }

  const tail = text.slice(lastIndex).trim();
  if (tail) segments.push({ type: "markdown", content: tail });

  if (segments.length === 0 && text.trim()) {
    return [{ type: "markdown", content: text.trim() }];
  }
  return segments;
}

export function formatMcqAnswers(
  payload: ChatMcqPayload,
  selections: Record<string, string | string[]>,
): string {
  const lines: string[] = ["[MCQ answers]"];
  for (const q of payload.questions) {
    const sel = selections[q.id];
    if (!sel) continue;
    const ids = Array.isArray(sel) ? sel : [sel];
    const labels = ids
      .map((id) => q.options.find((o) => o.id === id)?.label)
      .filter(Boolean);
    lines.push(`${q.prompt}`);
    lines.push(`→ ${labels.join("; ")}`);
  }
  return lines.join("\n");
}

export function hasChatMcqBlock(content: string): boolean {
  HX_MCQ_FENCE.lastIndex = 0;
  return HX_MCQ_FENCE.test(content);
}
