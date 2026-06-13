"use client";

import type { ReactNode } from "react";

/**
 * Compact dashboard masthead shell , matches Chat page header padding and height.
 */
export function DashboardHero({ children }: { children: ReactNode }) {
  return (
    <div className="shrink-0 border-b border-hx-border">
      <div className="px-4 py-2.5 lg:px-6 lg:py-3">{children}</div>
    </div>
  );
}
