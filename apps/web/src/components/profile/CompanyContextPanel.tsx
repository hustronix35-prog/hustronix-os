"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionTitle } from "@/components/ui/section-title";
import { useToast } from "@/components/ui/toast";
import { apiPost } from "@/lib/api";
import {
  COMPANY_STAGES,
  DECISION_STYLES,
  EMPTY_ORG_CONTEXT,
  MIN_ICP,
  MIN_NORTH_STAR,
  MIN_ONE_LINER,
  orgFormFromSettings,
  orgFormToSettingsPatch,
  type OrgContextForm,
  TEAM_BANDS,
  validateOrgEssentials,
} from "@/lib/org-context";

type Props = {
  settings: Record<string, string>;
  onboardingCompleted: boolean;
  onSaved?: () => void | Promise<void>;
};

export function CompanyContextPanel({
  settings,
  onboardingCompleted,
  onSaved,
}: Props) {
  const toast = useToast();
  const [form, setForm] = useState<OrgContextForm>(EMPTY_ORG_CONTEXT);
  const [hint, setHint] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(orgFormFromSettings(settings));
    setHint(null);
  }, [settings]);

  const update = useCallback(
    <K extends keyof OrgContextForm>(key: K, value: OrgContextForm[K]) => {
      setHint(null);
      setForm((f) => ({ ...f, [key]: value }));
    },
    [],
  );

  async function save() {
    const v = validateOrgEssentials(form);
    if (v) {
      setHint(v);
      return;
    }
    setSaving(true);
    setHint(null);
    try {
      const patch = orgFormToSettingsPatch(form);
      if (!onboardingCompleted) {
        patch["org.onboarding.completed"] = "1";
      }
      await apiPost("/api/settings/bulk", { settings: patch });
      try {
        window.dispatchEvent(new Event("hx-settings-saved"));
        window.dispatchEvent(new Event("hx-me-updated"));
      } catch {
        /* ignore */
      }
      toast.success("Company context saved.");
      await onSaved?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not save company context";
      setHint(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  const hasAnyContext = Boolean(
    form.orgName.trim() ||
      form.oneLiner.trim() ||
      form.icpSummary.trim() ||
      settings["org.agent_context_digest"]?.trim(),
  );

  return (
    <Card className="space-y-6">
      <div>
        <SectionTitle>Company context</SectionTitle>
        <p className="mt-1 text-sm text-hx-muted">
          What you entered during first-time setup. Hustronix uses this for decisions, signals, and
          chat , updates refresh the agent context digest.
        </p>
        {!hasAnyContext && (
          <p className="mt-3 text-sm text-hx-warning">
            No company profile yet.{" "}
            <Link href="/onboarding" className="font-medium text-hx-accent underline hover:no-underline">
              Complete setup
            </Link>{" "}
            or fill the fields below.
          </p>
        )}
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-hx-muted">Essentials</p>
        <div className="mt-4 space-y-4">
          <Field label="Organization name" required htmlFor="co-org">
            <input
              id="co-org"
              value={form.orgName}
              onChange={(e) => update("orgName", e.target.value)}
              className={inputClass}
              placeholder="e.g. Nexora Labs"
              autoComplete="organization"
            />
          </Field>
          <Field
            label="In one sentence, what does your organization do?"
            required
            htmlFor="co-1l"
            hint={`Min ${MIN_ONE_LINER} characters. ${form.oneLiner.trim().length}/${MIN_ONE_LINER}`}
          >
            <textarea
              id="co-1l"
              rows={2}
              value={form.oneLiner}
              onChange={(e) => update("oneLiner", e.target.value)}
              className={textareaClass}
            />
          </Field>
          <Field
            label="Ideal customer / ICP"
            required
            htmlFor="co-icp"
            hint={`Min ${MIN_ICP} characters. ${form.icpSummary.trim().length}/${MIN_ICP}`}
          >
            <textarea
              id="co-icp"
              rows={3}
              value={form.icpSummary}
              onChange={(e) => update("icpSummary", e.target.value)}
              className={textareaClass}
            />
          </Field>
          <Field
            label="Single outcome for the next 90 days"
            required
            htmlFor="co-90"
            hint={`Min ${MIN_NORTH_STAR} characters. ${form.northStar90d.trim().length}/${MIN_NORTH_STAR}`}
          >
            <textarea
              id="co-90"
              rows={2}
              value={form.northStar90d}
              onChange={(e) => update("northStar90d", e.target.value)}
              className={textareaClass}
            />
          </Field>
          <Field label="How are large or risky decisions usually made?" required htmlFor="co-ds">
            <select
              id="co-ds"
              value={form.decisionStyle}
              onChange={(e) => update("decisionStyle", e.target.value)}
              className={inputClass}
            >
              {DECISION_STYLES.map((o) => (
                <option key={o.value || "empty"} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Decision nuance (optional)" htmlFor="co-dsn">
            <textarea
              id="co-dsn"
              rows={2}
              value={form.decisionStyleNotes}
              onChange={(e) => update("decisionStyleNotes", e.target.value)}
              className={textareaClass}
              placeholder="Veto power, what evidence wins, known biases…"
            />
          </Field>
        </div>
      </div>

      <details className="group rounded-lg border border-hx-border/80 bg-hx-bg/40">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-hx-text marker:content-none [&::-webkit-details-marker]:hidden">
          <span>Optional context , team, tools, risks</span>
          <ChevronDown className="size-4 shrink-0 text-hx-muted transition group-open:rotate-180" />
        </summary>
        <div className="space-y-4 border-t border-hx-border/60 px-4 pb-4 pt-3">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Team size" htmlFor="co-team">
              <select
                id="co-team"
                value={form.teamSizeBand}
                onChange={(e) => update("teamSizeBand", e.target.value)}
                className={inputClass}
              >
                {TEAM_BANDS.map((o) => (
                  <option key={o.value || "skip"} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Company stage" htmlFor="co-stage">
              <select
                id="co-stage"
                value={form.companyStage}
                onChange={(e) => update("companyStage", e.target.value)}
                className={inputClass}
              >
                {COMPANY_STAGES.map((o) => (
                  <option key={o.value || "skip"} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Biggest operational pain" htmlFor="co-pain">
            <textarea
              id="co-pain"
              rows={2}
              value={form.topOperationalPain}
              onChange={(e) => update("topOperationalPain", e.target.value)}
              className={textareaClass}
            />
          </Field>
          <Field label="Competitors or alternatives" htmlFor="co-comp">
            <textarea
              id="co-comp"
              rows={2}
              value={form.competitiveLandscape}
              onChange={(e) => update("competitiveLandscape", e.target.value)}
              className={textareaClass}
            />
          </Field>
          <Field label="Key tools & systems" htmlFor="co-stack">
            <textarea
              id="co-stack"
              rows={2}
              value={form.stackSnapshot}
              onChange={(e) => update("stackSnapshot", e.target.value)}
              className={textareaClass}
              placeholder="CRM, warehouse, Slack…"
            />
          </Field>
          <Field label="Compliance / governance constraints" htmlFor="co-con">
            <textarea
              id="co-con"
              rows={2}
              value={form.constraintsNotes}
              onChange={(e) => update("constraintsNotes", e.target.value)}
              className={textareaClass}
            />
          </Field>
        </div>
      </details>

      {hint && (
        <p className="text-sm text-hx-danger" role="status">
          {hint}
        </p>
      )}

      <div className="flex flex-col gap-3 border-t border-hx-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-hx-muted">
          Saving updates <code className="text-[11px]">org.*</code> settings and the agent context
          digest used across the product.
        </p>
        <Button
          variant="primary"
          type="button"
          disabled={saving}
          className="shrink-0 sm:min-w-[10rem]"
          onClick={() => void save()}
        >
          {saving ? "Saving…" : "Save Changes"}
        </Button>
      </div>
    </Card>
  );
}

const inputClass =
  "mt-1.5 w-full rounded-lg border border-hx-border bg-hx-bg px-3 py-2 text-sm text-hx-text focus:border-hx-accent focus:outline-none";
const textareaClass = `${inputClass} resize-y`;

function Field({
  label,
  children,
  required,
  htmlFor,
  hint,
}: {
  label: string;
  children: ReactNode;
  required?: boolean;
  htmlFor?: string;
  hint?: string;
}) {
  return (
    <div>
      <label className="text-xs font-medium text-hx-muted" htmlFor={htmlFor}>
        {label}
        {required ? <span className="text-hx-danger"> *</span> : null}
      </label>
      {children}
      {hint ? <p className="mt-1 text-[11px] text-hx-muted">{hint}</p> : null}
    </div>
  );
}
