"use client";

import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Map,
  RotateCcw,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ASSISTANT_DRAWER_TABS,
  type AssistantDrawerTab,
} from "@/components/assistant/assistant-drawer-types";
import { AssistantChatPanel } from "@/components/assistant/AssistantChatPanel";
import { GuideChaptersPanel } from "@/components/assistant/GuideChaptersPanel";
import { TourStepIllustration } from "@/components/assistant/TourStepIllustration";
import { Button } from "@/components/ui/button";
import {
  PRODUCT_GUIDE_CHAPTERS,
  filterProductGuideChapters,
} from "@/data/product-guide";
import { PRODUCT_TOUR_STEPS } from "@/data/product-tour";
import { useProductTourOptional } from "@/components/tour/product-tour-context";
import { cn } from "@/lib/cn";

type Props = {
  open: boolean;
  onClose: () => void;
  tab: AssistantDrawerTab;
  onTabChange: (tab: AssistantDrawerTab) => void;
};

export function SystemAssistantDrawer({ open, onClose, tab, onTabChange }: Props) {
  const { push } = useRouter();
  const productTour = useProductTourOptional();
  const [q, setQ] = useState("");
  const [tourStep, setTourStep] = useState(0);

  const filtered = useMemo(
    () => filterProductGuideChapters(PRODUCT_GUIDE_CHAPTERS, q),
    [q],
  );

  const step = PRODUCT_TOUR_STEPS[tourStep] ?? PRODUCT_TOUR_STEPS[0];
  const lastIdx = PRODUCT_TOUR_STEPS.length - 1;

  useEffect(() => {
    if (!open) setQ("");
  }, [open]);

  function goToScreen(href: string) {
    onClose();
    push(href);
  }

  function startLiveTour() {
    if (productTour) {
      onClose();
      void productTour.restartTour();
      return;
    }
    onTabChange("tour");
    setTourStep(0);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-black/60"
        aria-label="Close assistant"
        onClick={onClose}
      />
      <aside
        className="hx-drawer-panel relative flex size-full max-w-lg flex-col border-l border-hx-border bg-hx-surface"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hx-assistant-title"
      >
        <div className="shrink-0 border-b border-hx-border">
          <div className="flex items-center justify-between gap-2 px-4 py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <Sparkles className="size-5 shrink-0 text-hx-accent" aria-hidden />
              <h2
                id="hx-assistant-title"
                className="truncate text-sm font-bold tracking-wide text-hx-text"
              >
                AI Assistant
              </h2>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {productTour ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-hx-muted transition hover:bg-hx-surface-elevated hover:text-hx-text"
                  onClick={startLiveTour}
                >
                  <RotateCcw className="size-3" aria-hidden />
                  Run spotlight tour
                </button>
              ) : null}
              <button
                type="button"
                className="rounded p-2 text-hx-muted hover:bg-hx-surface-elevated hover:text-hx-text"
                onClick={onClose}
                aria-label="Close"
              >
                <X className="size-5" />
              </button>
            </div>
          </div>

          <nav
            className="flex gap-1 px-3 pb-2.5"
            aria-label="Assistant panel sections"
          >
            {ASSISTANT_DRAWER_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                className={cn(
                  "flex-1 rounded-lg p-2 text-center text-[11px] font-semibold uppercase tracking-wide transition sm:text-xs",
                  tab === t.id
                    ? "border border-hx-accent/40 bg-hx-accent/12 text-hx-accent shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                    : "border border-transparent text-hx-muted hover:border-hx-border hover:bg-hx-surface-elevated hover:text-hx-text",
                )}
                onClick={() => onTabChange(t.id)}
              >
                <span className="hidden sm:inline">{t.label}</span>
                <span className="sm:hidden">{t.shortLabel}</span>
              </button>
            ))}
          </nav>
        </div>

        {tab === "tour" && (
          <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
            <div className="flex shrink-0 items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-hx-accent">
                <Map className="size-3.5 shrink-0" aria-hidden />
                Interactive tour
              </div>
              {!productTour ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-hx-muted transition hover:bg-hx-surface-elevated hover:text-hx-text"
                  onClick={startLiveTour}
                >
                  <RotateCcw className="size-3" aria-hidden />
                  Restart
                </button>
              ) : null}
            </div>
            <p className="shrink-0 text-xs text-hx-muted">
              Step {tourStep + 1} of {PRODUCT_TOUR_STEPS.length}
              {productTour
                ? " , use Run spotlight tour in the header for highlights on each screen."
                : " , Next walks the product; Open jumps to that screen."}
            </p>
            <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-hx-border bg-hx-bg/80 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] sm:p-6">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-hx-accent">
                Step {tourStep + 1}
              </p>
              <h3 className="mt-2 text-lg font-semibold leading-snug text-hx-text sm:text-xl">
                {step.title}
              </h3>
              <p className="mt-3 shrink-0 text-sm leading-relaxed text-hx-muted sm:text-[15px] sm:leading-relaxed">
                {step.body}
              </p>
              <TourStepIllustration stepId={step.id} className="mt-4" />
              <div className="mt-6 shrink-0 space-y-4 border-t border-hx-border/80 pt-5">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  className="gap-1"
                  disabled={tourStep <= 0}
                  onClick={() => setTourStep((s) => Math.max(0, s - 1))}
                >
                  <ChevronLeft className="size-4" aria-hidden />
                  Back
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  className="gap-1"
                  disabled={tourStep >= lastIdx}
                  onClick={() => setTourStep((s) => Math.min(lastIdx, s + 1))}
                >
                  Next
                  <ChevronRight className="size-4" aria-hidden />
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  type="button"
                  className="min-w-[8rem]"
                  onClick={() => goToScreen(step.href)}
                >
                  {step.ctaLabel}
                </Button>
              </div>
              <div
                className="flex flex-wrap gap-2"
                role="tablist"
                aria-label="Tour steps"
              >
                {PRODUCT_TOUR_STEPS.map((s, i) => (
                  <button
                    key={s.id}
                    type="button"
                    role="tab"
                    aria-selected={i === tourStep}
                    aria-label={`Tour step ${i + 1}: ${s.title}`}
                    title={s.title}
                    className={cn(
                      "h-2.5 min-w-[1.5rem] flex-1 rounded-full transition sm:max-w-[3rem] sm:flex-none",
                      i === tourStep ? "bg-hx-accent" : "bg-hx-border hover:bg-hx-accent/30",
                    )}
                    onClick={() => setTourStep(i)}
                  />
                ))}
              </div>
              </div>
            </div>
          </div>
        )}

        {tab === "guide" && (
          <>
            <div className="shrink-0 border-b border-hx-border px-4 py-3">
              <Link
                href="/guide"
                onClick={onClose}
                className="flex items-center justify-between gap-3 rounded-lg border border-hx-accent/35 bg-hx-accent/8 px-3 py-2.5 text-sm font-medium text-hx-accent transition hover:bg-hx-accent/15"
              >
                <span className="inline-flex items-center gap-2">
                  <BookOpen className="size-4" aria-hidden />
                  Open full guide page
                </span>
                <ExternalLink className="size-4 opacity-70" aria-hidden />
              </Link>
              <div className="relative mt-3">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-hx-muted" />
                <input
                  type="search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search chapters…"
                  aria-label="Search guide chapters"
                  className="w-full rounded-lg border border-hx-border bg-hx-bg py-2 pl-10 pr-3 text-sm text-hx-text placeholder:text-hx-muted focus:border-hx-accent focus:outline-none"
                />
              </div>
            </div>
            <div className="scrollbar-hx min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
              <GuideChaptersPanel chapters={filtered} onNavigate={onClose} />
            </div>
          </>
        )}

        {tab === "assistant" && (
          <AssistantChatPanel active={open} expanded />
        )}

      </aside>
    </div>
  );
}
