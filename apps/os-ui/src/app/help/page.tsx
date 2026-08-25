import { BookOpen, LifeBuoy, Mail, MessageSquare, Search } from "@/components/icons";
import { AppShell, StatusIcon, TopBar } from "@/components/shell/AppShell";
import { Panel, PanelHeader, StatusPill } from "@/components/ui/Primitives";
import { faqs, helpGuides, helpTopics, whatsNew } from "@/lib/mock-data";
import styles from "../pages.module.css";

export default function HelpPage() {
  return (
    <AppShell
      topBar={
        <TopBar
          title="Help Center"
          subtitle="Find answers, learn features, and get the most out of Hustronix."
        />
      }
    >
      <Panel>
        <label className={styles.field} style={{ maxWidth: 640 }}>
          <span className="sr-only">Search help</span>
          <div style={{ display: "flex", alignItems: "center", gap: 10, height: 48, padding: "0 14px", borderRadius: 12, border: "1px solid var(--border-subtle)", background: "var(--surface-raised)" }}>
            <Search size={18} color="var(--text-muted)" />
            <input
              placeholder="Search guides, FAQs, and features..."
              style={{ flex: 1, border: "none", outline: "none", background: "transparent" }}
            />
          </div>
        </label>
      </Panel>

      <div className={styles.gridMainRail}>
        <div className={styles.stack}>
          <Panel>
            <PanelHeader title="Popular topics" />
            <div className={styles.helpTopics}>
              {helpTopics.map((topic) => (
                <article key={topic.title} className={styles.topicCard}>
                  <StatusIcon tone="medium">
                    <BookOpen size={16} />
                  </StatusIcon>
                  <h3>{topic.title}</h3>
                  <p>{topic.desc}</p>
                </article>
              ))}
            </div>
          </Panel>

          <div className={styles.grid2}>
            <Panel>
              <PanelHeader
                title="Guides"
                action={
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {["Getting started", "Features", "Administration", "Best practices"].map((tab, i) => (
                      <StatusPill key={tab} label={tab} tone={i === 0 ? "medium" : "info"} />
                    ))}
                  </div>
                }
              />
              <div className={styles.stack} style={{ gap: 0 }}>
                {helpGuides.map((guide) => (
                  <button key={guide} type="button" className={styles.faqItem}>
                    {guide}
                    <span>→</span>
                  </button>
                ))}
              </div>
            </Panel>

            <Panel>
              <PanelHeader title="What's New" />
              <ul className={styles.listPlain}>
                {whatsNew.map((item) => (
                  <li key={item.title}>
                    <StatusIcon tone="low">
                      <BookOpen size={14} />
                    </StatusIcon>
                    <div>
                      <strong>{item.title}</strong>
                      <small>{item.meta}</small>
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>

          <Panel>
            <PanelHeader title="FAQ" />
            {faqs.map((q) => (
              <button key={q} type="button" className={styles.faqItem}>
                {q}
                <span>+</span>
              </button>
            ))}
          </Panel>
        </div>

        <aside className={styles.rail}>
          <Panel>
            <PanelHeader title="Get started" />
            <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 13 }}>
              Connect your tools, explore Company Brain, and review your first recommendation in Decide.
            </p>
            <a href="/brain" className={styles.primaryBtn} style={{ marginTop: 14, width: "fit-content" }}>
              Open Company Brain
            </a>
          </Panel>

          <Panel>
            <PanelHeader title="Resources" />
            {[
              { label: "Product documentation", icon: BookOpen },
              { label: "API reference", icon: LifeBuoy },
              { label: "Community", icon: MessageSquare },
            ].map((item) => (
              <button key={item.label} type="button" className={styles.faqItem}>
                <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                  <item.icon size={14} />
                  {item.label}
                </span>
                <span>→</span>
              </button>
            ))}
          </Panel>

          <Panel>
            <PanelHeader title="Still need help?" />
            <button type="button" className={styles.primaryBtn} style={{ width: "100%", justifyContent: "center" }}>
              <Mail size={16} /> Contact support
            </button>
          </Panel>
        </aside>
      </div>
    </AppShell>
  );
}
