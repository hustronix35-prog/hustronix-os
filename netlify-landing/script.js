/**
 * Static landing interactions (scroll reveals, parallax, FAQ, sticky CTA, smooth hash).
 */
(function () {
  "use strict";

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)")
    .matches;

  /** @type {HTMLElement | null} */
  const parallaxLayer = document.querySelector(
    ".landing-zone-hero .will-change-transform",
  );
  const heroSection = document.querySelector(".landing-zone-hero");
  let heroMouse = { x: 0, y: 0 };

  if (heroSection && parallaxLayer && !reducedMotion) {
    heroSection.addEventListener("pointermove", (e) => {
      const r = heroSection.getBoundingClientRect();
      heroMouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      heroMouse.y = -(((e.clientY - r.top) / r.height) * 2 - 1);
      parallaxLayer.style.transform = `translate3d(${heroMouse.x * 18}px, ${heroMouse.y * 12}px, 0)`;
    });
  }

  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener("click", (e) => {
      const id = a.getAttribute("href")?.slice(1);
      if (!id) return;
      const el = document.getElementById(id);
      if (!el) return;
      e.preventDefault();
      el.scrollIntoView({
        behavior: reducedMotion ? "auto" : "smooth",
        block: "start",
      });
      history.replaceState(null, "", `#${id}`);
    });
  });

  function inViewport(el, margin = 0.12) {
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight;
    return r.top < vh * (1 - margin) && r.bottom > vh * margin;
  }

  function revealMotionEl(el) {
    el.classList.add("motion-reveal--visible");
  }

  if (!reducedMotion) {
    const motionEls = document.querySelectorAll(".motion-reveal");
    if (motionEls.length) {
      const motionIo = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            revealMotionEl(entry.target);
            motionIo.unobserve(entry.target);
          }
        },
        { threshold: 0.08, rootMargin: "0px 0px -8% 0px" },
      );
      motionEls.forEach((el) => {
        if (inViewport(el)) revealMotionEl(el);
        else motionIo.observe(el);
      });
    }

    const enterEls = document.querySelectorAll(".landing-section-enter");
    if (enterEls.length) {
      const io = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              entry.target.classList.add("landing-section-enter--visible");
              io.unobserve(entry.target);
            }
          }
        },
        { threshold: 0.12, rootMargin: "0px 0px -14% 0px" },
      );
      enterEls.forEach((el) => {
        if (inViewport(el)) {
          el.classList.add("landing-section-enter--visible");
        } else {
          io.observe(el);
        }
      });
    }

    const flowRoot = document.querySelector(".landing-flow-root");
    if (flowRoot) {
      const flowIo = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              flowRoot.classList.add("landing-flow-root--in");
              flowIo.unobserve(flowRoot);
            }
          }
        },
        { threshold: 0.2 },
      );
      if (inViewport(flowRoot)) flowRoot.classList.add("landing-flow-root--in");
      else flowIo.observe(flowRoot);
    }

    const chaosGrid = document.querySelector(
      '[style*="grid-template-areas"][style*="slack"]',
    );
    if (chaosGrid) {
      chaosGrid.classList.add("landing-chaos-tools");
      if (inViewport(chaosGrid)) {
        chaosGrid.classList.add("motion-reveal--visible");
        chaosGrid.querySelectorAll(".motion-reveal").forEach(revealMotionEl);
      } else {
        const chaosIo = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (!entry.isIntersecting) continue;
              entry.target.classList.add("motion-reveal--visible");
              entry.target
                .querySelectorAll(".motion-reveal")
                .forEach(revealMotionEl);
              chaosIo.unobserve(entry.target);
            }
          },
          { threshold: 0.15 },
        );
        chaosIo.observe(chaosGrid);
      }
    }
  } else {
    document
      .querySelectorAll(".motion-reveal")
      .forEach((el) => el.classList.add("motion-reveal--visible"));
    document
      .querySelectorAll(".landing-section-enter")
      .forEach((el) => el.classList.add("landing-section-enter--visible"));
    document
      .querySelectorAll(".landing-flow-root")
      .forEach((el) => el.classList.add("landing-flow-root--in"));
  }

  document.querySelectorAll("details.landing-faq-item").forEach((d) => {
    d.addEventListener("toggle", () => {
      if (!d.open) return;
      const parent = d.closest("[data-faq-group]");
      if (!parent) return;
      parent.querySelectorAll("details.landing-faq-item").forEach((other) => {
        if (other !== d) other.open = false;
      });
    });
  });

  const stickyCta = document.getElementById("landing-sticky-cta");
  if (stickyCta) {
    const onScroll = () => {
      const max =
        document.documentElement.scrollHeight - window.innerHeight;
      const p = max > 0 ? window.scrollY / max : 0;
      stickyCta.hidden = p < 0.2;
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  document.documentElement.dataset.staticLanding = "true";
})();

/* Mechanism carousel loaded separately (mechanism-carousel.js) */
