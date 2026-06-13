"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ChevronRight, Sparkles } from "lucide-react";
import { PRODUCT_GUIDE_CHAPTERS } from "@/data/product-guide";
import { DashboardHero } from "@/components/shell/DashboardHero";
import { PageHeader } from "@/components/shell/PageHeader";
import { Card } from "@/components/ui/card";
import { MarkdownText } from "@/components/ui/markdown-text";
import { SectionTitle } from "@/components/ui/section-title";
import { cn } from "@/lib/cn";

export function GuideClient() {
  const [activeId, setActiveId] = useState(PRODUCT_GUIDE_CHAPTERS[0]?.id ?? "");

  const onScroll = useCallback(() => {
    const ids = PRODUCT_GUIDE_CHAPTERS.map((c) => c.id);
    const mid = window.scrollY + window.innerHeight * 0.25;
    for (let i = ids.length - 1; i >= 0; i--) {
      const el = document.getElementById(ids[i]!);
      if (el && el.offsetTop <= mid) {
        setActiveId(ids[i]!);
        break;
      }
    }
  }, []);

  useEffect(() => {
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [onScroll]);

  const linkBtnClass =
    "inline-flex items-center justify-center gap-2 rounded-md border border-hx-accent px-3 py-1.5 text-xs font-medium text-hx-accent transition hover:bg-hx-accent/10";

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-hx-bg">
      <DashboardHero>
        <PageHeader
          variant="dashboard"
          title="PRODUCT GUIDE"
          subtitle="How each area works, why it matters, and what to do first."
        />
      </DashboardHero>

      <div className="scrollbar-hide min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-8 lg:flex-row lg:items-start lg:gap-10">
          <nav
            aria-label="Guide sections"
            className="scrollbar-hide shrink-0 overflow-x-auto lg:sticky lg:top-24 lg:w-56 lg:overflow-visible"
          >
            <p className="mb-2 hidden text-[10px] font-semibold uppercase tracking-wider text-hx-muted lg:block">
              On this page
            </p>
            <ul className="flex gap-2 lg:flex-col lg:gap-0.5">
              {PRODUCT_GUIDE_CHAPTERS.map((c) => (
                <li key={c.id} className="shrink-0 lg:w-full">
                  <a
                    href={`#${c.id}`}
                    className={cn(
                      "flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-medium transition lg:border-transparent lg:px-2 lg:py-1.5 lg:text-sm",
                      activeId === c.id
                        ? "border-hx-accent/40 bg-hx-accent/10 text-hx-accent lg:bg-hx-accent/15"
                        : "border-hx-border bg-hx-surface text-hx-muted hover:border-hx-border hover:bg-hx-surface-elevated hover:text-hx-text lg:border-transparent lg:bg-transparent",
                    )}
                    onClick={(e) => {
                      e.preventDefault();
                      document.getElementById(c.id)?.scrollIntoView({
                        behavior: "smooth",
                        block: "start",
                      });
                    }}
                  >
                    <ChevronRight className="hidden size-3.5 shrink-0 opacity-70 lg:block" />
                    {c.navLabel}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="min-w-0 flex-1 space-y-10 pb-16 lg:space-y-12 lg:pb-20">
            <Card className="border-hx-border/80 bg-hx-surface/60 p-5 sm:p-6">
              <div className="flex gap-3">
                <Sparkles className="mt-0.5 size-5 shrink-0 text-hx-accent" />
                <div>
                  <p className="text-sm font-semibold text-hx-text">
                    Read in order or jump via the outline
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-hx-muted">
                    Each block explains the <strong>impact</strong> on decisions and execution, then
                    gives concrete <strong>workflows</strong> and shortcuts to the live screen.
                  </p>
                </div>
              </div>
            </Card>

            {PRODUCT_GUIDE_CHAPTERS.map((chapter) => (
              <article
                key={chapter.id}
                id={chapter.id}
                className="scroll-mt-24 sm:scroll-mt-28"
              >
                <Card className="border border-hx-border/80 bg-hx-surface p-6 shadow-sm sm:p-8">
                  <p className="text-xs font-semibold uppercase tracking-widest text-hx-accent">
                    {chapter.navLabel}
                  </p>
                  <h2 className="mt-2 text-xl font-bold tracking-tight text-hx-text sm:text-2xl">
                    {chapter.title}
                  </h2>
                  <p className="mt-1 text-sm font-medium text-hx-muted">{chapter.tagline}</p>

                  <div className="mt-5 border-t border-hx-border/60 pt-5">
                    <MarkdownText className="text-sm leading-relaxed">
                      {chapter.intro}
                    </MarkdownText>
                  </div>

                  <div className="mt-6">
                    <SectionTitle>Why it matters</SectionTitle>
                    <ul className="mt-3 space-y-2">
                      {chapter.impact.map((line) => (
                        <li key={line} className="flex gap-2 text-sm text-hx-text">
                          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-hx-accent" />
                          <span className="leading-relaxed">{line}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {chapter.workflows.map((w) => (
                    <div key={w.title} className="mt-6">
                      <SectionTitle>{w.title}</SectionTitle>
                      <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-hx-text">
                        {w.steps.map((step) => (
                          <li key={step} className="pl-1 marker:text-hx-accent">
                            {step}
                          </li>
                        ))}
                      </ol>
                    </div>
                  ))}

                  <div className="mt-6 flex flex-wrap gap-2">
                    {chapter.tryIt.map((t) => (
                      <Link
                        key={t.href + t.label}
                        href={t.href}
                        className={linkBtnClass}
                      >
                        {t.label}
                      </Link>
                    ))}
                  </div>

                  {chapter.proTips.length > 0 && (
                    <div className="mt-6 rounded-lg border border-hx-border/50 bg-hx-bg/80 px-4 py-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-hx-muted">
                        Pro tips
                      </p>
                      <ul className="mt-2 space-y-1.5 text-sm text-hx-muted">
                        {chapter.proTips.map((tip) => (
                          <li key={tip} className="leading-relaxed">
                            • {tip}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </Card>
              </article>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
