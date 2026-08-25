"use client";

import Link from "next/link";
import {
  Bell,
  ChevronRight,
  CreditCard,
  Layers,
  Lock,
  Plug,
  ScrollText,
  Shield,
  SlidersHorizontal,
  Sparkles,
  User,
  Users,
} from "@/components/icons";
import { AppShell, TopBar } from "@/components/shell/AppShell";
import { Panel } from "@/components/ui/Primitives";
import { settingsCategories } from "@/lib/mock-data";
import styles from "./settings.module.css";

const iconMap = {
  sliders: SlidersHorizontal,
  user: User,
  users: Users,
  shield: Shield,
  layers: Layers,
  plug: Plug,
  bell: Bell,
  sparkles: Sparkles,
  lock: Lock,
  "credit-card": CreditCard,
  scroll: ScrollText,
} as const;

export default function SettingsOverviewPage() {
  return (
    <AppShell
      topBar={
        <TopBar
          title="Settings"
          subtitle="What Hustronix is allowed to do. Trust, configuration, and autonomy."
        />
      }
    >
      <div className={styles.page}>
        <Panel>
          <p className={styles.overviewIntro}>
            Organization, integrations, and autonomy. Settings is control and trust, not another product surface.
          </p>
          <div className={styles.categoryGrid}>
            {settingsCategories.map((cat) => {
              const Icon = iconMap[cat.icon];
              return (
                <Link key={cat.id} href={cat.href} className={styles.categoryCard}>
                  <span className={styles.categoryIcon}>
                    <Icon size={18} />
                  </span>
                  <span className={styles.categoryBody}>
                    <strong>{cat.title}</strong>
                    <span>{cat.description}</span>
                  </span>
                  <ChevronRight size={16} className={styles.categoryChevron} />
                </Link>
              );
            })}
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}
