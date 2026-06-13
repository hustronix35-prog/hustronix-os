"use client";

import { Bell, Filter, Link2 } from "lucide-react";
import {
  GitHubIcon,
  JiraIcon,
  ManualSignalIcon,
  SlackIcon,
} from "@/components/icons/brand-icons";
import { Button } from "@/components/ui/button";
import {
  GraceCountdownRing,
  GraceCountdownText,
} from "@/components/ui/grace-countdown-ring";
import { SegmentTabs } from "@/components/ui/segment-tabs";
import { signalsUnverified } from "@/data/signals";
import type { SignalSource } from "@/data/types";
import { cn } from "@/lib/cn";
import { HeroPageHeader, HeroPanelBody } from "./shared";

function BrandSourceIcon({
  source,
  className,
}: {
  source: SignalSource;
  className?: string;
}) {
  switch (source) {
    case "slack":
      return <SlackIcon className={className} />;
    case "github":
      return <GitHubIcon className={className} />;
    case "jira":
      return <JiraIcon className={className} />;
    default:
      return <ManualSignalIcon className={className} />;
  }
}

/** Signals route , segment tabs, source rows with grace rings (matches live Signals page). */
export function HeroSignalsPanel() {
  const rows = signalsUnverified.slice(0, 2);
  const selectedId = rows[0]?.id;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <HeroPageHeader
        variant="signals"
        title="SIGNALS"
        subtitle="Real-world activity. Awaiting validation."
        trailing={
          <>
            <span className="relative flex size-6 items-center justify-center rounded-md border border-hx-border text-hx-muted md:h-7 md:w-7">
              <Bell className="size-3 md:h-3.5 md:w-3.5" />
              <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-hx-accent px-0.5 text-[7px] font-bold text-[#0a0a0a]">
                5
              </span>
            </span>
            <span className="flex h-6 items-center gap-1 rounded-md border border-hx-border px-1.5 text-[7px] font-semibold text-hx-muted md:h-7 md:px-2 md:text-[8px]">
              <Filter className="size-3" />
              Filter
            </span>
          </>
        }
      />
      <HeroPanelBody className="gap-2">
        <SegmentTabs
          value="unverified"
          onChange={() => {}}
          items={[
            { value: "unverified", label: "UNVERIFIED (5)" },
            { value: "linked", label: "LINKED (2)" },
            { value: "killed", label: "KILLED (1)" },
          ]}
          layout="wide"
          className="max-w-full scale-[0.9] origin-left md:scale-100"
        />

        <div className="space-y-2 md:space-y-2.5">
          {rows.map((sig) => {
            const isSel = sig.id === selectedId;
            const displayChannel = sig.channel || sig.tag || sig.source;
            return (
              <article
                key={sig.id}
                className={cn(
                  "rounded-lg border bg-[#0d0d0d] p-2 transition md:rounded-xl md:p-2.5",
                  isSel
                    ? "border-hx-accent shadow-[0_0_0_1px_rgba(212,175,55,0.35)]"
                    : "border-hx-border",
                )}
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between md:gap-3">
                  <div className="flex min-w-0 flex-1 gap-2 md:gap-3">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-hx-surface-elevated md:h-10 md:w-10">
                      <BrandSourceIcon
                        source={sig.source}
                        className="size-4 md:h-5 md:w-5"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[7px] text-hx-muted md:text-[8px]">
                        <span className="font-medium text-hx-text/90">
                          {displayChannel}
                        </span>
                        {sig.author ? (
                          <>
                            <span className="mx-1 text-hx-border">·</span>
                            <span>{sig.author}</span>
                          </>
                        ) : null}
                      </p>
                      <h2 className="mt-0.5 text-[10px] font-semibold leading-snug text-hx-text md:text-[11px]">
                        {sig.title}
                      </h2>
                      <p className="mt-0.5 line-clamp-2 text-[8px] leading-relaxed text-hx-muted md:text-[9px]">
                        {sig.description}
                      </p>
                      {sig.categoryTag ? (
                        <span className="mt-1 inline-flex rounded-md border border-hx-border bg-hx-surface px-1.5 py-px text-[7px] font-medium text-hx-muted">
                          {sig.categoryTag}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2 md:gap-3">
                    <div className="flex flex-col items-center gap-0.5">
                      <GraceCountdownRing
                        detectedAt={sig.detectedAt}
                        graceEndsAt={sig.graceEndsAt}
                        fallbackLabel={sig.expiresLabel}
                        urgent={sig.urgent}
                        className="!h-10 !w-10 md:!h-11 md:!w-11"
                      />
                      <GraceCountdownText
                        detectedAt={sig.detectedAt}
                        graceEndsAt={sig.graceEndsAt}
                        fallbackLabel={sig.expiresLabel}
                        className="text-[7px] md:text-[8px]"
                      />
                    </div>
                    <Button
                      variant="outlineGold"
                      size="sm"
                      type="button"
                      disabled
                      tabIndex={-1}
                      className="hidden gap-1 whitespace-nowrap px-2 py-1 text-[7px] sm:inline-flex md:text-[8px]"
                    >
                      <Link2 className="size-3" />
                      Link
                    </Button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        <p className="text-[7px] text-hx-muted md:text-[8px]">
          Showing {rows.length} of 5 signals
        </p>
      </HeroPanelBody>
    </div>
  );
}
