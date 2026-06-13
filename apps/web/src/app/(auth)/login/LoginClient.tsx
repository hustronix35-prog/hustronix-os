"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { HustrionixSidebarLockup } from "@/components/shell/HustrionixSidebarLockup";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { OAuthSocialButtons } from "@/components/auth/OAuthSocialButtons";
import { OtpInput } from "@/components/auth/OtpInput";
import { apiGet, buildApiHeaders, getApiBase, setStoredUserId } from "@/lib/api";
import { clearChatBrowserStorageForUser, purgeLegacyUnscopedChatBrowserStorage } from "@/lib/chatStorage";

export function LoginClient() {
  const { replace, refresh } = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/mission-control";
  const errParam = searchParams.get("error");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(errParam);
  const [loading, setLoading] = useState(false);
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState("");
  const [awaitingOtp, setAwaitingOtp] = useState(false);
  const [awaitingTotp, setAwaitingTotp] = useState(false);
  const [loginTotpToken, setLoginTotpToken] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [backupCode, setBackupCode] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await apiGet<{ user?: { id?: string } }>("/api/me");
        if (!cancelled) replace(next);
      } catch {
        /* show login form */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [next, replace]);

  function resetLoginFlow() {
    setAwaitingOtp(false);
    setChallengeToken(null);
    setOtpCode("");
    setAwaitingTotp(false);
    setLoginTotpToken(null);
    setTotpCode("");
    setBackupCode("");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const base = getApiBase();
      if (awaitingTotp && loginTotpToken) {
        if (!backupCode.trim() && !/^\d{6}$/.test(totpCode.trim())) {
          window.alert("Enter your 6-digit authenticator code, or a backup code.");
          setLoading(false);
          return;
        }
        const body: Record<string, string> = { totpToken: loginTotpToken };
        if (backupCode.trim()) body.backupCode = backupCode.trim().toUpperCase();
        else body.totpCode = totpCode.trim();
        const res = await fetch(`${base}/api/auth/login/totp`, {
          method: "POST",
          headers: buildApiHeaders(),
          credentials: "include",
          body: JSON.stringify(body),
        });
        const data = (await res.json()) as { error?: string; userId?: string };
        if (!res.ok) {
          const msg = data.error || res.statusText;
          window.alert(msg);
          throw new Error(msg);
        }
        if (data.userId) {
          setStoredUserId(data.userId);
          purgeLegacyUnscopedChatBrowserStorage();
        }
        resetLoginFlow();
        replace(next);
        refresh();
        return;
      }

      const body: Record<string, string> = {
        username: username.trim(),
        password,
      };
      if (awaitingOtp && challengeToken) {
        body.challengeToken = challengeToken;
        body.otp = otpCode.trim();
      }
      const res = await fetch(`${base}/api/auth/login`, {
        method: "POST",
        headers: buildApiHeaders(),
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as {
        error?: string;
        userId?: string;
        otpRequired?: boolean;
        challengeToken?: string;
        totpRequired?: boolean;
        totpToken?: string;
        code?: string;
      };
      if (!res.ok) {
        const msg = data.error || res.statusText;
        window.alert(msg);
        throw new Error(msg);
      }
      if (data.otpRequired && data.challengeToken) {
        setChallengeToken(data.challengeToken);
        setAwaitingOtp(true);
        setOtpCode("");
        return;
      }
      if (data.totpRequired && data.totpToken) {
        setLoginTotpToken(data.totpToken);
        setAwaitingTotp(true);
        setTotpCode("");
        setBackupCode("");
        return;
      }
      if (data.userId) {
        setStoredUserId(data.userId);
        purgeLegacyUnscopedChatBrowserStorage();
      }
      resetLoginFlow();
      replace(next);
      refresh();
    } catch (ex: unknown) {
      setError(ex instanceof Error ? ex.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="border-hx-border bg-hx-surface p-8 shadow-lg">
      <div className="mb-6">
        <HustrionixSidebarLockup className="h-14 max-h-14" fit="contain" />
      </div>
      <h1 className="text-xl font-semibold text-hx-text">Sign in</h1>
      <p className="mt-1 text-sm text-hx-muted">
        Use Google, GitHub, or your email (or username) and password.
      </p>

      <div className="mt-6 space-y-4">
        <OAuthSocialButtons variant="login" />
        <div className="relative flex items-center gap-3">
          <div className="h-px flex-1 bg-hx-border" />
          <span className="text-xs uppercase text-hx-muted">or</span>
          <div className="h-px flex-1 bg-hx-border" />
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="text-xs font-medium text-hx-muted" htmlFor="login-user">
              Email or username
            </label>
            <input
              id="login-user"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="mt-1 w-full rounded-lg border border-hx-border bg-hx-bg px-3 py-2 text-sm text-hx-text focus:border-hx-accent focus:outline-none"
              required
              disabled={awaitingOtp || awaitingTotp}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-hx-muted" htmlFor="login-pass">
              Password
            </label>
            <input
              id="login-pass"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-hx-border bg-hx-bg px-3 py-2 text-sm text-hx-text focus:border-hx-accent focus:outline-none"
              required
              disabled={awaitingTotp}
            />
          </div>
          {awaitingOtp && (
            <OtpInput
              id="login-otp"
              label="Email code"
              value={otpCode}
              onChange={setOtpCode}
              required
              helpText="Check your email for the sign-in code."
            />
          )}
          {awaitingTotp && (
            <div className="space-y-3 rounded-lg border border-hx-border bg-hx-surface-elevated p-3">
              <p className="text-sm text-hx-text">Enter the code from your authenticator app.</p>
              <OtpInput id="login-totp" label="6-digit code" value={totpCode} onChange={setTotpCode} />
              <label className="text-xs font-medium text-hx-muted" htmlFor="login-backup">
                Or backup code
              </label>
              <input
                id="login-backup"
                autoComplete="off"
                placeholder="XXXX-XXXX"
                value={backupCode}
                onChange={(e) => setBackupCode(e.target.value.toUpperCase())}
                className="mt-1 w-full rounded-lg border border-hx-border bg-hx-bg px-3 py-2 text-sm text-hx-text focus:border-hx-accent focus:outline-none"
              />
              <button
                type="button"
                className="text-xs text-hx-accent hover:underline"
                onClick={() => resetLoginFlow()}
              >
                Start over with a different account
              </button>
            </div>
          )}
          {error && (
            <p className="text-sm text-hx-danger" role="alert">
              {error}
            </p>
          )}
          <Button
            variant="primary"
            type="submit"
            className="w-full"
              disabled={loading}
          >
            {loading
              ? "Signing in…"
              : awaitingTotp
                ? "Verify authenticator"
                : awaitingOtp
                  ? "Complete sign in"
                  : "Sign in"}
          </Button>
        </form>
      </div>

      <p className="mt-6 text-center text-sm text-hx-muted">
        No account?{" "}
        <Link href="/signup" className="font-semibold text-hx-accent hover:underline">
          Create one
        </Link>
      </p>
    </Card>
  );
}
