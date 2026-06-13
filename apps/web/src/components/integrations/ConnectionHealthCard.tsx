"use client";

import { AlertTriangle, Clock, RefreshCw, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/cn";
import {
  formatExpiry,
  formatRelative,
  labelSurface,
  type IntegrationHealth,
} from "@/lib/integrations-health";

export type ConnectionHealthCardProps = {
  health: IntegrationHealth;
  /** Open the standard OAuth popup for this provider (UI slug, not backend id). */
  onReconnect: () => void;
  /** Open the Manage modal (disconnect / scope details). */
  onManage: () => void;
};

/**
 * Per-provider connection card surfaced in Settings → Connections.
 *
 * Visual hierarchy mirrors operational urgency:
 *   1. Critical states (needsReauth / expired surface) get danger colour and a
 *      Reconnect action sitting flush at the right.
 *   2. Expiring-soon (<60 min) gets a warning chip.
 *   3. Healthy connections show last-signal-at and 24h count so the user
 *      gets a concrete "yes, signal extraction is actually happening" signal.
 *
 * No skeleton variant , parent renders a single skeleton row for the whole grid.
 */
export function ConnectionHealthCard({
  health,
  onReconnect,
  onManage,
}: ConnectionHealthCardProps) {
  const anyExpired = health.surfaces.some((s) => s.expired);
  const expiringSoon = health.surfaces.some(
    (s) =>
      !s.expired &&
      s.minutesUntilExpiry !== null &&
      s.minutesUntilExpiry < 60,
  );
  const critical = health.needsReauth || anyExpired;
  const warning = !critical && expiringSoon;

  const statusVariant: "success" | "warning" | "danger" | "neutral" = !health.connected
    ? "neutral"
    : critical
      ? "danger"
      : warning
        ? "warning"
        : "success";

  const statusLabel = !health.connected
    ? "Disconnected"
    : critical
      ? "Needs attention"
      : warning
        ? "Expiring soon"
        : "Healthy";

  return (
    <Card
      className={cn(
        "p-5",
        critical && "border-hx-danger/40",
        warning && "border-hx-warning/40",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="text-base font-semibold text-hx-text">{health.label}</h4>
            <StatusBadge variant={statusVariant} dot={health.connected}>
              {statusLabel}
            </StatusBadge>
          </div>
          {health.externalTeamName && (
            <p className="mt-1 truncate text-xs text-hx-muted">{health.externalTeamName}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {critical && (
            <Button
              variant="primary"
              size="sm"
              type="button"
              className="gap-1"
              onClick={onReconnect}
            >
              <RefreshCw className="size-3.5" />
              Reconnect
            </Button>
          )}
          <Button variant="outlineGold" size="sm" type="button" onClick={onManage}>
            {health.connected ? "Settings" : "Connect"}
          </Button>
        </div>
      </div>

      {/* Always-on activity line. "," never lies; it just means we have no row. */}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-hx-muted">
        <span className="inline-flex items-center gap-1">
          <Zap className="size-3.5" />
          Last signal:{" "}
          <span className={health.lastSignalAt ? "text-hx-text" : "text-hx-muted"}>
            {formatRelative(health.lastSignalAt)}
          </span>
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="font-mono tabular-nums text-hx-text">
            {health.signalCount24h}
          </span>{" "}
          in last 24h
        </span>
        {health.expiresAt && (
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3.5" />
            Token:{" "}
            <span className={health.needsReauth ? "text-hx-danger" : "text-hx-text"}>
              {health.needsReauth ? "expired" : `valid (${formatRelative(health.expiresAt)})`}
            </span>
          </span>
        )}
      </div>

      {/* Subscription / surface rows. Hidden when there are none , most
          providers won't have any until the lifecycle hook registers them. */}
      {health.surfaces.length > 0 && (
        <ul className="mt-4 divide-y divide-hx-border rounded-lg border border-hx-border bg-hx-surface-elevated/40">
          {health.surfaces.map((s) => (
            <li
              key={`${s.kind}:${s.resource}`}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs"
            >
              <div className="min-w-0">
                <p className="font-medium text-hx-text">{labelSurface(s.kind)}</p>
                {s.resource && (
                  <p className="truncate text-[11px] text-hx-muted">{s.resource}</p>
                )}
              </div>
              <span
                className={cn(
                  "inline-flex items-center gap-1 font-mono tabular-nums",
                  s.expired
                    ? "text-hx-danger"
                    : s.minutesUntilExpiry !== null && s.minutesUntilExpiry < 60
                      ? "text-hx-warning"
                      : "text-hx-muted",
                )}
              >
                {s.expired && <AlertTriangle className="size-3" />}
                {s.expired ? formatExpiry(s.minutesUntilExpiry) : `expires in ${formatExpiry(s.minutesUntilExpiry)}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
