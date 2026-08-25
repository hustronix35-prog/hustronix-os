/**
 * Expected outcome recorded at decision time — what "it worked" would mean.
 * Slice 2: structured enough to judge later; not a KPI warehouse.
 */
export type ExpectedOutcome = {
  statement: string;
  metric: string;
  target: string;
  trajectory: "IMPROVING" | "STABLE" | "WORSENING";
  window_days: number;
  time_window_days: number;
  success_conditions: string[];
  success: {
    all_tasks_done: boolean;
    max_killed: number;
    fail_if_worsening: boolean;
    succeed_if_improving_or_resolved: boolean;
  };
};

export function expectedOutcomeForSituation(input: {
  title: string;
  trajectory?: string;
  windowDays?: number;
}): ExpectedOutcome {
  const title = String(input.title || "this situation").trim() || "this situation";
  const window_days = Number(input.windowDays) > 0 ? Number(input.windowDays) : 14;
  return {
    statement: `${title}: after execution the situation should improve or resolve, and must not still be worsening.`,
    metric: title,
    target: title,
    trajectory: "IMPROVING",
    window_days,
    time_window_days: window_days,
    success_conditions: [
      `${title} trajectory improves`,
      "Expected operational signals stop worsening",
    ],
    success: {
      all_tasks_done: true,
      max_killed: 0,
      fail_if_worsening: true,
      succeed_if_improving_or_resolved: true,
    },
  };
}
