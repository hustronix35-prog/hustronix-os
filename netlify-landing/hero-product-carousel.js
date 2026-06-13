/**
 * Auto-advance hero product preview tabs (static Netlify landing).
 */
(function () {
  "use strict";

  const AUTO_MS = 5500;
  const TABS = [
    {
      id: "mission-control",
      path: "/mission-control",
      title: "Mission Control",
      subtitle:
        "Command center for critical decisions and system performance.",
    },
    {
      id: "execute",
      path: "/execute",
      title: "Execute",
      subtitle: "Ledger, capacity, and execution transitions.",
    },
    {
      id: "signals",
      path: "/signals",
      title: "Signals",
      subtitle: "Ingest, verify, and link external signals to work.",
    },
    {
      id: "chat",
      path: "/chat",
      title: "Chat",
      subtitle: "Operator console with context, synthesis, and actions.",
    },
  ];

  const TAB_ACTIVE =
    "border-landing-gold/45 bg-[#1F1A12]/95 text-[#EDEDED] ring-1 ring-landing-gold/25";
  const TAB_IDLE =
    "border-white/[0.1] bg-[#1A1A1A]/90 text-[#9CA3AF] hover:border-landing-gold/35 hover:text-[#EDEDED]";

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)")
    .matches;

  function init() {
    const tablist = document.querySelector(
      '[aria-label="Hustronix product areas"]',
    );
    if (!tablist || tablist.dataset.heroProductBound === "1") return;
    tablist.dataset.heroProductBound = "1";

    const tabButtons = TABS.map((t) =>
      document.getElementById(`hero-product-tab-${t.id}`),
    ).filter(Boolean);
    if (tabButtons.length !== TABS.length) return;

    const panelId = tabButtons[0].getAttribute("aria-controls");
    const panel = panelId ? document.getElementById(panelId) : null;
    if (!panel) return;

    const urlBar = tablist.closest(".group")?.querySelector(".font-mono");
    const pathEl = urlBar?.querySelectorAll("span")[1];
    const sidebarItems = [...panel.querySelectorAll("aside span[title]")];
    const bodyPanels = [...document.querySelectorAll("[data-hero-panel]")];

    let active = 0;
    let paused = false;
    let timer = null;
    let inView = false;

    function setTabButtonState(btn, on) {
      btn.setAttribute("aria-selected", on ? "true" : "false");
      const base =
        "flex min-h-[44px] min-w-0 items-center justify-center gap-2 rounded-full border px-2 py-2.5 text-[10px] font-medium uppercase tracking-[0.12em] shadow-[0_8px_32px_rgba(0,0,0,0.45)] backdrop-blur-sm transition-colors sm:gap-2.5 sm:px-3 sm:text-xs sm:tracking-[0.14em] md:px-4";
      btn.className = `${base} ${on ? TAB_ACTIVE : TAB_IDLE}`;
    }

    function render(index) {
      const tab = TABS[index];
      if (!tab) return;
      active = index;

      tabButtons.forEach((btn, i) => setTabButtonState(btn, i === index));
      panel.setAttribute("aria-labelledby", `hero-product-tab-${tab.id}`);

      if (pathEl) pathEl.textContent = tab.path;

      sidebarItems.forEach((el) => {
        const on = el.getAttribute("title") === tab.title;
        el.className = on
          ? "flex h-7 w-7 items-center justify-center rounded-md md:h-8 md:w-8 bg-hx-accent/15 text-hx-accent"
          : "flex h-7 w-7 items-center justify-center rounded-md md:h-8 md:w-8 text-hx-muted opacity-80";
      });

      if (bodyPanels.length > 0) {
        bodyPanels.forEach((el) => {
          const on = el.getAttribute("data-hero-panel") === tab.id;
          el.classList.toggle("hidden", !on);
          el.classList.toggle("flex", on);
          el.setAttribute("aria-hidden", on ? "false" : "true");
        });
      }

      if (!reducedMotion) {
        panel.classList.remove("hero-product-panel-fade");
        void panel.offsetWidth;
        panel.classList.add("hero-product-panel-fade");
      }
    }

    function stopTimer() {
      if (timer) {
        window.clearInterval(timer);
        timer = null;
      }
    }

    function startTimer() {
      stopTimer();
      if (reducedMotion || paused || !inView) return;
      timer = window.setInterval(() => {
        render((active + 1) % TABS.length);
      }, AUTO_MS);
    }

    tabButtons.forEach((btn, i) => {
      btn.addEventListener("click", () => {
        render(i);
        startTimer();
      });
    });

    const root = tablist.closest(".group");
    if (root) {
      root.addEventListener("mouseenter", () => {
        paused = true;
        stopTimer();
      });
      root.addEventListener("mouseleave", () => {
        paused = false;
        startTimer();
      });
    }

    const io = new IntersectionObserver(
      (entries) => {
        inView = entries.some((e) => e.isIntersecting);
        if (inView) startTimer();
        else stopTimer();
      },
      { threshold: 0.2 },
    );
    io.observe(tablist);

    render(0);
    startTimer();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
