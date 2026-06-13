"use client";

import { driver, type Driver, type PopoverDOM } from "driver.js";
import "driver.js/dist/driver.css";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  SPOTLIGHT_TOUR_STEP_COUNT,
  SPOTLIGHT_TOUR_STEPS,
} from "@/data/product-tour-spotlight";
import { apiGet, apiPost } from "@/lib/api";
import {
  shouldOfferWelcomeTour,
  tourRestartPatch,
  tourSettingsPatch,
  tourStateFromSettings,
} from "@/lib/tour-settings";
import { ProductTourContext, type ProductTourContextValue } from "@/components/tour/product-tour-context";
import { TourFinishModal } from "@/components/tour/TourFinishModal";
import { WelcomeTourModal } from "@/components/tour/WelcomeTourModal";
import { TourResumeBanner } from "@/components/tour/TourResumeBanner";

const NAV_ROUTE_DELAY_MS = 450;
const HIGHLIGHT_RETRY_MS = 120;

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function queryTourTarget(selector: string): Element | null {
  if (!selector.trim()) return null;
  try {
    return document.querySelector(selector);
  } catch {
    return null;
  }
}

export function ProductTourProvider({ children }: { children: ReactNode }) {
  const { push, replace } = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamsKey = searchParams.toString();

  const [ready, setReady] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [spotlightActive, setSpotlightActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [tourState, setTourState] = useState({
    completed: false,
    skipped: false,
    lastStep: null as number | null,
  });

  const driverRef = useRef<Driver | null>(null);
  const stepIndexRef = useRef(0);
  const spotlightActiveRef = useRef(false);
  useEffect(() => {
    stepIndexRef.current = stepIndex;
  }, [stepIndex]);

  useEffect(() => {
    spotlightActiveRef.current = spotlightActive;
  }, [spotlightActive]);

  const persistSettings = useCallback(async (patch: Record<string, string>) => {
    try {
      await apiPost("/api/settings/bulk", { settings: patch });
      window.dispatchEvent(new Event("hx-settings-saved"));
    } catch {
      /* non-blocking */
    }
  }, []);

  const loadTourSettings = useCallback(async () => {
    try {
      const { settings } = await apiGet<{ settings: Record<string, string> }>("/api/settings");
      const state = tourStateFromSettings(settings);
      setTourState({
        completed: state.completed,
        skipped: state.skipped,
        lastStep: state.lastStep,
      });
      return settings;
    } catch {
      return undefined;
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void loadTourSettings();
  }, [loadTourSettings]);

  const destroyDriver = useCallback(() => {
    driverRef.current?.destroy();
    driverRef.current = null;
  }, []);

  const completeTour = useCallback(async () => {
    destroyDriver();
    setSpotlightActive(false);
    setFinishOpen(true);
    const patch = tourSettingsPatch({
      completed: true,
      skipped: false,
      lastStep: null,
    });
    setTourState({ completed: true, skipped: false, lastStep: null });
    await persistSettings(patch);
  }, [destroyDriver, persistSettings]);

  const skipTour = useCallback(async () => {
    destroyDriver();
    setSpotlightActive(false);
    setWelcomeOpen(false);
    const idx = stepIndexRef.current;
    const patch = tourSettingsPatch({
      skipped: true,
      lastStep: idx > 0 ? idx : null,
      markDismissedAt: true,
    });
    setTourState((s) => ({
      ...s,
      skipped: true,
      lastStep: idx > 0 ? idx : null,
    }));
    await persistSettings(patch);
    if (searchParams.get("tour")) {
      replace(pathname || "/mission-control");
    }
  }, [destroyDriver, persistSettings, pathname, replace, searchParams, searchParamsKey]);

  /** Resume banner only , clear saved step so the banner does not reappear. */
  const dismissResumeBanner = useCallback(async () => {
    destroyDriver();
    setSpotlightActive(false);
    setStepIndex(0);
    const patch = tourSettingsPatch({
      skipped: true,
      lastStep: null,
      markDismissedAt: true,
    });
    setTourState((s) => ({
      ...s,
      skipped: true,
      lastStep: null,
    }));
    await persistSettings(patch);
  }, [destroyDriver, persistSettings]);

  const skipTourRef = useRef(skipTour);
  useEffect(() => {
    skipTourRef.current = skipTour;
  }, [skipTour]);

  const attachTourSkipButton = useCallback((popover: PopoverDOM) => {
    const { footer } = popover;
    if (!footer || footer.querySelector("[data-hx-tour-skip]")) return;
    const nav = footer.querySelector(".driver-popover-navigation-btns");
    const skipBtn = document.createElement("button");
    skipBtn.type = "button";
    skipBtn.dataset.hxTourSkip = "true";
    /* Class must NOT contain the substring "driver-popover" , driver.js stops propagation on
       capture phase for matching controls and Skip never receives the click. */
    skipBtn.className = "hx-tour-skip-btn";
    skipBtn.textContent = "Skip";
    skipBtn.setAttribute("aria-label", "Skip guided tour");
    skipBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      void skipTourRef.current();
    });
    if (nav) footer.insertBefore(skipBtn, nav);
    else footer.appendChild(skipBtn);
  }, []);

  const showStep = useCallback(
    async (index: number) => {
      const step = SPOTLIGHT_TOUR_STEPS[index];
      if (!step) return;

      const currentPath = pathname?.split("?")[0] ?? "";
      if (step.route !== currentPath) {
        push(step.route);
        await wait(NAV_ROUTE_DELAY_MS);
      }

      destroyDriver();
      const driverObj = driver({
        animate: true,
        allowClose: true,
        overlayOpacity: 0.72,
        overlayColor: "#030303",
        stagePadding: 10,
        stageRadius: 12,
        popoverClass: "hx-driver-popover",
        showProgress: true,
        progressText: "{{current}} of {{total}}",
        nextBtnText: index >= SPOTLIGHT_TOUR_STEP_COUNT - 1 ? "Finish" : "Next",
        prevBtnText: "Back",
        doneBtnText: "Finish",
        onPopoverRender: (popoverDom) => {
          attachTourSkipButton(popoverDom);
        },
        onCloseClick: () => {
          void skipTour();
        },
        onDestroyed: () => {
          if (!spotlightActiveRef.current) return;
        },
        onNextClick: () => {
          const next = stepIndexRef.current + 1;
          if (next >= SPOTLIGHT_TOUR_STEP_COUNT) {
            void completeTour();
            return;
          }
          setStepIndex(next);
          void persistSettings(
            tourSettingsPatch({ lastStep: next }),
          );
        },
        onPrevClick: () => {
          const prev = Math.max(0, stepIndexRef.current - 1);
          setStepIndex(prev);
          void persistSettings(tourSettingsPatch({ lastStep: prev }));
        },
      });

      driverRef.current = driverObj;

      let element: Element | null = null;
      if (step.target) {
        for (let attempt = 0; attempt < 8; attempt += 1) {
          element = queryTourTarget(step.target);
          if (element) break;
          await wait(HIGHLIGHT_RETRY_MS);
        }
      }

      const popover = {
        title: step.title,
        description: step.body,
        side: (element ? step.side ?? "bottom" : "over") as "top" | "bottom" | "left" | "right" | "over",
        showButtons: ["previous", "next"] as ("previous" | "next")[],
      };

      if (element) {
        driverObj.highlight({ element, popover });
      } else {
        driverObj.highlight({ popover });
      }
    },
    [
      attachTourSkipButton,
      completeTour,
      destroyDriver,
      pathname,
      persistSettings,
      push,
      skipTour,
    ],
  );

  useEffect(() => {
    if (!spotlightActive) return;
    void showStep(stepIndex);
    return () => {
      destroyDriver();
    };
  }, [spotlightActive, stepIndex, showStep, destroyDriver]);

  const startTour = useCallback(
    (fromStep = 0) => {
      setWelcomeOpen(false);
      setFinishOpen(false);
      const clamped = Math.max(0, Math.min(fromStep, SPOTLIGHT_TOUR_STEP_COUNT - 1));
      setStepIndex(clamped);
      setSpotlightActive(true);
      void persistSettings(tourSettingsPatch({ lastStep: clamped, skipped: false }));
      setTourState((s) => ({ ...s, skipped: false }));
    },
    [persistSettings],
  );

  const resumeTour = useCallback(() => {
    const resumeFrom = tourState.lastStep ?? 0;
    startTour(resumeFrom);
  }, [startTour, tourState.lastStep]);

  const restartTour = useCallback(async () => {
    const patch = tourRestartPatch();
    setTourState({ completed: false, skipped: false, lastStep: 0 });
    await persistSettings(patch);
    setWelcomeOpen(true);
    setFinishOpen(false);
    setSpotlightActive(false);
    destroyDriver();
    push("/mission-control?tour=welcome");
  }, [destroyDriver, persistSettings, push]);

  const openWelcome = useCallback(() => {
    setWelcomeOpen(true);
  }, []);

  const dismissWelcome = useCallback(() => {
    setWelcomeOpen(false);
  }, []);

  const closeFinish = useCallback(() => {
    setFinishOpen(false);
    if (searchParams.get("tour")) {
      replace(pathname || "/mission-control");
    }
  }, [pathname, replace, searchParams, searchParamsKey]);

  useEffect(() => {
    if (!ready) return;
    const tourParam = searchParams.get("tour");
    if (tourParam === "welcome") {
      setWelcomeOpen(true);
      return;
    }
    if (tourParam === "start") {
      startTour(0);
    }
  }, [ready, searchParams, searchParamsKey, startTour]);

  useEffect(() => {
    if (!ready) return;
    if (searchParams.get("tour")) return;
    if (pathname !== "/mission-control") return;
    if (welcomeOpen || spotlightActive || finishOpen) return;

    void (async () => {
      const settings = await loadTourSettings();
      if (shouldOfferWelcomeTour(settings)) {
        setWelcomeOpen(true);
      }
    })();
  }, [ready, pathname, searchParams, searchParamsKey, welcomeOpen, spotlightActive, finishOpen, loadTourSettings]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && spotlightActive) {
        void skipTour();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [spotlightActive, skipTour]);

  const showResumeBanner =
    ready &&
    pathname === "/mission-control" &&
    tourState.skipped &&
    !tourState.completed &&
    tourState.lastStep !== null &&
    tourState.lastStep > 0;

  const showWelcome =
    welcomeOpen &&
    (pathname === "/mission-control" || searchParams.get("tour") === "welcome");

  const ctx = useMemo<ProductTourContextValue>(
    () => ({
      ready,
      isSpotlightActive: spotlightActive,
      welcomeOpen,
      finishOpen,
      stepIndex,
      stepCount: SPOTLIGHT_TOUR_STEP_COUNT,
      skipped: tourState.skipped,
      completed: tourState.completed,
      showResumeBanner,
      openWelcome,
      startTour,
      resumeTour,
      skipTour,
      restartTour,
      dismissWelcome,
      closeFinish,
    }),
    [
      ready,
      spotlightActive,
      welcomeOpen,
      finishOpen,
      stepIndex,
      tourState.skipped,
      tourState.completed,
      showResumeBanner,
      openWelcome,
      startTour,
      resumeTour,
      skipTour,
      restartTour,
      dismissWelcome,
      closeFinish,
    ],
  );

  return (
    <ProductTourContext.Provider value={ctx}>
      {children}
      <WelcomeTourModal
        open={showWelcome}
        onStart={() => startTour(0)}
        onSkip={() => void skipTour()}
      />
      <TourFinishModal open={finishOpen} onClose={closeFinish} />
      {showResumeBanner ? (
        <TourResumeBanner onResume={resumeTour} onDismiss={() => void dismissResumeBanner()} />
      ) : null}
    </ProductTourContext.Provider>
  );
}
