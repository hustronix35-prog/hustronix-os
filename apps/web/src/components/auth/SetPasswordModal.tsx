"use client";

import { Eye, EyeOff } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { apiPost } from "@/lib/api";

/** Aligned with `MIN_PASSWORD_LENGTH` in `apps/api/src/auth/password.ts`. */
const MIN_NEW_PASSWORD_LEN = 10;

const HX_INPUT =
  "w-full rounded-lg border border-hx-border bg-hx-bg py-2 pl-3 pr-10 text-sm text-hx-text focus:border-hx-accent focus:outline-none focus:ring-1 focus:ring-hx-accent/40";

export function SetPasswordModal() {
  const titleId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const newRef = useRef<HTMLInputElement>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => newRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, []);

  const trapTab = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab" || !containerRef.current) return;
    const root = containerRef.current;
    const nodes = root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    const list = Array.from(nodes);
    if (list.length === 0) return;
    const first = list[0];
    const last = list[list.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else if (document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  const canSubmit =
    newPassword.length >= MIN_NEW_PASSWORD_LEN &&
    newPassword === confirm &&
    newPassword.length > 0;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!canSubmit) {
      if (newPassword.length < MIN_NEW_PASSWORD_LEN) {
        setError(`Password must be at least ${MIN_NEW_PASSWORD_LEN} characters.`);
      } else if (newPassword !== confirm) {
        setError("Passwords do not match.");
      }
      return;
    }
    setSubmitting(true);
    try {
      await apiPost<{ success?: boolean }>("/api/auth/password", { newPassword });
      window.dispatchEvent(new CustomEvent("hx-me-updated"));
    } catch (ex: unknown) {
      setError(ex instanceof Error ? ex.message : "Could not set password.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
      role="presentation"
      aria-hidden={false}
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md outline-none"
        tabIndex={-1}
        onKeyDown={trapTab}
      >
        <Card className="border-hx-border bg-hx-surface p-6 shadow-sm">
          <h2 id={titleId} className="text-lg font-semibold text-hx-text">
            Set a password to continue
          </h2>
          <p className="mt-2 text-sm text-hx-muted">
            You signed in with Google or GitHub. Set an account password before using the rest of the app. This
            screen stays until your password is saved.
          </p>
          <form className="mt-6 space-y-4" onSubmit={onSubmit}>
            <div>
              <label className="text-xs font-medium text-hx-muted" htmlFor="set-pw-new">
                New password ({MIN_NEW_PASSWORD_LEN}+ characters)
              </label>
              <div className="relative mt-1">
                <input
                  ref={newRef}
                  id="set-pw-new"
                  type={showNew ? "text" : "password"}
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className={HX_INPUT}
                />
                <button
                  type="button"
                  tabIndex={-1}
                  className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-hx-muted hover:text-hx-text"
                  aria-label={showNew ? "Hide password" : "Show password"}
                  aria-pressed={showNew}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setShowNew((v) => !v)}
                >
                  {showNew ? (
                    <EyeOff className="size-4" aria-hidden />
                  ) : (
                    <Eye className="size-4" aria-hidden />
                  )}
                </button>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-hx-muted" htmlFor="set-pw-confirm">
                Confirm password
              </label>
              <div className="relative mt-1">
                <input
                  id="set-pw-confirm"
                  type={showConfirm ? "text" : "password"}
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className={HX_INPUT}
                />
                <button
                  type="button"
                  tabIndex={-1}
                  className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-hx-muted hover:text-hx-text"
                  aria-label={showConfirm ? "Hide password" : "Show password"}
                  aria-pressed={showConfirm}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setShowConfirm((v) => !v)}
                >
                  {showConfirm ? (
                    <EyeOff className="size-4" aria-hidden />
                  ) : (
                    <Eye className="size-4" aria-hidden />
                  )}
                </button>
              </div>
            </div>
            {error ? (
              <p className="text-sm text-hx-danger" role="alert">
                {error}
              </p>
            ) : null}
            <Button type="submit" variant="primary" className="w-full" disabled={!canSubmit || submitting}>
              {submitting ? "Saving…" : "Save password"}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
