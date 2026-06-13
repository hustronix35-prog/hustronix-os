import { cn } from "@/lib/cn";
import type { ComponentPropsWithoutRef } from "react";

export function Card({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<"div">) {
  return (
    <div
      className={cn(
        "hx-card rounded-xl border border-hx-border/90 bg-hx-surface p-6 ring-1 ring-inset ring-[var(--hx-card-ring)]",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
