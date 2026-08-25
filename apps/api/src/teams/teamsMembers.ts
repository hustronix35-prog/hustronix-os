import { isValidEmailFormat } from "../auth/password.js";
import { db } from "../database.js";
import {
  computeDerivedCapacity,
  computeTrustScore,
  listBeliefsForEntity,
} from "../execution-intelligence/derived-views.js";
import type { BeliefView } from "../execution-intelligence/types.js";

export type TeamEntrySource = "ledger" | "roster" | "workspace";

export type TeamEntry = {
  id: string;
  name: string;
  email: string;
  role: string;
  team: string;
  capacity: string;
  loadPct: number;
  utilization: number;
  status: "Healthy" | "At Risk" | "Over Capacity";
  slackId?: string;
  talentTier?: string;
  canRemove: boolean;
  isOrgOwner?: boolean;
  source: TeamEntrySource;
  /** Roster rows (and full profile fields) can be edited via PATCH /api/metrics/teams/roster/:id */
  editable: boolean;
  /** EIE advisory summary (ledger owners only) */
  intelligence?: TeamIntelligenceSummary;
};

export type TeamIntelligenceSummary = {
  topBeliefs: BeliefView[];
  trustScore: { mean: number; confidence: number; nObs: number };
  derivedCapacity: number;
  derivedConfidence: number;
  uncertainty: number;
  legacyCapacity: number;
};

export function enrichLedgerOwnerIntelligence(
  tenantId: string,
  owner: string,
  legacyCapacity: number,
): TeamIntelligenceSummary {
  const beliefs = listBeliefsForEntity(tenantId, "person", owner);
  const derived = computeDerivedCapacity(beliefs);
  const trustScore = computeTrustScore(beliefs);
  const topBeliefs = beliefs
    .filter((b) => !b.beliefKey.startsWith("expertise:") && !b.beliefKey.startsWith("performance_at_load:"))
    .sort((a, b) => b.mean * b.confidence - a.mean * a.confidence)
    .slice(0, 3);
  return {
    topBeliefs,
    trustScore,
    derivedCapacity: derived.derivedCapacity,
    derivedConfidence: derived.confidence,
    uncertainty: derived.uncertainty,
    legacyCapacity,
  };
}

export function mapRosterRow(r: {
  id: string;
  name: string;
  email: string;
  role: string;
  team: string;
  capacity: string;
  slack_id: string | null;
  talent_tier: string | null;
}): TeamEntry {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    role: r.role,
    team: r.team,
    capacity: r.capacity,
    loadPct: 0,
    utilization: 0,
    status: "Healthy",
    slackId: r.slack_id || undefined,
    talentTier: r.talent_tier || undefined,
    canRemove: true,
    source: "roster",
    editable: true,
  };
}

/** All team rows shown on /teams: ledger owners, saved roster, workspace self. */
export function buildTeamEntries(userId: string): TeamEntry[] {
  const owners = db.rawGet(
    `SELECT e.owner as owner,
        COUNT(*) as total_tasks,
        SUM(CASE WHEN e.status = 'ACTIVE' THEN e.weight ELSE 0 END) as active_weight,
        SUM(CASE WHEN e.status = 'BLOCKED' THEN 1 ELSE 0 END) as blocked_n,
        SUM(CASE WHEN e.status = 'PENDING' THEN 1 ELSE 0 END) as pending_n
     FROM execution_ledger e
     INNER JOIN decision_ledger d ON e.decision_id = d.id
     WHERE d.user_id = ?
     GROUP BY e.owner
     ORDER BY e.owner`,
    [userId],
  ) as {
    owner: string;
    total_tasks: number;
    active_weight: number;
    blocked_n: number;
    pending_n: number;
  }[];

  const seenEmails = new Set<string>();
  const members: TeamEntry[] = [];

  for (let i = 0; i < owners.length; i++) {
    const o = owners[i]!;
    const cap = db.getOwnerCapacity(o.owner, userId);
    const load = Number(o.active_weight || 0);
    const capN = cap.capacity || 3;
    const loadPct = Math.min(100, Math.round((load / capN) * 100));
    const utilization = Math.min(100, loadPct + (Number(o.blocked_n) > 0 ? 15 : 0));
    let status: "Healthy" | "At Risk" | "Over Capacity" = "Healthy";
    if (load > capN) status = "Over Capacity";
    else if (load > capN * 0.85 || Number(o.blocked_n) > 0) status = "At Risk";
    const email = `${o.owner}@owners.local`;
    seenEmails.add(email.toLowerCase());
    members.push({
      id: `ledger:${o.owner}`,
      name: o.owner === "system" ? "System" : o.owner,
      email,
      role: "Owner",
      team: "Execution",
      capacity: `${capN.toFixed(1)} wt`,
      loadPct,
      utilization,
      status,
      canRemove: false,
      source: "ledger",
      editable: false,
      intelligence: enrichLedgerOwnerIntelligence(userId, o.owner, capN),
    });
  }

  for (const r of db.listTeamRoster(userId)) {
    const em = (r.email || "").toLowerCase();
    if (!em || seenEmails.has(em)) continue;
    seenEmails.add(em);
    members.push(mapRosterRow(r));
  }

  if (userId !== "system") {
    const selfRow = db.getUserById(userId) as
      | { id: string; username: string; email: string | null }
      | undefined;
    if (selfRow) {
      const sColEmail = (selfRow.email && String(selfRow.email).trim()) || "";
      const sProfileEmail = (db.getSetting(userId, "profile.email") || "").trim();
      const sUsername = (selfRow.username || "").trim();
      const sResolvedEmail =
        sColEmail ||
        (sUsername.includes("@") ? sUsername : "") ||
        (sProfileEmail.length > 0 && isValidEmailFormat(sProfileEmail) ? sProfileEmail : "");
      const ownerUid = (db.getSetting(userId, "org.owner_user_id") || "").trim();
      const isOrgOwner = ownerUid === userId;
      const profileRole = (db.getSetting(userId, "profile.role") || "").trim();
      const displayRole = profileRole || (isOrgOwner ? "Owner" : "Member");
      const displayName =
        (db.getSetting(userId, "profile.display_name") || "").trim() || sUsername || userId;
      const alreadyListed =
        sResolvedEmail &&
        members.some((m) => m.email.toLowerCase() === sResolvedEmail.toLowerCase());
      if (sResolvedEmail && !alreadyListed) {
        members.unshift({
          id: "__self__",
          name: displayName,
          email: sResolvedEmail,
          role: displayRole,
          team: "Workspace",
          capacity: "—",
          loadPct: 0,
          utilization: 0,
          status: "Healthy",
          canRemove: false,
          isOrgOwner,
          source: "workspace",
          editable: false,
        });
      }
    }
  }

  return members;
}
