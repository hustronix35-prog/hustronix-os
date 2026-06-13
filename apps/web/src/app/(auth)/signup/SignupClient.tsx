"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { OAuthSocialButtons } from "@/components/auth/OAuthSocialButtons";
import { OtpInput } from "@/components/auth/OtpInput";
import { HustrionixSidebarLockup } from "@/components/shell/HustrionixSidebarLockup";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { buildApiHeaders, getApiBase, setStoredUserId } from "@/lib/api";
import { purgeLegacyUnscopedChatBrowserStorage } from "@/lib/chatStorage";

/** Keep aligned with `MIN_PASSWORD_LENGTH` in `apps/api/src/auth/password.ts`. */
const MIN_PW = 10;
const RESEND_COOLDOWN_SEC = 60;

function normalizeEmail(raw: string): string {
  return String(raw || "").trim().toLowerCase();
}

function isValidEmailFormat(raw: string): boolean {
  const s = normalizeEmail(raw);
  if (s.length < 5 || s.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export function SignupClient() {
  const { replace, refresh } = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState("");
  const [deliveryMode, setDeliveryMode] = useState<"smtp" | "dev_console" | null>(null);
  const [resendSec, setResendSec] = useState(0);

  useEffect(() => {
    if (resendSec <= 0) return;
    const t = setInterval(() => setResendSec((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [resendSec]);

  function validateCredentials(): string | null {
    const em = normalizeEmail(email);
    if (!isValidEmailFormat(em)) return "Enter a valid email address.";
    if (password.length < MIN_PW) return `Password must be at least ${MIN_PW} characters.`;
    if (password !== confirm) return "Passwords do not match.";
    return null;
  }

  function goBackToStep1() {
    setStep(1);
    setChallengeToken(null);
    setOtpCode("");
    setDeliveryMode(null);
    setError(null);
  }

  async function requestOtp(resend: boolean) {
    setError(null);
    const v = validateCredentials();
    if (v) {
      setError(v);
      return;
    }
    setLoading(true);
    try {
      const base = getApiBase();
      const em = normalizeEmail(email);
      const res = await fetch(`${base}/api/auth/otp/request`, {
        method: "POST",
        headers: buildApiHeaders(),
        credentials: "include",
        body: JSON.stringify({ username: em, purpose: "signup" }),
      });
      const data = (await res.json()) as {
        challengeToken?: string;
        error?: string;
        deliveryMode?: "smtp" | "dev_console";
      };
      if (!res.ok) {
        throw new Error(data.error || "Could not send verification code");
      }
      if (!data.challengeToken) {
        throw new Error("Could not send verification code");
      }
      setChallengeToken(data.challengeToken);
      setDeliveryMode(data.deliveryMode === "dev_console" ? "dev_console" : "smtp");
      setResendSec(RESEND_COOLDOWN_SEC);
      setStep(2);
      if (!resend) setOtpCode("");
    } catch (ex: unknown) {
      setError(ex instanceof Error ? ex.message : "Could not send verification code");
    } finally {
      setLoading(false);
    }
  }

  async function onVerifySubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const v = validateCredentials();
    if (v) {
      setError(v);
      return;
    }
    if (!challengeToken || !/^\d{6}$/.test(otpCode.trim())) {
      setError("Enter the 6-digit code from your email.");
      return;
    }
    setLoading(true);
    try {
      const base = getApiBase();
      const em = normalizeEmail(email);
      const registerBody: Record<string, string> = {
        email: em,
        password,
        challengeToken,
        otp: otpCode.trim(),
      };
      if (displayName.trim()) registerBody.displayName = displayName.trim();
      const res = await fetch(`${base}/api/auth/register`, {
        method: "POST",
        headers: buildApiHeaders(),
        credentials: "include",
        body: JSON.stringify(registerBody),
      });
      const data = (await res.json()) as { userId?: string; error?: string };
      if (res.ok && data.userId) {
        setStoredUserId(data.userId);
        purgeLegacyUnscopedChatBrowserStorage();
        replace("/onboarding");
        refresh();
        return;
      }
      throw new Error(data.error || "Sign up failed");
    } catch (ex: unknown) {
      setError(ex instanceof Error ? ex.message : "Sign up failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="border-hx-border bg-hx-surface p-8 shadow-lg">
      <div className="mb-6">
        <HustrionixSidebarLockup className="h-14 max-h-14" fit="contain" />
      </div>
      <h1 className="text-xl font-semibold text-hx-text">Create account</h1>
      <p className="mt-1 text-sm text-hx-muted">
        Google and GitHub create your account on first sign-in. Or sign up with your work email: we send a short
        verification code before your password account is created.
      </p>

      <div className="mt-6 space-y-4">
        <OAuthSocialButtons variant="signup" />
        <div className="relative flex items-center gap-3">
          <div className="h-px flex-1 bg-hx-border" />
          <span className="text-xs uppercase text-hx-muted">or</span>
          <div className="h-px flex-1 bg-hx-border" />
        </div>

        {step === 1 ? (
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-hx-muted" htmlFor="su-email">
                Email <span className="text-hx-danger">*</span>
              </label>
              <input
                id="su-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-lg border border-hx-border bg-hx-bg px-3 py-2 text-sm text-hx-text focus:border-hx-accent focus:outline-none"
                required
              />
            </div>
            <div>
              <label className="text-xs font-medium text-hx-muted" htmlFor="su-dn">
                Display name <span className="text-hx-muted">(optional)</span>
              </label>
              <input
                id="su-dn"
                autoComplete="name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-hx-border bg-hx-bg px-3 py-2 text-sm text-hx-text focus:border-hx-accent focus:outline-none"
                placeholder="Shown in your profile"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-hx-muted" htmlFor="su-pass">
                Password ({MIN_PW}+ characters)
              </label>
              <input
                id="su-pass"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-lg border border-hx-border bg-hx-bg px-3 py-2 text-sm text-hx-text focus:border-hx-accent focus:outline-none"
                required
                minLength={MIN_PW}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-hx-muted" htmlFor="su-pass2">
                Confirm password
              </label>
              <input
                id="su-pass2"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="mt-1 w-full rounded-lg border border-hx-border bg-hx-bg px-3 py-2 text-sm text-hx-text focus:border-hx-accent focus:outline-none"
                required
                minLength={MIN_PW}
              />
            </div>
            {error && (
              <p className="text-sm text-hx-danger" role="alert">
                {error}
              </p>
            )}
            <Button
              variant="primary"
              type="button"
              className="w-full"
              disabled={loading}
              onClick={() => void requestOtp(false)}
            >
              {loading ? "Sending…" : "Send verification code"}
            </Button>
          </div>
        ) : (
          <form onSubmit={onVerifySubmit} className="space-y-4">
            <p className="text-sm text-hx-text">
              We sent a code to <span className="font-medium">{normalizeEmail(email)}</span>.
            </p>
            <OtpInput
              id="su-otp"
              label="Email verification code"
              value={otpCode}
              onChange={setOtpCode}
              autoFocus
              required
              helpText={
                deliveryMode === "dev_console"
                  ? "Check your inbox for the code. In local development, the code is also logged to the API server console."
                  : "Check your inbox for the code."
              }
            />
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <button
                type="button"
                className="text-hx-accent hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                disabled={loading || resendSec > 0}
                onClick={() => void requestOtp(true)}
              >
                {resendSec > 0 ? `Resend code (${resendSec}s)` : "Resend code"}
              </button>
              <span className="text-hx-muted">·</span>
              <button type="button" className="text-hx-accent hover:underline" onClick={goBackToStep1}>
                Back to edit email
              </button>
            </div>
            {error && (
              <p className="text-sm text-hx-danger" role="alert">
                {error}
              </p>
            )}
            <Button variant="primary" type="submit" className="w-full" disabled={loading}>
              {loading ? "Creating…" : "Verify and create account"}
            </Button>
          </form>
        )}
      </div>

      <p className="mt-6 text-center text-sm text-hx-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-hx-accent hover:underline">
          Sign in
        </Link>
      </p>
    </Card>
  );
}
