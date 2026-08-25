"use client";

import { Send } from "@/components/icons";
import { HustronixMark } from "@/components/brand/HustronixMark";
import { useRouter } from "next/navigation";
import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { CHAT_DRAFT_KEY, chatUrlForQuery, stashChatDraft } from "@/lib/chat-handoff";
import { cx } from "@/lib/utils";
import styles from "./ui.module.css";

export function Panel({
  children,
  className,
  style,
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  padded?: boolean;
}) {
  return (
    <section className={cx("panel", styles.panel, padded && styles.padded, className)} style={style}>
      {children}
    </section>
  );
}

export function PanelHeader({
  title,
  action,
  subtitle,
}: {
  title: string;
  action?: ReactNode;
  subtitle?: string;
}) {
  return (
    <div className={styles.panelHeader}>
      <div>
        <h2 className={styles.sectionTitle}>{title}</h2>
        {subtitle ? <p className={styles.panelSubtitle}>{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function StatusPill({
  label,
  tone,
}: {
  label: string;
  tone?: string;
}) {
  const color = tone ?? label;
  return (
    <span className={styles.pill} data-tone={color.toLowerCase().replace(/\s+/g, "-")}>
      {label}
    </span>
  );
}

export function ProgressBar({
  value,
  tone = "gold",
}: {
  value: number;
  tone?: "gold" | "green" | "red" | "orange" | "blue" | "purple";
}) {
  return (
    <div className={styles.progressTrack} aria-hidden>
      <div
        className={styles.progressFill}
        data-tone={tone}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

export function HealthRing({
  value,
  max = 100,
  label,
  size = "md",
  tone = "at-risk",
}: {
  value: number;
  max?: number;
  label: string;
  size?: "sm" | "md" | "lg";
  tone?: string;
}) {
  const dim = size === "sm" ? 48 : size === "lg" ? 84 : 68;
  const stroke = size === "sm" ? 5 : size === "lg" ? 8 : 7;
  const radius = (dim - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.max(0, Math.min(1, value / max));
  const offset = circumference * (1 - pct);

  return (
    <div className={styles.healthRing} data-size={size} data-tone={tone}>
      <svg width={dim} height={dim} viewBox={`0 0 ${dim} ${dim}`} role="img" aria-label={`${label}: ${value} of ${max}`}>
        <circle
          cx={dim / 2}
          cy={dim / 2}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={stroke}
        />
        <circle
          className={styles.healthArc}
          cx={dim / 2}
          cy={dim / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${dim / 2} ${dim / 2})`}
        />
        <text x="50%" y={label ? "48%" : "52%"} textAnchor="middle" dominantBaseline="middle" className={styles.healthValue}>
          {value}
          {label ? <tspan className={styles.healthMax}>/{max}</tspan> : null}
        </text>
      </svg>
      {label ? (
        <div className={styles.healthLabel}>
          <span className={styles.healthDot} />
          {label}
        </div>
      ) : null}
    </div>
  );
}

export function FilterPills({
  items,
  active,
  onChange,
}: {
  items: Array<{ label: string; count?: number | null; href?: string }>;
  active: string;
  onChange?: (label: string) => void;
}) {
  return (
    <div className={styles.filterRow} role="tablist" aria-label="Filters">
      {items.map((item) => {
        const isActive = item.label === active;
        const dataLabel = item.label.replace(/ \d+$/, "").replace(/^All .*/, "All");
        const content = (
          <>
            {item.label}
            {item.count != null ? <span className={styles.filterCount}>{item.count}</span> : null}
          </>
        );
        if (item.href) {
          return (
            <a
              key={item.label}
              href={item.href}
              className={cx(styles.filterPill, isActive && styles.filterActive)}
              data-label={dataLabel}
              aria-current={isActive ? "page" : undefined}
            >
              {content}
            </a>
          );
        }
        return (
          <button
            key={item.label}
            type="button"
            className={cx(styles.filterPill, isActive && styles.filterActive)}
            data-label={dataLabel}
            aria-pressed={isActive}
            onClick={() => onChange?.(item.label)}
          >
            {content}
          </button>
        );
      })}
    </div>
  );
}

export function MetricStrip({
  items,
}: {
  items: Array<{ label: string; value: string | number; subtitle?: string; status?: string; icon?: ReactNode }>;
}) {
  return (
    <div className={styles.metricStrip}>
      {items.map((item) => (
        <div key={item.label} className={styles.metricTile} data-tone={item.status}>
          <div className={styles.metricIcon}>{item.icon}</div>
          <div>
            <div className={cx(styles.metricValue, "tabular")}>{item.value}</div>
            <div className={styles.metricLabel}>{item.label}</div>
            {item.subtitle ? <div className={styles.metricSub}>{item.subtitle}</div> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

export function AIComposer({
  placeholder,
  prompts,
}: {
  placeholder: string;
  prompts: string[];
}) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const routed = useRef(false);

  const continueInChat = (text: string, autoSend: boolean) => {
    const trimmed = text.trim();
    if (autoSend) {
      if (!trimmed) return;
      try {
        sessionStorage.removeItem(CHAT_DRAFT_KEY);
      } catch {
        /* ignore */
      }
      router.push(chatUrlForQuery(trimmed));
      return;
    }
    stashChatDraft(text);
    if (!routed.current) {
      routed.current = true;
      router.push("/chat");
    }
  };

  return (
    <div className={cx("panel", styles.composer)} data-dock="true">
      <form
        className={styles.composerRow}
        onSubmit={(e) => {
          e.preventDefault();
          continueInChat(value, true);
        }}
      >
        <div className={styles.composerInputWrap}>
          <span className={styles.composerSpark} aria-hidden>
            <HustronixMark size={18} />
          </span>
          <label className="sr-only" htmlFor="ai-composer">
            Ask Hustronix
          </label>
          <input
            id="ai-composer"
            className={styles.composerInput}
            placeholder={placeholder}
            value={value}
            onChange={(e) => {
              const next = e.target.value;
              setValue(next);
              if (next.length > 0) continueInChat(next, false);
            }}
            autoComplete="off"
          />
        </div>
        <button type="submit" className={styles.sendBtn} aria-label="Continue in Chat" disabled={!value.trim()}>
          <Send size={16} />
        </button>
      </form>
      <div className={styles.promptRow}>
        {prompts.map((prompt) => (
          <button
            key={prompt}
            type="button"
            className={styles.promptChip}
            onClick={() => continueInChat(prompt, true)}
          >
            {prompt}
          </button>
        ))}
      </div>
      <p className={styles.composerNote}>
        Continues in Chat with full history. Verify critical information before making decisions.
      </p>
    </div>
  );
}
