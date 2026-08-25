"use client";

import { useMemo, useState } from "react";
import { Check, Minus, Search } from "@/components/icons";
import { Panel } from "@/components/ui/Primitives";
import { DataTable } from "@/components/ui/DataTable";
import { settingsPermissionMatrix, settingsRoles } from "@/lib/mock-data";
import { PrimaryAction, SettingsShell } from "../_components/SettingsShell";
import styles from "../settings.module.css";

type Tab = "Roles" | "Permissions Matrix";

export default function RolesSettingsPage() {
  const [tab, setTab] = useState<Tab>("Roles");
  const [query, setQuery] = useState("");

  const roles = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return settingsRoles;
    return settingsRoles.filter(
      (r) => r.name.toLowerCase().includes(q) || r.description.toLowerCase().includes(q),
    );
  }, [query]);

  return (
    <SettingsShell
      title="Roles & Permissions"
      subtitle="Define access levels and permission matrices."
      action={tab === "Roles" ? <PrimaryAction>+ Create Role</PrimaryAction> : undefined}
    >
      <div className={styles.tabs} role="tablist" aria-label="Roles sections">
        {(["Roles", "Permissions Matrix"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            className={styles.tab}
            data-active={tab === t}
            aria-selected={tab === t}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Roles" ? (
        <>
          <div className={styles.sectionToolbar}>
            <label className={styles.searchField}>
              <Search size={15} color="var(--text-muted)" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search roles..."
                aria-label="Search roles"
              />
            </label>
          </div>
          <DataTable
            columns={[
              { key: "name", label: "Role" },
              { key: "users", label: "Users" },
              { key: "description", label: "Description" },
              { key: "updated", label: "Last Updated" },
            ]}
            rows={roles.map((r) => ({
              name: r.name,
              users: String(r.users),
              description: r.description,
              updated: r.updated,
            }))}
          />
        </>
      ) : (
        <Panel padded={false}>
          <div className={styles.matrix}>
            <table>
              <thead>
                <tr>
                  <th>Permission</th>
                  <th>Owner</th>
                  <th>Admin</th>
                  <th>Manager</th>
                  <th>Member</th>
                  <th>Viewer</th>
                </tr>
              </thead>
              <tbody>
                {settingsPermissionMatrix.map((row) => (
                  <tr key={row.permission}>
                    <td>{row.permission}</td>
                    {(["Owner", "Admin", "Manager", "Member", "Viewer"] as const).map((role) => (
                      <td key={role}>
                        {row[role] ? (
                          <Check size={16} className={styles.check} aria-label="Allowed" />
                        ) : (
                          <Minus size={16} className={styles.dash} aria-label="Denied" />
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </SettingsShell>
  );
}
