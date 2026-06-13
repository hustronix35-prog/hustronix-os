/**
 * Early access form — saves to Netlify Blobs via submit-early-access (no Google Sheet).
 * Optional: Hustronix API if data-api-base is set. Netlify Forms as last-resort backup.
 */
(function () {
  "use strict";

  const apiBase =
    document.documentElement.getAttribute("data-api-base") || "";
  const preferNetlify =
    document.documentElement.getAttribute("data-form-backend") === "netlify";

  function apiUrl(path) {
    return `${apiBase}${path}`;
  }

  function trim(v) {
    return String(v || "").trim();
  }

  function showStatus(form, text, isError) {
    let el = form.querySelector(".ea-status");
    if (!el) {
      el = document.createElement("p");
      el.className = "ea-status mt-2 text-xs";
      form.appendChild(el);
    }
    el.textContent = text;
    el.className = isError
      ? "ea-status mt-2 text-xs text-red-400"
      : "ea-status mt-2 text-xs text-[#c6a85a]";
  }

  async function postJson(url, payload) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => null);
    return { res, data };
  }

  async function postNetlifyForm(form, fd) {
    if (form.getAttribute("data-netlify") !== "true") return;
    const formName = form.getAttribute("name") || "early-access";
    const params = new URLSearchParams();
    params.append("form-name", formName);
    for (const [key, value] of fd.entries()) {
      if (key === "bot-field") continue;
      params.append(key, String(value));
    }
    await fetch("/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
  }

  async function submitEarlyAccess(form, payload, fd) {
    const errors = [];

    if (apiBase && !preferNetlify) {
      try {
        const { res, data } = await postJson(apiUrl("/api/early-access"), payload);
        if (res.ok && data && data.ok) {
          return {
            ok: true,
            message:
              data.message ||
              "You're on the list. We'll reach out when early access opens.",
          };
        }
        errors.push((data && data.error) || "API submission failed.");
      } catch {
        errors.push("API unreachable.");
      }
    }

    try {
      const { res, data } = await postJson(
        "/.netlify/functions/submit-early-access",
        payload,
      );
      if (res.ok && data && data.ok) {
        return {
          ok: true,
          message:
            data.message ||
            "You're on the list. We'll reach out when early access opens.",
        };
      }
      errors.push(
        (data && data.error) ||
          "Could not save submission. Deploy on Netlify or run netlify dev.",
      );
    } catch {
      errors.push("Could not reach the save endpoint.");
    }

    try {
      await postNetlifyForm(form, fd);
      return {
        ok: true,
        message:
          "You're on the list. We'll reach out when early access opens.",
      };
    } catch {
      /* fall through */
    }

    throw new Error(
      errors[0] ||
        "Could not submit. Please try again or email hello@hustronix.online.",
    );
  }

  function bindForm(form) {
    if (!form || form.dataset.eaBound === "1") return;
    form.dataset.eaBound = "1";

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const payload = {
        name: trim(fd.get("name")),
        email: trim(fd.get("email")),
        company: trim(fd.get("company")),
        role: trim(fd.get("role")),
        source: trim(form.getAttribute("data-source")) || "landing-static",
      };

      const btn = form.querySelector('button[type="submit"]');
      if (btn) {
        btn.disabled = true;
        btn.dataset.prevLabel = btn.textContent || "";
        btn.textContent = "Sending…";
      }

      try {
        const result = await submitEarlyAccess(form, payload, fd);
        form.reset();
        showStatus(form, result.message, false);
      } catch (err) {
        showStatus(
          form,
          err instanceof Error ? err.message : "Something went wrong.",
          true,
        );
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = btn.dataset.prevLabel || "Request early access";
        }
      }
    });
  }

  document.querySelectorAll("form[data-early-access]").forEach(bindForm);

  function scrollToEarlyAccess(e) {
    const target = document.getElementById("early-access");
    if (!target) return;
    e.preventDefault();
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    try {
      history.replaceState(null, "", "#early-access");
    } catch {
      /* ignore */
    }
  }

  document
    .querySelectorAll("[data-scroll-early-access]")
    .forEach((el) => el.addEventListener("click", scrollToEarlyAccess));
})();
