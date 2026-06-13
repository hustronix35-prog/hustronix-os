import { cn } from "@/lib/cn";

type Variant = "success" | "danger" | "warning" | "neutral" | "accent";

const styles: Record<Variant, string> = {
  success:
    "border-hx-success/40 bg-hx-success/10 text-hx-success [&_.dot]:bg-hx-success",
  danger: "border-hx-danger/40 bg-hx-danger/15 text-hx-danger [&_.dot]:bg-hx-danger",
  warning:
    "border-hx-warning/40 bg-hx-warning/10 text-hx-warning [&_.dot]:bg-hx-warning",
  neutral: "border-hx-border bg-hx-surface-elevated text-hx-muted [&_.dot]:bg-hx-muted",
  accent:
    "border-hx-accent/50 bg-hx-accent/10 text-hx-accent [&_.dot]:bg-hx-accent",
};

export function StatusBadge({
  children,
  variant = "neutral",
  dot,
  className,
}: {
  children: React.ReactNode;
  variant?: Variant;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        styles[variant],
        className,
      )}
    >
      {dot && <span className="dot size-1.5 rounded-full" />}
      {children}
    </span>
  );
}
