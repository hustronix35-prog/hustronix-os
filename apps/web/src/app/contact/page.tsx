import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { ContactForm } from "./ContactForm";
import { cn } from "@/lib/cn";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Contact Hustronix about ledger-backed decisions, signals, and auditable execution.",
};

const section = "mx-auto w-full max-w-6xl px-6 md:px-8";

export default async function ContactPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) || {};
  const rawSubject = params.subject;
  const subject =
    typeof rawSubject === "string"
      ? rawSubject
      : Array.isArray(rawSubject)
        ? rawSubject[0]
        : "";

  return (
    <main className="landing-page-wrap min-h-dvh text-hx-text">
      <section className="landing-zone-hero relative overflow-hidden border-b border-white/[0.06] bg-gradient-to-b from-landing-deep via-[#0a0a0a] to-landing-void py-16 md:py-24">
        <div className="pointer-events-none absolute inset-0 opacity-[0.6]" aria-hidden>
          <div className="landing-blob-blue -left-[25%] top-[8%] opacity-[0.07]" />
          <div className="landing-blob-purple -right-[25%] bottom-[12%] opacity-[0.075]" />
          <div className="landing-ambient-hex opacity-[0.22]" />
        </div>

        <div className={cn(section, "relative z-10")}>
          <div className="mx-auto max-w-2xl text-center">
            <Link
              href="/"
              className="inline-flex items-center justify-center rounded-sm outline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-landing-gold/50"
            >
              <Image
                src="/brand/hustronix-logo.png"
                alt="Hustronix"
                width={624}
                height={222}
                className="h-10 w-auto md:h-12"
                priority
              />
            </Link>
            <p className="text-[11px] font-semibold uppercase tracking-[0.48em] text-landing-gold/90">
              Contact
            </p>
            <h1 className="mt-6 text-balance font-sans text-3xl font-bold leading-[1.12] tracking-tight text-[#EDEDED] md:text-4xl md:leading-[1.15]">
              Talk to Hustronix
            </h1>
            <p className="mt-5 text-pretty text-base leading-relaxed text-hx-muted/80 md:text-lg">
              Tell us what you&apos;re trying to build or enforce. We&apos;ll
              reply with a clear next step.
            </p>
          </div>

          <div className="mx-auto mt-10 max-w-3xl">
            <div className="landing-chrome-frame">
              <div className="landing-chrome-inner border border-white/[0.06] bg-[#0A0A0A]/88 p-6 backdrop-blur-xl md:p-10">
                <ContactForm initialSubject={subject} />
                <div className="mt-8 border-t border-white/[0.08] pt-6 text-xs text-hx-muted/80">
                  Prefer email?{" "}
                  <a
                    className="font-semibold text-landing-gold/90 underline-offset-4 hover:underline"
                    href={`mailto:hello@hustronix.online?subject=${encodeURIComponent(
                      subject || "Contact",
                    )}`}
                  >
                    hello@hustronix.online
                  </a>
                  .
                </div>
              </div>
            </div>
          </div>

          <div className="mt-10 flex justify-center">
            <Link
              href="/"
              className="text-xs font-semibold uppercase tracking-[0.22em] text-hx-muted transition-colors hover:text-landing-gold"
            >
              Back to home
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}

