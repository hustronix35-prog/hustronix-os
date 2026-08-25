"use client";

import { useState } from "react";
import { Laptop, Monitor, Smartphone } from "@/components/icons";
import { Panel, PanelHeader, StatusPill } from "@/components/ui/Primitives";
import { DataTable } from "@/components/ui/DataTable";
import { settingsSessions } from "@/lib/mock-data";
import { SettingsShell } from "../_components/SettingsShell";
import styles from "../settings.module.css";

function deviceIcon(device: string) {
  const d = device.toLowerCase();
  if (d.includes("iphone") || d.includes("android")) return Smartphone;
  if (d.includes("macbook") || d.includes("laptop")) return Laptop;
  return Monitor;
}

export default function SecuritySettingsPage() {
  const [sessions, setSessions] = useState(settingsSessions);

  function revoke(device: string) {
    setSessions((prev) => prev.filter((s) => s.device !== device));
  }

  return (
    <SettingsShell
      title="Security"
      subtitle="Password, 2FA, SSO, and active sessions."
    >
      <Panel>
        <PanelHeader title="Authentication" />
        <div className={styles.authRow}>
          <div className={styles.authMeta}>
            <strong>Password</strong>
            <span>Last changed 42 days ago</span>
          </div>
          <button type="button" className={styles.ghostBtn}>
            Change
          </button>
        </div>
        <div className={styles.authRow}>
          <div className={styles.authMeta}>
            <strong>Two-Factor Authentication</strong>
            <span>Authenticator app configured</span>
          </div>
          <StatusPill label="Enabled" tone="healthy" />
        </div>
        <div className={styles.authRow}>
          <div className={styles.authMeta}>
            <strong>Single Sign-On</strong>
            <span>Google Workspace SAML</span>
          </div>
          <StatusPill label="Configured" tone="healthy" />
        </div>
      </Panel>

      <div>
        <h2
          style={{
            margin: "0 0 10px",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--text-muted)",
          }}
        >
          Active Sessions
        </h2>
        <DataTable
          columns={[
            {
              key: "device",
              label: "Device",
              render: (row) => {
                const Icon = deviceIcon(row.device);
                return (
                  <div className={styles.deviceCell}>
                    <span className={styles.deviceIcon}>
                      <Icon size={15} />
                    </span>
                    <span>{row.device}</span>
                  </div>
                );
              },
            },
            { key: "location", label: "Location" },
            { key: "lastActive", label: "Last Active" },
            {
              key: "action",
              label: "Action",
              render: (row) =>
                row.current === "true" ? (
                  <StatusPill label="Current" tone="info" />
                ) : (
                  <button
                    type="button"
                    className={styles.dangerBtn}
                    onClick={() => revoke(row.device)}
                  >
                    Revoke
                  </button>
                ),
            },
          ]}
          rows={sessions.map((s) => ({
            device: s.device,
            location: s.location,
            lastActive: s.lastActive,
            current: s.current ? "true" : "false",
            action: "",
          }))}
        />
      </div>
    </SettingsShell>
  );
}
