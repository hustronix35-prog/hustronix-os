"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { buildApiHeaders, getApiBase, readApiJson, setStoredUserId } from "@/lib/api";
import styles from "../auth.module.css";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [otp, setOtp] = useState("");
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function requestOtp(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${getApiBase()}/api/auth/otp/request`, {
        method: "POST",
        headers: buildApiHeaders(),
        credentials: "include",
        body: JSON.stringify({ username: email.trim(), purpose: "signup" }),
      });
      const data = await readApiJson<{ error?: string; challengeToken?: string }>(res);
      if (!res.ok) throw new Error(data.error || res.statusText);
      if (!data.challengeToken) {
        throw new Error("No verification token returned. Check SMTP is configured on the API.");
      }
      setChallengeToken(data.challengeToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send code");
    } finally {
      setLoading(false);
    }
  }

  async function register(e: FormEvent) {
    e.preventDefault();
    if (!challengeToken) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${getApiBase()}/api/auth/register`, {
        method: "POST",
        headers: buildApiHeaders(),
        credentials: "include",
        body: JSON.stringify({
          email: email.trim(),
          password,
          displayName: displayName.trim() || undefined,
          otp: otp.trim(),
          challengeToken,
        }),
      });
      const data = await readApiJson<{ error?: string; userId?: string }>(res);
      if (!res.ok) throw new Error(data.error || res.statusText);
      if (data.userId) setStoredUserId(data.userId);
      router.replace("/onboarding");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign up failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.shell}>
      <div className={styles.card}>
        <div className={styles.brandCentered}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/logo-lockup.png"
            alt="Hustronix — Decide. Align. Execute."
            className={styles.brandLockup}
            width={707}
            height={353}
          />
        </div>
        <h1 className={styles.title}>Create account</h1>
        <p className={styles.subtitle}>
          Verify your email, then we&apos;ll capture the company context your agents need.
        </p>

        {!challengeToken ? (
          <form className={styles.form} onSubmit={requestOtp}>
            <label className={styles.label}>
              Work email
              <input
                className={styles.input}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </label>
            <label className={styles.label}>
              Display name
              <input
                className={styles.input}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                autoComplete="name"
                placeholder="Optional"
              />
            </label>
            <label className={styles.label}>
              Password
              <input
                className={styles.input}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                required
                minLength={8}
              />
              <span className={styles.hint}>At least 8 characters</span>
            </label>
            {error ? <p className={styles.error} role="alert">{error}</p> : null}
            <button className={styles.primary} type="submit" disabled={loading}>
              {loading ? "Sending…" : "Send verification code"}
            </button>
          </form>
        ) : (
          <form className={styles.form} onSubmit={register}>
            <p className={styles.hint}>
              Enter the 6-digit code sent to <strong>{email}</strong>
            </p>
            <label className={styles.label}>
              Verification code
              <input
                className={styles.input}
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                inputMode="numeric"
                pattern="\d{6}"
                required
                autoComplete="one-time-code"
              />
            </label>
            {error ? <p className={styles.error} role="alert">{error}</p> : null}
            <button className={styles.primary} type="submit" disabled={loading}>
              {loading ? "Creating…" : "Create account"}
            </button>
            <button
              className={styles.ghost}
              type="button"
              onClick={() => {
                setChallengeToken(null);
                setOtp("");
                setError(null);
              }}
            >
              Use a different email
            </button>
          </form>
        )}

        <p className={styles.footer}>
          Already have an account? <Link href="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
