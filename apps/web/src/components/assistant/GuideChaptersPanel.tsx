"use client";

import Link from "next/link";
import { MarkdownText } from "@/components/ui/markdown-text";
import type { GuideChapter } from "@/data/product-guide";

type Props = {
  chapters: GuideChapter[];
  onNavigate?: () => void;
};

export function GuideChaptersPanel({ chapters, onNavigate }: Props) {
  if (chapters.length === 0) {
    return <p className="text-sm text-hx-muted">No chapters match your search.</p>;
  }

  return (
    <>
      {chapters.map((ch) => (
        <section
          key={ch.id}
          className="rounded-lg border border-hx-border bg-hx-bg/80 p-3"
        >
          <h3 className="text-xs font-bold uppercase tracking-wider text-hx-accent">
            {ch.navLabel}
          </h3>
          <p className="mt-1 text-[11px] font-medium text-hx-text">{ch.title}</p>
          <p className="text-[11px] text-hx-muted">{ch.tagline}</p>
          <MarkdownText muted className="mt-2 text-xs leading-relaxed">
            {ch.intro}
          </MarkdownText>
          <details className="mt-2 rounded-md border border-hx-border border-opacity-60 bg-hx-surface/50 px-2 py-1.5">
            <summary className="cursor-pointer text-[11px] font-semibold text-hx-text">
              Impact, workflows & tips
            </summary>
            <ul className="mt-2 list-inside list-disc space-y-1 text-[11px] text-hx-muted">
              {ch.impact.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <div className="mt-3 space-y-2">
              {ch.workflows.map((w) => (
                <div key={w.title}>
                  <p className="text-[11px] font-semibold text-hx-text">{w.title}</p>
                  <ol className="mt-1 list-inside list-decimal space-y-0.5 text-[11px] text-hx-muted">
                    {w.steps.map((st) => (
                      <li key={st}>{st}</li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
            {ch.tryIt.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {ch.tryIt.map((t) => (
                  <Link
                    key={t.href + t.label}
                    href={t.href}
                    onClick={onNavigate}
                    className="rounded-md border border-hx-accent px-2 py-1 text-[11px] font-medium text-hx-accent transition hover:bg-hx-accent/10"
                  >
                    {t.label}
                  </Link>
                ))}
              </div>
            )}
            <ul className="mt-2 space-y-1 border-t border-hx-border border-opacity-50 pt-2 text-[11px] text-hx-muted">
              {ch.proTips.map((tip) => (
                <li key={tip}>
                  <MarkdownText muted variant="inline" className="text-[11px]">
                    {tip}
                  </MarkdownText>
                </li>
              ))}
            </ul>
          </details>
        </section>
      ))}
    </>
  );
}
