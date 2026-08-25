"use client";

import { useMemo, useState } from "react";
import { MoreHorizontal, Search } from "@/components/icons";
import { StatusPill } from "@/components/ui/Primitives";
import { DataTable } from "@/components/ui/DataTable";
import { settingsInvitations, settingsTeams, settingsUsers } from "@/lib/mock-data";
import { PrimaryAction, SettingsShell } from "../_components/SettingsShell";
import styles from "../settings.module.css";

type Tab = "Users" | "Teams" | "Invitations";

export default function UsersSettingsPage() {
  const [tab, setTab] = useState<Tab>("Users");
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("All Roles");

  const users = useMemo(() => {
    return settingsUsers.filter((u) => {
      const q = query.trim().toLowerCase();
      const matchQ =
        !q ||
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.team.toLowerCase().includes(q);
      const matchRole = role === "All Roles" || u.role === role;
      return matchQ && matchRole;
    });
  }, [query, role]);

  return (
    <SettingsShell
      title="Users & Teams"
      subtitle="Manage members, teams, and pending invitations."
      action={
        tab === "Users" ? (
          <PrimaryAction>+ Invite User</PrimaryAction>
        ) : tab === "Teams" ? (
          <PrimaryAction>+ Create Team</PrimaryAction>
        ) : (
          <PrimaryAction>+ Send Invite</PrimaryAction>
        )
      }
    >
      <div className={styles.tabs} role="tablist" aria-label="Users sections">
        {(["Users", "Teams", "Invitations"] as Tab[]).map((t) => (
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

      {tab === "Users" ? (
        <>
          <div className={styles.sectionToolbar}>
            <label className={styles.searchField}>
              <Search size={15} color="var(--text-muted)" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search users..."
                aria-label="Search users"
              />
            </label>
            <select
              className={styles.filterSelect}
              value={role}
              onChange={(e) => setRole(e.target.value)}
              aria-label="Filter by role"
            >
              <option>All Roles</option>
              <option>Owner</option>
              <option>Admin</option>
              <option>Manager</option>
              <option>Member</option>
              <option>Viewer</option>
            </select>
          </div>
          <DataTable
            columns={[
              {
                key: "user",
                label: "User",
                render: (row) => (
                  <div className={styles.userCell}>
                    <span className={styles.userAvatar}>{row.initials}</span>
                    <span className={styles.userMeta}>
                      <strong>{row.name}</strong>
                      <span>{row.email}</span>
                    </span>
                  </div>
                ),
              },
              { key: "role", label: "Role" },
              { key: "team", label: "Team" },
              { key: "lastActive", label: "Last Active" },
              {
                key: "status",
                label: "Status",
                render: (row) => (
                  <StatusPill
                    label={row.status}
                    tone={row.status === "Active" ? "healthy" : "medium"}
                  />
                ),
              },
              {
                key: "actions",
                label: "",
                render: () => (
                  <button type="button" className={styles.ghostBtn} aria-label="User actions">
                    <MoreHorizontal size={16} />
                  </button>
                ),
              },
            ]}
            rows={users.map((u) => ({
              name: u.name,
              email: u.email,
              initials: u.initials,
              role: u.role,
              team: u.team,
              lastActive: u.lastActive,
              status: u.status,
              actions: "",
              user: u.name,
            }))}
          />
        </>
      ) : null}

      {tab === "Teams" ? (
        <DataTable
          columns={[
            { key: "name", label: "Team" },
            { key: "members", label: "Members" },
            { key: "lead", label: "Lead" },
          ]}
          rows={settingsTeams.map((t) => ({
            name: t.name,
            members: String(t.members),
            lead: t.lead,
          }))}
        />
      ) : null}

      {tab === "Invitations" ? (
        <DataTable
          columns={[
            { key: "email", label: "Email" },
            { key: "role", label: "Role" },
            { key: "invited", label: "Invited" },
            {
              key: "status",
              label: "Status",
              render: (row) => (
                <StatusPill
                  label={row.status}
                  tone={row.status === "Pending" ? "medium" : "critical"}
                />
              ),
            },
          ]}
          rows={settingsInvitations.map((i) => ({
            email: i.email,
            role: i.role,
            invited: i.invited,
            status: i.status,
          }))}
        />
      ) : null}
    </SettingsShell>
  );
}
