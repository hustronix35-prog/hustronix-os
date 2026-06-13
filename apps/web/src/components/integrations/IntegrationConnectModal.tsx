"use client";

import type { ReactNode } from "react";
import {
  Calendar,
  FileText,
  Mail,
  MessageSquare,
  MoreHorizontal,
  Users,
  Workflow,
  X,
} from "lucide-react";
import { useEffect } from "react";
import {
  GitHubIcon,
  JiraIcon,
  SlackIcon,
} from "@/components/icons/brand-icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { IntegrationDefinition } from "@/data/settings";
import { openIntegrationOAuthPopup } from "@/lib/oauth-window";

function HustronixMark({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex size-11 shrink-0 items-center justify-center rounded-2xl border border-white/15 bg-black/40",
        className,
      )}
      aria-hidden
    >
      <span className="text-xl font-black tracking-tight text-hx-accent">H</span>
    </div>
  );
}

function ProviderLogo({ integration }: { integration: IntegrationDefinition }) {
  const wrap = "flex size-11 shrink-0 items-center justify-center rounded-2xl bg-white/[0.06] p-2";
  switch (integration.id) {
    case "slack":
      return (
        <div className={wrap}>
          <SlackIcon className="size-9" />
        </div>
      );
    case "github":
      return (
        <div className={wrap}>
          <GitHubIcon className="size-9 text-white" />
        </div>
      );
    case "google_calendar":
      return (
        <div className={cn(wrap, "text-[#4285F4]")}>
          <Calendar className="size-8" strokeWidth={2} />
        </div>
      );
    case "notion":
      return (
        <div className={wrap}>
          <FileText className="size-8 text-white/90" />
        </div>
      );
    case "gmail":
      return (
        <div className={wrap}>
          <Mail className="size-8 text-red-400" />
        </div>
      );
    case "jira":
      return (
        <div className={wrap}>
          <JiraIcon className="size-9" />
        </div>
      );
    case "linear":
      return (
        <div className={wrap}>
          <Workflow className="size-8 text-[#5E6AD2]" />
        </div>
      );
    case "ms_teams":
      return (
        <div className={wrap}>
          <Users className="size-8 text-[#6264A7]" />
        </div>
      );
    default:
      return (
        <div className={wrap}>
          <MessageSquare className="size-8 text-white/80" />
        </div>
      );
  }
}

function InfoBlock({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="border-b border-white/[0.08] py-4 last:border-b-0 last:pb-0 first:pt-0">
      <p className="text-sm font-semibold text-white">{title}</p>
      <div className="mt-2 text-sm leading-relaxed text-zinc-400">{children}</div>
    </div>
  );
}

export function IntegrationConnectModal({
  integration,
  mode,
  onClose,
}: {
  integration: IntegrationDefinition | null;
  mode: "connect" | "manage";
  onClose: () => void;
}) {
  useEffect(() => {
    if (!integration) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [integration]);

  if (!integration) return null;

  const inv = integration;
  const title =
    mode === "manage"
      ? `Manage ${inv.name}`
      : `Connect ${inv.name}`;

  function continueToProvider() {
    openIntegrationOAuthPopup(inv.apiSlug);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4"
      role="presentation"
      onClick={onClose}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="integration-connect-title"
        className="relative w-full max-w-lg rounded-[1.25rem] bg-[#171717] p-8 shadow-2xl ring-1 ring-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="absolute right-4 top-4 rounded-lg p-2 text-zinc-500 transition hover:bg-white/10 hover:text-white"
          aria-label="Close"
          onClick={onClose}
        >
          <X className="size-5" />
        </button>

        <div className="flex flex-col items-center text-center">
          <div className="flex items-center gap-3">
            <HustronixMark />
            <MoreHorizontal
              className="size-6 shrink-0 text-zinc-500"
              strokeWidth={2}
              aria-hidden
            />
            <ProviderLogo integration={inv} />
          </div>
          <h2
            id="integration-connect-title"
            className="mt-6 text-xl font-semibold tracking-tight text-white"
          >
            {title}
          </h2>
          <p className="mt-1 text-sm text-zinc-500">{inv.developer}</p>
        </div>

        <div className="mt-8 rounded-2xl bg-[#1f1f1f] px-5 py-2 ring-1 ring-white/[0.06]">
          <InfoBlock title="Permissions are explicit">
            Hustronix only uses the scopes you approve on{" "}
            {inv.name}&apos;s authorization page. You can revoke access anytime
            from {inv.name} or from Hustronix once disconnect
            is available.
          </InfoBlock>
          <InfoBlock title="You're in control">
            Data from this connector is used to sync context relevant to your
            workspace (signals, calendar holds, PRs, etc.). Review our{" "}
            <a
              href="https://hustronix.online/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 hover:underline"
            >
              privacy policy
            </a>{" "}
            and{" "}
            <a
              href="https://hustronix.online/terms"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 hover:underline"
            >
              terms
            </a>
            .
          </InfoBlock>
          <InfoBlock title="Connectors can introduce risk">
            Only continue if you trust this workspace and the vendor&apos;s
            domain shown in your browser when you leave Hustronix.{" "}
            <a
              href="https://slack.com/help/articles/360003913054-Security-best-practices-for-using-Slack"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 hover:underline"
            >
              Learn how to stay safe
            </a>
            .
          </InfoBlock>
        </div>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-end">
          <Button
            variant="outline"
            type="button"
            className="border-white/20 bg-transparent text-white hover:bg-white/10"
            onClick={onClose}
          >
            Cancel
          </Button>
          <button
            type="button"
            onClick={continueToProvider}
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-white px-5 text-sm font-semibold text-black transition hover:bg-zinc-100"
          >
            Continue to {inv.name}
          </button>
        </div>

        <p className="mt-4 text-center text-xs text-zinc-600">
          Opens a separate window to complete sign-in on {inv.name}&apos;s site
          (Slack-style OAuth). If your browser blocks popups, a new tab is used
          instead.
        </p>
      </div>
    </div>
  );
}
