/**
 * Contact form for static Netlify demand-validation site (POST /api/contact).
 */
(function () {
  "use strict";

  const apiBase =
    document.documentElement.getAttribute("data-api-base") || "";

  function apiUrl(path) {
    return `${apiBase}${path}`;
  }

  function trim(v) {
    return String(v || "").trim();
  }

  function showStatus(form, text, isError) {
    let el = form.querySelector(".contact-status");
    if (!el) {
      el = document.createElement("p");
      el.className = "contact-status";
      form.appendChild(el);
    }
    el.textContent = text;
    el.className = isError ? "contact-status err" : "contact-status ok";
  }

  function bindForm(form) {
    if (!form || form.dataset.contactBound === "1") return;
    form.dataset.contactBound = "1";

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const payload = {
        name: trim(fd.get("name")),
        email: trim(fd.get("email")),
        company: trim(fd.get("company")),
        subject: trim(fd.get("subject")),
        message: trim(fd.get("message")),
        source: trim(form.getAttribute("data-source")) || "netlify-contact",
      };

      const btn = form.querySelector('button[type="submit"]');
      if (btn) {
        btn.disabled = true;
        btn.dataset.prevLabel = btn.textContent || "";
        btn.textContent = "Sending…";
      }

      try {
        const res = await fetch(apiUrl("/api/contact"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data || !data.ok) {
          throw new Error(
            (data && data.error) || "Could not send your message. Please try again.",
          );
        }
        form.reset();
        showStatus(
          form,
          data.message || "Thanks — we received your message and will reply soon.",
          false,
        );
      } catch (err) {
        showStatus(
          form,
          err instanceof Error ? err.message : "Something went wrong.",
          true,
        );
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = btn.dataset.prevLabel || "Send message";
        }
      }
    });
  }

  document.querySelectorAll("form[data-contact-form]").forEach(bindForm);
})();
