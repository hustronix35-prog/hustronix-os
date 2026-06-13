"use client";

import dynamic from "next/dynamic";
import type { TeamsDonutProps } from "./teams-donut-inner";

export type { TeamsDonutProps };

export const TeamsDonut = dynamic(
  () => import("./teams-donut-inner").then((m) => ({ default: m.TeamsDonutInner })),
  {
    ssr: false,
    loading: () => (
      <div className="h-48 w-full min-h-[12rem] rounded-lg bg-hx-surface-elevated/40" aria-hidden />
    ),
  },
);
