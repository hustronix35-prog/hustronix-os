import { cn } from "@/lib/cn";

/** Brand voice tagline , gold periods (style guide). */
export function BrandTagline({ className }: { className?: string }) {
  return (
    <p
      className={cn(
        "text-[8px] font-medium uppercase tracking-[0.22em] text-hx-text",
        className,
      )}
    >
      <span>Decide</span>
      <span className="text-hx-accent">.</span>
      <span> Align</span>
      <span className="text-hx-accent">.</span>
      <span> Execute</span>
      <span className="text-hx-accent">.</span>
    </p>
  );
}
