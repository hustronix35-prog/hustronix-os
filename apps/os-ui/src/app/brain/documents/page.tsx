"use client";

import { useEffect, useState } from "react";
import { BrainEntityShell, DataTable, EmptyCatalog, StatusCell } from "../_shared";
import { apiGet } from "@/lib/api";
import { formatWhen } from "@/lib/live-mappers";

type DocRow = {
  title: string;
  source: string;
  system: string;
  updated: string;
  status: string;
};

export default function DocumentsPage() {
  const [rows, setRows] = useState<DocRow[] | null>(null);

  useEffect(() => {
    Promise.all([
      apiGet<{ signals?: Array<Record<string, unknown>> }>("/api/execution/signals/by-state?tab=all").catch(
        () => ({ signals: [] as Array<Record<string, unknown>> }),
      ),
      apiGet<{ entities?: Array<Record<string, unknown>> }>("/api/entities?type=project").catch(() => ({
        entities: [] as Array<Record<string, unknown>>,
      })),
    ])
      .then(([sigData, entData]) => {
        const docs: DocRow[] = [];
        for (const s of sigData.signals ?? []) {
          const subtype = String(s.source_subtype || "");
          const source = String(s.source || "");
          const isDoc =
            source === "MANUAL" ||
            subtype.includes("confluence") ||
            subtype.includes("notion") ||
            subtype.includes("page") ||
            subtype.includes("memo") ||
            subtype.includes("forecast");
          if (!isDoc) continue;
          let system = subtype || source;
          try {
            const meta = s.ingest_meta
              ? (JSON.parse(String(s.ingest_meta)) as { artifact_type?: string })
              : {};
            if (meta.artifact_type) system = String(meta.artifact_type);
          } catch {
            /* ignore */
          }
          docs.push({
            title: String(s.content || s.id || "").replace(/\s+/g, " ").slice(0, 120),
            source,
            system,
            updated: formatWhen(s.detected_at != null ? String(s.detected_at) : null),
            status: String(s.state || ""),
          });
        }
        for (const e of entData.entities ?? []) {
          docs.push({
            title: String(e.label || e.ref_id || e.id || "Project"),
            source: "ENTITY",
            system: String(e.type || "project"),
            updated: formatWhen(e.updated_at != null ? String(e.updated_at) : null),
            status: "INDEXED",
          });
        }
        setRows(docs.slice(0, 80));
      })
      .catch(() => setRows([]));
  }, []);

  return (
    <BrainEntityShell active="Documents" newLabel="New">
      {!rows?.length ? (
        <EmptyCatalog label="documents" />
      ) : (
        <DataTable
          newLabel="New"
          rows={rows}
          columns={[
            { key: "title", label: "Document / artifact" },
            { key: "source", label: "Source" },
            { key: "system", label: "Type" },
            { key: "updated", label: "Updated" },
            { key: "status", label: "Status", render: (row) => <StatusCell value={row.status} /> },
          ]}
        />
      )}
    </BrainEntityShell>
  );
}
