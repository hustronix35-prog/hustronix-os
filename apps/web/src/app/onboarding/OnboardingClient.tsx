"use client";

import { ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionTitle } from "@/components/ui/section-title";
import { apiGet, apiPost } from "@/lib/api";

/** Loosened slightly vs multi-step wizard , enough signal without blocking activation. */
const MIN_ORG_NAME = 2;
const MIN_ONE_LINER = 15;
const MIN_ICP = 15;
const MIN_NORTH_STAR = 8;

const DECISION_STYLES = [
  { value: "", label: "Select…" },
  { value: "data_driven", label: "Data-driven (metrics / experiments first)" },
  { value: "founder_led", label: "Founder or exec-led intuition" },
  { value: "consensus", label: "Consensus across leads or teams" },
  { value: "committee", label: "Formal committee or board-gated" },
  { value: "mixed", label: "Mixed , depends on the bet" },
  { value: "other", label: "Other (explain in notes)" },
] as const;

const TEAM_BANDS = [
  { value: "", label: "Skip" },
  { value: "1-10", label: "1–10" },
  { value: "11-50", label: "11–50" },
  { value: "51-200", label: "51–200" },
  { value: "201-1000", label: "201–1,000" },
  { value: "1000+", label: "1,000+" },
] as const;

const STAGES = [
  { value: "", label: "Skip" },
  { value: "idea", label: "Idea / pre-revenue" },
  { value: "early", label: "Early revenue" },
  { value: "growth", label: "Growth" },
  { value: "scale", label: "Scale" },
  { value: "enterprise", label: "Enterprise / mature" },
] as const;

function slice(s: string, max: number) {
  const t = s.trim();
  return t.length <= max ? t : t.slice(0, max);
}

function buildDigest(values: FormValues): string {
  const lines: string[] = [
    `Organization name: ${values.orgName}`,
    `What they do: ${values.oneLiner}`,
    `Ideal customer / ICP: ${values.icpSummary}`,
    `90-day north star: ${values.northStar90d}`,
    `Decision style: ${values.decisionStyle || "(not set)"}`,
  ];
  if (values.decisionStyleNotes.trim()) {
    lines.push(`How decisions really get made: ${values.decisionStyleNotes.trim()}`);
  }
  if (values.teamSizeBand)
    lines.push(`Team size band: ${values.teamSizeBand}`);
  if (values.companyStage) lines.push(`Stage: ${values.companyStage}`);
  if (values.topOperationalPain.trim()) {
    lines.push(`Top operational pain: ${values.topOperationalPain.trim()}`);
  }
  if (values.competitiveLandscape.trim()) {
    lines.push(`Competitive landscape: ${values.competitiveLandscape.trim()}`);
  }
  if (values.stackSnapshot.trim()) {
    lines.push(`Tools & systems: ${values.stackSnapshot.trim()}`);
  }
  if (values.constraintsNotes.trim()) {
    lines.push(`Constraints / governance: ${values.constraintsNotes.trim()}`);
  }
  return lines.join("\n");
}

type FormValues = {
  orgName: string;
  oneLiner: string;
  icpSummary: string;
  northStar90d: string;
  decisionStyle: string;
  decisionStyleNotes: string;
  teamSizeBand: string;
  companyStage: string;
  topOperationalPain: string;
  competitiveLandscape: string;
  stackSnapshot: string;
  constraintsNotes: string;
};

const initialForm: FormValues = {
  orgName: "",
  oneLiner: "",
  icpSummary: "",
  northStar90d: "",
  decisionStyle: "",
  decisionStyleNotes: "",
  teamSizeBand: "",
  companyStage: "",
  topOperationalPain: "",
  competitiveLandscape: "",
  stackSnapshot: "",
  constraintsNotes: "",
};

export function OnboardingClient() {
  const { replace, refresh } = useRouter();
  const [form, setForm] = useState<FormValues>(initialForm);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hydrating, setHydrating] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { settings } = await apiGet<{ settings: Record<string, string> }>(
          "/api/settings",
        );
        if (cancelled) return;
        if (settings?.["org.onboarding.completed"] === "1") {
          replace("/mission-control?tour=welcome");
          return;
        }
        setForm((prev) => ({
          ...prev,
          orgName: settings?.["org.name"] ?? "",
          oneLiner: settings?.["org.value_prop_one_liner"] ?? "",
          icpSummary: settings?.["org.icp_summary"] ?? "",
          northStar90d: settings?.["org.north_star_90d"] ?? "",
          decisionStyle: settings?.["org.decision_style"] ?? "",
          decisionStyleNotes: settings?.["org.decision_style_notes"] ?? "",
          teamSizeBand: settings?.["org.team_size_band"] ?? "",
          companyStage: settings?.["org.company_stage"] ?? "",
          topOperationalPain: settings?.["org.top_operational_pain"] ?? "",
          competitiveLandscape: settings?.["org.competitive_landscape"] ?? "",
          stackSnapshot: settings?.["org.stack_snapshot"] ?? "",
          constraintsNotes: settings?.["org.constraints_notes"] ?? "",
        }));
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setHydrating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [replace]);

  const essentialsValid = useMemo(
    () =>
      form.orgName.trim().length >= MIN_ORG_NAME &&
      form.oneLiner.trim().length >= MIN_ONE_LINER &&
      form.icpSummary.trim().length >= MIN_ICP &&
      form.northStar90d.trim().length >= MIN_NORTH_STAR &&
      Boolean(form.decisionStyle),
    [
      form.orgName,
      form.oneLiner,
      form.icpSummary,
      form.northStar90d,
      form.decisionStyle,
    ],
  );

  const update = useCallback(
    <K extends keyof FormValues>(key: K, value: FormValues[K]) => {
      setHint(null);
      setForm((f) => ({ ...f, [key]: value }));
    },
    [],
  );

  const validateEssentials = useCallback((): string | null => {
    if (form.orgName.trim().length < MIN_ORG_NAME) {
      return "Add your organization name.";
    }
    if (form.oneLiner.trim().length < MIN_ONE_LINER) {
      return `Describe what you do in at least ${MIN_ONE_LINER} characters (${form.oneLiner.trim().length}/${MIN_ONE_LINER}).`;
    }
    if (form.icpSummary.trim().length < MIN_ICP) {
      return `Ideal customer / ICP needs at least ${MIN_ICP} characters (${form.icpSummary.trim().length}/${MIN_ICP}).`;
    }
    if (form.northStar90d.trim().length < MIN_NORTH_STAR) {
      return `90-day focus needs at least ${MIN_NORTH_STAR} characters.`;
    }
    if (!form.decisionStyle) {
      return "Choose how large decisions are usually made.";
    }
    return null;
  }, [form]);

  const submit = useCallback(async () => {
    const v = validateEssentials();
    if (v) {
      setHint(v);
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const digest = slice(buildDigest(form), 12000);
      const core = slice(digest, 4000);
      await apiPost("/api/settings/bulk", {
        settings: {
          "org.onboarding.completed": "1",
          "org.name": slice(form.orgName, 500),
          "org.value_prop_one_liner": slice(form.oneLiner, 2000),
          "org.icp_summary": slice(form.icpSummary, 4000),
          "org.north_star_90d": slice(form.northStar90d, 2000),
          "org.decision_style": form.decisionStyle,
          "org.decision_style_notes": slice(form.decisionStyleNotes, 2000),
          "org.team_size_band": form.teamSizeBand || "",
          "org.company_stage": form.companyStage || "",
          "org.top_operational_pain": slice(form.topOperationalPain, 4000),
          "org.competitive_landscape": slice(form.competitiveLandscape, 4000),
          "org.stack_snapshot": slice(form.stackSnapshot, 4000),
          "org.constraints_notes": slice(form.constraintsNotes, 4000),
          "org.agent_context_digest": digest,
          "core_memory.organization": core,
        },
      });
      try {
        window.dispatchEvent(new Event("hx-settings-saved"));
      } catch {
        /* ignore */
      }
      replace("/mission-control?tour=welcome");
      refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not save onboarding.");
    } finally {
      setLoading(false);
    }
  }, [form, replace, refresh, validateEssentials]);

  if (hydrating) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-hx-border/30 px-4 py-2.5 sm:px-6 lg:px-8">
          <div className="h-10 w-48 animate-pulse rounded-md bg-hx-surface-elevated/70 sm:h-11" />
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12">
          <p className="text-sm text-hx-muted">Preparing your workspace…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col px-4 pb-12 pt-5 sm:pb-14 sm:pt-6 lg:px-8">
        <div className="mb-5 text-left">
          <p className="text-xs font-semibold uppercase tracking-widest text-hx-accent">
            First-time setup
          </p>
          <h1 className="mt-1.5 text-balance text-2xl font-bold tracking-tight text-hx-text sm:text-3xl">
            Set up your workspace
          </h1>
          <p className="mt-2 max-w-xl text-pretty text-sm leading-snug text-hx-muted">
            One screen , answer the essentials, then jump to Mission Control. Expand{" "}
            <span className="font-medium text-hx-text">Optional context</span> anytime for richer
            signals and agent answers (same fields as before, nothing removed).
          </p>
        </div>

        <Card className="border border-hx-border/80 bg-hx-surface/95 p-5 shadow-[0_24px_48px_-12px_rgba(0,0,0,0.55)] backdrop-blur-[2px] sm:p-7">
          <div className="space-y-6">
            <div>
              <SectionTitle>Essentials</SectionTitle>
              <p className="mt-1 text-xs text-hx-muted">
                Used for decisions, signals, and chat context.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-hx-muted" htmlFor="on-org">
                  Organization name <span className="text-hx-danger">*</span>
                </label>
                <input
                  id="on-org"
                  value={form.orgName}
                  onChange={(e) => update("orgName", e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-hx-border bg-hx-bg px-3 py-2 text-sm text-hx-text focus:border-hx-accent focus:outline-none"
                  placeholder="e.g. Acme Growth"
                  autoComplete="organization"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-hx-muted" htmlFor="on-1l">
                  In one sentence, what does your organization do?{" "}
                  <span className="text-hx-danger">*</span>
                </label>
                <textarea
                  id="on-1l"
                  rows={2}
                  value={form.oneLiner}
                  onChange={(e) => update("oneLiner", e.target.value)}
                  className="mt-1.5 w-full resize-y rounded-lg border border-hx-border bg-hx-bg px-3 py-2 text-sm text-hx-text focus:border-hx-accent focus:outline-none"
                  placeholder="Who you serve and the outcome , skip jargon."
                />
                <p className="mt-1 text-[11px] text-hx-muted">
                  Min {MIN_ONE_LINER} characters.{" "}
                  <span className="tabular-nums text-hx-text">
                    {form.oneLiner.trim().length}/{MIN_ONE_LINER}
                  </span>
                </p>
              </div>
              <div>
                <label className="text-xs font-medium text-hx-muted" htmlFor="on-icp">
                  Ideal customer / ICP <span className="text-hx-danger">*</span>
                </label>
                <textarea
                  id="on-icp"
                  rows={3}
                  value={form.icpSummary}
                  onChange={(e) => update("icpSummary", e.target.value)}
                  className="mt-1.5 w-full resize-y rounded-lg border border-hx-border bg-hx-bg px-3 py-2 text-sm text-hx-text focus:border-hx-accent focus:outline-none"
                  placeholder="Role, company size, region, pain , what makes a perfect-fit account?"
                />
                <p className="mt-1 text-[11px] text-hx-muted">
                  Min {MIN_ICP} characters.{" "}
                  <span className="tabular-nums text-hx-text">
                    {form.icpSummary.trim().length}/{MIN_ICP}
                  </span>
                </p>
              </div>
              <div>
                <label className="text-xs font-medium text-hx-muted" htmlFor="on-90">
                  Single outcome for the next 90 days <span className="text-hx-danger">*</span>
                </label>
                <textarea
                  id="on-90"
                  rows={2}
                  value={form.northStar90d}
                  onChange={(e) => update("northStar90d", e.target.value)}
                  className="mt-1.5 w-full resize-y rounded-lg border border-hx-border bg-hx-bg px-3 py-2 text-sm text-hx-text focus:border-hx-accent focus:outline-none"
                  placeholder="One sharp goal , revenue, launch, retention, etc."
                />
                <p className="mt-1 text-[11px] text-hx-muted">
                  Min {MIN_NORTH_STAR} characters.{" "}
                  <span className="tabular-nums text-hx-text">
                    {form.northStar90d.trim().length}/{MIN_NORTH_STAR}
                  </span>
                </p>
              </div>
              <div>
                <label className="text-xs font-medium text-hx-muted" htmlFor="on-ds">
                  How are large or risky decisions usually made?{" "}
                  <span className="text-hx-danger">*</span>
                </label>
                <select
                  id="on-ds"
                  value={form.decisionStyle}
                  onChange={(e) => update("decisionStyle", e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-hx-border bg-hx-bg px-3 py-2 text-sm text-hx-text focus:border-hx-accent focus:outline-none"
                >
                  {DECISION_STYLES.map((o) => (
                    <option key={o.value || "empty"} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-hx-muted" htmlFor="on-dsn">
                  Nuance <span className="text-hx-muted">(optional)</span>
                </label>
                <textarea
                  id="on-dsn"
                  rows={2}
                  value={form.decisionStyleNotes}
                  onChange={(e) => update("decisionStyleNotes", e.target.value)}
                  className="mt-1.5 w-full resize-y rounded-lg border border-hx-border bg-hx-bg px-3 py-2 text-sm text-hx-text focus:border-hx-accent focus:outline-none"
                  placeholder="Veto power, what evidence wins, known biases…"
                />
              </div>
            </div>

            <details className="group rounded-lg border border-hx-border/80 bg-hx-bg/40">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-hx-text marker:content-none [&::-webkit-details-marker]:hidden">
                <span>Optional context , team, tools, risks</span>
                <ChevronDown className="size-4 shrink-0 text-hx-muted transition group-open:rotate-180" />
              </summary>
              <div className="space-y-4 border-t border-hx-border/60 px-4 pb-4 pt-3">
                <p className="text-xs leading-relaxed text-hx-muted">
                  Same fields as the old step 3. Leave collapsed to finish faster , you can add this
                  later in Settings.
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="text-xs font-medium text-hx-muted" htmlFor="on-team">
                      Team size
                    </label>
                    <select
                      id="on-team"
                      value={form.teamSizeBand}
                      onChange={(e) => update("teamSizeBand", e.target.value)}
                      className="mt-1.5 w-full rounded-lg border border-hx-border bg-hx-bg px-3 py-2 text-sm text-hx-text focus:border-hx-accent focus:outline-none"
                    >
                      {TEAM_BANDS.map((o) => (
                        <option key={o.value || "skip"} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-hx-muted" htmlFor="on-stage">
                      Company stage
                    </label>
                    <select
                      id="on-stage"
                      value={form.companyStage}
                      onChange={(e) => update("companyStage", e.target.value)}
                      className="mt-1.5 w-full rounded-lg border border-hx-border bg-hx-bg px-3 py-2 text-sm text-hx-text focus:border-hx-accent focus:outline-none"
                    >
                      {STAGES.map((o) => (
                        <option key={o.value || "skip"} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-hx-muted" htmlFor="on-pain">
                    Biggest operational pain
                  </label>
                  <textarea
                    id="on-pain"
                    rows={2}
                    value={form.topOperationalPain}
                    onChange={(e) => update("topOperationalPain", e.target.value)}
                    className="mt-1.5 w-full resize-y rounded-lg border border-hx-border bg-hx-bg px-3 py-2 text-sm text-hx-text focus:border-hx-accent focus:outline-none"
                    placeholder="Handoffs, tools, capacity…"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-hx-muted" htmlFor="on-comp">
                    Competitors or alternatives
                  </label>
                  <textarea
                    id="on-comp"
                    rows={2}
                    value={form.competitiveLandscape}
                    onChange={(e) => update("competitiveLandscape", e.target.value)}
                    className="mt-1.5 w-full resize-y rounded-lg border border-hx-border bg-hx-bg px-3 py-2 text-sm text-hx-text focus:border-hx-accent focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-hx-muted" htmlFor="on-stack">
                    Key tools & systems
                  </label>
                  <textarea
                    id="on-stack"
                    rows={2}
                    value={form.stackSnapshot}
                    onChange={(e) => update("stackSnapshot", e.target.value)}
                    className="mt-1.5 w-full resize-y rounded-lg border border-hx-border bg-hx-bg px-3 py-2 text-sm text-hx-text focus:border-hx-accent focus:outline-none"
                    placeholder="CRM, warehouse, Slack…"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-hx-muted" htmlFor="on-con">
                    Compliance / governance constraints
                  </label>
                  <textarea
                    id="on-con"
                    rows={2}
                    value={form.constraintsNotes}
                    onChange={(e) => update("constraintsNotes", e.target.value)}
                    className="mt-1.5 w-full resize-y rounded-lg border border-hx-border bg-hx-bg px-3 py-2 text-sm text-hx-text focus:border-hx-accent focus:outline-none"
                    placeholder="SOC2, GDPR, procurement gates…"
                  />
                </div>
              </div>
            </details>

            {hint && (
              <p className="text-sm text-hx-danger" role="status">
                {hint}
              </p>
            )}
            {error && (
              <p className="text-sm text-hx-danger" role="alert">
                {error}
              </p>
            )}

            <div className="flex flex-col gap-2 border-t border-hx-border/70 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[11px] text-hx-muted">
                {essentialsValid ? (
                  <span className="text-hx-success">Ready , saves org context and opens Mission Control.</span>
                ) : (
                  "Fill the fields marked * to continue."
                )}
              </p>
              <Button
                variant="primary"
                type="button"
                disabled={loading}
                className="w-full shrink-0 sm:w-auto sm:min-w-[14rem]"
                onClick={() => void submit()}
              >
                {loading ? "Saving…" : "Save & open Mission Control"}
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
