"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionTitle } from "@/components/ui/section-title";
import { StatusBadge } from "@/components/ui/status-badge";
import { apiGet, apiPost } from "@/lib/api";

type DecisionRow = {
  id: string;
  vow: string;
  status: string;
  confidence: number;
  created_at: string;
};

export function DecisionsPanel({
  refreshTrigger = 0,
}: {
  refreshTrigger?: number;
}) {
  const [rows, setRows] = useState<DecisionRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const data = await apiGet<{ decisions: DecisionRow[] }>("/api/decisions");
      setRows(data.decisions || []);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to load decisions");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshTrigger]);

  async function commit(id: string) {
    const justification = window.prompt("Commit justification (optional)") || "Committed from Mission Control";
    setBusy(id);
    try {
      await apiPost("/api/decisions/commit", { decisionId: id, justification });
      await load();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const actionable = rows.filter((r) => r.status === "DRAFT");

  return (
    <div id="mission-decisions-panel" data-tour="mc-decisions-panel" className="lg:col-span-2 scroll-mt-24">
    <Card className="h-full">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hx-border px-4 py-2.5">
        <div>
          <SectionTitle className="tracking-[0.2em]">Decisions</SectionTitle>
          <p className="mt-1 text-sm text-hx-muted">
            DRAFT decisions can be committed to ACTIVE (REST + conflict rules apply).
          </p>
        </div>
        <Button variant="outline" size="sm" type="button" onClick={() => void load()}>
          Refresh
        </Button>
      </div>
      {err && <p className="px-5 py-2 text-sm text-hx-danger">{err}</p>}
      <div className="max-h-[320px] overflow-y-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="sticky top-0 bg-hx-surface-elevated/90 text-[10px] font-semibold uppercase tracking-wider text-hx-muted">
            <tr>
              <th className="px-5 py-3">Vow</th>
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3">Confidence</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-hx-border">
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-6 text-hx-muted">
                  No decisions for this user.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-hx-surface-elevated/20">
                <td className="px-5 py-3 font-medium text-hx-text">{r.vow.slice(0, 72)}</td>
                <td className="px-5 py-3">
                  <StatusBadge
                    variant={
                      r.status === "ACTIVE"
                        ? "success"
                        : r.status === "UNDER_REVIEW"
                          ? "warning"
                          : "neutral"
                    }
                    dot
                  >
                    {r.status}
                  </StatusBadge>
                </td>
                <td className="px-5 py-3 text-hx-muted">
                  {Math.round(Number(r.confidence) <= 1 ? Number(r.confidence) * 100 : Number(r.confidence))}%
                </td>
                <td className="px-5 py-3 text-right">
                  {r.status === "DRAFT" ? (
                    <Button
                      variant="primary"
                      size="sm"
                      type="button"
                      disabled={busy === r.id}
                      onClick={() => void commit(r.id)}
                    >
                      {busy === r.id ? "…" : "Commit"}
                    </Button>
                  ) : (
                    <span className="text-xs text-hx-muted">,</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {actionable.length > 0 && (
        <p className="border-t border-hx-border px-5 py-3 text-xs text-hx-muted">
          {actionable.length} decision(s) in DRAFT , commit activates enforcement.
        </p>
      )}
    </Card>
    </div>
  );
}
