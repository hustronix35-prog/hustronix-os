export type SignalSource = "slack" | "github" | "jira" | "notion";

export type Signal = {
  id: string;
  title: string;
  description: string;
  source: SignalSource;
  channel?: string;
  tag?: string;
  /** Human-readable category pill (e.g. User Report, Code Change). */
  categoryTag?: string;
  author?: string;
  received: string;
  /** ISO time for live grace ring (with `graceEndsAt`). */
  detectedAt?: string | null;
  graceEndsAt?: string | null;
  expiresLabel: string;
  urgent?: boolean;
  workspace?: string;
  messageId?: string;
  priority?: "High" | "Medium" | "Low";
};

export type ExecutionRow = {
  id: string;
  task: string;
  description: string;
  owner: string;
  ownerInitials: string;
  weight: number;
  status: "ACTIVE" | "BLOCKED" | "PENDING" | "COMPLETED";
  due: string;
  dueTone: "ok" | "soon" | "overdue";
  decision: string;
};

export type TeamMember = {
  id: string;
  name: string;
  email: string;
  role: string;
  team: string;
  capacity: string;
  loadPct: number;
  utilization: number;
  status: "Healthy" | "At Risk" | "Over Capacity";
  /** Slack member ID (e.g. U0123ABCD) or @display handle */
  slackId?: string;
  /** Roster tier / seniority label for planning */
  talentTier?: string;
  /** True when the row is a user-added roster member that can be deleted via DELETE /api/metrics/teams/roster/:id */
  canRemove?: boolean;
  /** True when this member is the organization owner (rendered with an Owner badge) */
  isOrgOwner?: boolean;
  /** EIE advisory beliefs (ledger owners only) */
  beliefs?: {
    beliefKey: string;
    mean: number;
    confidence: number;
    variance: number;
    nObs: number;
    modelId: string;
  }[];
  derivedCapacity?: {
    value: number;
    confidence: number;
    uncertainty: number;
  };
  legacyCapacity?: number;
  trustScore?: { mean: number; confidence: number; nObs: number };
  intelligenceAdvisory?: boolean;
};
