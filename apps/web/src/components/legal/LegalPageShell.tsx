import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

const LAST_UPDATED = "May 4, 2026";

type LegalPageShellProps = {
  title: string;
  children: ReactNode;
  className?: string;
};

export function LegalPageShell({
  title,
  children,
  className,
}: LegalPageShellProps) {
  return (
    <div className="min-h-dvh bg-hx-bg text-hx-text">
      <header className="border-b border-hx-border-subtle bg-hx-bg/95 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-4 px-6 md:px-8">
          <Link
            href="/"
            className="text-xs font-bold uppercase tracking-[0.35em] text-hx-text transition-colors hover:text-landing-gold"
          >
            HUSTRONI<span className="text-landing-gold">X</span>
          </Link>
          <Link
            href="/login"
            className="text-sm text-hx-muted transition-colors hover:text-hx-text"
          >
            Sign in
          </Link>
        </div>
      </header>
      <main
        className={cn(
          "mx-auto max-w-3xl px-4 py-10 sm:px-6 md:px-8 md:py-16",
          className,
        )}
      >
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-hx-muted">
          Last updated {LAST_UPDATED}
        </p>
        <h1 className="mt-3 font-sans text-3xl font-bold tracking-tight text-hx-text md:text-4xl">
          {title}
        </h1>
        <div
          className={cn(
            "mt-10 max-w-none text-sm leading-relaxed text-hx-muted",
            "[&_h2]:mt-12 [&_h2]:scroll-mt-24 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-hx-text [&_h2:first-of-type]:mt-10",
            "[&_p+p]:mt-4",
            "[&_ul]:my-4 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5",
            "[&_strong]:font-semibold [&_strong]:text-hx-text",
            "[&_a]:text-landing-gold [&_a]:underline-offset-4 [&_a]:transition-colors hover:[&_a]:underline",
          )}
        >
          {children}
        </div>
      </main>
    </div>
  );
}
