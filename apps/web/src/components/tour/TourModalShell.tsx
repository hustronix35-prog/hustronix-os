"use client";

import type { ReactNode } from "react";

export function TourModalShell({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-[105] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70" aria-hidden />
      {children}
    </div>
  );
}
