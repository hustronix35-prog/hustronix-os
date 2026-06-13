"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { Reveal } from "@/components/landing/ScrollReveal";
import { SocialFooterLinks } from "@/components/landing/SocialFooterLinks";

const section = "mx-auto max-w-6xl px-6 md:px-8";

const footerLink =
  "block text-sm text-hx-muted transition-colors duration-200 hover:text-landing-gold";

const columnTitle =
  "mb-4 text-[10px] font-semibold uppercase tracking-[0.38em] text-landing-gold/85";

export function LandingFooter() {
  const [logoFailed, setLogoFailed] = useState(false);

  return (
    <footer className="relative overflow-hidden border-t border-white/[0.07] bg-gradient-to-b from-[#050505] via-hx-bg to-black">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-landing-gold/45 to-transparent"
        aria-hidden
      />
      <div className="landing-ambient-hex pointer-events-none absolute inset-0 opacity-[0.12]" aria-hidden />

      <Reveal className={cn(section, "relative z-10 py-14 md:py-16")} y={24}>
        <div className="rounded-2xl border border-white/[0.08] bg-[#0a0a0a]/80 p-8 shadow-[0_24px_80px_rgba(0,0,0,0.55)] backdrop-blur-md md:p-10 lg:p-12">
          <div className="grid grid-cols-1 gap-12 sm:grid-cols-2 lg:grid-cols-4 lg:gap-10">
            {/* Brand */}
            <div className="sm:col-span-2 lg:col-span-1">
              <Link
                href="/"
                className="inline-block focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-landing-gold/60"
              >
                {!logoFailed ? (
                  <Image
                    src="/brand/hustronix-logo.png"
                    alt="Hustronix"
                    width={220}
                    height={48}
                    className="h-11 w-auto max-w-[240px] opacity-95"
                    onError={() => setLogoFailed(true)}
                  />
                ) : (
                  <span className="font-sans text-sm font-bold uppercase tracking-[0.42em] text-hx-text">
                    HUSTRONI<span className="text-landing-gold">X</span>
                  </span>
                )}
              </Link>
              <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.28em] text-hx-muted">
                Decide. Align. Execute.
              </p>
              <p className="mt-4 max-w-sm text-sm leading-relaxed text-hx-muted/90">
                Govern decisions and execution in one system,ledger-backed,
                auditable, and built for operators.
              </p>
              <SocialFooterLinks className="mt-6" />
            </div>

            {/* Product */}
            <div>
              <h2 className={columnTitle}>Product</h2>
              <nav className="flex flex-col gap-3" aria-label="Product">
                <Link href="/mission-control" className={footerLink}>
                  Mission Control
                </Link>
                <Link href="/execute" className={footerLink}>
                  Execute
                </Link>
                <Link href="/signals" className={footerLink}>
                  Signals
                </Link>
                <Link href="/chat" className={footerLink}>
                  Chat
                </Link>
                <Link href="/reports" className={footerLink}>
                  Reports
                </Link>
              </nav>
            </div>

            {/* Company */}
            <div>
              <h2 className={columnTitle}>Company</h2>
              <nav className="flex flex-col gap-3" aria-label="Company">
                <Link href="/teams" className={footerLink}>
                  Teams
                </Link>
                <Link href="/#pricing" className={footerLink}>
                  Pricing
                </Link>
                <Link href="/contact" className={footerLink}>
                  Contact
                </Link>
              </nav>
            </div>

            {/* Legal */}
            <div>
              <h2 className={columnTitle}>Legal</h2>
              <nav className="flex flex-col gap-3" aria-label="Legal">
                <Link href="/privacy" className={footerLink}>
                  Privacy Policy
                </Link>
                <Link href="/terms" className={footerLink}>
                  Terms of Service
                </Link>
                <Link href="/cookies" className={footerLink}>
                  Cookie Policy
                </Link>
              </nav>
            </div>
          </div>
        </div>
      </Reveal>

      <div className="relative z-10 border-t border-hx-border-subtle bg-black/40">
        <div
          className={cn(
            section,
            "flex flex-col gap-6 py-8 md:flex-row md:items-center md:justify-between md:py-9",
          )}
        >
          <p className="text-xs text-hx-muted">
            © 2026 Hustronix. All rights reserved.
          </p>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
            <Link
              href="/privacy"
              className="text-hx-muted transition-colors hover:text-landing-gold"
            >
              Privacy
            </Link>
            <Link
              href="/terms"
              className="text-hx-muted transition-colors hover:text-landing-gold"
            >
              Terms
            </Link>
            <Link
              href="/cookies"
              className="text-hx-muted transition-colors hover:text-landing-gold"
            >
              Cookies
            </Link>
            <a
              href="https://hustronix.online"
              className="text-hx-muted transition-colors hover:text-landing-gold"
              rel="noopener noreferrer"
            >
              hustronix.online
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
