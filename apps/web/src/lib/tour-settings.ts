/** Product tour persistence in per-user `settings` (via /api/settings). */

export const TOUR_SETTING_KEYS = {
  completed: "product.tour.completed",
  skipped: "product.tour.skipped",
  lastStep: "product.tour.last_step",
  completedAt: "product.tour.completed_at",
  dismissedAt: "product.tour.dismissed_at",
} as const;

export type TourSettingsState = {
  completed: boolean;
  skipped: boolean;
  lastStep: number | null;
};

export function tourStateFromSettings(
  settings: Record<string, string | undefined> | undefined,
): TourSettingsState {
  const s = settings ?? {};
  return {
    completed: s[TOUR_SETTING_KEYS.completed] === "1",
    skipped: s[TOUR_SETTING_KEYS.skipped] === "1",
    lastStep: parseTourStepIndex(s[TOUR_SETTING_KEYS.lastStep]),
  };
}

export function parseTourStepIndex(raw: string | undefined): number | null {
  if (!raw?.trim()) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function shouldOfferWelcomeTour(
  settings: Record<string, string | undefined> | undefined,
  opts?: { forceWelcome?: boolean },
): boolean {
  if (opts?.forceWelcome) return true;
  const { completed, skipped } = tourStateFromSettings(settings);
  return !completed && !skipped;
}

export function shouldShowResumeBanner(
  settings: Record<string, string | undefined> | undefined,
): boolean {
  const { completed, skipped, lastStep } = tourStateFromSettings(settings);
  return skipped && !completed && lastStep !== null && lastStep > 0;
}

export function tourSettingsPatch(
  patch: Partial<{
    completed: boolean;
    skipped: boolean;
    lastStep: number | null;
    markCompletedAt: boolean;
    markDismissedAt: boolean;
  }>,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (patch.completed !== undefined) {
    out[TOUR_SETTING_KEYS.completed] = patch.completed ? "1" : "0";
    if (patch.completed) {
      out[TOUR_SETTING_KEYS.skipped] = "0";
      out[TOUR_SETTING_KEYS.completedAt] = new Date().toISOString();
    }
  }
  if (patch.skipped !== undefined) {
    out[TOUR_SETTING_KEYS.skipped] = patch.skipped ? "1" : "0";
    if (patch.skipped) {
      out[TOUR_SETTING_KEYS.dismissedAt] = new Date().toISOString();
    }
  }
  if (patch.lastStep !== undefined) {
    out[TOUR_SETTING_KEYS.lastStep] =
      patch.lastStep === null ? "" : String(patch.lastStep);
  }
  if (patch.markDismissedAt) {
    out[TOUR_SETTING_KEYS.dismissedAt] = new Date().toISOString();
  }
  return out;
}

/** Clear skip/completed so a manual restart can run the full tour again. */
export function tourRestartPatch(): Record<string, string> {
  return {
    [TOUR_SETTING_KEYS.completed]: "0",
    [TOUR_SETTING_KEYS.skipped]: "0",
    [TOUR_SETTING_KEYS.lastStep]: "0",
    [TOUR_SETTING_KEYS.completedAt]: "",
    [TOUR_SETTING_KEYS.dismissedAt]: "",
  };
}
