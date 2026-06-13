"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

type ApiOk = { ok: true };
type ApiErr = { ok: false; error: string };

const labelClass =
  "text-[11px] font-semibold uppercase tracking-[0.28em] text-hx-muted";
const inputClass =
  "mt-2 w-full rounded-xl border border-white/[0.10] bg-black/45 px-4 py-3 text-sm text-hx-text placeholder:text-hx-muted/60 outline-none transition focus:border-landing-gold/45 focus:ring-2 focus:ring-landing-gold/20";
const helpClass = "mt-2 text-xs text-hx-muted/75";

function normalizeSubject(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

export function ContactForm({ initialSubject }: { initialSubject?: string }) {
  const subjectPrefill = useMemo(
    () => normalizeSubject(initialSubject || ""),
    [initialSubject],
  );

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [subject, setSubject] = useState(subjectPrefill);
  const [message, setMessage] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    setDone(false);

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, company, subject, message }),
      });

      const data = (await res.json().catch(() => null)) as ApiOk | ApiErr | null;
      if (!res.ok) {
        const msg =
          (data && "error" in data && data.error) ||
          "Could not send your message. Please try again.";
        throw new Error(msg);
      }

      setDone(true);
      setName("");
      setEmail("");
      setCompany("");
      setSubject(subjectPrefill);
      setMessage("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="contact-name">
            Name
          </label>
          <input
            id="contact-name"
            className={inputClass}
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            required
            maxLength={100}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="contact-email">
            Email
          </label>
          <input
            id="contact-email"
            className={inputClass}
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            required
            maxLength={254}
          />
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="contact-company">
            Company <span className="text-hx-muted/60">(optional)</span>
          </label>
          <input
            id="contact-company"
            className={inputClass}
            autoComplete="organization"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="Company (optional)"
            maxLength={120}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="contact-subject">
            Subject
          </label>
          <input
            id="contact-subject"
            className={inputClass}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="What should we route this to?"
            maxLength={140}
            required
          />
        </div>
      </div>

      <div>
        <label className={labelClass} htmlFor="contact-message">
          Message
        </label>
        <textarea
          id="contact-message"
          className={cn(inputClass, "min-h-[140px] resize-y py-3.5 leading-relaxed")}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="A few sentences is enough. Include context, urgency, and constraints."
          required
          maxLength={4000}
        />
        <p className={helpClass}>
          By submitting, you consent to us contacting you about your request. We
          don&apos;t sell your data.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-hx-danger/35 bg-hx-danger/10 px-4 py-3 text-sm text-hx-danger">
          {error}
        </div>
      )}

      {done && (
        <div className="rounded-xl border border-landing-gold/30 bg-landing-gold/10 px-4 py-3 text-sm text-hx-text">
          Message sent. We&apos;ll reply soon.
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button
          type="submit"
          variant="outlineGold"
          size="lg"
          disabled={submitting}
          className="w-full rounded-full py-3.5 text-sm font-semibold uppercase tracking-[0.12em] sm:w-auto"
        >
          {submitting ? "Sending…" : "Send message"}
        </Button>
        <p className="text-xs text-hx-muted/75">
          We typically respond within 1 business day.
        </p>
      </div>
    </form>
  );
}

