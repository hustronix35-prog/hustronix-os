"use client";

import { Map } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  onResume: () => void;
  onDismiss: () => void;
};

export function TourResumeBanner({ onResume, onDismiss }: Props) {
  return (
    <div
      className="pointer-events-none fixed bottom-4 left-1/2 z-[110] w-[min(100%,28rem)] -translate-x-1/2 px-4"
      role="status"
    >
      <div className="pointer-events-auto flex flex-wrap items-center justify-between gap-3 rounded-lg border border-hx-accent/40 bg-hx-surface px-4 py-3 shadow-lg">
        <div className="flex min-w-0 items-center gap-2 text-sm text-hx-text">
          <Map className="size-4 shrink-0 text-hx-accent" aria-hidden />
          <span>Resume the guided product tour where you left off.</span>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="ghost" size="sm" type="button" onClick={onDismiss}>
            Dismiss
          </Button>
          <Button variant="primary" size="sm" type="button" onClick={onResume}>
            Resume tour
          </Button>
        </div>
      </div>
    </div>
  );
}
