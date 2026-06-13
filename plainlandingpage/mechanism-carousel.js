/**
 * Auto-advance "How the platform works" carousel (static landing; mirrors ArchitectureSteps).
 */
(function () {
  "use strict";

  const AUTO_MS = 5500;
  const STEPS = [
    {
      step: "01",
      title: "Data ingestion",
      body: "Connect Slack, Jira, GitHub, meetings, CRM, and email as unified signal sources.",
      iconClass: "lucide-unplug",
    },
    {
      step: "02",
      title: "Signal capture",
      body: "Continuous real-time capture from all connected systems—without disrupting workflows.",
      iconClass: "lucide-radio",
    },
    {
      step: "03",
      title: "Context engine",
      body: "Real-time context modeling builds a live operational graph of enterprise activity.",
      iconClass: "lucide-activity",
    },
    {
      step: "04",
      title: "Analytics & reasoning",
      body: "Alignment and drift detection surfaces execution conflicts before they compound.",
      iconClass: "lucide-brain",
    },
    {
      step: "05",
      title: "APIs & dashboards",
      body: "Expose operational intelligence through APIs and visual surfaces your teams already use.",
      iconClass: "lucide-layout-dashboard",
    },
    {
      step: "06",
      title: "Cloud-native scale",
      body: "Enterprise-grade reliability, security, and elastic performance at any scale.",
      iconClass: "lucide-cloud",
    },
  ];

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)")
    .matches;

  function init() {
    const root = document.querySelector(
      '[aria-label="How the platform works"]',
    );
    if (!root || root.dataset.mechanismBound === "1") return;
    root.dataset.mechanismBound = "1";

    const card = root.querySelector("[aria-live]");
    const grid = root.querySelector(".grid.grid-cols-2");
    if (!card || !grid) return;

    const stepButtons = [...grid.querySelectorAll("button[aria-label]")].filter(
      (b) => /^\d{2}:/.test(b.getAttribute("aria-label") || ""),
    );
    if (stepButtons.length !== STEPS.length) return;

    const stepNumEl = card.querySelector(".tabular-nums");
    const titleEl = card.querySelector("h3");
    const bodyEl = card.querySelector("p.max-w-2xl");
    const progressTrack = card.querySelector(
      ".relative.mt-6.h-1.overflow-hidden",
    );
    let progressBar = progressTrack?.querySelector(".h-full");

    function iconHost() {
      return card.querySelector(".flex.h-12.w-12");
    }

    const iconTemplates = stepButtons.map((btn) => {
      const svg = btn.querySelector("svg");
      return svg ? svg.cloneNode(true) : null;
    });

    let active = 0;
    let paused = false;
    let autoOff = false;
    let timer = null;
    let inView = false;

    function setProgressAnimating(on) {
      if (!progressBar || !progressTrack) return;
      progressBar.classList.remove("mechanism-progress-bar");
      void progressBar.offsetWidth;
      if (on && !reducedMotion) {
        progressBar.classList.add("mechanism-progress-bar");
      }
    }

    function render(index) {
      const s = STEPS[index];
      const btn = stepButtons[index];
      if (!s || !btn) return;

      active = index;
      if (stepNumEl) stepNumEl.textContent = s.step;
      if (titleEl) titleEl.textContent = s.title;
      if (bodyEl) bodyEl.textContent = s.body;

      const host = iconHost();
      const tpl = iconTemplates[index];
      if (host && tpl) {
        host.innerHTML = "";
        host.appendChild(tpl.cloneNode(true));
      }

      stepButtons.forEach((b, i) => {
        const on = i === index;
        if (on) b.setAttribute("aria-current", "step");
        else b.removeAttribute("aria-current");
        b.classList.toggle("mechanism-step--active", on);
      });

      if (!progressBar) {
        progressBar = document.createElement("div");
        progressBar.className =
          "h-full origin-left rounded-full bg-gradient-to-r from-landing-gold/60 via-landing-gold to-landing-gold/80";
        progressTrack.appendChild(progressBar);
      }

      if (reducedMotion || paused || autoOff) {
        progressBar.classList.remove("mechanism-progress-bar");
        progressBar.style.transform = `scaleX(${(index + 1) / STEPS.length})`;
        progressBar.style.transition = "transform 0.3s ease";
      } else {
        progressBar.style.transform = "";
        progressBar.style.transition = "";
        setProgressAnimating(true);
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
      if (reducedMotion || paused || autoOff || !inView) return;
      timer = window.setInterval(() => {
        render((active + 1) % STEPS.length);
      }, AUTO_MS);
    }

    stepButtons.forEach((btn, i) => {
      btn.addEventListener("click", () => {
        render(i);
        startTimer();
      });
    });

    root.addEventListener("mouseenter", () => {
      paused = true;
      stopTimer();
      setProgressAnimating(false);
      if (progressBar) {
        progressBar.style.transform = `scaleX(${(active + 1) / STEPS.length})`;
      }
    });
    root.addEventListener("mouseleave", () => {
      paused = false;
      render(active);
      startTimer();
    });

    const skipButtons = root.querySelectorAll("button");
    skipButtons.forEach((btn) => {
      if (btn.textContent?.trim() !== "Skip") return;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const idx = stepButtons.findIndex((b) =>
          b.classList.contains("mechanism-step--active"),
        );
        if (idx < 0 || idx >= STEPS.length - 1) {
          autoOff = true;
          stopTimer();
          return;
        }
        render(idx + 1);
        startTimer();
      });
    });

    const io = new IntersectionObserver(
      (entries) => {
        inView = entries.some((e) => e.isIntersecting);
        if (inView) startTimer();
        else stopTimer();
      },
      { threshold: 0.25 },
    );
    io.observe(root);

    render(0);
    if (!reducedMotion) startTimer();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
