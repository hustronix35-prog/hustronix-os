"use client";

import { KeyRound, Lock, ScrollText, Server, Shield } from "lucide-react";
import { cn } from "@/lib/cn";
import { RevealStaggerItem, RevealStaggerList } from "@/components/landing/ScrollReveal";

const ITEMS = [
  {
    title: "Encrypted infrastructure",
    body: "Data in transit and at rest protected with modern TLS and storage encryption.",
    Icon: Lock,
  },
  {
    title: "Role-based access",
    body: "Org-scoped permissions aligned to owner, operator, and viewer roles.",
    Icon: KeyRound,
  },
  {
    title: "Audit logging",
    body: "Decision commits, execution transitions, and sensitive actions are traceable.",
    Icon: ScrollText,
  },
  {
    title: "Isolated tenant data",
    body: "Per-organization boundaries—signals and ledger entries stay scoped to your workspace.",
    Icon: Server,
  },
  {
    title: "Enterprise-ready stack",
    body: "Deterministic enforcement core with session-safe auth—not prompt-only control.",
    Icon: Shield,
  },
] as const;

export function LandingSecurity({ className }: { className?: string }) {
  return (
    <RevealStaggerList
      className={cn(
        "grid list-none gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:gap-5",
        className,
      )}
    >
      {ITEMS.map((item) => {
        const Icon = item.Icon;
        return (
          <RevealStaggerItem
            key={item.title}
            className="landing-glass-card rounded-xl p-6"
          >
            <Icon className="size-5 text-landing-gold/90" strokeWidth={1.35} aria-hidden />
            <h3 className="mt-4 text-sm font-semibold uppercase tracking-[0.12em] text-hx-text">
              {item.title}
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-hx-muted/80">{item.body}</p>
          </RevealStaggerItem>
        );
      })}
    </RevealStaggerList>
  );
}
