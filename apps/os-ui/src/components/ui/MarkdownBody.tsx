"use client";

import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { safeMarkdownHref } from "@/lib/markdown-href";
import { cx } from "@/lib/utils";
import styles from "./markdown.module.css";

const components: Components = {
  h1: ({ children }) => <h2>{children}</h2>,
  h2: ({ children }) => <h2>{children}</h2>,
  h4: ({ children }) => <h3>{children}</h3>,
  a: ({ href, children }) => {
    const safe = safeMarkdownHref(href);
    if (!safe) return <span>{children}</span>;
    const external = !safe.startsWith("#") && !safe.startsWith("/");
    return (
      <a href={safe} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
        {children}
      </a>
    );
  },
  table: ({ children }) => (
    <div className={styles.tableWrap}>
      <table>{children}</table>
    </div>
  ),
};

export function MarkdownBody({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cx(styles.md, className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

