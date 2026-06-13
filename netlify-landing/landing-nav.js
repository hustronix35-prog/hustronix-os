/**
 * Fixed sticky header + mobile nav drawer (Netlify demand landing).
 */
(function () {
  "use strict";

  function bindHashScroll(link) {
    link.addEventListener("click", (e) => {
      const id = link.getAttribute("href")?.slice(1);
      const target = id ? document.getElementById(id) : null;
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      try {
        history.replaceState(null, "", `#${id}`);
      } catch {
        /* ignore */
      }
    });
  }

  /** Logo | centered section links | CTA + menu (desktop grid). */
  function layoutHeaderBar(header, nav) {
    const inner = header.querySelector(":scope > div");
    if (!inner || inner.dataset.landingHeaderLayout === "1") return { inner, actions: null };
    inner.dataset.landingHeaderLayout = "1";
    inner.classList.add("landing-header-inner");

    const brand = inner.querySelector(":scope > a");
    if (brand) brand.classList.add("landing-header-brand");

    const hashLinks = [...nav.querySelectorAll('a[href^="#"]')].filter(
      (a) => !a.hasAttribute("data-scroll-early-access") && a.textContent?.trim(),
    );
    const scrollCta =
      nav.querySelector("[data-scroll-early-access]") ||
      nav.querySelector('a.landing-cta-primary[href*="signup"]') ||
      nav.querySelector("a.landing-cta-primary");

    const linksWrap = document.createElement("div");
    linksWrap.className = "landing-header-links";
    linksWrap.setAttribute("role", "navigation");
    linksWrap.setAttribute("aria-label", "Sections");
    hashLinks.forEach((link) => {
      link.className = "landing-header-link";
      bindHashScroll(link);
      linksWrap.appendChild(link);
    });

    const actions = document.createElement("div");
    actions.className = "landing-header-actions";
    if (scrollCta) {
      scrollCta.classList.add("landing-header-cta");
      actions.appendChild(scrollCta);
    }

    inner.replaceChildren(
      ...(brand ? [brand] : []),
      ...(linksWrap.childElementCount ? [linksWrap] : []),
      actions,
    );
    nav.remove();
    return { inner, actions };
  }

  function init() {
    const wrap = document.querySelector(".landing-page-wrap");
    const header = wrap?.querySelector(":scope > header");
    const nav = header?.querySelector('nav[aria-label="Primary"]');
    if (!wrap || !header || !nav || header.dataset.landingNavBound === "1") return;
    header.dataset.landingNavBound = "1";
    header.classList.add("landing-site-header");

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "landing-nav-toggle lg:hidden";
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-controls", "landing-nav-drawer");
    toggle.setAttribute("aria-label", "Open menu");
    toggle.innerHTML =
      '<span class="landing-nav-toggle-bar" aria-hidden="true"></span>' +
      '<span class="landing-nav-toggle-bar" aria-hidden="true"></span>' +
      '<span class="landing-nav-toggle-bar" aria-hidden="true"></span>';

    const drawer = document.createElement("div");
    drawer.id = "landing-nav-drawer";
    drawer.className = "landing-nav-drawer lg:hidden";
    drawer.setAttribute("role", "dialog");
    drawer.setAttribute("aria-modal", "true");
    drawer.setAttribute("aria-label", "Site menu");

    const hashLinks = [...nav.querySelectorAll('a[href^="#"]')].filter(
      (a) => !a.hasAttribute("data-scroll-early-access") && a.textContent?.trim(),
    );
    hashLinks.forEach((link) => {
      const item = document.createElement("a");
      item.href = link.getAttribute("href") || "#";
      item.textContent = link.textContent?.trim() || "";
      item.addEventListener("click", (e) => {
        const id = item.getAttribute("href")?.slice(1);
        const target = id ? document.getElementById(id) : null;
        if (target) {
          e.preventDefault();
          closeMenu();
          target.scrollIntoView({ behavior: "smooth", block: "start" });
          try {
            history.replaceState(null, "", `#${id}`);
          } catch {
            /* ignore */
          }
        } else {
          closeMenu();
        }
      });
      drawer.appendChild(item);
    });

    const headerCta =
      nav.querySelector("[data-scroll-early-access]") ||
      nav.querySelector('a.landing-cta-primary[href*="signup"]') ||
      nav.querySelector("a.landing-cta-primary");
    if (headerCta) {
      const cta = document.createElement("a");
      cta.href = headerCta.getAttribute("href") || "/signup";
      cta.className = headerCta.className + " landing-cta-primary";
      cta.textContent = headerCta.textContent?.trim() || "Get Started";
      if (headerCta.hasAttribute("data-scroll-early-access")) {
        cta.setAttribute("data-scroll-early-access", "");
      }
      cta.addEventListener("click", (e) => {
        const href = cta.getAttribute("href") || "";
        if (href.startsWith("#")) {
          const target = document.getElementById(href.slice(1));
          if (target) {
            e.preventDefault();
            closeMenu();
            target.scrollIntoView({ behavior: "smooth", block: "start" });
            try {
              history.replaceState(null, "", href);
            } catch {
              /* ignore */
            }
            return;
          }
        }
        closeMenu();
      });
      drawer.appendChild(cta);
    }

    document.body.appendChild(drawer);

    const { actions } = layoutHeaderBar(header, nav);
    if (actions) {
      actions.insertBefore(toggle, actions.firstChild);
    } else {
      header.querySelector(".landing-header-inner")?.appendChild(toggle);
    }

    function openMenu() {
      drawer.classList.add("is-open");
      toggle.setAttribute("aria-expanded", "true");
      toggle.setAttribute("aria-label", "Close menu");
      document.body.classList.add("landing-nav-open");
    }

    function closeMenu() {
      drawer.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "Open menu");
      document.body.classList.remove("landing-nav-open");
    }

    toggle.addEventListener("click", () => {
      if (drawer.classList.contains("is-open")) closeMenu();
      else openMenu();
    });

    drawer.addEventListener("click", (e) => {
      if (e.target === drawer) closeMenu();
    });

    window.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Escape") closeMenu();
      },
      { passive: true },
    );

    window.addEventListener(
      "resize",
      () => {
        if (window.matchMedia("(min-width: 1024px)").matches) closeMenu();
      },
      { passive: true },
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
