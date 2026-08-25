"use client";

import { useEffect, useState } from "react";
import { BrainEntityShell, DataTable, EmptyCatalog, StatusCell } from "../_shared";
import { fetchEntities } from "@/lib/api";
import { formatWhen } from "@/lib/live-mappers";

function money(n: unknown): string {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return "—";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}M`;
  if (v >= 1_000) return `$${Math.round(v / 1_000)}K`;
  return `$${Math.round(v)}`;
}

function healthLabel(score: unknown, confidence: number): string {
  const n = Number(score);
  if (Number.isFinite(n)) {
    if (n >= 75) return "Healthy";
    if (n >= 55) return "Watch";
    return "At Risk";
  }
  return confidence >= 0.7 ? "Healthy" : "Watch";
}

export default function CustomersPage() {
  const [rows, setRows] = useState<Array<Record<string, string>> | null>(null);

  useEffect(() => {
    fetchEntities("customer").then((list) => {
      if (!list) {
        setRows([]);
        return;
      }
      setRows(
        list.map((e) => {
          const m = e.metadata || {};
          const health = healthLabel(m.health_score, e.confidence);
          return {
            customer: e.label,
            health,
            arr: money(m.arr_usd ?? m.arr),
            last: formatWhen(e.freshness_at || null),
            stage: String(m.industry || m.stage || e.type || "—"),
            owner: String(m.executive_sponsor || m.owner || m.cs_owner || "—"),
          };
        }),
      );
    });
  }, []);

  return (
    <BrainEntityShell active="Customers" newLabel="New Customer">
      {!rows?.length ? (
        <EmptyCatalog label="customers" />
      ) : (
        <DataTable
          newLabel="New Customer"
          rows={rows}
          columns={[
            { key: "customer", label: "Customer" },
            { key: "health", label: "Health", render: (row) => <StatusCell value={row.health} /> },
            { key: "arr", label: "ARR" },
            { key: "last", label: "Last Activity" },
            { key: "stage", label: "Industry" },
            { key: "owner", label: "Sponsor" },
          ]}
        />
      )}
    </BrainEntityShell>
  );
}
