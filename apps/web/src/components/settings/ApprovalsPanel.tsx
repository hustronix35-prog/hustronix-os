"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionTitle } from "@/components/ui/section-title";
import { apiGet, apiPost } from "@/lib/api";

type ApprovalRow = {
  id: string;
  actor_id: string;
  tool_name: string;
  permission: string;
  status: string;
  approved_by: string | null;
  second_approved_by: string | null;
  expires_at: string;
  created_at: string;
  canApprove?: boolean;
};

export function ApprovalsPanel() {
  const [rows, setRows] = useState<ApprovalRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const data = await apiGet<{ approvals: ApprovalRow[] }>("/api/security/approvals/pending");
      setRows(data.approvals || []);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to load approvals");
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function approve(id: string) {
    setBusy(id);
    try {
      await apiPost(`/api/security/approvals/${id}/approve`, {});
      await load();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hx-border px-4 py-3">
        <div>
          <SectionTitle>Dual-control approvals</SectionTitle>
          <p className="mt-1 text-sm text-hx-muted">
            High-risk mutations require two independent approvers. First approval grants one signer;
            second completes dual-control.
          </p>
        </div>
        <Button variant="outline" size="sm" type="button" onClick={() => void load()}>
          Refresh
        </Button>
      </div>
      {err && <p className="px-4 py-2 text-sm text-hx-danger">{err}</p>}
      <div className="max-h-[420px] overflow-y-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="sticky top-0 bg-hx-surface-elevated/90 text-[10px] font-semibold uppercase tracking-wider text-hx-muted">
            <tr>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Requester</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Approval ID</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-hx-border">
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-hx-muted">
                  No pending approvals for your organization.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-hx-surface-elevated/20">
                <td className="px-4 py-3 font-medium">{r.tool_name}</td>
                <td className="px-4 py-3 text-hx-muted">{r.actor_id.slice(0, 12)}…</td>
                <td className="px-4 py-3 text-hx-muted">
                  {r.second_approved_by ? "APPROVED" : r.approved_by ? "1/2" : r.status}
                </td>
                <td className="px-4 py-3 font-mono text-xs">{r.id.slice(0, 8)}…</td>
                <td className="px-4 py-3 text-right">
                  {r.canApprove ? (
                    <Button
                      variant="primary"
                      size="sm"
                      type="button"
                      disabled={busy === r.id}
                      onClick={() => void approve(r.id)}
                    >
                      {busy === r.id ? "…" : "Approve"}
                    </Button>
                  ) : (
                    <span className="text-xs text-hx-muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
