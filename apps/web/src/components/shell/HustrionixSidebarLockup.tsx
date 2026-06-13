import Image from "next/image";
import { cn } from "@/lib/cn";

const ALT = "HUSTRONIX , Decide. Align. Execute.";

type Props = {
  className?: string;
  /** `contain` fits the full artwork without cropping (e.g. auth card at fixed height). Default `cover`. */
  fit?: "cover" | "contain";
};

/**
 * Sidebar rail: lockup fills the container edge-to-edge (no ring/padding).
 */
export function HustrionixSidebarLockup({ className, fit = "cover" }: Props) {
  return (
    <div
      className={cn(
        "relative h-[72px] w-full shrink-0 overflow-hidden rounded-md bg-hx-sidebar",
        className,
      )}
    >
      <Image
        src="/brand/hustronix-sidebar-lockup.png"
        alt={ALT}
        fill
        priority
        sizes="240px"
        quality={92}
        className={cn(
          fit === "contain" ? "object-contain object-center" : "object-cover object-center",
        )}
      />
    </div>
  );
}
