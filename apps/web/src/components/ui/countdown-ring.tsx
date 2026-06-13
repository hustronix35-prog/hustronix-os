import { cn } from "@/lib/cn";

export function CountdownRing({
  label,
  urgent,
  className,
}: {
  label: string;
  urgent?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex size-11 shrink-0 items-center justify-center rounded-full border-2 bg-hx-surface-elevated text-[9px] font-bold leading-tight",
        urgent
          ? "border-hx-danger text-hx-danger"
          : "border-hx-accent text-hx-accent",
        className,
      )}
    >
      <span className="px-0.5 text-center">{label}</span>
    </div>
  );
}
