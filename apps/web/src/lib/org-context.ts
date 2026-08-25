/** First-time setup / company context — persisted in `settings` (`org.*`, agent digest). */

export const MIN_ORG_NAME = 2;
export const MIN_ONE_LINER = 15;
export const MIN_ICP = 15;
export const MIN_NORTH_STAR = 8;

export const DECISION_STYLES = [
  { value: "", label: "Select…" },
  { value: "data_driven", label: "Data-driven (metrics / experiments first)" },
  { value: "founder_led", label: "Founder or exec-led intuition" },
  { value: "consensus", label: "Consensus across leads or teams" },
  { value: "committee", label: "Formal committee or board-gated" },
  { value: "mixed", label: "Mixed — depends on the bet" },
  { value: "other", label: "Other (explain in notes)" },
] as const;

export const TEAM_BANDS = [
  { value: "", label: "Not set" },
  { value: "1-10", label: "1–10" },
  { value: "11-50", label: "11–50" },
  { value: "51-200", label: "51–200" },
  { value: "201-1000", label: "201–1,000" },
  { value: "1000+", label: "1,000+" },
] as const;

export const COMPANY_STAGES = [
  { value: "", label: "Not set" },
  { value: "idea", label: "Idea / pre-revenue" },
  { value: "early", label: "Early revenue" },
  { value: "growth", label: "Growth" },
  { value: "scale", label: "Scale" },
  { value: "enterprise", label: "Enterprise / mature" },
] as const;

export type OrgContextForm = {
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

export const EMPTY_ORG_CONTEXT: OrgContextForm = {
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

export function sliceText(s: string, max: number): string {
  const t = s.trim();
  return t.length <= max ? t : t.slice(0, max);
}

export function orgFormFromSettings(
  settings: Record<string, string | undefined> | undefined,
): OrgContextForm {
  const s = settings ?? {};
  return {
    orgName: s["org.name"] ?? "",
    oneLiner: s["org.value_prop_one_liner"] ?? "",
    icpSummary: s["org.icp_summary"] ?? "",
    northStar90d: s["org.north_star_90d"] ?? "",
    decisionStyle: s["org.decision_style"] ?? "",
    decisionStyleNotes: s["org.decision_style_notes"] ?? "",
    teamSizeBand: s["org.team_size_band"] ?? "",
    companyStage: s["org.company_stage"] ?? "",
    topOperationalPain: s["org.top_operational_pain"] ?? "",
    competitiveLandscape: s["org.competitive_landscape"] ?? "",
    stackSnapshot: s["org.stack_snapshot"] ?? "",
    constraintsNotes: s["org.constraints_notes"] ?? "",
  };
}

export function buildOrgDigest(values: OrgContextForm): string {
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
  if (values.teamSizeBand) lines.push(`Team size band: ${values.teamSizeBand}`);
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

/** Settings patch for bulk save (includes agent digest keys). */
export function orgFormToSettingsPatch(form: OrgContextForm): Record<string, string> {
  const digest = sliceText(buildOrgDigest(form), 12000);
  return {
    "org.name": sliceText(form.orgName, 500),
    "org.value_prop_one_liner": sliceText(form.oneLiner, 2000),
    "org.icp_summary": sliceText(form.icpSummary, 4000),
    "org.north_star_90d": sliceText(form.northStar90d, 2000),
    "org.decision_style": form.decisionStyle,
    "org.decision_style_notes": sliceText(form.decisionStyleNotes, 2000),
    "org.team_size_band": form.teamSizeBand || "",
    "org.company_stage": form.companyStage || "",
    "org.top_operational_pain": sliceText(form.topOperationalPain, 4000),
    "org.competitive_landscape": sliceText(form.competitiveLandscape, 4000),
    "org.stack_snapshot": sliceText(form.stackSnapshot, 4000),
    "org.constraints_notes": sliceText(form.constraintsNotes, 4000),
    "org.agent_context_digest": digest,
  };
}

export function validateOrgEssentials(form: OrgContextForm): string | null {
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
}

export function optionLabel(
  options: readonly { value: string; label: string }[],
  value: string,
): string {
  if (!value.trim()) return "Not set";
  return options.find((o) => o.value === value)?.label ?? value;
}
