"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BrainEntityShell, DataTable, EmptyCatalog, StatusCell, styles } from "../_shared";
import { fetchDecisions } from "@/lib/api";
import { confidencePct, formatWhen } from "@/lib/live-mappers";
import detailStyles from "../projects/[slug]/project-detail.module.css";

export default function DecisionsPage() {
  const [rows, setRows] = useState<Array<Record<string, string>> | null>(null);

  useEffect(() => {
    fetchDecisions().then((list) => {
      if (!list) {
        setRows([]);
        return;
      }
      setRows(
        list.map((d) => ({
          decision: d.vow,
          type: d.status.replace(/_/g, " "),
          status: d.status.replace(/_/g, " "),
          confidence: confidencePct(d.confidence) != null ? `${confidencePct(d.confidence)}%` : "—",
          impact: d.status === "ACTIVE" ? "High" : "Medium",
          decided: formatWhen(d.created_at),
          owner: "—",
          id: d.id,
        })),
      );
    });
  }, []);

  return (
    <BrainEntityShell active="Decisions" newLabel="New Decision">
      {!rows?.length ? (
        <EmptyCatalog label="decisions" />
      ) : (
        <DataTable
          newLabel="New Decision"
          rows={rows}
          columns={[
            {
              key: "decision",
              label: "Decision",
              render: (row) => (
                <Link href={`/brain/projects/${row.id}`} className={styles.link}>
                  {row.decision}
                </Link>
              ),
            },
            { key: "type", label: "Type" },
            { key: "status", label: "Status", render: (row) => <StatusCell value={row.status} /> },
            { key: "confidence", label: "Confidence" },
            { key: "impact", label: "Impact", render: (row) => <StatusCell value={row.impact} /> },
            { key: "decided", label: "Created" },
            { key: "owner", label: "Owner" },
            {
              key: "id",
              label: "",
              render: (row) => (
                <Link href={`/brain/projects/${row.id}`} className={detailStyles.detailsBtn}>
                  Details
                </Link>
              ),
            },
          ]}
        />
      )}
    </BrainEntityShell>
  );
}
