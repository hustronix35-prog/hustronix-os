"use client";

import dynamic from "next/dynamic";
import type { ReportLineChartProps } from "./report-line-chart-inner";

export type { ReportLineChartProps };

export const ReportLineChart = dynamic(
  () =>
    import("./report-line-chart-inner").then((m) => ({
      default: m.ReportLineChartInner,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="h-72 w-full min-h-[12rem] rounded-lg bg-hx-surface-elevated/40" aria-hidden />
    ),
  },
);
