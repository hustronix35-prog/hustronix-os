/** Shared Analytics dashboard types (mirrors GET /api/analytics/summary). */

export type AnalyticsRange = "7d" | "14d" | "30d" | "90d";

export type AnalyticsKpi = {
  id: string;
  label: string;
  value: string;
  sub: string;
  delta: number;
  deltaLabel: string;
  up: boolean;
  tone: "good" | "warn" | "bad" | "neutral";
  spark: number[];
};

export type AnalyticsSlice = {
  key: string;
  label: string;
  count: number;
  pct: number;
  color: string;
};

export type AnalyticsSummary = {
  range: AnalyticsRange;
  rangeLabel: string;
  generatedAt: string;
  overview: {
    kpis: AnalyticsKpi[];
    healthSeries: { label: string; value: number }[];
    distribution: { total: number; slices: AnalyticsSlice[] };
    topRisks: {
      id: string;
      title: string;
      detail: string;
      level: string;
      score: number;
    }[];
  };
  execution: {
    totals: {
      total: number;
      completed: number;
      inProgress: number;
      blocked: number;
      overdue: number;
      pending: number;
      killed: number;
    };
    distribution: { total: number; slices: AnalyticsSlice[] };
    bottlenecks: {
      id: string;
      task: string;
      owner: string;
      impact: string;
      reason: string;
    }[];
  };
  decisions: {
    metrics: {
      made: number;
      approved: number;
      pending: number;
      reversed: number;
      effectiveness: number;
    };
    recent: {
      id: string;
      title: string;
      status: string;
      owner: string;
      confidence: number | null;
      when: string;
    }[];
  };
  teams: {
    health: {
      team: string;
      health: number;
      load: number;
      members: number;
      spark: number[];
    }[];
    workload: AnalyticsSlice[];
    overloaded: { id: string; name: string; team: string; load: number; status: string }[];
    people: number;
  };
  initiatives: {
    id: string;
    name: string;
    health: number;
    progress: number;
    risks: number;
    owner: string;
    target: string;
    status: string;
  }[];
  trends: {
    metrics: { id: string; label: string; series: { date: string; value: number }[] }[];
  };
  reports: {
    id: string;
    name: string;
    description: string;
    lastRun: string;
    owner: string;
    kind: "scheduled" | "system" | "my";
  }[];
};
