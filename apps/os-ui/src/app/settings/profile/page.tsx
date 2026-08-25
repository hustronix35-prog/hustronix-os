"use client";

import { useEffect, useState } from "react";
import { Panel, PanelHeader } from "@/components/ui/Primitives";
import { fetchMe, fetchSettingsMap, patchMe, saveSettingsBulk } from "@/lib/api";
import { SaveButton, SettingsShell } from "../_components/SettingsShell";
import styles from "../settings.module.css";

const LANDING_OPTIONS = [
  { label: "Home", value: "/" },
  { label: "Talk", value: "/chat" },
  { label: "Brain", value: "/brain" },
  { label: "Decide", value: "/decide" },
  { label: "Execute", value: "/execute" },
  { label: "Alerts", value: "/alerts" },
];

export default function ProfileSettingsPage() {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [department, setDepartment] = useState("");
  const [bio, setBio] = useState("");
  const [landing, setLanding] = useState("/");
  const [itemsPerPage, setItemsPerPage] = useState("25");
  const [initials, setInitials] = useState("HX");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchMe(), fetchSettingsMap()]).then(([me, settings]) => {
      if (cancelled) return;
      if (me) {
        setDisplayName(me.profile.displayName);
        setEmail(me.profile.email || me.user.email || "");
        setPhone(me.profile.phone);
        setDepartment(me.profile.department);
        setBio(me.profile.bio);
        const name = me.profile.displayName || me.user.username;
        const parts = name.trim().split(/\s+/);
        setInitials(
          parts.length >= 2
            ? (parts[0][0] + parts[1][0]).toUpperCase()
            : name.slice(0, 2).toUpperCase() || "HX",
        );
      }
      if (settings) {
        const dash = settings["prefs.default_dashboard"] || "/";
        setLanding(LANDING_OPTIONS.some((o) => o.value === dash) ? dash : "/");
        setItemsPerPage(settings["prefs.items_per_page"] || "25");
      }
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    setBusy(true);
    setHint(null);
    setError(null);
    try {
      await patchMe({
        displayName,
        email,
        phone,
        department,
        bio,
      });
      await saveSettingsBulk({
        "prefs.default_dashboard": landing,
        "prefs.items_per_page": String(Math.min(100, Math.max(10, Number(itemsPerPage) || 25))),
      });
      setHint("Saved to your account");
      window.setTimeout(() => setHint(null), 2200);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save profile");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsShell
      title="Profile Settings"
      subtitle="Your personal information and account preferences."
    >
      <Panel>
        <PanelHeader title="Profile Information" />
        <div className={styles.avatarRow}>
          <span className={styles.avatar}>{initials}</span>
          <button
            type="button"
            className={styles.ghostBtn}
            disabled
            title="Photo upload is not available yet"
          >
            Change photo
          </button>
        </div>
        <div className={styles.formGrid}>
          <div className={styles.field}>
            <label htmlFor="full-name">Full Name</label>
            <input
              id="full-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={!loaded}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="email">Email</label>
            <input
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={!loaded}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="phone">Phone</label>
            <input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={!loaded} />
          </div>
          <div className={styles.field}>
            <label htmlFor="dept">Department</label>
            <input
              id="dept"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              disabled={!loaded}
            />
          </div>
          <div className={`${styles.field} ${styles.formGridFull}`}>
            <label htmlFor="bio">Bio</label>
            <textarea id="bio" value={bio} onChange={(e) => setBio(e.target.value)} rows={3} disabled={!loaded} />
          </div>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Preferences" />
        <div className={styles.formGrid}>
          <div className={styles.field}>
            <label htmlFor="landing">Default Landing Page</label>
            <select id="landing" value={landing} onChange={(e) => setLanding(e.target.value)} disabled={!loaded}>
              {LANDING_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor="ipp">Items per page</label>
            <input
              id="ipp"
              type="number"
              value={itemsPerPage}
              min={10}
              max={100}
              onChange={(e) => setItemsPerPage(e.target.value)}
              disabled={!loaded}
            />
          </div>
        </div>
      </Panel>

      <div className={styles.footerActions}>
        {hint ? <span className={styles.fieldHint}>{hint}</span> : null}
        {error ? <span className={styles.fieldHint}>{error}</span> : null}
        <SaveButton onClick={() => void save()} busy={busy} disabled={!loaded} />
      </div>
    </SettingsShell>
  );
}
