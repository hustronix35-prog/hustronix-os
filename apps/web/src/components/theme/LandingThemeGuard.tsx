"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { THEME_STORAGE_KEY, type Theme } from "@/components/theme/ThemeProvider";

/** Marketing routes always render in dark mode; app theme resumes elsewhere. */
const LANDING_DARK_PATHS = new Set(["/", "/contact"]);

function readStoredTheme(): Theme {
  try {
    const t = localStorage.getItem(THEME_STORAGE_KEY);
    if (t === "light" || t === "dark") return t;
  } catch {
    /* ignore */
  }
  return "dark";
}

export function LandingThemeGuard() {
  const pathname = usePathname();
  const isLanding = LANDING_DARK_PATHS.has(pathname ?? "");

  useEffect(() => {
    const root = document.documentElement;
    if (isLanding) {
      root.setAttribute("data-theme", "dark");
      return;
    }
    root.setAttribute("data-theme", readStoredTheme());
  }, [isLanding]);

  return null;
}
