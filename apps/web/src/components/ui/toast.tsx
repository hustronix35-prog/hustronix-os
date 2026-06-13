"use client";

import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { cn } from "@/lib/cn";

export type ToastKind = "success" | "error" | "info";

interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
}

export interface ToastApi {
  show: (text: string, kind?: ToastKind, ttlMs?: number) => void;
  success: (text: string, ttlMs?: number) => void;
  error: (text: string, ttlMs?: number) => void;
  info: (text: string, ttlMs?: number) => void;
}

const NOOP_API: ToastApi = {
  show: () => {},
  success: () => {},
  error: () => {},
  info: () => {},
};

const ToastContext = createContext<ToastApi | null>(null);

const DEFAULT_TTL_MS = 3500;
const ERROR_TTL_MS = 6000;

/**
 * Mounts a fixed bottom-right toast viewport and exposes `useToast()` to all
 * descendant client components. Safe to render multiple stacked toasts ,
 * they queue vertically and auto-dismiss.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    setToasts((arr) => arr.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const show = useCallback(
    (text: string, kind: ToastKind = "info", ttlMs?: number) => {
      const id = ++idRef.current;
      const lifetime =
        typeof ttlMs === "number" && ttlMs > 0
          ? ttlMs
          : kind === "error"
            ? ERROR_TTL_MS
            : DEFAULT_TTL_MS;
      setToasts((arr) => [...arr, { id, kind, text }]);
      const timer = setTimeout(() => dismiss(id), lifetime);
      timersRef.current.set(id, timer);
    },
    [dismiss],
  );

  useEffect(() => {
    return () => {
      timersRef.current.forEach((t) => clearTimeout(t));
      timersRef.current.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (text, ttlMs) => show(text, "success", ttlMs),
      error: (text, ttlMs) => show(text, "error", ttlMs),
      info: (text, ttlMs) => show(text, "info", ttlMs),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

/**
 * Returns the toast API. If no `<ToastProvider />` is mounted in the tree we
 * return a no-op shim instead of throwing, so consumers can be added safely
 * without forcing every layout to wrap them.
 */
export function useToast(): ToastApi {
  return useContext(ToastContext) ?? NOOP_API;
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.kind === "error" ? "alert" : "status"}
          className={cn(
            "pointer-events-auto flex items-start gap-3 rounded-lg border px-3 py-2.5 shadow-lg backdrop-blur-sm",
            "motion-safe:animate-in motion-safe:slide-in-from-bottom-2 motion-safe:fade-in motion-safe:duration-200",
            t.kind === "success" && "border-hx-success/50 bg-hx-success/15 text-hx-success",
            t.kind === "error" && "border-hx-danger/50 bg-hx-danger/15 text-hx-danger",
            t.kind === "info" && "border-hx-border bg-hx-surface text-hx-text",
          )}
        >
          {t.kind === "success" ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
          ) : t.kind === "error" ? (
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          ) : (
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          )}
          <p className="flex-1 text-sm leading-snug">{t.text}</p>
          <button
            type="button"
            onClick={() => onDismiss(t.id)}
            className="-mr-1 rounded p-0.5 text-current opacity-60 transition hover:opacity-100"
            aria-label="Dismiss"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}
