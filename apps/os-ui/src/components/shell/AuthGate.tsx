"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { apiGet, clearAuthSession } from "@/lib/api";
import styles from "@/app/auth.module.css";

const PUBLIC = new Set(["/login", "/signup"]);

/**
 * Requires session cookie for app routes; sends incomplete orgs to /onboarding.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "/";
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const redirecting = useRef(false);

  const isPublic = PUBLIC.has(pathname);
  const isOnboarding = pathname.startsWith("/onboarding");

  useEffect(() => {
    let cancelled = false;
    redirecting.current = false;

    (async () => {
      if (isPublic) {
        setReady(true);
        return;
      }

      try {
        const me = await apiGet<{ user?: { id?: string } }>("/api/me");
        if (cancelled) return;
        if (me.user?.id === "system") {
          setReady(true);
          return;
        }

        const { settings } = await apiGet<{ settings: Record<string, string> }>("/api/settings");
        if (cancelled) return;

        const onboarding = settings?.["org.onboarding.completed"];
        const forceOnboarding = onboarding === "0" || onboarding === "false";
        if (forceOnboarding && !isOnboarding) {
          redirecting.current = true;
          router.replace("/onboarding");
          return;
        }
        if (!forceOnboarding && isOnboarding) {
          redirecting.current = true;
          router.replace("/chat");
          return;
        }
        setReady(true);
      } catch {
        if (cancelled || redirecting.current) return;
        if (isOnboarding || !isPublic) {
          redirecting.current = true;
          await clearAuthSession();
          const next = encodeURIComponent(pathname || "/");
          router.replace(`/login?next=${next}`);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pathname, router, isPublic, isOnboarding]);

  if (isPublic) return <>{children}</>;

  if (!ready) {
    return (
      <div className={styles.gate} suppressHydrationWarning>
        Preparing workspace…
      </div>
    );
  }

  return <>{children}</>;
}
