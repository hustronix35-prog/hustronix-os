"use client";

import { AlertTriangle, ChevronRight, Zap } from "lucide-react";
import { DecisionHexTarget } from "@/components/mission/DecisionHexTarget";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionTitle } from "@/components/ui/section-title";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  capacityStatus,
  currentDecision,
  executionsSummary,
  mcExecutionsTable,
} from "@/data/mission-control";
import { HeroPageHeader, HeroPanelBody } from "./shared";

const CAPACITY_SCALE_MAX = 150;

function mcExecStatusVariant(
  status: string,
): "danger" | "warning" | "success" {
  if (status === "BLOCKED") return "danger";
  if (status === "PENDING") return "warning";
  return "success";
}

/** Mission Control dashboard grid , decision + capacity column, executions table below. */
export function HeroMissionControlPanel() {
  const execSum = executionsSummary;
  const cap = capacityStatus;
  const dec = currentDecision;
  const loadBarPct = Math.min((cap.loadPct / CAPACITY_SCALE_MAX) * 100, 100);
  const activeW =
    execSum.total > 0 ? (execSum.active / execSum.total) * 100 : 0;
  const blockedW =
    execSum.total > 0 ? (execSum.blocked / execSum.total) * 100 : 0;
  const tableRows = mcExecutionsTable.slice(0, 3);
  const pendingN = Math.max(
    0,
    execSum.total - execSum.active - execSum.blocked,
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <HeroPageHeader
        variant="mission"
        title="MISSION CONTROL"
        subtitle="Command center for critical decisions and system performance."
      />
      <HeroPanelBody className="gap-2 md:gap-2.5">
        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(112px,140px)] md:gap-2.5">
          <Card className="flex flex-col border-hx-border bg-hx-surface p-0 shadow-none">
            <div className="border-b border-hx-border px-2 py-1.5 md:px-2.5 md:py-2">
              <SectionTitle className="text-[8px] tracking-[0.14em] md:text-[9px] md:tracking-[0.18em]">
                Current Decision
              </SectionTitle>
            </div>
            <div className="flex flex-col gap-2 p-2 sm:flex-row sm:items-start sm:gap-3 md:p-2.5">
              <div className="flex shrink-0 justify-center sm:justify-start">
                <DecisionHexTarget className="size-14 sm:h-[72px] sm:w-[72px]" />
              </div>
              <div className="min-w-0 flex-1 space-y-1.5">
                <p className="text-[11px] font-bold leading-tight tracking-tight text-hx-text sm:text-xs md:text-sm">
                  {dec.title}
                </p>
                <p className="line-clamp-3 text-[9px] leading-relaxed text-hx-muted sm:line-clamp-4 sm:text-[10px]">
                  {dec.description}
                </p>
                <div className="flex flex-wrap gap-1 pt-0.5">
                  <StatusBadge variant="warning" dot className="text-[8px]">
                    UNDER REVIEW
                  </StatusBadge>
                  <span className="inline-flex items-center rounded-full border border-hx-accent px-1.5 py-px text-[8px] font-semibold text-hx-accent">
                    CONFIDENCE {dec.confidence}%
                  </span>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-px border-t border-hx-border bg-hx-border sm:grid-cols-4">
              {[
                { k: "Owner", v: dec.owner },
                { k: "Created", v: dec.created },
                { k: "Priority", v: dec.priority },
                { k: "Active", v: dec.timeActive },
              ].map((row) => (
                <div
                  key={row.k}
                  className="bg-hx-surface p-1.5 md:px-2 md:py-2"
                >
                  <div className="text-[7px] font-semibold uppercase tracking-wider text-hx-muted md:text-[8px]">
                    {row.k}
                  </div>
                  <div className="truncate text-[8px] font-medium text-hx-text md:text-[9px]">
                    {row.v}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="flex flex-col border-hx-border bg-hx-surface p-2 shadow-none md:p-2.5">
            <SectionTitle className="text-[8px] tracking-[0.14em] md:text-[9px]">
              Capacity
            </SectionTitle>
            <p className="mt-1.5 text-xs font-bold leading-none tracking-tight text-hx-danger sm:text-sm md:text-base">
              {cap.headline}
            </p>
            <p className="mt-0.5 text-[7px] font-bold uppercase tracking-[0.12em] text-hx-muted md:text-[8px]">
              {cap.sub}
            </p>
            <p className="mt-2 text-[7px] font-medium text-hx-muted md:text-[8px]">
              Load vs Capacity
            </p>
            <p className="mt-0.5 text-lg font-bold tabular-nums leading-none text-hx-danger md:text-xl">
              {cap.loadPct}%
            </p>
            <div className="mt-1.5 md:mt-2">
              <div className="mb-1 flex justify-between text-[6px] font-semibold uppercase tracking-wider text-hx-muted md:text-[7px]">
                <span>0%</span>
                <span>150%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-hx-surface-elevated md:h-2.5">
                <div
                  className="h-full rounded-full bg-hx-danger"
                  style={{ width: `${loadBarPct}%` }}
                />
              </div>
            </div>
            <div className="mt-2 flex gap-1.5 rounded-md border border-hx-danger/35 bg-hx-danger/10 p-1.5 text-[7px] leading-snug text-hx-muted md:gap-2 md:p-2 md:text-[8px]">
              <AlertTriangle className="mt-0.5 size-3 shrink-0 text-hx-danger md:h-3.5 md:w-3.5" />
              <p className="line-clamp-4">{cap.warning}</p>
            </div>
            <Button
              variant="primary"
              size="sm"
              className="mt-2 w-full py-1.5 text-[8px] md:mt-2.5 md:py-2 md:text-[9px]"
              disabled
              tabIndex={-1}
            >
              <Zap className="size-3 md:h-3.5 md:w-3.5" />
              KILL OR ADJUST
            </Button>
          </Card>
        </div>

        <Card className="flex flex-col border-hx-border bg-hx-surface p-0 shadow-none">
          <div className="flex flex-wrap items-center justify-between gap-1 border-b border-hx-border px-2 py-1.5 md:px-2.5 md:py-2">
            <div>
              <SectionTitle className="text-[8px] tracking-[0.14em] md:text-[9px]">
                Executions
              </SectionTitle>
              <p className="mt-0.5 text-[8px] text-hx-muted md:text-[9px]">
                {execSum.total} Total
              </p>
            </div>
            <span className="text-[8px] font-semibold text-hx-accent md:text-[9px]">
              View all
            </span>
          </div>
          <div className="px-2 py-1.5 md:px-2.5 md:py-2">
            <div className="flex h-2 overflow-hidden rounded-full bg-hx-surface-elevated">
              <div
                className="bg-hx-success transition-all"
                style={{ width: `${activeW}%` }}
              />
              <div
                className="bg-hx-danger transition-all"
                style={{ width: `${blockedW}%` }}
              />
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[7px] font-medium md:text-[8px]">
              <span className="text-hx-success">{execSum.active} Active</span>
              <span className="text-hx-accent">{pendingN} Pending</span>
              <span className="text-hx-danger">{execSum.blocked} Blocked</span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[280px] text-left text-[8px] md:text-[9px]">
              <thead className="border-t border-hx-border bg-hx-surface-elevated/40 text-[7px] font-semibold uppercase tracking-wider text-hx-muted md:text-[8px]">
                <tr>
                  <th className="px-2 py-1.5 font-medium md:px-2.5">
                    Execution
                  </th>
                  <th className="px-2 py-1.5 font-medium md:px-2.5">Owner</th>
                  <th className="px-2 py-1.5 font-medium md:px-2.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hx-border">
                {tableRows.map((row) => (
                  <tr key={row.id} className="hover:bg-hx-surface-elevated/15">
                    <td className="max-w-[120px] px-2 py-1.5 align-middle md:max-w-[180px] md:px-2.5">
                      <span className="line-clamp-2 font-semibold text-hx-text">
                        {row.name}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-hx-text md:px-2.5">
                      <span className="mr-1 inline-flex size-5 items-center justify-center rounded-full bg-hx-accent/15 text-[7px] font-bold text-hx-accent md:h-6 md:w-6 md:text-[8px]">
                        {row.initials}
                      </span>
                      <span className="hidden sm:inline">{row.owner}</span>
                    </td>
                    <td className="px-2 py-1.5 md:px-2.5">
                      <StatusBadge
                        variant={mcExecStatusVariant(row.status)}
                        dot
                        className="text-[7px] md:text-[8px]"
                      >
                        {row.status}
                      </StatusBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-end border-t border-hx-border px-2 py-1 md:px-2.5">
            <span className="inline-flex items-center gap-0.5 text-[8px] font-semibold text-hx-accent md:text-[9px]">
              Open Execute
              <ChevronRight className="size-3" />
            </span>
          </div>
        </Card>
      </HeroPanelBody>
    </div>
  );
}
