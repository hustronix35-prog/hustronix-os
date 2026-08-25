"use client";

import { Panel, PanelHeader, StatusPill } from "@/components/ui/Primitives";
import pageStyles from "@/app/pages.module.css";
import { SettingsShell } from "../_components/SettingsShell";
import styles from "../settings.module.css";

export default function BillingSettingsPage() {
  return (
    <SettingsShell title="Billing" subtitle="Plan, usage, and payment settings.">
      <Panel>
        <div className={styles.planHero}>
          <div>
            <strong>Enterprise Plan</strong>
            <p>Billed annually · Next renewal Sep 1, 2026</p>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <StatusPill label="Active" tone="healthy" />
            <button type="button" className={pageStyles.primaryBtn}>
              Manage plan
            </button>
          </div>
        </div>
        <div className={styles.planStats}>
          <div className={styles.planStat}>
            <span>Users</span>
            <strong>12 / 25</strong>
          </div>
          <div className={styles.planStat}>
            <span>Spaces</span>
            <strong>6 / Unlimited</strong>
          </div>
          <div className={styles.planStat}>
            <span>Signals / month</span>
            <strong>1.2M / 5M</strong>
          </div>
          <div className={styles.planStat}>
            <span>AI requests / month</span>
            <strong>245K / 1M</strong>
          </div>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Payment Method" />
        <div className={styles.authRow}>
          <div className={styles.authMeta}>
            <strong>Visa ·••• 4242</strong>
            <span>Expires 08/28 · Spandan Patil</span>
          </div>
          <button type="button" className={styles.ghostBtn}>
            Update
          </button>
        </div>
        <p className={styles.stubNote}>Invoices and payment history are stubbed for this UI preview.</p>
      </Panel>
    </SettingsShell>
  );
}
