export type RosterFieldKey =
  | "name"
  | "email"
  | "role"
  | "team"
  | "capacity"
  | "slackId"
  | "talentTier";

export type RosterFieldSpec = {
  key: RosterFieldKey;
  label: string;
  required: boolean;
  description: string;
  example: string;
  aliases: string[];
};

export const ROSTER_FIELD_SCHEMA: RosterFieldSpec[] = [
  {
    key: "name",
    label: "Name",
    required: true,
    description: "Display name for the roster row.",
    example: "Alex Morgan",
    aliases: ["name", "full name", "employee", "owner", "member", "person"],
  },
  {
    key: "email",
    label: "Email",
    required: true,
    description: "Unique key per workspace; used to merge imports.",
    example: "alex@company.com",
    aliases: ["email", "e-mail", "work email", "mail"],
  },
  {
    key: "role",
    label: "Role",
    required: false,
    description: "Function or title (defaults to Member).",
    example: "Product",
    aliases: ["role", "title", "job title", "function"],
  },
  {
    key: "team",
    label: "Scope / team",
    required: false,
    description: "Squad or scope label (defaults to General).",
    example: "Growth",
    aliases: ["team", "scope", "department", "dept", "squad", "group"],
  },
  {
    key: "capacity",
    label: "Capacity label",
    required: false,
    description: "Planning label, e.g. weekly hours (defaults to 40h / week).",
    example: "40h / week",
    aliases: ["capacity", "hours", "availability", "fte", "bandwidth"],
  },
  {
    key: "slackId",
    label: "Slack ID",
    required: false,
    description: "Slack member ID or @handle.",
    example: "U01234ABCD",
    aliases: ["slack", "slack id", "slack_id", "slack handle"],
  },
  {
    key: "talentTier",
    label: "Level",
    required: false,
    description: "Seniority tier for planning.",
    example: "Senior",
    aliases: ["level", "tier", "seniority", "grade", "talent tier"],
  },
];

export type RosterDraftMember = {
  name: string;
  email: string;
  role: string;
  team: string;
  capacity: string;
  slackId?: string;
  talentTier?: string;
  sourceRow?: number;
  issues?: string[];
};

export type RosterParseResult = {
  members: RosterDraftMember[];
  columnMapping: Partial<Record<RosterFieldKey, string>>;
  detectedHeaders: string[];
  warnings: string[];
  method: "heuristic" | "llm";
};

export type RosterParseResponse = RosterParseResult & {
  schema?: RosterFieldSpec[];
};
