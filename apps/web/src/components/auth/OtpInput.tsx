"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";

const cellClass =
  "size-10 shrink-0 rounded-lg border border-hx-border bg-hx-bg text-center text-sm text-hx-text focus:border-hx-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-45";

const OTP_SLOT_KEYS = ["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7"] as const;

export type OtpInputProps = {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  length?: number;
  disabled?: boolean;
  autoFocus?: boolean;
  required?: boolean;
  helpText?: string;
  onComplete?: (v: string) => void;
};

function digitsOnly(s: string, maxLen: number): string {
  return s.replace(/\D/g, "").slice(0, maxLen);
}

export function OtpInput({
  id,
  label,
  value,
  onChange,
  length = 6,
  disabled = false,
  autoFocus,
  required,
  helpText,
  onComplete,
}: OtpInputProps) {
  const d = digitsOnly(value, length);
  const cells = Array.from({ length }, (_, i) => (i < d.length ? d[i]! : ""));
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const lastCompleteRef = useRef<string | null>(null);

  useEffect(() => {
    if (d.length === length && onComplete && lastCompleteRef.current !== d) {
      lastCompleteRef.current = d;
      onComplete(d);
    }
    if (d.length < length) lastCompleteRef.current = null;
  }, [d, length, onComplete]);

  function focusAt(i: number) {
    const el = inputRefs.current[i];
    if (el) {
      el.focus();
      el.select();
    }
  }

  function handleChange(i: number, raw: string) {
    if (disabled) return;
    if (raw.length > 1) {
      const pasted = digitsOnly(raw, length);
      onChange(pasted);
      requestAnimationFrame(() => focusAt(Math.min(Math.max(pasted.length - 1, 0), length - 1)));
      return;
    }
    const cur = digitsOnly(value, length);
    if (raw === "") {
      onChange(cur.slice(0, i) + cur.slice(i + 1));
      return;
    }
    const ch = digitsOnly(raw, 20).slice(-1);
    if (!ch) return;
    if (i > cur.length) {
      requestAnimationFrame(() => focusAt(cur.length));
      return;
    }
    onChange((cur.slice(0, i) + ch + cur.slice(i + 1)).slice(0, length));
    if (ch && i < length - 1) requestAnimationFrame(() => focusAt(i + 1));
  }

  function handleKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (disabled) return;
    const cur = digitsOnly(value, length);
    if (e.key === "Backspace") {
      if (cells[i]) {
        e.preventDefault();
        onChange(cur.slice(0, i) + cur.slice(i + 1));
        return;
      }
      if (i > 0) {
        e.preventDefault();
        onChange(cur.slice(0, i - 1) + cur.slice(i));
        requestAnimationFrame(() => focusAt(i - 1));
      }
    }
    if (e.key === "ArrowLeft" && i > 0) {
      e.preventDefault();
      focusAt(i - 1);
    }
    if (e.key === "ArrowRight" && i < length - 1) {
      e.preventDefault();
      focusAt(i + 1);
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    if (disabled) return;
    const text = e.clipboardData.getData("text");
    const pasted = digitsOnly(text, length);
    if (pasted.length > 0) {
      e.preventDefault();
      onChange(pasted);
      requestAnimationFrame(() => focusAt(Math.min(Math.max(pasted.length - 1, 0), length - 1)));
    }
  }

  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-hx-muted" htmlFor={`${id}-0`} id={`${id}-label`}>
        {label}
        {required ? <span className="text-hx-danger"> *</span> : null}
      </label>
      <div className="mt-1 flex gap-2" role="group" aria-labelledby={`${id}-label`} id={`${id}-otp-group`}>
        {cells.map((ch, i) => (
          <input
            key={`${id}-${OTP_SLOT_KEYS[i] ?? `s${i}`}`}
            id={i === 0 ? `${id}-0` : `${id}-${i}`}
            ref={(el) => {
              inputRefs.current[i] = el;
            }}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="one-time-code"
            maxLength={1}
            aria-label={`Digit ${i + 1} of ${length}`}
            aria-required={required}
            disabled={disabled}
            autoFocus={autoFocus && i === 0}
            value={ch}
            className={cellClass}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onPaste={handlePaste}
          />
        ))}
      </div>
      {helpText ? <p className="text-xs text-hx-muted">{helpText}</p> : null}
    </div>
  );
}
