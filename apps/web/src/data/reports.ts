export type ReportChartPoint = {
  date: string;
  success: number;
  load: number;
};

export const reportKpis = [
  {
    label: "Decisions Completed",
    value: "47",
    sub: "Last 30 days",
    trend: "↑ 12% vs previous 30 days",
    trendUp: true,
  },
  {
    label: "Execution Success Rate",
    value: "68%",
    sub: "Last 30 days",
    trend: "↓ 8% vs previous 30 days",
    trendUp: false,
  },
  {
    label: "Signals Killed",
    value: "132",
    sub: "Last 30 days",
    trend: "↑ 28% vs previous 30 days",
    trendUp: true,
  },
];

export const reportChart: ReportChartPoint[] = [
  { date: "Apr 20", success: 82, load: 38 },
  { date: "Apr 24", success: 78, load: 44 },
  { date: "Apr 28", success: 74, load: 52 },
  { date: "May 2", success: 71, load: 61 },
  { date: "May 6", success: 70, load: 68 },
  { date: "May 11", success: 58, load: 94 },
  { date: "May 14", success: 62, load: 88 },
  { date: "May 18", success: 64, load: 79 },
];
