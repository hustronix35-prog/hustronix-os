/**
 * Shared password strength helpers used by the Password card on both the
 * Profile (`/profile` → Security) and Settings (`/settings` → Security) pages.
 *
 * The UI is the single source of taste; the server enforces its own minimum
 * (currently 10 chars in `apps/api/src/auth/password.ts`).
 */

/** UI minimum for a new password. Must match `MIN_PASSWORD_LENGTH` on the server. */
export const MIN_PW = 10;

/** Strength tier shown in the meter (0 weakest → 3 strongest). */
export type StrengthTier = 0 | 1 | 2 | 3;

export interface PasswordAnalysis {
  hasLower: boolean;
  hasUpper: boolean;
  hasDigit: boolean;
  hasSymbol: boolean;
  lenOk: boolean;
  mixed: boolean;
  tier: StrengthTier;
  label: string;
}

/** Compute strength tier + requirements checklist for a candidate password. */
export function analyzeNewPassword(pw: string): PasswordAnalysis {
  const hasLower = /[a-z]/.test(pw);
  const hasUpper = /[A-Z]/.test(pw);
  const hasDigit = /\d/.test(pw);
  const hasSymbol = /[^A-Za-z0-9]/.test(pw);
  const lenOk = pw.length >= MIN_PW;
  const mixed = hasLower && hasUpper;
  const extraCount = [mixed, hasDigit, hasSymbol].filter(Boolean).length;
  let tier: StrengthTier = 0;
  let label = "Weak";
  if (!lenOk) {
    tier = 0;
    label = "Weak";
  } else if (extraCount === 0) {
    tier = 1;
    label = "Fair";
  } else if (extraCount === 1) {
    tier = 2;
    label = "Good";
  } else {
    tier = 3;
    label = "Strong";
  }
  return { hasLower, hasUpper, hasDigit, hasSymbol, lenOk, mixed, tier, label };
}

/**
 * Tailwind class for the n-th strength bar.
 * Empty input renders all bars as faint outlines (no scary red on first paint).
 */
export function strengthBarClass(tier: StrengthTier, barIndex: number, length: number): string {
  if (length === 0) return "bg-hx-border/40";
  if (barIndex > tier) return "bg-hx-border/40";
  if (tier === 0) return "bg-hx-danger";
  if (tier === 1) return "bg-hx-warning";
  if (tier === 2) return "bg-hx-accent";
  return "bg-hx-success";
}

/** Tailwind text-color class for the strength label badge. */
export function strengthLabelClass(length: number, tier: StrengthTier): string {
  if (length === 0) return "text-hx-muted";
  if (tier === 0) return "text-hx-danger";
  if (tier === 1) return "text-hx-warning";
  if (tier === 2) return "text-hx-accent";
  return "text-hx-success";
}

/**
 * Server returns `{ error: string }` JSON for password failures, but may also
 * return a plain text body. Return the most user-friendly string we can find.
 */
export function parsePasswordApiError(body: string): string {
  try {
    const j = JSON.parse(body) as { error?: string };
    return j.error || body;
  } catch {
    return body;
  }
}
