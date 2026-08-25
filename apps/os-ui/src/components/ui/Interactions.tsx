"use client";

import { CheckCircle2, Info, X, XCircle } from "@/components/icons";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import styles from "./interactions.module.css";

/* ------------------------------ Toasts ------------------------------ */

type ToastTone = "info" | "success" | "danger";

type Toast = {
  id: number;
  title: string;
  description?: string;
  tone: ToastTone;
};

const ToastContext = createContext<{
  toast: (title: string, options?: { description?: string; tone?: ToastTone }) => void;
} | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

const toastIcons: Record<ToastTone, ReactNode> = {
  info: <Info size={16} />,
  success: <CheckCircle2 size={16} />,
  danger: <XCircle size={16} />,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const toast = useCallback(
    (title: string, options?: { description?: string; tone?: ToastTone }) => {
      const id = ++idRef.current;
      setToasts((prev) => [
        ...prev.slice(-3),
        { id, title, description: options?.description, tone: options?.tone ?? "info" },
      ]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 3800);
    },
    [],
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className={styles.toastViewport} role="status" aria-live="polite" suppressHydrationWarning>
        {toasts.map((t) => (
          <div key={t.id} className={styles.toast} data-tone={t.tone}>
            <span className={styles.toastIcon}>{toastIcons[t.tone]}</span>
            <div className={styles.toastBody}>
              <strong>{t.title}</strong>
              {t.description ? <span>{t.description}</span> : null}
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/* ------------------------------ Modal ------------------------------ */

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  size,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  size?: "md" | "lg";
  children: ReactNode;
  footer?: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className={styles.modalOverlay}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.modalPanel} data-size={size ?? "md"} role="dialog" aria-modal="true" aria-label={title}>
        <div className={styles.modalHead}>
          <div>
            <h2>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button type="button" className={styles.modalClose} aria-label="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className={styles.modalBody}>{children}</div>
        {footer ? <div className={styles.modalFoot}>{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------ Dropdown ------------------------------ */

export type MenuItem =
  | {
      type: "item";
      label: string;
      description?: string;
      icon?: ReactNode;
      tone?: "default" | "danger";
      onSelect: () => void;
    }
  | { type: "separator" }
  | { type: "header"; label: string };

export function Dropdown({
  trigger,
  items,
  align = "right",
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  items: MenuItem[];
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pad = 12;
    const gap = 8;
    const width = Math.min(320, window.innerWidth - pad * 2);
    const left =
      align === "right"
        ? Math.max(pad, Math.min(r.right - width, window.innerWidth - width - pad))
        : Math.max(pad, Math.min(r.left, window.innerWidth - width - pad));

    const measured = menuRef.current?.scrollHeight ?? 0;
    const estimated = Math.min(280, 48 + items.length * 44);
    const menuH = measured > 0 ? measured : estimated;
    const spaceBelow = window.innerHeight - r.bottom - gap - pad;
    const spaceAbove = r.top - gap - pad;
    const openUp = spaceBelow < menuH && spaceAbove > spaceBelow;
    const available = openUp ? spaceAbove : spaceBelow;
    const maxHeight = Math.max(160, Math.min(menuH, available, window.innerHeight - pad * 2));
    const usedH = Math.min(menuH, maxHeight);

    let top = openUp ? r.top - gap - usedH : r.bottom + gap;
    if (top < pad) top = pad;
    if (top + usedH > window.innerHeight - pad) {
      top = Math.max(pad, window.innerHeight - pad - usedH);
    }

    setCoords((prev) => {
      if (
        prev &&
        prev.top === top &&
        prev.left === left &&
        prev.width === width &&
        prev.maxHeight === maxHeight
      ) {
        return prev;
      }
      return { top, left, width, maxHeight };
    });
  }, [align, items.length]);

  useLayoutEffect(() => {
    if (!open) {
      setCoords(null);
      return;
    }
    place();
  }, [open, place]);

  // After the menu mounts, remeasure with real height so it can flip above the trigger.
  useLayoutEffect(() => {
    if (!open || !coords || !menuRef.current) return;
    place();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only remount/remeasure when menu first appears
  }, [open, Boolean(coords)]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onReposition = () => place();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open, place]);

  const menu = open && coords ? (
    <div
      ref={menuRef}
      className={styles.menu}
      data-align={align}
      role="menu"
      style={{
        position: "fixed",
        top: coords.top,
        left: coords.left,
        width: coords.width,
        maxHeight: coords.maxHeight,
        right: "auto",
        overflowY: "auto",
      }}
    >
      {items.map((item, i) => {
        if (item.type === "separator") return <div key={i} className={styles.menuSep} />;
        if (item.type === "header")
          return (
            <div key={i} className={styles.menuHead}>
              {item.label}
            </div>
          );
        return (
          <button
            key={i}
            type="button"
            role="menuitem"
            className={styles.menuItem}
            data-tone={item.tone === "danger" ? "danger" : undefined}
            onClick={() => {
              setOpen(false);
              item.onSelect();
            }}
          >
            {item.icon ? <span className={styles.menuIcon}>{item.icon}</span> : null}
            <span className={styles.menuCopy}>
              <strong>{item.label}</strong>
              {item.description ? <small>{item.description}</small> : null}
            </span>
          </button>
        );
      })}
    </div>
  ) : null;

  return (
    <div className={styles.menuWrap} ref={wrapRef}>
      {trigger({ open, toggle: () => setOpen((v) => !v) })}
      {typeof document !== "undefined" && menu ? createPortal(menu, document.body) : null}
    </div>
  );
}

/* Shared button class exports for modals */
export const buttonStyles = {
  primary: styles.btnPrimary,
  danger: styles.btnDanger,
  ghost: styles.btnGhost,
};

export const modalStyles = {
  kvGrid: styles.kvGrid,
  text: styles.modalText,
  list: styles.modalList,
  footLead: styles.modalFootLead,
  readyLead: styles.readyLead,
  readyBar: styles.readyBar,
  statStrip: styles.statStrip,
  readyNext: styles.readyNext,
  readyActions: styles.readyActions,
  brief: styles.brief,
  whoRow: styles.whoRow,
  whoChip: styles.whoChip,
};
