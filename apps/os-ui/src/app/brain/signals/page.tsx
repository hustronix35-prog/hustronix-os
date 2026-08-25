"use client";

import { useEffect, useState } from "react";
import { BrainEntityShell, DataTable, EmptyCatalog, StatusCell } from "../_shared";
import { apiGet } from "@/lib/api";
import { formatWhen } from "@/lib/live-mappers";

export default function SignalsPage() {
  const [rows, setRows] = useState<Array<Record<string, string>> | null>(null);

  useEffect(() => {
    apiGet<{ signals?: Array<Record<string, unknown>> }>("/api/execution/signals/by-state?tab=unverified")
      .then((data) => {
        const list = data.signals ?? [];
        setRows(
          list.map((s) => ({
            signal: String(s.content || s.id || ""),
            source: String(s.source || ""),
            system: String(s.source_subtype || "—"),
            detected: formatWhen(s.detected_at != null ? String(s.detected_at) : null),
            status: String(s.state || ""),
            open: Array.isArray(s.openTargets) && (s.openTargets as { label?: string }[])[0]?.label
              ? String((s.openTargets as { label: string }[])[0].label)
              : "—",
          })),
        );
      })
      .catch(() => setRows([]));
  }, []);

  return (
    <BrainEntityShell active="Signals" newLabel="New">
      {!rows?.length ? (
        <EmptyCatalog label="unverified signals" />
      ) : (
        <DataTable
          newLabel="New"
          rows={rows}
          columns={[
            { key: "signal", label: "Signal" },
            { key: "source", label: "Source" },
            { key: "system", label: "System" },
            { key: "open", label: "Open" },
            { key: "detected", label: "Detected" },
            { key: "status", label: "Status", render: (row) => <StatusCell value={row.status} /> },
          ]}
        />
      )}
    </BrainEntityShell>
  );
}
