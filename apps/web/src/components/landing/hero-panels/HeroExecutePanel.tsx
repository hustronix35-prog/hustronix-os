"use client";

import { AlertTriangle } from "lucide-react";
import { HustrionixLogo } from "@/components/shell/HustrionixLogo";
import { Card } from "@/components/ui/card";
import { SectionTitle } from "@/components/ui/section-title";
import { SegmentTabs } from "@/components/ui/segment-tabs";
import { StatusBadge } from "@/components/ui/status-badge";
import { executions } from "@/data/executions";
import { capacityStatus } from "@/data/mission-control";
import type { ExecutionRow } from "@/data/types";
import { cn } from "@/lib/cn";
import { HeroPageHeader, HeroPanelBody } from "./shared";

const EXEC_TABS = ["ACTIVE", "BLOCKED", "PENDING", "COMPLETED"] as const;

function ledgerExecStatusVariant(
  s: ExecutionRow["status"],
): "danger" | "warning" | "success" | "neutral" {
  if (s === "BLOCKED") return "danger";
  if (s === "PENDING") return "warning";
  if (s === "ACTIVE") return "success";
  return "neutral";
}

function dueToneClass(tone: ExecutionRow["dueTone"]) {
  if (tone === "overdue") return "text-hx-danger font-medium";
  if (tone === "soon") return "text-hx-success font-medium";
  return "text-hx-muted";
}

/** Execute route , segment tabs, ledger table, and right inspector column. */
export function HeroExecutePanel() {
  const cap = capacityStatus;
  const rows = executions.slice(0, 4);
  const selected = rows[0]!;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <HeroPageHeader
        variant="execute"
        title="EXECUTION"
        subtitle="Control and monitor all executions linked to active decisions."
      />
      <HeroPanelBody className="gap-2 p-0 sm:p-0 md:p-0">
        <div className="flex min-h-0 flex-1 flex-col gap-2 px-1.5 pb-1.5 pt-1.5 sm:px-2 md:gap-2.5 md:px-2.5 md:pb-2.5 md:pt-2">
          <Card className="flex flex-wrap items-center gap-2 border-hx-danger/45 bg-hx-danger/10 px-2 py-1.5 md:px-2.5 md:py-2">
            <AlertTriangle className="size-4 shrink-0 text-hx-danger md:h-5 md:w-5" />
            <p className="min-w-0 flex-1 text-[8px] font-semibold leading-snug text-hx-danger md:text-[9px]">
              SYSTEM OVER CAPACITY , {cap.loadPct}% load
            </p>
          </Card>

          <SegmentTabs
            value="ACTIVE"
            onChange={() => {}}
            items={EXEC_TABS.map((t) => ({ value: t, label: t }))}
            className="max-w-full scale-[0.92] origin-left md:scale-100"
          />

          <div className="flex min-h-0 flex-1 gap-1.5 md:gap-2">
            <Card className="min-w-0 flex-1 overflow-hidden border-hx-border bg-hx-surface p-0 shadow-none">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[220px] text-left text-[8px] md:text-[9px]">
                  <thead className="border-b border-hx-border bg-hx-surface-elevated/50 text-[7px] font-semibold uppercase tracking-wide text-hx-muted md:text-[8px]">
                    <tr>
                      <th className="px-2 py-1.5 font-medium md:px-2.5">Task</th>
                      <th className="hidden px-2 py-1.5 font-medium sm:table-cell md:px-2.5">
                        Owner
                      </th>
                      <th className="px-2 py-1.5 font-medium md:px-2.5">Status</th>
                      <th className="hidden px-2 py-1.5 font-medium md:table-cell md:px-2.5">
                        Due
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-hx-border">
                    {rows.map((row, i) => (
                      <tr
                        key={row.id}
                        className={cn(
                          i === 0 &&
                            "bg-hx-accent/5 ring-1 ring-inset ring-hx-accent/40",
                          row.status === "BLOCKED" && "border-l-2 border-l-hx-danger",
                        )}
                      >
                        <td className="max-w-[9rem] px-2 py-1.5 align-top md:max-w-[11rem] md:px-2.5">
                          <span className="line-clamp-2 font-semibold leading-snug text-hx-text">
                            {row.task}
                          </span>
                        </td>
                        <td className="hidden whitespace-nowrap px-2 py-1.5 sm:table-cell md:px-2.5">
                          <span className="inline-flex size-5 items-center justify-center rounded-full bg-hx-accent/15 text-[7px] font-bold text-hx-accent">
                            {row.ownerInitials}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 md:px-2.5">
                          <StatusBadge
                            variant={ledgerExecStatusVariant(row.status)}
                            dot
                            className="text-[7px] md:text-[8px]"
                          >
                            {row.status}
                          </StatusBadge>
                        </td>
                        <td
                          className={cn(
                            "hidden whitespace-nowrap px-2 py-1.5 md:table-cell md:px-2.5",
                            dueToneClass(row.dueTone),
                          )}
                        >
                          {row.due}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <aside className="hidden w-[38%] max-w-[11rem] shrink-0 flex-col border border-hx-border bg-hx-surface sm:flex md:max-w-[13rem]">
              <div className="border-b border-hx-border px-2 py-1.5 md:px-2.5 md:py-2">
                <SectionTitle className="text-[8px] md:text-[9px]">
                  Task Inspector
                </SectionTitle>
              </div>
              <div className="scrollbar-hide flex-1 space-y-2 overflow-y-auto p-2 md:space-y-2.5 md:p-2.5">
                <div>
                  <p className="text-[9px] font-bold leading-snug text-hx-text md:text-[10px]">
                    {selected.task}
                  </p>
                  <p className="mt-1 line-clamp-3 text-[8px] leading-relaxed text-hx-muted">
                    {selected.description}
                  </p>
                  <div className="mt-1.5">
                    <StatusBadge
                      variant={ledgerExecStatusVariant(selected.status)}
                      dot
                      className="text-[7px] md:text-[8px]"
                    >
                      {selected.status}
                    </StatusBadge>
                  </div>
                </div>
                <dl className="space-y-1 text-[8px] md:text-[9px]">
                  <div className="flex justify-between gap-2">
                    <dt className="text-hx-muted">Owner</dt>
                    <dd className="font-medium text-hx-text">{selected.owner}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-hx-muted">Weight</dt>
                    <dd className="font-mono text-hx-text">{selected.weight}</dd>
                  </div>
                </dl>
                <div className="rounded-md border border-hx-border bg-hx-surface-elevated/50 p-1.5 md:p-2">
                  <SectionTitle className="text-[7px] md:text-[8px]">
                    Linked Decision
                  </SectionTitle>
                  <div className="mt-1 flex gap-1.5">
                    <HustrionixLogo className="size-3.5 shrink-0 opacity-90 md:h-4 md:w-4" />
                    <p className="line-clamp-3 text-[8px] font-medium leading-snug text-hx-text">
                      {selected.decision}
                    </p>
                  </div>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </HeroPanelBody>
    </div>
  );
}
