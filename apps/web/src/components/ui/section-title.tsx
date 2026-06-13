import { cn } from "@/lib/cn";

export function SectionTitle({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h2
      className={cn(
        "flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-hx-accent",
        className,
      )}
    >
      <span
        className="hx-section-accent-bar h-3 w-0.5 shrink-0 rounded-full bg-gradient-to-b from-hx-accent-bright to-hx-accent-muted shadow-[0_0_12px_rgba(212,175,55,0.35)]"
        aria-hidden
      />
      {children}
    </h2>
  );
}
