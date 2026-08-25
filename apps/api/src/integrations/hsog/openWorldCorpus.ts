/**
 * Open-world corpus — no scenario IDs, theme labels, theme lexicon, playbooks,
 * or HSOG terminology. Mixed sources, ambient noise, conflict, and resolve-without-decision.
 */
export type OpenWorldArtifact = {
  day: number;
  source: string;
  author: string;
  content: string;
  external_id: string;
  story_id: string | null;
};

export type OpenWorldStory = {
  id: string;
  title: string;
  expected_entity: string;
  /** Evaluator-only: should a situation be discovered? */
  should_discover: boolean;
  /** Evaluator-only: should it become decision-ready? */
  expect_ready: boolean;
  /** Evaluator-only: should it de-escalate / resolve without a useful new decision? */
  expect_resolve: boolean;
  first_evidence_day: number;
  declaration_day: number | null;
  resolve_day?: number;
  artifact_external_ids: string[];
};

export type OpenWorldCorpus = {
  stories: OpenWorldStory[];
  artifacts: OpenWorldArtifact[];
};

function art(
  day: number,
  source: string,
  author: string,
  content: string,
  slug: string,
  story_id: string | null,
): OpenWorldArtifact {
  return {
    day,
    source,
    author,
    content,
    external_id: `openworld:${slug}:d${day}:${source}`,
    story_id,
  };
}

export function buildOpenWorldCorpus(): OpenWorldCorpus {
  const artifacts: OpenWorldArtifact[] = [];
  const stories: OpenWorldStory[] = [];

  const rail = [
    art(11, "slack", "Lena", "Lena is worried: MeridianRail shop floor reports unapproved weekend overtime stacking up.", "rail-ot", "meridian_rail"),
    art(13, "email", "Hugo", "Hugo flags a serious concern to labor: MeridianRail overtime is overdue for a written response.", "rail-mail", "meridian_rail"),
    art(15, "jira", "Ivy", "Ticket: MeridianRail cannot staff the night shift without the overtime exception; risk of a walkout.", "rail-jira", "meridian_rail"),
    art(17, "slack", "Lena", "MeridianRail steward escalates again — still blocked on a management answer.", "rail-esc", "meridian_rail"),
  ];
  artifacts.push(...rail);
  stories.push({
    id: "meridian_rail",
    title: "MeridianRail overtime pressure",
    expected_entity: "MeridianRail",
    should_discover: true,
    expect_ready: true,
    expect_resolve: false,
    first_evidence_day: 11,
    declaration_day: 17,
    artifact_external_ids: rail.map((a) => a.external_id),
  });

  const volt = [
    art(12, "jira", "Ken", "VoltHarbor pack line paused: operators are concerned about cell swelling on lot VH-19.", "volt-swell", "volt_harbor"),
    art(14, "slack", "Rae", "Rae: VoltHarbor QA says we should treat this as stop-ship until lot VH-19 is isolated. Urgent.", "volt-stop", "volt_harbor"),
    art(16, "meeting", "Ken", "Standup notes: VoltHarbor cannot resume the pack line; field risk if swollen cells ship.", "volt-meet", "volt_harbor"),
    art(18, "email", "Rae", "Customer ops asked whether VoltHarbor units already in transit need a hold. Still blocked.", "volt-hold", "volt_harbor"),
  ];
  artifacts.push(...volt);
  stories.push({
    id: "volt_harbor",
    title: "VoltHarbor pack-line hold",
    expected_entity: "VoltHarbor",
    should_discover: true,
    expect_ready: true,
    expect_resolve: false,
    first_evidence_day: 12,
    declaration_day: 18,
    artifact_external_ids: volt.map((a) => a.external_id),
  });

  const cedar = [
    art(20, "slack", "Pia", "Pia: CedarPath campus AQI is serious; facilities may close the west wing today.", "cedar-aqi", "cedar_path"),
    art(21, "email", "Pia", "CedarPath west wing closed after wildfire smoke. Teams working remote. Concern about on-site labs.", "cedar-close", "cedar_path"),
    art(23, "slack", "Pia", "CedarPath west wing reopened; AQI cleared. All-clear from facilities — stood down.", "cedar-open", "cedar_path"),
  ];
  artifacts.push(...cedar);
  stories.push({
    id: "cedar_path",
    title: "CedarPath smoke closure (resolves)",
    expected_entity: "CedarPath",
    should_discover: true,
    expect_ready: false,
    expect_resolve: true,
    first_evidence_day: 20,
    declaration_day: 21,
    resolve_day: 23,
    artifact_external_ids: cedar.map((a) => a.external_id),
  });

  const quin = [
    art(22, "email", "Theo", "Theo is concerned: Quinlan Labs stipend reimbursements look duplicated for June.", "quin-dup", "quinlan_labs"),
    art(24, "slack", "Nia", "Finance: Quinlan Labs cannot close the books until the duplicate stipends are explained. Overdue.", "quin-books", "quinlan_labs"),
    art(26, "jira", "Theo", "Ticket: Quinlan Labs unauthorized double-pay on intern stipends; risk of audit finding.", "quin-tix", "quinlan_labs"),
  ];
  artifacts.push(...quin);
  stories.push({
    id: "quinlan_labs",
    title: "Quinlan Labs stipend duplicates",
    expected_entity: "Quinlan Labs",
    should_discover: true,
    expect_ready: true,
    expect_resolve: false,
    first_evidence_day: 22,
    declaration_day: 26,
    artifact_external_ids: quin.map((a) => a.external_id),
  });

  const bramble = [
    art(25, "slack", "Oz", "Oz: BrambleNet peering congestion is failing our east-coast handoff. Customers will notice.", "bramble-cong", "bramble_net"),
    art(27, "jira", "Oz", "BrambleNet transit partner is blocked on a prefix advertisement; serious packet loss overnight.", "bramble-pfx", "bramble_net"),
    art(28, "email", "Willa", "Willa: BrambleNet cannot meet the committed handoff. Escalating to the peering chair.", "bramble-esc", "bramble_net"),
  ];
  artifacts.push(...bramble);
  stories.push({
    id: "bramble_net",
    title: "BrambleNet peering congestion",
    expected_entity: "BrambleNet",
    should_discover: true,
    expect_ready: true,
    expect_resolve: false,
    first_evidence_day: 25,
    declaration_day: 28,
    artifact_external_ids: bramble.map((a) => a.external_id),
  });

  const kestrel = [
    art(30, "slack", "Jen", "Rumour: a Kestrel Fund observer seat is being discussed after the last board packet.", "kestrel-rumor", "kestrel_fund"),
    art(31, "email", "CFO", "CFO denied any Kestrel Fund observer arrangement. Called it a false alarm.", "kestrel-deny", "kestrel_fund"),
    art(32, "slack", "Jen", "Counsel is still worried about the Kestrel Fund filing even after the denial.", "kestrel-counsel", "kestrel_fund"),
  ];
  artifacts.push(...kestrel);
  stories.push({
    id: "kestrel_fund",
    title: "Kestrel Fund observer conflict",
    expected_entity: "Kestrel Fund",
    should_discover: true,
    expect_ready: false,
    expect_resolve: false,
    first_evidence_day: 30,
    declaration_day: 32,
    artifact_external_ids: kestrel.map((a) => a.external_id),
  });

  const amber = [
    art(33, "email", "HR", "Amberly Studio intern offers were pulled this morning. Candidates are concerned.", "amber-pull", "amberly_studio"),
    art(34, "slack", "HR", "Hiring coord: Amberly Studio cohort is cancelled pending budget. Risk of burned campus relationships.", "amber-can", "amberly_studio"),
    art(36, "email", "HR", "Amberly Studio intern offers reinstated. Walked back the cancellation — all clear.", "amber-back", "amberly_studio"),
  ];
  artifacts.push(...amber);
  stories.push({
    id: "amberly_studio",
    title: "Amberly Studio intern reversal",
    expected_entity: "Amberly Studio",
    should_discover: true,
    expect_ready: false,
    expect_resolve: true,
    first_evidence_day: 33,
    declaration_day: 34,
    resolve_day: 36,
    artifact_external_ids: amber.map((a) => a.external_id),
  });

  const noise = [
    art(11, "slack", "Cafe", "Cafeteria menu: lentil soup and garlic bread on Thursday.", "noise-menu", null),
    art(14, "email", "Facilities", "Bike rack by the loading dock will be painted next week. No action needed.", "noise-bike", null),
    art(20, "slack", "Cafe", "Reminder: bring your own mug. Dishwasher is slow today.", "noise-mug", null),
    art(27, "email", "Facilities", "Visitor parking on the south lot is open this weekend for the picnic.", "noise-park", null),
    art(31, "slack", "Cafe", "Someone left a blue umbrella in the lobby. Claim at reception.", "noise-umb", null),
  ];
  artifacts.push(...noise);
  stories.push({
    id: "ambient_noise",
    title: "Ambient noise (should not become a situation)",
    expected_entity: "Cafeteria",
    should_discover: false,
    expect_ready: false,
    expect_resolve: false,
    first_evidence_day: 11,
    declaration_day: null,
    artifact_external_ids: noise.map((a) => a.external_id),
  });

  artifacts.sort((a, b) => a.day - b.day || a.external_id.localeCompare(b.external_id));
  return { stories, artifacts };
}
