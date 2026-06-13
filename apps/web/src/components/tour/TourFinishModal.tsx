"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TourModalShell } from "@/components/tour/TourModalShell";

type Props = {
  open: boolean;
  onClose: () => void;
};

export function TourFinishModal({ open, onClose }: Props) {
  if (!open) return null;

  return (
    <TourModalShell>
      <Card
        className="relative z-[110] mx-4 w-full max-w-lg border-hx-success/30 p-6 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hx-finish-tour-title"
      >
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-hx-success">
          Tour complete
        </p>
        <h2 id="hx-finish-tour-title" className="mt-2 text-xl font-bold text-hx-text">
          You are set to run the loop
        </h2>
        <p className="mt-2 text-sm text-hx-muted">Use this rhythm in your first week:</p>
        <ol className="mt-3 list-inside list-decimal space-y-1.5 text-sm text-hx-muted">
          <li>Mission Control + Execute , one active decision with a handful of tasks.</li>
          <li>Signals , triage UNVERIFIED items for 15 minutes daily.</li>
          <li>Chat , deep dives on risks and dependencies.</li>
          <li>Reports + Teams , snapshot outcomes and owner load.</li>
        </ol>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Link
            href="/guide"
            onClick={onClose}
            className="inline-flex items-center justify-center rounded-md border border-hx-border px-3 py-1.5 text-xs font-medium text-hx-text transition hover:bg-hx-surface-elevated"
          >
            Full guide
          </Link>
          <Link
            href="/chat"
            onClick={onClose}
            className="inline-flex items-center justify-center rounded-md border border-hx-border px-3 py-1.5 text-xs font-medium text-hx-text transition hover:bg-hx-surface-elevated"
          >
            Open Chat
          </Link>
          <Button variant="primary" size="sm" type="button" onClick={onClose}>
            Got it
          </Button>
        </div>
      </Card>
    </TourModalShell>
  );
}
