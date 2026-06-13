"use client";

import { useEffect, useState } from "react";

/** Recharts needs non-zero container size; skip render until after paint. */
export function ClientCharts({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);
  if (!ready) {
    return <div className="min-h-[200px] w-full min-w-[200px]" aria-hidden />;
  }
  return <>{children}</>;
}
