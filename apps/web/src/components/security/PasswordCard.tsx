"use client";

import { useMemo, useState } from "react";
import { Check, CheckCircle2, Eye, EyeOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionTitle } from "@/components/ui/section-title";
import { useToast } from "@/components/ui/toast";
import { buildApiHeaders, getApiBase } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  analyzeNewPassword,
  MIN_PW,
  parsePasswordApiError,
  strengthBarClass,
  strengthLabelClass,
} from "@/lib/passwordStrength";

export interface PasswordCardProps {
  /** True once the caller has loaded `/api/me` and knows the password state. */
  meReady: boolean;
  /** Caller observed `me.hasPassword === false` , show the first-time copy. */
  firstTimePassword: boolean;
  /**
   * Render a muted explanation in place of the form (e.g. the `system` principal
   * cannot change its password). Falsy values fall through to the form.
   */
  disabledReason?: string | null;
  /** Optional callback invoked after a successful password update. */
  onChanged?: () => void;
}

type Banner = { kind: "success" | "error"; text: string } | null;

/**
 * Reusable Password change card. Owns its own form state, strength meter,
 * Caps Lock detection, show/hide toggles, and the POST /api/auth/password call.
 *
 * Used by:
 *   - apps/web/src/app/(dashboard)/profile/ProfileClient.tsx
 *   - apps/web/src/app/(dashboard)/settings/SettingsClient.tsx
 */
export function PasswordCard({
  meReady,
  firstTimePassword,
  disabledReason,
  onChanged,
}: PasswordCardProps) {
  const requiresCurrentPassword = meReady && !firstTimePassword;
  const toast = useToast();

  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [pwShow, setPwShow] = useState({ current: false, next: false, confirm: false });
  const [pwFocus, setPwFocus] = useState<"current" | "next" | "confirm" | null>(null);
  const [capsOn, setCapsOn] = useState(false);
  const [pwBusy, setPwBusy] = useState(false);
  const [pwBanner, setPwBanner] = useState<Banner>(null);

  const pwAnalysis = useMemo(() => analyzeNewPassword(pw.next), [pw.next]);
  const pwFormValid = useMemo(() => {
    if (!meReady) return false;
    if (pw.next.length < MIN_PW || pw.next !== pw.confirm) return false;
    if (requiresCurrentPassword) {
      if (pw.current.trim() === "") return false;
      if (pw.next === pw.current) return false;
    }
    return true;
  }, [meReady, requiresCurrentPassword, pw.current, pw.next, pw.confirm]);

  async function updatePassword() {
    if (!pwFormValid) return;
    setPwBusy(true);
    setPwBanner(null);
    try {
      const body: Record<string, string> = { newPassword: pw.next };
      if (requiresCurrentPassword) body.currentPassword = pw.current;
      const res = await fetch(`${getApiBase()}/api/auth/password`, {
        method: "POST",
        headers: buildApiHeaders(),
        credentials: "include",
        body: JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) {
        let msg = parsePasswordApiError(text) || res.statusText;
        if (res.status === 401) msg = "Current password is incorrect.";
        setPwBanner({ kind: "error", text: msg });
        toast.error(msg);
        return;
      }
      const successText = firstTimePassword
        ? "Password set. You can now sign in with your email and password."
        : "Password updated. Other sessions may need to re-authenticate.";
      setPw({ current: "", next: "", confirm: "" });
      setPwShow({ current: false, next: false, confirm: false });
      setPwBanner({ kind: "success", text: successText });
      toast.success(firstTimePassword ? "Password set." : "Password updated.");
      try {
        window.dispatchEvent(new CustomEvent("hx-me-updated"));
      } catch {
        // no-op
      }
      onChanged?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Password update failed";
      setPwBanner({ kind: "error", text: msg });
      toast.error(msg);
    } finally {
      setPwBusy(false);
    }
  }

  const trapCapsLock = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.getModifierState) setCapsOn(e.getModifierState("CapsLock"));
  };

  return (
    <Card className="space-y-0 overflow-hidden p-0">
      <div className="border-b border-hx-border/70 px-6 pb-5 pt-6">
        <SectionTitle>Password</SectionTitle>
        <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-hx-muted">
          Choose a strong password to keep your account secure. We recommend a passphrase
          or password manager.
        </p>
      </div>

      {disabledReason ? (
        <p className="px-6 py-8 text-sm text-hx-muted">{disabledReason}</p>
      ) : !meReady ? (
        <p className="px-6 py-8 text-sm text-hx-muted">Loading account…</p>
      ) : (
        <div className="grid gap-6 p-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="space-y-5">
            {firstTimePassword ? (
              <div className="rounded-md border border-hx-accent/40 bg-hx-accent/10 px-3 py-2 text-xs text-hx-text">
                You&apos;re setting a password for the first time.
              </div>
            ) : null}

            {requiresCurrentPassword ? (
              <div className="space-y-1.5">
                <label
                  className="block text-xs font-medium uppercase tracking-wide text-hx-muted"
                  htmlFor="pw-card-current"
                >
                  Current password
                </label>
                <div className="relative">
                  <input
                    id="pw-card-current"
                    type={pwShow.current ? "text" : "password"}
                    autoComplete="current-password"
                    className="w-full rounded-lg border border-hx-border bg-hx-surface-elevated py-2 pl-3 pr-10 text-sm text-hx-text placeholder:text-hx-muted/60 focus:border-hx-accent focus:outline-none focus:ring-1 focus:ring-hx-accent/40"
                    value={pw.current}
                    onChange={(e) => setPw((p) => ({ ...p, current: e.target.value }))}
                    onFocus={() => setPwFocus("current")}
                    onBlur={() => {
                      setPwFocus(null);
                      setCapsOn(false);
                    }}
                    onKeyDown={trapCapsLock}
                    onKeyUp={trapCapsLock}
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-hx-muted hover:text-hx-text"
                    aria-label={pwShow.current ? "Hide password" : "Show password"}
                    aria-pressed={pwShow.current}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setPwShow((s) => ({ ...s, current: !s.current }))}
                  >
                    {pwShow.current ? (
                      <EyeOff className="size-4" aria-hidden />
                    ) : (
                      <Eye className="size-4" aria-hidden />
                    )}
                  </button>
                </div>
                {pwFocus === "current" && capsOn ? (
                  <p className="text-[11px] text-hx-warning">Caps Lock is on.</p>
                ) : null}
              </div>
            ) : null}

            <div className="space-y-1.5">
              <label
                className="block text-xs font-medium uppercase tracking-wide text-hx-muted"
                htmlFor="pw-card-new"
              >
                New password
              </label>
              <div className="relative">
                <input
                  id="pw-card-new"
                  type={pwShow.next ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder={`At least ${MIN_PW} characters`}
                  className="w-full rounded-lg border border-hx-border bg-hx-surface-elevated py-2 pl-3 pr-10 text-sm text-hx-text placeholder:text-hx-muted/60 focus:border-hx-accent focus:outline-none focus:ring-1 focus:ring-hx-accent/40"
                  value={pw.next}
                  onChange={(e) => setPw((p) => ({ ...p, next: e.target.value }))}
                  onFocus={() => setPwFocus("next")}
                  onBlur={() => {
                    setPwFocus(null);
                    setCapsOn(false);
                  }}
                  onKeyDown={trapCapsLock}
                  onKeyUp={trapCapsLock}
                />
                <button
                  type="button"
                  tabIndex={-1}
                  className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-hx-muted hover:text-hx-text"
                  aria-label={pwShow.next ? "Hide password" : "Show password"}
                  aria-pressed={pwShow.next}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setPwShow((s) => ({ ...s, next: !s.next }))}
                >
                  {pwShow.next ? (
                    <EyeOff className="size-4" aria-hidden />
                  ) : (
                    <Eye className="size-4" aria-hidden />
                  )}
                </button>
              </div>
              {pwFocus === "next" && capsOn ? (
                <p className="text-[11px] text-hx-warning">Caps Lock is on.</p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <label
                className="block text-xs font-medium uppercase tracking-wide text-hx-muted"
                htmlFor="pw-card-confirm"
              >
                Confirm new password
              </label>
              <div className="relative">
                <input
                  id="pw-card-confirm"
                  type={pwShow.confirm ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="Repeat your new password"
                  className="w-full rounded-lg border border-hx-border bg-hx-surface-elevated py-2 pl-3 pr-10 text-sm text-hx-text placeholder:text-hx-muted/60 focus:border-hx-accent focus:outline-none focus:ring-1 focus:ring-hx-accent/40"
                  value={pw.confirm}
                  onChange={(e) => setPw((p) => ({ ...p, confirm: e.target.value }))}
                  onFocus={() => setPwFocus("confirm")}
                  onBlur={() => {
                    setPwFocus(null);
                    setCapsOn(false);
                  }}
                  onKeyDown={trapCapsLock}
                  onKeyUp={trapCapsLock}
                />
                <button
                  type="button"
                  tabIndex={-1}
                  className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-hx-muted hover:text-hx-text"
                  aria-label={pwShow.confirm ? "Hide password" : "Show password"}
                  aria-pressed={pwShow.confirm}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setPwShow((s) => ({ ...s, confirm: !s.confirm }))}
                >
                  {pwShow.confirm ? (
                    <EyeOff className="size-4" aria-hidden />
                  ) : (
                    <Eye className="size-4" aria-hidden />
                  )}
                </button>
              </div>
              {pwFocus === "confirm" && capsOn ? (
                <p className="text-[11px] text-hx-warning">Caps Lock is on.</p>
              ) : null}
              {pw.confirm.length > 0 ? (
                pw.next === pw.confirm ? (
                  <p className="flex items-center gap-1.5 text-xs text-hx-success">
                    <CheckCircle2 className="size-3.5 shrink-0" aria-hidden />
                    Passwords match
                  </p>
                ) : (
                  <p className="flex items-center gap-1.5 text-xs text-hx-danger">
                    <span
                      className="size-1.5 shrink-0 rounded-full bg-hx-danger"
                      aria-hidden
                    />
                    Passwords don&apos;t match
                  </p>
                )
              ) : null}
            </div>
          </div>

          <aside className="space-y-4 self-start rounded-lg border border-hx-border/70 bg-hx-surface-elevated/40 p-4">
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium uppercase tracking-wide text-hx-muted">
                  Strength
                </span>
                <span
                  className={cn(
                    "text-xs font-medium",
                    strengthLabelClass(pw.next.length, pwAnalysis.tier),
                  )}
                >
                  {pw.next.length === 0 ? "," : pwAnalysis.label}
                </span>
              </div>
              <div
                className="flex gap-1"
                role="status"
                aria-label={`Password strength: ${pw.next.length === 0 ? "empty" : pwAnalysis.label}`}
              >
                {([0, 1, 2, 3] as const).map((i) => (
                  <div
                    key={i}
                    className={cn(
                      "h-1.5 flex-1 rounded-full transition-colors",
                      strengthBarClass(pwAnalysis.tier, i, pw.next.length),
                    )}
                  />
                ))}
              </div>
            </div>

            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-hx-muted">
                Requirements
              </p>
              <ul className="space-y-1.5 text-xs">
                <li
                  className={cn(
                    "flex items-center gap-2",
                    pwAnalysis.lenOk ? "text-hx-success" : "text-hx-muted",
                  )}
                >
                  <Check
                    className={cn(
                      "size-3.5 shrink-0",
                      pwAnalysis.lenOk ? "text-hx-success" : "opacity-35",
                    )}
                    aria-hidden
                  />
                  At least {MIN_PW} characters
                </li>
                <li
                  className={cn(
                    "flex items-center gap-2",
                    pwAnalysis.hasUpper ? "text-hx-success" : "text-hx-muted",
                  )}
                >
                  <Check
                    className={cn(
                      "size-3.5 shrink-0",
                      pwAnalysis.hasUpper ? "text-hx-success" : "opacity-35",
                    )}
                    aria-hidden
                  />
                  Includes an uppercase letter
                </li>
                <li
                  className={cn(
                    "flex items-center gap-2",
                    pwAnalysis.hasDigit ? "text-hx-success" : "text-hx-muted",
                  )}
                >
                  <Check
                    className={cn(
                      "size-3.5 shrink-0",
                      pwAnalysis.hasDigit ? "text-hx-success" : "opacity-35",
                    )}
                    aria-hidden
                  />
                  Includes a number
                </li>
                <li
                  className={cn(
                    "flex items-center gap-2",
                    pwAnalysis.hasSymbol ? "text-hx-success" : "text-hx-muted",
                  )}
                >
                  <Check
                    className={cn(
                      "size-3.5 shrink-0",
                      pwAnalysis.hasSymbol ? "text-hx-success" : "opacity-35",
                    )}
                    aria-hidden
                  />
                  Includes a symbol
                </li>
              </ul>
            </div>
          </aside>
        </div>
      )}

      {!disabledReason ? (
        <div className="border-t border-hx-border/70 bg-hx-surface-elevated/30 px-6 py-4">
          {pwBanner?.kind === "success" ? (
            <p
              role="status"
              className="mb-3 rounded-md border border-hx-success/40 bg-hx-success/10 px-3 py-2 text-sm text-hx-success"
            >
              {pwBanner.text}
            </p>
          ) : pwBanner?.kind === "error" ? (
            <p
              role="alert"
              className="mb-3 rounded-md border border-hx-danger/40 bg-hx-danger/15 px-3 py-2 text-sm text-hx-danger"
            >
              {pwBanner.text}
            </p>
          ) : null}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[11px] text-hx-muted">
              You&apos;ll stay signed in on this device. Other sessions may need to re-authenticate.
            </p>
            <Button
              variant="primary"
              type="button"
              className="shrink-0"
              disabled={!pwFormValid || pwBusy || !meReady}
              onClick={() => void updatePassword()}
            >
              {pwBusy ? "Updating…" : "Update password"}
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
