"use client";

import { useEffect, useState } from "react";
import { Panel, PanelHeader } from "@/components/ui/Primitives";
import { fetchMe, fetchSettingsMap, saveSettingsBulk } from "@/lib/api";
import { SaveButton, SettingsShell, Toggle } from "../_components/SettingsShell";
import styles from "../settings.module.css";

const TZ_OPTIONS = [
  "UTC+05:30 Asia/Kolkata",
  "UTC+00:00 London",
  "UTC-05:00 New York",
  "UTC-08:00 Los Angeles",
];

const LANG_MAP: Record<string, string> = { English: "en", Spanish: "es", German: "de" };
const LANG_REVERSE: Record<string, string> = { en: "English", es: "Spanish", de: "German" };

export default function GeneralSettingsPage() {
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [companySize, setCompanySize] = useState("11 - 50");
  const [timezone, setTimezone] = useState(TZ_OPTIONS[0]);
  const [language, setLanguage] = useState("English");
  const [dateFormat, setDateFormat] = useState("MMM DD, YYYY");
  const [weekStart, setWeekStart] = useState("Monday");
  const [darkMode, setDarkMode] = useState(true);
  const [compact, setCompact] = useState(false);
  const [tips, setTips] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchMe(), fetchSettingsMap()]).then(([me, settings]) => {
      if (cancelled) return;
      setWorkspaceId(me?.user.id || "");
      setWorkspaceName(settings?.["org.name"] || me?.org.name || "");
      setCompanySize(settings?.["org.team_size_band"] || "11 - 50");
      setTimezone(settings?.["org.timezone"] || TZ_OPTIONS[0]);
      setLanguage(LANG_REVERSE[settings?.["prefs.language"] || "en"] || "English");
      setDateFormat(settings?.["org.date_format"] || "MMM DD, YYYY");
      setWeekStart(settings?.["org.week_start"] || "Monday");
      setDarkMode((settings?.["prefs.theme"] || "dark") !== "light");
      setCompact(settings?.["prefs.compact_mode"] === "1" || settings?.["prefs.compact_mode"] === "true");
      setTips(settings?.["profile.show_tips"] !== "0");
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
      await saveSettingsBulk({
        "org.name": workspaceName,
        "org.team_size_band": companySize,
        "org.timezone": timezone,
        "prefs.language": LANG_MAP[language] || "en",
        "org.date_format": dateFormat,
        "org.week_start": weekStart,
        "prefs.theme": darkMode ? "dark" : "light",
        "prefs.compact_mode": compact ? "1" : "0",
        "profile.show_tips": tips ? "1" : "0",
      });
      setHint("Saved to your workspace");
      window.setTimeout(() => setHint(null), 2200);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save settings");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsShell
      title="General Settings"
      subtitle="Workspace details, localization, and display preferences."
    >
      <Panel>
        <PanelHeader title="Workspace Details" />
        <div className={styles.formGrid}>
          <div className={styles.field}>
            <label htmlFor="ws-name">Workspace Name</label>
            <input
              id="ws-name"
              value={workspaceName}
              onChange={(e) => setWorkspaceName(e.target.value)}
              disabled={!loaded}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="ws-id">Workspace ID</label>
            <input id="ws-id" value={workspaceId} readOnly title="Assigned at account creation" />
          </div>
          <div className={styles.field}>
            <label htmlFor="size">Company Size</label>
            <select id="size" value={companySize} onChange={(e) => setCompanySize(e.target.value)} disabled={!loaded}>
              <option>1 - 10</option>
              <option>11 - 50</option>
              <option>51 - 200</option>
              <option>201 - 1000</option>
              <option>1000+</option>
            </select>
          </div>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Localization" />
        <div className={styles.formGrid}>
          <div className={styles.field}>
            <label htmlFor="tz">Timezone</label>
            <select id="tz" value={timezone} onChange={(e) => setTimezone(e.target.value)} disabled={!loaded}>
              {TZ_OPTIONS.map((tz) => (
                <option key={tz}>{tz}</option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor="lang">Language</label>
            <select id="lang" value={language} onChange={(e) => setLanguage(e.target.value)} disabled={!loaded}>
              <option>English</option>
              <option>Spanish</option>
              <option>German</option>
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor="date">Date Format</label>
            <select id="date" value={dateFormat} onChange={(e) => setDateFormat(e.target.value)} disabled={!loaded}>
              <option>MMM DD, YYYY</option>
              <option>DD/MM/YYYY</option>
              <option>YYYY-MM-DD</option>
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor="week">Week Starts</label>
            <select id="week" value={weekStart} onChange={(e) => setWeekStart(e.target.value)} disabled={!loaded}>
              <option>Monday</option>
              <option>Sunday</option>
            </select>
          </div>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Preferences" />
        <div className={styles.toggleRow}>
          <div className={styles.toggleMeta}>
            <strong>Enable dark mode</strong>
            <span>Use the Hustronix dark command-center theme</span>
          </div>
          <Toggle on={darkMode} onClick={() => setDarkMode((v) => !v)} label="Enable dark mode" />
        </div>
        <div className={styles.toggleRow}>
          <div className={styles.toggleMeta}>
            <strong>Compact view</strong>
            <span>Reduce spacing for denser tables and panels</span>
          </div>
          <Toggle on={compact} onClick={() => setCompact((v) => !v)} label="Compact view" />
        </div>
        <div className={styles.toggleRow}>
          <div className={styles.toggleMeta}>
            <strong>Show onboarding tips</strong>
            <span>Surface contextual tips for new workspace features</span>
          </div>
          <Toggle on={tips} onClick={() => setTips((v) => !v)} label="Show onboarding tips" />
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
