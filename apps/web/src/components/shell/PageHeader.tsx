"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import type { AssistantDrawerTab } from "@/components/assistant/assistant-drawer-types";
import { AssistantLaunchControl } from "@/components/assistant/AssistantLaunchControl";
import { SystemAssistantDrawer } from "@/components/assistant/SystemAssistantDrawer";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/cn";

type PageHeaderProps = {
  title: string;
  subtitle: string;
  className?: string;
  /** Dashboard: compact Chat-style row , title + live badge left, actions right. */
  variant?: "default" | "dashboard";
  /** Dashboard only: page actions before AI Assistant (right column, vertically centered). */
  trailingActions?: ReactNode;
};

export function PageHeader({
  title,
  subtitle,
  className,
  variant = "default",
  trailingActions,
}: PageHeaderProps) {
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<AssistantDrawerTab>("assistant");

  function openDrawer(tab: AssistantDrawerTab) {
    setDrawerTab(tab);
    setAssistantOpen(true);
  }

  const status = (
    <StatusBadge variant="success" dot className="hx-status-pill shrink-0">
      Live
    </StatusBadge>
  );

  const assistantControl = (
    <AssistantLaunchControl
      assistantOpen={assistantOpen}
      onOpenDrawer={openDrawer}
    />
  );

  const drawer = (
    <SystemAssistantDrawer
      open={assistantOpen}
      onClose={() => setAssistantOpen(false)}
      tab={drawerTab}
      onTabChange={setDrawerTab}
    />
  );

  if (variant === "dashboard") {
    return (
      <>
        <header className={cn(className)}>
          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
            <div className="min-w-0 flex-1 lg:max-w-2xl">
              <div className="flex flex-wrap items-center gap-1.5">
                <h1 className="text-lg font-bold tracking-wide text-hx-text sm:text-xl">{title}</h1>
                {status}
              </div>
              <p className="mt-0 max-w-xl text-pretty text-xs leading-tight text-hx-muted sm:text-[13px] sm:leading-snug">
                {subtitle}
              </p>
            </div>
            <div className="flex max-w-full items-center justify-start gap-1.5 max-sm:flex-wrap sm:shrink-0 sm:flex-nowrap sm:justify-end [&>button]:shrink-0 [&_.hx-assistant-shell]:shrink-0">
              {trailingActions}
              {assistantControl}
            </div>
          </div>
        </header>
        {drawer}
      </>
    );
  }

  return (
    <>
      <header
        className={cn(
          "flex flex-col gap-3 border-b border-hx-border/80 pb-4 sm:flex-row sm:items-start sm:justify-between",
          className,
        )}
      >
        <div className="space-y-2">
          <h1 className="text-balance text-xl font-semibold tracking-[0.12em] text-hx-text sm:text-2xl">
            {title}
          </h1>
          <p className="max-w-2xl text-pretty text-sm leading-relaxed text-hx-muted">
            {subtitle}
          </p>
          <div className="flex items-center gap-2 pt-0.5">{status}</div>
        </div>
        {assistantControl}
      </header>
      {drawer}
    </>
  );
}
