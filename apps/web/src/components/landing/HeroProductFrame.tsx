"use client";

import {
  useCallback,
  useEffect,
  useId,
  useState,
  type FocusEvent,
} from "react";
import {
  Activity,
  LayoutDashboard,
  MessageSquare,
  Workflow,
} from "lucide-react";
import {
  HeroChatPanel,
  HeroExecutePanel,
  HeroMissionControlPanel,
  HeroSignalsPanel,
} from "@/components/landing/hero-panels";
import { cn } from "@/lib/cn";

/** Auto-advance hero tabs; pause respects hover/focus and `prefers-reduced-motion`. */
const HERO_AUTO_ROTATE_MS = 5500;

const HERO_PREVIEW_ASPECT = "aspect-[16/10]";

const HERO_TABS = [
  "mission-control",
  "execute",
  "signals",
  "chat",
] as const;
type HeroProductTab = (typeof HERO_TABS)[number];

const pills: {
  id: HeroProductTab;
  label: string;
  Icon: typeof LayoutDashboard;
}[] = [
  { id: "mission-control", label: "Mission Control", Icon: LayoutDashboard },
  { id: "execute", label: "Execute", Icon: Workflow },
  { id: "signals", label: "Signals", Icon: Activity },
  { id: "chat", label: "Chat", Icon: MessageSquare },
];

const sidebarNav: {
  id: HeroProductTab;
  Icon: typeof LayoutDashboard;
  label: string;
}[] = [
  { id: "mission-control", Icon: LayoutDashboard, label: "Mission Control" },
  { id: "execute", Icon: Workflow, label: "Execute" },
  { id: "signals", Icon: Activity, label: "Signals" },
  { id: "chat", Icon: MessageSquare, label: "Chat" },
];

const TAB_PATH: Record<HeroProductTab, string> = {
  "mission-control": "/mission-control",
  execute: "/execute",
  signals: "/signals",
  chat: "/chat",
};

/** Landing-only preview: each tab mirrors its dashboard route layout. */
export function HeroProductFrame() {
  const [activeTab, setActiveTab] = useState<HeroProductTab>("mission-control");
  const tabPanelId = useId();
  const fadeStyleId = useId().replace(/:/g, "");
  const pathSuffix = TAB_PATH[activeTab];
  const [hoveringControl, setHoveringControl] = useState(false);
  const [focusInsideControl, setFocusInsideControl] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setPrefersReducedMotion(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const advanceTab = useCallback(() => {
    setActiveTab((current) => {
      const i = HERO_TABS.indexOf(current);
      return HERO_TABS[(i + 1) % HERO_TABS.length]!;
    });
  }, []);

  const pauseAuto =
    prefersReducedMotion || hoveringControl || focusInsideControl;

  useEffect(() => {
    if (pauseAuto) return;
    const id = window.setInterval(advanceTab, HERO_AUTO_ROTATE_MS);
    return () => clearInterval(id);
  }, [advanceTab, pauseAuto, activeTab]);

  const onControlFocusCapture = () => setFocusInsideControl(true);
  const onControlBlurCapture = (e: FocusEvent<HTMLDivElement>) => {
    const next = e.relatedTarget as Node | null;
    if (next && e.currentTarget.contains(next)) return;
    setFocusInsideControl(false);
  };

  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: `
@keyframes hx-hero-product-fade-${fadeStyleId} {
  from { opacity: 0; }
  to { opacity: 1; }
}
.hx-hero-product-fade-${fadeStyleId} {
  animation: hx-hero-product-fade-${fadeStyleId} 0.2s ease-out;
}
@media (prefers-reduced-motion: reduce) {
  .hx-hero-product-fade-${fadeStyleId} { animation: none; }
}
`,
        }}
      />
      <div className="group relative mx-auto mt-10 w-full max-w-5xl transition-transform duration-500 ease-out motion-safe:md:hover:scale-[1.01] md:mt-14">
        <div
          className="w-full min-w-0"
          onMouseEnter={() => setHoveringControl(true)}
          onMouseLeave={() => setHoveringControl(false)}
          onFocusCapture={onControlFocusCapture}
          onBlurCapture={onControlBlurCapture}
        >
          <div className="rounded-[22px] border border-white/[0.1] bg-gradient-to-b from-white/[0.07] to-transparent p-px shadow-[0_32px_120px_rgba(0,0,0,0.88),0_0_72px_rgba(198,168,90,0.16)] transition-[box-shadow,border-color] duration-300 md:group-hover:border-white/[0.14] md:group-hover:shadow-[0_36px_140px_rgba(0,0,0,0.92),0_0_96px_rgba(198,168,90,0.22)]">
            <div className="overflow-hidden rounded-[21px] bg-hx-bg">
              <div
                className={cn(
                  "flex w-full min-w-0 flex-col overflow-hidden",
                  HERO_PREVIEW_ASPECT,
                )}
              >
                <div className="flex w-full shrink-0 items-center gap-3 overflow-x-hidden border-b border-white/[0.07] bg-[#0A0A0A]/60 px-4 py-3 md:gap-4 md:px-5">
                  <div className="flex shrink-0 gap-2">
                    <span className="size-2.5 rounded-full bg-[#ff5f57]/90" />
                    <span className="size-2.5 rounded-full bg-[#febc2e]/90" />
                    <span className="size-2.5 rounded-full bg-[#28c840]/90" />
                  </div>
                  <div className="flex min-w-0 flex-1 items-center rounded-lg border border-white/[0.08] bg-black/55 px-3 py-2 font-mono text-[10px] text-[#9CA3AF] sm:text-[11px]">
                    <span className="truncate text-landing-gold">
                      hustronix.online
                    </span>
                    <span className="shrink-0 text-[#9CA3AF]/70">
                      {pathSuffix}
                    </span>
                  </div>
                  <div className="hidden w-14 shrink-0 sm:block" aria-hidden />
                </div>

                <div
                  id={tabPanelId}
                  role="tabpanel"
                  aria-labelledby={`hero-product-tab-${activeTab}`}
                  className="pointer-events-none flex min-h-0 min-w-0 flex-1 select-none flex-col overflow-hidden"
                >
                  <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
                    <aside className="flex w-10 shrink-0 flex-col items-center gap-2.5 border-r border-hx-border bg-hx-sidebar py-2.5 md:w-11 md:gap-3 md:py-3">
                      {sidebarNav.map(({ Icon, label, id }) => (
                        <span
                          key={id}
                          className={cn(
                            "flex size-7 items-center justify-center rounded-md md:h-8 md:w-8",
                            activeTab === id
                              ? "bg-hx-accent/15 text-hx-accent"
                              : "text-hx-muted opacity-80",
                          )}
                          title={label}
                        >
                          <Icon
                            className="size-3.5 md:h-4 md:w-4"
                            aria-hidden
                          />
                        </span>
                      ))}
                    </aside>

                    <div
                      className={cn(
                        "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
                        !prefersReducedMotion &&
                          `hx-hero-product-fade-${fadeStyleId}`,
                      )}
                    >
                      <div
                        data-hero-panel="mission-control"
                        className={cn(
                          "min-h-0 flex-1 flex-col",
                          activeTab === "mission-control" ? "flex" : "hidden",
                        )}
                        aria-hidden={activeTab !== "mission-control"}
                      >
                        <HeroMissionControlPanel />
                      </div>
                      <div
                        data-hero-panel="execute"
                        className={cn(
                          "min-h-0 flex-1 flex-col",
                          activeTab === "execute" ? "flex" : "hidden",
                        )}
                        aria-hidden={activeTab !== "execute"}
                      >
                        <HeroExecutePanel />
                      </div>
                      <div
                        data-hero-panel="signals"
                        className={cn(
                          "min-h-0 flex-1 flex-col",
                          activeTab === "signals" ? "flex" : "hidden",
                        )}
                        aria-hidden={activeTab !== "signals"}
                      >
                        <HeroSignalsPanel />
                      </div>
                      <div
                        data-hero-panel="chat"
                        className={cn(
                          "min-h-0 flex-1 flex-col",
                          activeTab === "chat" ? "flex" : "hidden",
                        )}
                        aria-hidden={activeTab !== "chat"}
                      >
                        <HeroChatPanel />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div
            className="mt-10 grid w-full min-w-0 grid-cols-2 gap-3 overflow-x-hidden sm:grid-cols-4 sm:gap-3 md:mt-12 md:gap-4"
            role="tablist"
            aria-label="Hustronix product areas"
          >
            {pills.map(({ label, Icon, id }) => (
              <button
                key={id}
                type="button"
                role="tab"
                id={`hero-product-tab-${id}`}
                aria-selected={activeTab === id}
                aria-controls={tabPanelId}
                onMouseEnter={() => setActiveTab(id)}
                onClick={() => setActiveTab(id)}
                className={cn(
                  "flex min-h-[44px] min-w-0 items-center justify-center gap-2 rounded-full border p-2.5 text-[10px] font-medium uppercase tracking-[0.12em] shadow-[0_8px_32px_rgba(0,0,0,0.45)] backdrop-blur-sm transition-colors sm:gap-2.5 sm:px-3 sm:text-xs sm:tracking-[0.14em] md:px-4",
                  activeTab === id
                    ? "border-landing-gold/45 bg-[#1F1A12]/95 text-[#EDEDED] ring-1 ring-landing-gold/25"
                    : "border-white/[0.1] bg-[#1A1A1A]/90 text-[#9CA3AF] hover:border-landing-gold/35 hover:text-[#EDEDED]",
                )}
              >
                <Icon
                  className="size-3.5 shrink-0 text-landing-gold sm:h-4 sm:w-4"
                  aria-hidden
                />
                <span className="truncate">{label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
