"use client";

import dynamic from "next/dynamic";
import type { TeamsBarChartProps } from "./teams-bar-chart-inner";

export type { TeamsBarChartProps };

export const TeamsBarChart = dynamic(
  () => import("./teams-bar-chart-inner").then((m) => ({ default: m.TeamsBarChartInner })),
  {
    ssr: false,
    loading: () => (
      <div className="h-52 w-full min-h-[12rem] rounded-lg bg-hx-surface-elevated/40" aria-hidden />
    ),
  },
);
