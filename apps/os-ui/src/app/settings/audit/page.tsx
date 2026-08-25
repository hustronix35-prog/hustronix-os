"use client";

import { DataTable } from "@/components/ui/DataTable";
import { settingsAuditLogs } from "@/lib/mock-data";
import { SettingsShell } from "../_components/SettingsShell";

export default function AuditLogsSettingsPage() {
  return (
    <SettingsShell
      title="Audit Logs"
      subtitle="Review workspace activity and configuration changes."
    >
      <DataTable
        columns={[
          { key: "time", label: "Time" },
          { key: "actor", label: "Actor" },
          { key: "action", label: "Action" },
          { key: "target", label: "Target" },
        ]}
        rows={settingsAuditLogs.map((log) => ({
          time: log.time,
          actor: log.actor,
          action: log.action,
          target: log.target,
        }))}
      />
    </SettingsShell>
  );
}
