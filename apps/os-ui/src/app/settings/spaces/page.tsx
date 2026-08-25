"use client";

import { useMemo, useState } from "react";
import {
  Briefcase,
  Building2,
  Rocket,
  Search,
  Sparkles,
  Tag,
  Target,
} from "@/components/icons";
import { Panel, StatusPill } from "@/components/ui/Primitives";
import { settingsSpaces } from "@/lib/mock-data";
import { PrimaryAction, SettingsShell } from "../_components/SettingsShell";
import styles from "../settings.module.css";

const spaceIcons = {
  building: Building2,
  rocket: Rocket,
  target: Target,
  briefcase: Briefcase,
  sparkles: Sparkles,
  tag: Tag,
} as const;

export default function SpacesSettingsPage() {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return settingsSpaces;
    return settingsSpaces.filter(
      (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
    );
  }, [query]);

  return (
    <SettingsShell
      title="Spaces"
      subtitle="Organize work across company and project spaces."
      action={<PrimaryAction>+ Create Space</PrimaryAction>}
    >
      <div className={styles.sectionToolbar}>
        <label className={styles.searchField}>
          <Search size={15} color="var(--text-muted)" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search spaces..."
            aria-label="Search spaces"
          />
        </label>
      </div>

      <div className={styles.spacesGrid}>
        {filtered.map((space) => {
          const Icon = spaceIcons[space.icon as keyof typeof spaceIcons] ?? Building2;
          return (
            <article key={space.name} className={styles.spaceCard}>
              <div className={styles.spaceTop}>
                <span className={styles.spaceIcon}>
                  <Icon size={18} />
                </span>
                <StatusPill label={space.status} tone="healthy" />
              </div>
              <div>
                <h3>{space.name}</h3>
                <p>{space.description}</p>
              </div>
              <div className={styles.spaceMeta}>
                <span>
                  {space.members} Members · {space.projects} Projects
                </span>
              </div>
            </article>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <Panel>
          <p className={styles.stubNote}>No spaces match your search.</p>
        </Panel>
      ) : null}
    </SettingsShell>
  );
}
