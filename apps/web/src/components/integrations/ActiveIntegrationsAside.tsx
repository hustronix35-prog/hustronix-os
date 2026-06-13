"use client";

import Link from "next/link";
import { Card } from "@/components/ui/card";
import { SectionTitle } from "@/components/ui/section-title";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/cn";
import {
  DEFAULT_INTEGRATIONS,
  INTEGRATION_ORDER,
  type MeIntegrations,
} from "@/lib/me-integrations";

export type ActiveIntegrationsAsideProps = {
  /** Live slice from `/api/me`; `null` shows all disconnected (same as missing integrations). */
  integrationStatus?: MeIntegrations | null;
  className?: string;
};

export function ActiveIntegrationsAside({
  integrationStatus,
  className,
}: ActiveIntegrationsAsideProps) {
  const integrations = integrationStatus ?? DEFAULT_INTEGRATIONS;

  return (
    <Card className={cn(className)}>
      <SectionTitle>Active integrations</SectionTitle>
      <ul className="mt-4 divide-y divide-hx-border">
        {INTEGRATION_ORDER.map((key) => {
          const row = integrations[key];
          const connected = row.connected === true;
          return (
            <li
              key={key}
              className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0"
            >
              <span className="text-sm font-medium text-hx-text">{row.label}</span>
              <StatusBadge variant={connected ? "success" : "neutral"} dot={connected}>
                {connected ? "Connected" : "Disconnected"}
              </StatusBadge>
            </li>
          );
        })}
      </ul>
      <Link
        href="/settings?tab=connections"
        className="mt-4 inline-block text-sm font-medium text-hx-accent hover:underline"
      >
        Manage Integrations →
      </Link>
    </Card>
  );
}
