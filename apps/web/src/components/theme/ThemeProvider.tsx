"use client";

import { MotionConfig, useReducedMotion } from "framer-motion";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Theme = "dark" | "light";

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  /** Undefined until after mount (match SSR + avoid flicker in menus). */
  resolvedTheme: Theme | undefined;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export const THEME_STORAGE_KEY = "hustronix-theme";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const prefersReducedMotion = useReducedMotion();
  const [theme, setThemeState] = useState<Theme>("dark");
  const [resolvedTheme, setResolvedTheme] = useState<Theme | undefined>(
    undefined,
  );

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const attr = document.documentElement.getAttribute("data-theme");
      const initial: Theme = attr === "light" ? "light" : "dark";
      setThemeState(initial);
      setResolvedTheme(initial);
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    setResolvedTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* ignore quota / private mode */
    }
  }, []);

  const value = useMemo(
    () => ({ theme, setTheme, resolvedTheme }),
    [theme, setTheme, resolvedTheme],
  );

  return (
    <ThemeContext.Provider value={value}>
      <MotionConfig reducedMotion={prefersReducedMotion ? "always" : "user"}>
        {children}
      </MotionConfig>
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return ctx;
}
