"use client";

import type { ReactNode } from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

export type MarkdownVariant = "block" | "inline";

/** Allow only safe URL schemes in rendered markdown links. */
function safeMarkdownHref(href: string | undefined): string | undefined {
  if (!href) return undefined;
  const trimmed = href.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("#") || trimmed.startsWith("/")) return trimmed;
  try {
    const url = new URL(trimmed);
    const scheme = url.protocol.replace(/:$/, "").toLowerCase();
    if (scheme === "http" || scheme === "https" || scheme === "mailto" || scheme === "tel") {
      return trimmed;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

type Props = {
  children: string;
  className?: string;
  /** Use softer body color for secondary panels */
  muted?: boolean;
  /** `inline` avoids block wrappers where headings/lists would break layout (e.g. card titles). */
  variant?: MarkdownVariant;
};

/**
 * Renders assistant/user copy that may include **bold**, lists, links, and code fences.
 */
export function MarkdownText({
  children,
  className = "",
  muted = false,
  variant = "block",
}: Props) {
  const body = muted ? "text-hx-muted" : "text-hx-text";
  const strongClass = muted ? "font-semibold text-hx-text" : "font-semibold text-hx-text";

  const P: Components["p"] =
    variant === "inline"
      ? ({ children: c }) => <span className={`block ${body} leading-relaxed last:mb-0`}>{c}</span>
      : ({ children: c }) => <p className={`mb-2 leading-relaxed last:mb-0 ${body}`}>{c}</p>;

  const components: Components = {
    p: P,
    strong: ({ children: c }) => <strong className={strongClass}>{c}</strong>,
    em: ({ children: c }) => <em className="italic text-hx-muted">{c}</em>,
    ul: ({ children: c }) => (
      <ul className={`my-2 list-disc space-y-1 pl-5 last:mb-0 ${body}`}>{c}</ul>
    ),
    ol: ({ children: c }) => (
      <ol className={`my-2 list-decimal space-y-1 pl-5 last:mb-0 ${body}`}>{c}</ol>
    ),
    li: ({ children: c }) => <li className="leading-relaxed">{c}</li>,
    h1: ({ children: c }) => (
      <h3 className="mb-2 mt-3 text-base font-bold text-hx-accent first:mt-0">{c}</h3>
    ),
    h2: ({ children: c }) => (
      <h3 className="mb-2 mt-3 text-sm font-bold text-hx-accent first:mt-0">{c}</h3>
    ),
    h3: ({ children: c }) => (
      <h4 className="mb-1 mt-2 text-sm font-semibold text-hx-accent first:mt-0">{c}</h4>
    ),
    a: ({ href, children: c }) => {
      const safe = safeMarkdownHref(href);
      if (!safe) return <span className="text-hx-muted">{c}</span>;
      const external = !safe.startsWith("#") && !safe.startsWith("/");
      return (
        <a
          href={safe}
          className="font-medium text-hx-accent underline underline-offset-2 hover:text-hx-accent-bright"
          {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        >
          {c}
        </a>
      );
    },
    blockquote: ({ children: c }) => (
      <blockquote className="my-2 border-l-2 border-hx-accent/40 pl-3 italic text-hx-muted">{c}</blockquote>
    ),
    hr: () => <hr className="my-3 border-hx-border" />,
    table: ({ children: c }) => (
      <div className="my-2 max-w-full overflow-x-auto">
        <table className="w-full border-collapse text-sm">{c}</table>
      </div>
    ),
    thead: ({ children: c }) => (
      <thead className="border-b border-hx-border bg-hx-surface-elevated/60">{c}</thead>
    ),
    th: ({ children: c }) => (
      <th className="border border-hx-border px-2 py-1.5 text-left font-semibold text-hx-text">{c}</th>
    ),
    td: ({ children: c }) => (
      <td className="border border-hx-border/70 px-2 py-1.5 align-top">{c}</td>
    ),
    code: (props: { className?: string; children?: ReactNode; inline?: boolean }) => {
      const { className, children: c, inline } = props;
      if (inline) {
        return (
          <code className="rounded bg-hx-surface-elevated px-1 py-0.5 font-mono text-[0.85em] text-hx-accent-bright">
            {c}
          </code>
        );
      }
      return (
        <code
          className={`block overflow-x-auto rounded-lg bg-hx-surface-elevated p-3 font-mono text-xs leading-relaxed ${className ?? ""}`}
        >
          {c}
        </code>
      );
    },
    pre: ({ children: c }) => (
      <pre className="my-2 max-w-full overflow-x-auto rounded-lg border border-hx-border/50 bg-hx-bg p-0">{c}</pre>
    ),
  };

  return (
    <div className={`hx-markdown min-w-0 break-words ${className}`.trim()}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
