/**
 * Anthropic tier defaults track Anthropic’s active snapshot IDs (see deprecation docs).
 * Coordinator (premium): Sonnet-class. Fast tier: Haiku-class only.
 */

export const ANTHROPIC_COORDINATOR_DEFAULT_MODEL = "claude-sonnet-4-6";
export const ANTHROPIC_FAST_DEFAULT_MODEL = "claude-haiku-4-5-20251001";

/** Retired / unsupported coordinator snapshots → current default Sonnet. */
const RETIRED_PREMIUM_REDIRECT: Record<string, string> = {
  "claude-3-5-sonnet-20241022": ANTHROPIC_COORDINATOR_DEFAULT_MODEL,
  "claude-3-5-sonnet-20240620": ANTHROPIC_COORDINATOR_DEFAULT_MODEL,
  "claude-3-7-sonnet-20250219": ANTHROPIC_COORDINATOR_DEFAULT_MODEL,
  /** Deprecated snapshot — steer to the active Sonnet 4.x id. */
  "claude-sonnet-4-20250514": ANTHROPIC_COORDINATOR_DEFAULT_MODEL,
};

/** Retired fast-tier snapshots → current default Haiku. */
const RETIRED_FAST_REDIRECT: Record<string, string> = {
  "claude-3-5-haiku-20241022": ANTHROPIC_FAST_DEFAULT_MODEL,
};

/** Normalize typo / placeholder ids to canonical Anthropic model strings. */
export function normalizeAnthropicModelId(id: string): string {
  const t = id.trim();
  const aliases: Record<string, string> = {
    "claude-4-6-sonnet-20260217": "claude-sonnet-4-6",
    "claude-4-6-sonnet": "claude-sonnet-4-6",
  };
  return aliases[t] ?? t;
}

function isAnthropicHaikuClassModel(normalizedId: string): boolean {
  return /haiku/i.test(normalizedId);
}

/** Premium / coordinator: remap retired Sonnet ids; otherwise pass through (including Sonnet 4.x). */
export function coercePremiumCoordinatorModel(raw: string): string {
  const n = normalizeAnthropicModelId(raw.trim());
  const redirected = RETIRED_PREMIUM_REDIRECT[n];
  if (redirected) {
    console.warn(`[llm] Coordinator model "${raw.trim()}" is retired — using ${redirected}.`);
    return redirected;
  }
  return n;
}

/** Fast tier: Haiku-class only; retired Haiku → default; Sonnet/Opus → Haiku default. */
export function coerceFastAnthropicModel(raw: string): string {
  const n = normalizeAnthropicModelId(raw.trim());
  const retired = RETIRED_FAST_REDIRECT[n];
  if (retired) {
    console.warn(`[llm] Fast tier model "${raw.trim()}" is retired — using ${retired}.`);
    return retired;
  }
  if (!isAnthropicHaikuClassModel(n)) {
    console.warn(
      `[llm] Fast tier expects Haiku-class; "${raw.trim()}" — using ${ANTHROPIC_FAST_DEFAULT_MODEL}.`,
    );
    return ANTHROPIC_FAST_DEFAULT_MODEL;
  }
  return n;
}
