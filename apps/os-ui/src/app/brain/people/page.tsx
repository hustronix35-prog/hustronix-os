"use client";

import { useEffect, useState } from "react";
import { BrainEntityShell, DataTable, EmptyCatalog, StatusCell } from "../_shared";
import { fetchExecutionLedger, fetchTeamMetrics } from "@/lib/api";

export default function PeoplePage() {
  const [rows, setRows] = useState<Array<Record<string, string>> | null>(null);

  useEffect(() => {
    Promise.all([fetchTeamMetrics(), fetchExecutionLedger("all")]).then(([t, ledger]) => {
      if (!t) {
        setRows([]);
        return;
      }
      const focusByOwner = new Map<string, string>();
      for (const r of ledger || []) {
        if (!["ACTIVE", "BLOCKED", "PENDING"].includes(r.status.toUpperCase())) continue;
        const key = r.owner.trim().toLowerCase();
        if (!key || focusByOwner.has(key)) continue;
        focusByOwner.set(key, (r.success_condition || r.decision_vow || r.type || "").slice(0, 72));
      }
      setRows(
        t.members.map((m) => ({
          person: m.name,
          role: m.role,
          team: m.team,
          focus: focusByOwner.get(m.name.trim().toLowerCase()) || "—",
          load: `${Math.round(m.loadPct)}%`,
          status: m.status,
        })),
      );
    });
  }, []);

  return (
    <BrainEntityShell active="People" newLabel="New">
      {!rows?.length ? (
        <EmptyCatalog label="people" />
      ) : (
        <DataTable
          newLabel="New"
          rows={rows}
          columns={[
            { key: "person", label: "Person" },
            { key: "role", label: "Role" },
            { key: "team", label: "Team" },
            { key: "focus", label: "Current Focus" },
            { key: "load", label: "Load" },
            { key: "status", label: "Status", render: (row) => <StatusCell value={row.status} /> },
          ]}
        />
      )}
    </BrainEntityShell>
  );
}
