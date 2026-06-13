import { cn } from "@/lib/cn";

type Variant = "primary" | "outline" | "outlineGold" | "ghost" | "dangerOutline";

const variants: Record<Variant, string> = {
  primary:
    "hx-btn-primary border border-transparent bg-gradient-to-b from-[#e8c85a] to-hx-accent font-semibold text-[#0a0a0a] shadow-[inset_0_1px_0_rgba(255,255,255,0.38),0_6px_20px_rgba(212,175,55,0.22)] hover:brightness-[1.05] active:brightness-[0.97]",
  outline:
    "hx-btn-outline border border-hx-border bg-transparent text-hx-text shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] hover:border-hx-border hover:bg-hx-surface-elevated/80",
  outlineGold:
    "hx-btn-outline-gold border border-hx-accent/90 bg-transparent text-hx-accent shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] hover:bg-hx-accent/10 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_24px_rgba(212,175,55,0.12)]",
  ghost:
    "hx-btn-ghost border border-transparent text-hx-muted hover:bg-hx-surface-elevated/60 hover:text-hx-text",
  dangerOutline:
    "border border-hx-danger/90 text-hx-danger hover:bg-hx-danger/10",
};

export function Button({
  className,
  variant = "outline",
  size = "md",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: "sm" | "md" | "lg";
}) {
  const sizes = {
    sm: "px-3 py-1.5 text-xs rounded-md",
    md: "px-4 py-2 text-sm rounded-lg",
    lg: "px-5 py-2.5 text-sm rounded-lg",
  } as const;

  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center justify-center gap-2 font-medium transition duration-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hx-accent/35 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--hx-bg)]",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-45",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}
