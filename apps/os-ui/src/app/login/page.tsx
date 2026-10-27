"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useState } from "react";
import {
  apiGet,
  buildApiHeaders,
  getApiBase,
  readApiJson,
  setStoredUserId,
  withApiRetry,
} from "@/lib/api";
import styles from "../auth.module.css";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/chat";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(params.get("error"));
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await apiGet("/api/me");
        if (!cancelled) router.replace(next);
      } catch {
        /* show form */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [next, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await withApiRetry(async () => {
        const res = await fetch(`${getApiBase()}/api/auth/login`, {
          method: "POST",
          headers: buildApiHeaders(),
          credentials: "include",
          body: JSON.stringify({ username: username.trim(), password }),
        });
        const data = await readApiJson<{
          error?: string;
          userId?: string;
          requiresTotp?: boolean;
          requiresOtp?: boolean;
          totpToken?: string;
          challengeToken?: string;
        }>(res);
        if (!res.ok) throw new Error(data.error || res.statusText);
        if (data.requiresTotp || data.requiresOtp) {
          throw new Error(
            "This account requires a second factor. Complete MFA from your authenticator, or disable MFA for local development.",
          );
        }
        if (data.userId) setStoredUserId(data.userId);
      });
      router.replace(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
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
        <h1 className={styles.title}>Sign in</h1>
        <p className={styles.subtitle}>Access your company brain, decisions, and execution ledger.</p>
        <form className={styles.form} onSubmit={onSubmit}>
          <label className={styles.label} htmlFor="login-user">
            Username or email
            <input
              id="login-user"
              className={styles.input}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </label>
          <label className={styles.label} htmlFor="login-pass">
            Password
            <input
              id="login-pass"
              className={styles.input}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
          <button className={styles.primary} type="submit" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className={styles.footer}>
          New here? <Link href="/signup">Create an account</Link>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className={styles.gate}>Loading…</div>}>
      <LoginForm />
    </Suspense>
  );
}
