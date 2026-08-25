"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";
import {
  DECISION_STYLES,
  EMPTY_ORG_CONTEXT,
  MIN_ICP,
  MIN_ONE_LINER,
  orgFormFromSettings,
  orgFormToSettingsPatch,
  validateOrgEssentials,
  type OrgContextForm,
} from "@/lib/org-context";
import styles from "../auth.module.css";

export default function OnboardingPage() {
  const router = useRouter();
  const [form, setForm] = useState<OrgContextForm>(EMPTY_ORG_CONTEXT);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hydrating, setHydrating] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await apiGet("/api/me");
        const { settings } = await apiGet<{ settings: Record<string, string> }>("/api/settings");
        if (cancelled) return;
        if (settings?.["org.onboarding.completed"] === "1") {
          router.replace("/chat");
          return;
        }
        setForm(orgFormFromSettings(settings));
      } catch {
        if (!cancelled) router.replace("/login?next=/onboarding");
      } finally {
        if (!cancelled) setHydrating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const essentialsValid = useMemo(() => validateOrgEssentials(form) === null, [form]);

  const update = useCallback(<K extends keyof OrgContextForm>(key: K, value: OrgContextForm[K]) => {
    setHint(null);
    setForm((f) => ({ ...f, [key]: value }));
  }, []);

  const submit = useCallback(async () => {
    const v = validateOrgEssentials(form);
    if (v) {
      setHint(v);
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await apiPost("/api/settings/bulk", {
        settings: {
          ...orgFormToSettingsPatch(form),
          "org.onboarding.completed": "1",
        },
      });
      router.replace("/chat");
      router.refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not save onboarding.");
    } finally {
      setLoading(false);
    }
  }, [form, router]);

  if (hydrating) {
    return <div className={styles.gate}>Preparing your workspace…</div>;
  }

  return (
    <div className={styles.shell}>
      <div className={styles.card}>
        <div className={styles.brandCentered}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/logo-lockup.png"
            alt="Hustronix — Decide. Align. Execute."
            className={styles.brandLockup}
            width={707}
            height={353}
          />
        </div>

        <h1 className={styles.title}>Set up your workspace</h1>
        <p className={styles.subtitle}>
          A few essentials so Hustronix can ground decisions in your company — not generic advice.
        </p>

        <div className={styles.form}>
          <label className={styles.label}>
            <span>
              Organization name <span className={styles.req}>*</span>
            </span>
            <input
              className={styles.input}
              value={form.orgName}
              onChange={(e) => update("orgName", e.target.value)}
              placeholder="e.g. Acme Growth"
              autoComplete="organization"
            />
          </label>

          <label className={styles.label}>
            <span>
              What does your organization do? <span className={styles.req}>*</span>
            </span>
            <textarea
              className={styles.textarea}
              rows={2}
              value={form.oneLiner}
              onChange={(e) => update("oneLiner", e.target.value)}
              placeholder="Who you serve and the outcome — skip jargon."
            />
            <span className={styles.hint}>
              Min {MIN_ONE_LINER} characters.{" "}
              <strong>
                {form.oneLiner.trim().length}/{MIN_ONE_LINER}
              </strong>
            </span>
          </label>

          <label className={styles.label}>
            <span>
              Ideal customer / ICP <span className={styles.req}>*</span>
            </span>
            <textarea
              className={styles.textarea}
              rows={3}
              value={form.icpSummary}
              onChange={(e) => update("icpSummary", e.target.value)}
              placeholder="Company size, industry, buyer role, buying trigger…"
            />
            <span className={styles.hint}>
              Min {MIN_ICP} characters.{" "}
              <strong>
                {form.icpSummary.trim().length}/{MIN_ICP}
              </strong>
            </span>
          </label>

          <label className={styles.label}>
            <span>
              90-day north star <span className={styles.req}>*</span>
            </span>
            <textarea
              className={styles.textarea}
              rows={2}
              value={form.northStar90d}
              onChange={(e) => update("northStar90d", e.target.value)}
              placeholder="The one outcome that matters most this quarter."
            />
          </label>

          <label className={styles.label}>
            <span>
              How are large decisions usually made? <span className={styles.req}>*</span>
            </span>
            <select
              className={styles.select}
              value={form.decisionStyle}
              onChange={(e) => update("decisionStyle", e.target.value)}
            >
              {DECISION_STYLES.map((o) => (
                <option key={o.value || "empty"} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          {hint ? (
            <p className={styles.error} role="status">
              {hint}
            </p>
          ) : null}
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}

          <button
            className={styles.primary}
            type="button"
            disabled={loading || !essentialsValid}
            onClick={() => void submit()}
          >
            {loading ? "Saving…" : "Continue to Hustronix"}
          </button>
        </div>
      </div>
    </div>
  );
}
