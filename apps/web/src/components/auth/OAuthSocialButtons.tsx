"use client";

import { useEffect, useState, type ReactNode } from "react";
import { buildApiHeaders, getApiBase } from "@/lib/api";
import { cn } from "@/lib/cn";

export type OAuthSocialButtonsProps = {
  /** "login" → Continue with…; "signup" → Sign up with… */
  variant?: "login" | "signup";
};

type ProviderKey = "google" | "github";

type ProvidersPayload = {
  google?: unknown;
  github?: unknown;
  googleHint?: string;
  githubHint?: string;
};

function isConfiguredEntry(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (v && typeof v === "object" && "configured" in v) {
    return Boolean((v as { configured?: boolean }).configured);
  }
  return false;
}

function loginUrlFor(provider: ProviderKey, v: unknown): string | undefined {
  if (v && typeof v === "object" && "loginUrl" in v) {
    const u = (v as { loginUrl?: string }).loginUrl;
    return typeof u === "string" && u.trim() ? u.trim() : undefined;
  }
  return undefined;
}

const outlineButtonClass =
  "inline-flex w-full items-center justify-center gap-2 rounded-lg border border-hx-border bg-transparent px-4 py-2 text-sm font-medium text-hx-text transition hover:bg-hx-surface-elevated";

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden className="shrink-0">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden className="shrink-0 text-hx-text">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

export function OAuthSocialButtons({ variant = "login" }: OAuthSocialButtonsProps) {
  const [loading, setLoading] = useState(true);
  const [googleOk, setGoogleOk] = useState(false);
  const [githubOk, setGithubOk] = useState(false);
  const [googleHint, setGoogleHint] = useState<string | null>(null);
  const [githubHint, setGithubHint] = useState<string | null>(null);
  const [googleUrl, setGoogleUrl] = useState<string | undefined>(undefined);
  const [githubUrl, setGithubUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const base = getApiBase();
        const res = await fetch(`${base}/api/auth/providers`, {
          headers: buildApiHeaders(),
          credentials: "include",
        });
        const data = (await res.json()) as ProvidersPayload;
        if (cancelled) return;
        if (!res.ok) {
          setGoogleOk(false);
          setGithubOk(false);
          setGoogleHint(null);
          setGithubHint(null);
          setGoogleUrl(undefined);
          setGithubUrl(undefined);
          return;
        }
        setGoogleOk(isConfiguredEntry(data.google));
        setGithubOk(isConfiguredEntry(data.github));
        setGoogleHint(typeof data.googleHint === "string" ? data.googleHint : null);
        setGithubHint(typeof data.githubHint === "string" ? data.githubHint : null);
        setGoogleUrl(loginUrlFor("google", data.google));
        setGithubUrl(loginUrlFor("github", data.github));
      } catch {
        if (!cancelled) {
          setGoogleOk(false);
          setGithubOk(false);
          setGoogleHint(null);
          setGithubHint(null);
          setGoogleUrl(undefined);
          setGithubUrl(undefined);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const prefix = variant === "signup" ? "Sign up with" : "Continue with";
  const base = getApiBase();

  function hrefFor(provider: ProviderKey, configured: boolean, explicit?: string) {
    if (!configured) return undefined;
    if (explicit?.trim()) return explicit.trim();
    const path = `/api/auth/${provider}/start`;
    return base ? `${base}${path}` : path;
  }

  return (
    <div className="flex flex-col gap-3">
      <SocialRow
        label={`${prefix} Google`}
        icon={<GoogleIcon />}
        configured={googleOk}
        loading={loading}
        href={hrefFor("google", googleOk, googleUrl)}
        title={
          loading
            ? undefined
            : googleOk
              ? undefined
              : googleHint ||
                "Configure Google OAuth (client id, redirect URI, and server credentials) in the API .env to enable Google sign-in."
        }
      />
      <SocialRow
        label={`${prefix} GitHub`}
        icon={<GitHubIcon />}
        configured={githubOk}
        loading={loading}
        href={hrefFor("github", githubOk, githubUrl)}
        title={
          loading
            ? undefined
            : githubOk
              ? undefined
              : githubHint ||
                "Configure GitHub OAuth (client id, redirect URI, and server credentials) in the API .env to enable GitHub sign-in."
        }
      />
    </div>
  );
}

function SocialRow({
  label,
  icon,
  configured,
  loading,
  href,
  title,
}: {
  label: string;
  icon: ReactNode;
  configured: boolean;
  loading: boolean;
  href?: string;
  title?: string;
}) {
  const showAsDisabled = loading || !configured;
  const className = cn(
    outlineButtonClass,
    showAsDisabled && "pointer-events-none cursor-not-allowed opacity-45 hover:bg-transparent",
    loading && "animate-pulse opacity-60",
  );

  if (!showAsDisabled && href) {
    return (
      <a href={href} className={cn(outlineButtonClass, "no-underline")}>
        {icon}
        {label}
      </a>
    );
  }

  return (
    <span
      role="button"
      tabIndex={-1}
      className={className}
      aria-disabled="true"
      title={title}
    >
      {icon}
      {label}
    </span>
  );
}
