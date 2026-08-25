/**
 * Bottleneck detection over the dependency chain — reason, don't just store edges.
 */
import {
  loadDependencyEdges,
  walkDownstream,
  walkUpstream,
  type DependencyEdge,
} from "./dependency-chain.js";
import {
  formatEvidenceLine,
  type EvidenceReference,
} from "../intelligence/evidence-reference.js";

export type BottleneckReport = {
  bottleneck: string | null;
  blockedTeams: string[];
  upstreamBlockers: string[];
  situationId: string | null;
  confidence: number;
  evidence: EvidenceReference[];
  chain: Array<{ waiter: string; blocker: string; work: string }>;
  talk: string;
};

function titleTeam(t: string): string {
  return String(t || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function workLabel(edge: DependencyEdge | undefined): string {
  if (!edge) return "";
  const raw = `${edge.toWork || ""} ${edge.fromWork || ""}`.trim();
  if (/credential/i.test(raw)) return "credential review";
  if (/legal|approval|contract|clause/i.test(raw)) return "approval";
  if (/access/i.test(raw)) return "access review";
  const slice = (edge.fromWork || edge.toWork || "").replace(/^Waiting:\s*/i, "").trim();
  return slice.slice(0, 80);
}

function scoreEdge(e: DependencyEdge): number {
  let n = e.confidence;
  if (e.status === "DELAYED") n += 0.2;
  if (e.status === "AT_RISK") n += 0.1;
  n += Math.min(0.15, e.evidence.length * 0.05);
  return n;
}

export function detectBottleneck(userId: string, focusTeam?: string | null): BottleneckReport {
  const edges = loadDependencyEdges(userId);
  const active = edges.filter((e) => e.status !== "ON_TRACK");
  const pool = active.length ? active : edges;
  if (!pool.length) {
    return {
      bottleneck: null,
      blockedTeams: [],
      upstreamBlockers: [],
      situationId: null,
      confidence: 0,
      evidence: [],
      chain: [],
      talk: "No cross-team waits are on the dependency graph yet.",
    };
  }

  const waiters = new Set(pool.map((e) => e.fromTeam));
  const blockers = new Set(pool.map((e) => e.toTeam));
  const roots = [...waiters].filter((w) => !blockers.has(w));
  const start =
    (focusTeam && pool.find((e) => e.fromTeam.toLowerCase() === focusTeam.toLowerCase())?.fromTeam) ||
    roots[0] ||
    pool.sort((a, b) => scoreEdge(b) - scoreEdge(a))[0].fromTeam;

  const chainEdges = walkUpstream(pool, start);
  const immediate = chainEdges[0];
  const bottleneck = immediate?.toTeam || null;
  const blockedTeams = bottleneck ? walkDownstream(pool, bottleneck) : [start];
  const upstreamBlockers = chainEdges.slice(1).map((e) => e.toTeam);
  const evidence = chainEdges.flatMap((e) => e.evidence).slice(0, 8);
  const confidence = chainEdges.length
    ? Math.round((chainEdges.reduce((s, e) => s + e.confidence, 0) / chainEdges.length) * 100) / 100
    : 0;
  const situationId = chainEdges.find((e) => e.situationId)?.situationId || null;

  const chain = chainEdges.map((e) => ({
    waiter: e.fromTeam,
    blocker: e.toTeam,
    work: workLabel(e),
  }));

  const talk = formatBottleneckTalk({
    bottleneck,
    blockedTeams,
    upstreamBlockers,
    chain,
    evidence,
    start,
    immediate,
  });

  return {
    bottleneck,
    blockedTeams,
    upstreamBlockers,
    situationId,
    confidence,
    evidence,
    chain,
    talk,
  };
}

function formatBottleneckTalk(input: {
  bottleneck: string | null;
  blockedTeams: string[];
  upstreamBlockers: string[];
  chain: Array<{ waiter: string; blocker: string; work: string }>;
  evidence: EvidenceReference[];
  start: string;
  immediate: DependencyEdge | undefined;
}): string {
  const { bottleneck, blockedTeams, upstreamBlockers, chain, evidence, start, immediate } = input;
  if (!bottleneck) {
    return `${titleTeam(start)} has no recorded blocker.`;
  }
  const blocked = titleTeam(blockedTeams[0] || start);
  const mid = titleTeam(bottleneck);
  const work = workLabel(immediate);
  const up = upstreamBlockers[0] ? titleTeam(upstreamBlockers[0]) : null;
  const lines: string[] = [];
  lines.push(`${blocked} is blocked.`);
  lines.push(
    `${mid} is the immediate blocker${work ? ` (${work})` : ""}.`,
  );
  if (up) {
    const upWork = chain[1]?.work;
    lines.push(
      `${up} is the upstream blocker${upWork ? ` (${upWork})` : ""}.`,
    );
    lines.push(
      `${blocked} is blocked by ${mid}'s ${work || "review"}. ${mid} is waiting on ${up}${
        upWork ? ` ${upWork}` : " approval"
      }.`,
    );
  } else {
    lines.push(`${blocked} is waiting on ${mid}${work ? ` for ${work}` : ""}.`);
  }
  if (evidence.length) {
    lines.push("");
    lines.push("This dependency is supported by these signals:");
    for (const ev of evidence.slice(0, 4)) lines.push(`• ${formatEvidenceLine(ev)}`);
  } else if (chain.length) {
    lines.push("");
    lines.push("Provenance: inferred from team wait language on the ledger (no signal ids stored on these edges yet).");
  }
  return lines.join("\n");
}

export function explainBottlenecks(userId: string): BottleneckReport {
  return detectBottleneck(userId);
}
