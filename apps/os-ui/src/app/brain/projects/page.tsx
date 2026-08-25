"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BrainEntityShell, DataTable, EmptyCatalog, StatusCell, styles } from "../_shared";
import { fetchDecisions, fetchExecutionLedger } from "@/lib/api";
import { confidencePct, formatWhen } from "@/lib/live-mappers";
import detailStyles from "./[slug]/project-detail.module.css";

export default function ProjectsPage() {
  const [rows, setRows] = useState<Array<Record<string, string>> | null>(null);

  useEffect(() => {
    Promise.all([fetchDecisions(), fetchExecutionLedger("all")]).then(([list, ledger]) => {
      if (!list) {
        setRows([]);
        return;
      }
      const byDecision = new Map<string, typeof ledger>();
      for (const r of ledger || []) {
        const arr = byDecision.get(r.decision_id) ?? [];
        arr.push(r);
        byDecision.set(r.decision_id, arr);
      }
      setRows(
        list.map((d) => {
          const tasks = byDecision.get(d.id) || [];
          const doneN = tasks.filter((t) => t.status.toUpperCase() === "DONE").length;
          const owners = [...new Set(tasks.map((t) => t.owner).filter(Boolean))];
          const progress =
            d.status === "COMPLETED"
              ? "100%"
              : tasks.length
                ? `${doneN}/${tasks.length} executed`
                : d.status === "ACTIVE"
                  ? "In flight"
                  : "—";
          return {
            project: d.vow,
            owner: owners[0] || "—",
            status: d.status.replace(/_/g, " "),
            health: confidencePct(d.confidence) != null ? `${confidencePct(d.confidence)}%` : "—",
            progress,
            target: formatWhen(d.created_at),
            slug: d.id,
          };
        }),
      );
    });
  }, []);

  return (
    <BrainEntityShell active="Projects" newLabel="New Project">
      {!rows?.length ? (
        <EmptyCatalog label="projects" />
      ) : (
        <DataTable
          newLabel="New Project"
          rows={rows}
          columns={[
            {
              key: "project",
              label: "Initiative",
              render: (row) => (
                <Link href={`/brain/projects/${row.slug}`} className={styles.link}>
                  {row.project}
                </Link>
              ),
            },
            { key: "owner", label: "Owner" },
            { key: "status", label: "Status", render: (row) => <StatusCell value={row.status} /> },
            { key: "health", label: "Confidence" },
            { key: "progress", label: "Progress" },
            { key: "target", label: "Created" },
            {
              key: "slug",
              label: "",
              render: (row) => (
                <Link href={`/brain/projects/${row.slug}`} className={detailStyles.detailsBtn}>
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
