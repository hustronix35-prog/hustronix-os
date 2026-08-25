/**
 * Company Reality Benchmark corpus — messy operational feed, not HSOG.
 * Ground truth stays in evaluator; ingest payload has no scenario labels.
 */
import type { CrArtifact, CrCorpus, CrSource, CrStory } from "./types.js";

const CUSTOMERS = ["Acme", "Northstar", "Meridian", "Atlas", "CobaltWorks", "HelixBio", "SentryLine"] as const;
const PRODUCTS = ["NexusAI", "SignalGrid", "FlowOps", "LatticeOps"] as const;

const NOISE_SLACK = [
  "Standup moved to 10:30 — no blockers reported.",
  "Cafeteria added oat milk again. Thanks facilities.",
  "Reminder: expense reports due Friday.",
  "Someone left a charger in the small conference room.",
  "PTO calendar updated for next sprint.",
  "All-hands deck link posted in #general.",
  "Office plants watered. Nothing else to report.",
  "New mug design poll in #random — vote by EOD.",
];

const NOISE_EMAIL = [
  "Facilities: south parking lot repainted this weekend.",
  "IT: laptop refresh window opens next month.",
  "HR: remember to submit timesheets by noon Friday.",
  "Admin: visitor badge process unchanged for Q2.",
];

const NOISE_GITHUB = [
  "chore: bump eslint dependency",
  "docs: fix typo in README",
  "test: stabilize flaky unit test",
  "refactor: rename helper in utils",
];

function art(
  iso: string,
  source: CrSource,
  author: string,
  content: string,
  slug: string,
  story_id: string | null,
): CrArtifact {
  return {
    iso_date: iso,
    source,
    author,
    content,
    external_id: `crb:${slug}:${source}:${iso}`,
    story_id,
  };
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Ambiguous churn arc — no "health score" vocabulary. */
function customerChurnArc(customer: string, start: string, slug: string): { artifacts: CrArtifact[]; story: CrStory } {
  const id = `churn_${slug}`;
  const lines: Array<[number, CrSource, string, string, string]> = [
    [0, "support", "Jordan", `${customer}: the account team logged three serious complaints this month.`, "c1"],
    [2, "slack", "Priya", `Renewal conversation with ${customer} isn't going well — they're frustrated with the connector.`, "c2"],
    [4, "email", "Marcus", `Sales note: ${customer} sponsor hasn't joined the last three calls.`, "c3"],
    [6, "meeting", "Jordan", `Customer call summary — ${customer} team says they're looking at another provider.`, "c4"],
    [8, "crm", "Helen", `${customer} renewal flagged at risk in CRM after support escalations.`, "c5"],
    [10, "slack", "Ethan", `Engineering: recurring timeout on ${customer} ingestion path — SLA pressure building.`, "c6"],
    [12, "jira", "Noor", `Ticket: ${customer} connector failures blocking their nightly sync.`, "c7"],
    [14, "email", "Jordan", `${customer} exec asked for a written plan before they'll discuss renewal terms.`, "c8"],
  ];
  const artifacts = lines.map(([off, src, author, content, s]) =>
    art(addDays(start, off), src, author, content, `${slug}-${s}`, id),
  );
  return {
    artifacts,
    story: {
      id,
      title: `${customer} renewal / churn risk`,
      expected_entity: customer,
      expected_pattern: "customer_churn_risk",
      should_discover: true,
      expect_ready: true,
      expect_resolve: false,
      first_evidence_date: start,
      ready_target_date: addDays(start, 12),
      artifact_external_ids: artifacts.map((a) => a.external_id),
      impact_usd: 80_000,
      impact_note: "ARR at risk on renewal",
    },
  };
}

function selfResolvingChurn(customer: string, start: string, slug: string): { artifacts: CrArtifact[]; story: CrStory } {
  const id = `resolve_${slug}`;
  const lines: Array<[number, CrSource, string, string, string]> = [
    [0, "support", "Jordan", `${customer}: two complaints logged — account getting nervous.`, "r1"],
    [3, "slack", "Priya", `${customer} renewal conversation stalled; sponsor stopped responding.`, "r2"],
    [6, "email", "Ethan", `Deployed hotfix for ${customer} connector — errors down overnight.`, "r3"],
    [9, "meeting", "Jordan", `${customer} confirmed improvement on today's call. Support queue cleared.`, "r4"],
    [12, "crm", "Marcus", `${customer} renewal conversation back on track per CS update.`, "r5"],
  ];
  const artifacts = lines.map(([off, src, author, content, s]) =>
    art(addDays(start, off), src, author, content, `${slug}-${s}`, id),
  );
  return {
    artifacts,
    story: {
      id,
      title: `${customer} complaints then recovery`,
      expected_entity: customer,
      expected_pattern: "customer_churn_risk",
      should_discover: true,
      expect_ready: false,
      expect_resolve: true,
      expect_no_decision: true,
      first_evidence_date: start,
      resolve_date: addDays(start, 12),
      artifact_external_ids: artifacts.map((a) => a.external_id),
    },
  };
}

function contradictoryRenewal(customer: string, start: string, slug: string): { artifacts: CrArtifact[]; story: CrStory } {
  const id = `contradict_${slug}`;
  const lines: Array<[number, CrSource, string, string, string]> = [
    [0, "crm", "Marcus", `Sales: ${customer} seems happy — renewal looks fine on paper.`, "x1"],
    [2, "support", "Jordan", `Support escalation: three unresolved tickets on ${customer} this week.`, "x2"],
    [4, "slack", "Priya", `CS: ${customer} executive sponsor hasn't responded to two meeting invites.`, "x3"],
    [6, "email", "Jordan", `Customer email: ${customer} is evaluating an alternative vendor despite sales optimism.`, "x4"],
    [8, "meeting", "Helen", `Leadership sync: mixed renewal signals on ${customer} — need more evidence before commit.`, "x5"],
  ];
  const artifacts = lines.map(([off, src, author, content, s]) =>
    art(addDays(start, off), src, author, content, `${slug}-${s}`, id),
  );
  return {
    artifacts,
    story: {
      id,
      title: `${customer} contradictory renewal signals`,
      expected_entity: customer,
      expected_pattern: "customer_churn_risk",
      should_discover: true,
      expect_ready: false,
      expect_resolve: false,
      expect_no_decision: true,
      contradictory: true,
      first_evidence_date: start,
      artifact_external_ids: artifacts.map((a) => a.external_id),
    },
  };
}

function recurringOutage(start: string): { artifacts: CrArtifact[]; story: CrStory } {
  const id = "signalgrid_recurring";
  const lines: Array<[number, CrSource, string, string, string]> = [
    [0, "slack", "Ethan", "SignalGrid ingestion partition alert — customer delays exceeding SLA.", "o1"],
    [2, "jira", "Priya", "SignalGrid reliability ticket: kafka lag spiking across tenants.", "o2"],
    [5, "email", "Jordan", "SignalGrid outage resolved — ingestion back within SLA.", "o3"],
    [8, "slack", "Ethan", "SignalGrid outage returned overnight. Same partition path failing again.", "o4"],
    [10, "jira", "Priya", "SignalGrid deferred reliability work still blocking ingestion recovery.", "o5"],
  ];
  const artifacts = lines.map(([off, src, author, content, s]) =>
    art(addDays(start, off), src, author, content, `sg-${s}`, id),
  );
  return {
    artifacts,
    story: {
      id,
      title: "SignalGrid recurring outage",
      expected_entity: "SignalGrid",
      expected_pattern: "infrastructure_outage",
      should_discover: true,
      expect_ready: true,
      expect_resolve: false,
      expect_reopen: true,
      first_evidence_date: start,
      resolve_date: addDays(start, 5),
      reopen_date: addDays(start, 8),
      artifact_external_ids: artifacts.map((a) => a.external_id),
      impact_usd: 40_000,
      impact_note: "Ingestion SLA breach",
    },
  };
}

function launchSlipAmbiguous(start: string): { artifacts: CrArtifact[]; story: CrStory } {
  const id = "nexus_launch_slip";
  const lines: Array<[number, CrSource, string, string, string]> = [
    [0, "slack", "Imani", "The rollout is slipping — QA still finding edge cases in nested approvals.", "l1"],
    [3, "jira", "Renata", "Nexus v2 launch gate yellow: evidence links missing from architecture review.", "l2"],
    [6, "meeting", "Product", "Launch readiness review — engineering says the release likely slips two weeks.", "l3"],
    [9, "email", "Security", "Launch blocked until retrieval trace coverage passes security checklist.", "l4"],
    [12, "slack", "Imani", "Customer dates at risk if Nexus GA slips again this sprint.", "l5"],
    [15, "github", "Renata", "P1: missing decision trail links blocking Nexus launch checklist.", "l6"],
  ];
  const artifacts = lines.map(([off, src, author, content, s]) =>
    art(addDays(start, off), src, author, content, `nx-${s}`, id),
  );
  return {
    artifacts,
    story: {
      id,
      title: "NexusAI launch / GA slip",
      expected_entity: "NexusAI",
      expected_pattern: "product_launch_slip",
      should_discover: true,
      expect_ready: true,
      expect_resolve: false,
      first_evidence_date: start,
      ready_target_date: addDays(start, 15),
      artifact_external_ids: artifacts.map((a) => a.external_id),
      impact_usd: 200_000,
      impact_note: "Launch delay",
    },
  };
}

function securityArc(start: string): { artifacts: CrArtifact[]; story: CrStory } {
  const id = "security_access";
  const lines: Array<[number, CrSource, string, string, string]> = [
    [0, "slack", "Omar", "SIEM alert: unusual export volume from support tooling account.", "s1"],
    [2, "email", "Noor", "Expired admin exception still active — access review incomplete.", "s2"],
    [5, "jira", "Omar", "SEV1: support engineer admin path flagged in audit packet.", "s3"],
    [8, "meeting", "Security", "Enterprise audit evidence register still incomplete for access reviews.", "s4"],
  ];
  const artifacts = lines.map(([off, src, author, content, s]) =>
    art(addDays(start, off), src, author, content, `sec-${s}`, id),
  );
  return {
    artifacts,
    story: {
      id,
      title: "Security incident / audit exception",
      expected_entity: "SIEM",
      expected_pattern: "security_incident",
      should_discover: true,
      expect_ready: true,
      expect_resolve: false,
      first_evidence_date: start,
      artifact_external_ids: artifacts.map((a) => a.external_id),
    },
  };
}

function hiringFreeze(start: string): { artifacts: CrArtifact[]; story: CrStory } {
  const id = "hiring_freeze";
  const lines: Array<[number, CrSource, string, string, string]> = [
    [0, "email", "Leah", "HRIS updated: company-wide hiring freeze effective immediately.", "h1"],
    [3, "slack", "Helen", "Finance citing burn pressure — only documented exceptions allowed.", "h2"],
    [6, "jira", "Leah", "GRC analyst backfill requested as limited exception to hiring freeze.", "h3"],
  ];
  const artifacts = lines.map(([off, src, author, content, s]) =>
    art(addDays(start, off), src, author, content, `hr-${s}`, id),
  );
  return {
    artifacts,
    story: {
      id,
      title: "Hiring freeze / headcount exceptions",
      expected_entity: "HRIS",
      expected_pattern: "hiring_freeze",
      should_discover: true,
      expect_ready: true,
      expect_resolve: false,
      first_evidence_date: start,
      artifact_external_ids: artifacts.map((a) => a.external_id),
    },
  };
}

function forecastMiss(start: string): { artifacts: CrArtifact[]; story: CrStory } {
  const id = "forecast_miss";
  const lines: Array<[number, CrSource, string, string, string]> = [
    [0, "crm", "Marcus", "Q3 forecast coverage gap widening — several deals still in stale commit stage.", "f1"],
    [3, "email", "Helen", "Finance: pipeline coverage below approval threshold for Q3.", "f2"],
    [6, "slack", "Marcus", "Northstar and Atlas renewals showing stale risk in CRM fields.", "f3"],
  ];
  const artifacts = lines.map(([off, src, author, content, s]) =>
    art(addDays(start, off), src, author, content, `fc-${s}`, id),
  );
  return {
    artifacts,
    story: {
      id,
      title: "Forecast / coverage miss",
      expected_entity: "Northstar",
      expected_pattern: "sales_forecast_miss",
      should_discover: true,
      expect_ready: true,
      expect_resolve: false,
      first_evidence_date: start,
      artifact_external_ids: artifacts.map((a) => a.external_id),
    },
  };
}

function enterpriseDeal(start: string): { artifacts: CrArtifact[]; story: CrStory } {
  const id = "sentryline_deal";
  const lines: Array<[number, CrSource, string, string, string]> = [
    [0, "crm", "Marcus", "SentryLine enterprise deal marked commit — audit-ready trails still incomplete.", "e1"],
    [3, "email", "Legal", "SentryLine contract language on data residency not finalized.", "e2"],
    [6, "slack", "Noor", "Security: SentryLine AI recommendation trail not audit-complete.", "e3"],
  ];
  const artifacts = lines.map(([off, src, author, content, s]) =>
    art(addDays(start, off), src, author, content, `sl-${s}`, id),
  );
  return {
    artifacts,
    story: {
      id,
      title: "SentryLine enterprise deal red flags",
      expected_entity: "SentryLine",
      expected_pattern: "enterprise_deal_red_flags",
      should_discover: true,
      expect_ready: true,
      expect_resolve: false,
      first_evidence_date: start,
      artifact_external_ids: artifacts.map((a) => a.external_id),
      impact_usd: 500_000,
      impact_note: "Enterprise deal blocked",
    },
  };
}

function featureRegression(start: string): { artifacts: CrArtifact[]; story: CrStory } {
  const id = "flowops_regression";
  const lines: Array<[number, CrSource, string, string, string]> = [
    [0, "jira", "Renata", "FlowOps nested approval regression — edge case failing in QA.", "q1"],
    [3, "slack", "QA", "FlowOps tickets spiking after feature flag accidentally enabled for GA customers.", "q2"],
    [6, "github", "Imani", "FlowOps rollback in progress — permission bug affecting production tenants.", "q3"],
  ];
  const artifacts = lines.map(([off, src, author, content, s]) =>
    art(addDays(start, off), src, author, content, `fo-${s}`, id),
  );
  return {
    artifacts,
    story: {
      id,
      title: "FlowOps feature quality regression",
      expected_entity: "FlowOps",
      expected_pattern: "feature_quality_regression",
      should_discover: true,
      expect_ready: true,
      expect_resolve: false,
      first_evidence_date: start,
      artifact_external_ids: artifacts.map((a) => a.external_id),
    },
  };
}

function engWaitsSecurity(start: string): { artifacts: CrArtifact[]; story: CrStory } {
  const id = "eng_security_dep";
  const lines: Array<[number, CrSource, string, string, string]> = [
    [0, "slack", "Ethan", "Engineering is waiting on Security for credentials after the access review.", "d1"],
    [2, "jira", "Renata", "Payment integration blocked until Security clears API key rotation.", "d2"],
    [4, "email", "Noor", "Security queue backlog — engineering release path still blocked.", "d3"],
  ];
  const artifacts = lines.map(([off, src, author, content, s]) =>
    art(addDays(start, off), src, author, content, `dep-${s}`, id),
  );
  return {
    artifacts,
    story: {
      id,
      title: "Engineering blocked on Security credentials",
      expected_entity: "Engineering",
      should_discover: false,
      expect_ready: false,
      expect_resolve: false,
      first_evidence_date: start,
      artifact_external_ids: artifacts.map((a) => a.external_id),
    },
  };
}

function parallelAcmeStories(start: string): { artifacts: CrArtifact[]; stories: CrStory[] } {
  const implId = "acme_implementation";
  const implArts = [
    art(addDays(start, 0), "jira", "Imani", "Acme implementation phase 2 — data migration checklist at 60%.", "impl1", implId),
    art(addDays(start, 5), "slack", "Jordan", "Acme onboarding workshop scheduled; no renewal concerns on this track.", "impl2", implId),
    art(addDays(start, 10), "meeting", "Priya", "Acme implementation steering committee — timeline stable.", "impl3", implId),
  ];
  const implStory: CrStory = {
    id: implId,
    title: "Acme implementation (parallel)",
    expected_entity: "Acme",
    should_discover: false,
    expect_ready: false,
    expect_resolve: false,
    first_evidence_date: start,
    artifact_external_ids: implArts.map((a) => a.external_id),
  };
  return { artifacts: implArts, stories: [implStory] };
}

function generateNoise(count: number, startIso: string, spanDays: number): CrArtifact[] {
  const out: CrArtifact[] = [];
  const sources: CrSource[] = ["slack", "email", "github", "doc", "meeting"];
  for (let i = 0; i < count; i++) {
    const dayOff = i % spanDays;
    const iso = addDays(startIso, dayOff);
    const src = sources[i % sources.length];
    let content: string;
    if (src === "slack") content = NOISE_SLACK[i % NOISE_SLACK.length];
    else if (src === "email") content = NOISE_EMAIL[i % NOISE_EMAIL.length];
    else if (src === "github") content = NOISE_GITHUB[i % NOISE_GITHUB.length];
    else content = `Routine ${src} update #${i + 1} — no action required.`;
    out.push(art(iso, src, "NoiseBot", content, `noise-${i}`, null));
  }
  return out;
}

export type BuildCorpusOpts = {
  /** Target total artifacts (500–10000). Default 800. */
  targetSize?: number;
  /** Base calendar start. */
  startDate?: string;
};

/**
 * Build a Company Reality Benchmark corpus.
 * ~15–25% signal / 75–85% ambient noise by artifact count.
 */
export function buildCompanyRealityCorpus(opts: BuildCorpusOpts = {}): CrCorpus {
  const start = opts.startDate || "2026-01-06";
  const targetSize = Math.min(10000, Math.max(500, opts.targetSize ?? 800));

  const storyBuilders: Array<{ artifacts: CrArtifact[]; stories: CrStory[] }> = [];

  for (const [i, customer] of CUSTOMERS.slice(0, 5).entries()) {
    const arc = customerChurnArc(customer, addDays(start, i * 3), customer.toLowerCase());
    storyBuilders.push({ artifacts: arc.artifacts, stories: [arc.story] });
  }

  const helix = selfResolvingChurn("HelixBio", addDays(start, 40), "helix");
  storyBuilders.push({ artifacts: helix.artifacts, stories: [helix.story] });

  const atlasC = contradictoryRenewal("Kaldera", addDays(start, 45), "kaldera");
  storyBuilders.push({ artifacts: atlasC.artifacts, stories: [atlasC.story] });

  const outage = recurringOutage(addDays(start, 20));
  storyBuilders.push({ artifacts: outage.artifacts, stories: [outage.story] });

  const launch = launchSlipAmbiguous(addDays(start, 10));
  storyBuilders.push({ artifacts: launch.artifacts, stories: [launch.story] });

  const sec = securityArc(addDays(start, 15));
  storyBuilders.push({ artifacts: sec.artifacts, stories: [sec.story] });

  const hire = hiringFreeze(addDays(start, 25));
  storyBuilders.push({ artifacts: hire.artifacts, stories: [hire.story] });

  const fc = forecastMiss(addDays(start, 30));
  storyBuilders.push({ artifacts: fc.artifacts, stories: [fc.story] });

  const ent = enterpriseDeal(addDays(start, 35));
  storyBuilders.push({ artifacts: ent.artifacts, stories: [ent.story] });

  const feat = featureRegression(addDays(start, 38));
  storyBuilders.push({ artifacts: feat.artifacts, stories: [feat.story] });

  const dep = engWaitsSecurity(addDays(start, 42));
  storyBuilders.push({ artifacts: dep.artifacts, stories: [dep.story] });

  const parallel = parallelAcmeStories(addDays(start, 5));
  storyBuilders.push({ artifacts: parallel.artifacts, stories: parallel.stories });

  const signalArtifacts: CrArtifact[] = [];
  const stories: CrStory[] = [];
  for (const b of storyBuilders) {
    signalArtifacts.push(...b.artifacts);
    stories.push(...b.stories);
  }

  const signalCount = signalArtifacts.length;
  const noiseCount = Math.max(0, targetSize - signalCount);
  const noise = generateNoise(noiseCount, start, 90);
  const artifacts = [...signalArtifacts, ...noise].sort((a, b) => a.iso_date.localeCompare(b.iso_date));

  return {
    generated_at: new Date().toISOString(),
    artifact_count: artifacts.length,
    noise_ratio: Math.round((noiseCount / Math.max(artifacts.length, 1)) * 1000) / 1000,
    stories,
    artifacts,
  };
}
