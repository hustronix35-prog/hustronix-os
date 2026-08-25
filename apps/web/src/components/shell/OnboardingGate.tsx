"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { apiGet, clearAuthSession } from "@/lib/api";

/**
 * Sends authenticated users without org onboarding to `/onboarding`.
 * Skips for `system` (local automation) and when already on the onboarding route.
 *
 * TEMP: `SKIP_ONBOARDING_GATE` lets dashboard routes (e.g. Mission Control) load
 * without completing the org setup form. Re-enable by setting to false.
 */
const SKIP_ONBOARDING_GATE = true;

export function OnboardingGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [gate, setGate] = useState<"check" | "allow">(
    SKIP_ONBOARDING_GATE ? "allow" : "check",
  );
  const redirectingRef = useRef(false);

  useEffect(() => {
    if (SKIP_ONBOARDING_GATE) {
      setGate("allow");
      return;
    }

    if (pathname?.startsWith("/onboarding")) {
      setGate("allow");
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const me = await apiGet<{ user: { id: string } }>("/api/me");
        if (cancelled) return;
        if (me.user?.id === "system") {
          setGate("allow");
          return;
        }
        const { settings } = await apiGet<{ settings: Record<string, string> }>(
          "/api/settings",
        );
        if (cancelled) return;
        if (settings?.["org.onboarding.completed"] === "1") {
          setGate("allow");
          return;
        }
        router.replace("/onboarding");
      } catch {
        if (cancelled || redirectingRef.current) return;
        redirectingRef.current = true;
        await clearAuthSession();
        const next = encodeURIComponent(pathname || "/mission-control");
        router.replace(`/login?next=${next}`);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  if (gate === "check" && !pathname?.startsWith("/onboarding")) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-2 px-6 py-16 text-center">
        <p className="text-sm text-hx-muted">Preparing workspace…</p>
      </div>
    );
  }

  return <>{children}</>;
}
