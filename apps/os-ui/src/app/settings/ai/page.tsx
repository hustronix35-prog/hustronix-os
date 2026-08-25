"use client";

import { useEffect, useState } from "react";
import { Panel, PanelHeader } from "@/components/ui/Primitives";
import { apiGet, apiPost } from "@/lib/api";
import { SaveButton, SettingsShell, Toggle } from "../_components/SettingsShell";
import styles from "../settings.module.css";

const LEVELS = [
  { id: "observe", label: "Observe", copy: "Hustronix only analyzes." },
  { id: "recommend", label: "Recommend", copy: "Hustronix recommends actions." },
  { id: "approve", label: "Approve", copy: "Hustronix prepares actions and waits for approval." },
  { id: "execute", label: "Execute", copy: "Hustronix can run approved action classes automatically." },
] as const;

type AutonomyLevel = (typeof LEVELS)[number]["id"];

function parseLevel(value: unknown): AutonomyLevel {
  const v = String(value ?? "").toLowerCase();
  return LEVELS.some((l) => l.id === v) ? (v as AutonomyLevel) : "approve";
}

export default function AiPreferencesPage() {
  const [level, setLevel] = useState<AutonomyLevel>("approve");
  const [autoSuggest, setAutoSuggest] = useState(true);
  const [contextBrain, setContextBrain] = useState(true);
  const [verbose, setVerbose] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiGet<{ settings?: Record<string, string> }>("/api/settings")
      .then((data) => {
        if (cancelled) return;
        setLevel(parseLevel(data.settings?.["ui.autonomy_level"]));
      })
      .catch(() => {
        /* stay on default Approve until a session can persist */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await apiPost("/api/settings/bulk", { settings: { "ui.autonomy_level": level } });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not save autonomy.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsShell title="AI Preferences" subtitle="What Hustronix is allowed to do.">
      <Panel>
        <PanelHeader
          title="Hustronix autonomy"
          subtitle="Trust control. Chat still proposes; the ledger only moves when the gate allows it."
        />
        <div className={styles.levelList} role="radiogroup" aria-label="Hustronix autonomy">
          {LEVELS.map((item) => {
            const on = level === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={on}
                className={styles.levelCard}
                data-on={on ? "true" : "false"}
                onClick={() => setLevel(item.id)}
              >
                <strong>{item.label}</strong>
                <span>{item.copy}</span>
              </button>
            );
          })}
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Assistant Behavior" />
        <div className={styles.formGrid}>
          <div className={styles.field}>
            <label htmlFor="tone">Response tone</label>
            <select id="tone" defaultValue="Executive concise">
              <option>Executive concise</option>
              <option>Detailed analytical</option>
              <option>Conversational</option>
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor="depth">Default analysis depth</label>
            <select id="depth" defaultValue="Balanced">
              <option>Quick</option>
              <option>Balanced</option>
              <option>Deep</option>
            </select>
          </div>
        </div>
        <div className={styles.toggleRow}>
          <div className={styles.toggleMeta}>
            <strong>Auto-suggest next actions</strong>
            <span>Propose follow-ups after decisions and alerts</span>
          </div>
          <Toggle
            on={autoSuggest}
            onClick={() => setAutoSuggest((v) => !v)}
            label="Auto-suggest next actions"
          />
        </div>
        <div className={styles.toggleRow}>
          <div className={styles.toggleMeta}>
            <strong>Use Company Brain context</strong>
            <span>Ground answers in graph entities and relationships</span>
          </div>
          <Toggle
            on={contextBrain}
            onClick={() => setContextBrain((v) => !v)}
            label="Use Company Brain context"
          />
        </div>
        <div className={styles.toggleRow}>
          <div className={styles.toggleMeta}>
            <strong>Verbose reasoning</strong>
            <span>Show longer rationale chains in the composer</span>
          </div>
          <Toggle on={verbose} onClick={() => setVerbose((v) => !v)} label="Verbose reasoning" />
        </div>
      </Panel>

      <div className={styles.footerActions}>
        {error ? <span className={styles.fieldHint}>{error}</span> : null}
        {saved ? <span className={styles.fieldHint}>Saved</span> : null}
        <SaveButton onClick={() => void save()} label={saving ? "Saving…" : "Save changes"} />
      </div>
    </SettingsShell>
  );
}
