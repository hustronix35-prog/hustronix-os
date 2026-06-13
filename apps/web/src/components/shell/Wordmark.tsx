import { cn } from "@/lib/cn";

/** HUSTRONIX , bold caps, wide tracking; final X in Signal Gold (matches official lockup). */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "text-sm font-bold uppercase tracking-[0.06em] text-hx-text",
        className,
      )}
    >
      <span className="text-hx-text">HUSTRONI</span>
      <span className="text-hx-accent">X</span>
    </span>
  );
}
