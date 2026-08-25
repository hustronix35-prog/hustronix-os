export type Status =
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "info"
  | "healthy"
  | "at-risk"
  | "pending"
  | "blocked"
  | "on-track"
  | "off-track"
  | "waiting"
  | "connected"
  | "purple"
  | "cyan";

export type Impact = "High" | "Medium" | "Low";

export type NavItem = {
  label: string;
  href: string;
  icon: string;
};

export type Metric = {
  label: string;
  value: string | number;
  subtitle?: string;
  status?: Status;
  icon?: string;
};

export type Decision = {
  title: string;
  type: string;
  status: string;
  confidence?: number;
  impact: Impact;
  owner: string;
  deadline?: string;
  age?: string;
};

export type Alert = {
  id?: string;
  title: string;
  severity: "Critical" | "High" | "Medium" | "Low" | "Info";
  description: string;
  tags: string[];
  time: string;
  action: string;
  group: "Today" | "Yesterday";
  unread?: boolean;
};

export type FocusItem = {
  id?: string;
  title: string;
  status: string;
  statusTone: Status;
  progress: number;
  due: string;
  icon: string;
};

export type ScheduleItem = {
  time: string;
  title: string;
  badge?: string;
  highlight?: boolean;
};

export type Recommendation = {
  rank: number;
  title: string;
  status: string;
  statusTone: Status;
  explanation: string;
  confidence: number;
  impact: Impact;
  impactDetail: string;
  effort: Impact;
  source: string;
};

export type KGKind =
  | "goal"
  | "initiative"
  | "decision"
  | "execution"
  | "signal"
  | "metric"
  | "customer";

export type KGTone = "gold" | "red" | "orange" | "purple" | "blue" | "green";

export type KGNode = {
  id: string;
  kind: KGKind;
  tone: KGTone;
  title: string;
  subtitle?: string;
  x: number;
  y: number;
  ring?: { pct: number; label: string; sub?: string };
  value?: string;
  pill?: { label: string; tone: string };
  risky?: boolean;
  center?: boolean;
  why?: string;
  impact?: string;
  confidence?: string;
  href?: string;
  openLabel?: string;
};

export type KGEdgeKind =
  | "contributes"
  | "drives"
  | "depends"
  | "influences"
  | "requires"
  | "affects"
  | "related"
  | "blocks";

export type KGEdge = {
  from: string;
  to: string;
  kind: KGEdgeKind;
  label?: string;
  pct?: string;
};

export type EntityCount = {
  label: string;
  count: number;
  href: string;
  icon: string;
  tone: Status;
};

export type TableRow = Record<string, string | number | boolean | undefined>;
