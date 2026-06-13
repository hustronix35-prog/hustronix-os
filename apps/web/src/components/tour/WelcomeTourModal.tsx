"use client";

import { LayoutDashboard, MessageSquare, Zap } from "lucide-react";
import { BroadcastIcon } from "@/components/icons/brand-icons";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TourModalShell } from "@/components/tour/TourModalShell";

type Props = {
  open: boolean;
  onStart: () => void;
  onSkip: () => void;
};

export function WelcomeTourModal({ open, onStart, onSkip }: Props) {
  if (!open) return null;

  return (
    <TourModalShell>
      <Card
        className="relative z-[110] mx-4 w-full max-w-lg border-hx-accent/30 p-6 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hx-welcome-tour-title"
      >
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-hx-accent">
          Welcome to HUSTRONIX
        </p>
        <h2 id="hx-welcome-tour-title" className="mt-2 text-xl font-bold text-hx-text">
          Operational intelligence in one loop
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-hx-muted">
          Strategy should not live in slides while work happens elsewhere. HUSTRONIX ties{" "}
          <strong className="font-medium text-hx-text">decisions</strong>,{" "}
          <strong className="font-medium text-hx-text">execution</strong>, and{" "}
          <strong className="font-medium text-hx-text">signals</strong> so your team executes on
          what you actually committed to.
        </p>
        <ul className="mt-4 space-y-2.5 text-sm text-hx-muted">
          <li className="flex items-start gap-2.5">
            <LayoutDashboard className="mt-0.5 size-4 shrink-0 text-hx-accent" aria-hidden />
            <span>
              <strong className="text-hx-text">Mission Control</strong> , log and track the active
              bet, capacity, and ledger health.
            </span>
          </li>
          <li className="flex items-start gap-2.5">
            <Zap className="mt-0.5 size-4 shrink-0 text-hx-accent" aria-hidden />
            <span>
              <strong className="text-hx-text">Execute</strong> , move tasks with clear owners and
              states tied to decisions.
            </span>
          </li>
          <li className="flex items-start gap-2.5">
            <BroadcastIcon className="mt-0.5 size-4 shrink-0 text-hx-accent" aria-hidden />
            <span>
              <strong className="text-hx-text">Signals</strong> , verify, link, or kill inbound
              noise so prioritization stays honest.
            </span>
          </li>
          <li className="flex items-start gap-2.5">
            <MessageSquare className="mt-0.5 size-4 shrink-0 text-hx-accent" aria-hidden />
            <span>
              <strong className="text-hx-text">Chat</strong> , ask the agent with your org and
              ledger context, not a blank slate.
            </span>
          </li>
        </ul>
        <p className="mt-4 text-xs text-hx-muted">
          This short tour highlights each screen (~3 minutes). You can skip and restart anytime from
          Profile or the AI Assistant.
        </p>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button variant="outline" size="sm" type="button" onClick={onSkip}>
            Skip for now
          </Button>
          <Button variant="primary" size="sm" type="button" onClick={onStart}>
            Start guided tour
          </Button>
        </div>
      </Card>
    </TourModalShell>
  );
}
