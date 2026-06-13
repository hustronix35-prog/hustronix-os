/**
 * Password-protected early-access leads viewer (Google Sheet via Netlify function).
 * Password is checked server-side in Apps Script — not embedded in this file.
 */
(function () {
  "use strict";

  const SESSION_KEY = "hustronix_ea_leads_session";
  const PWD_KEY = "hustronix_ea_leads_pwd";
  const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;

  const gate = document.getElementById("leads-gate");
  const panel = document.getElementById("leads-panel");
  const loginForm = document.getElementById("leads-login-form");
  const passwordInput = document.getElementById("leads-password");
  const gateError = document.getElementById("leads-gate-error");
  const loadError = document.getElementById("leads-load-error");
  const tbody = document.getElementById("leads-tbody");
  const emptyEl = document.getElementById("leads-empty");
  const countEl = document.getElementById("leads-count");
  const table = document.getElementById("leads-table");

  let cachedPassword = "";
  let cachedEntries = [];

  function showGateError(msg) {
    gateError.textContent = msg;
    gateError.hidden = !msg;
  }

  function showLoadError(msg) {
    loadError.textContent = msg;
    loadError.hidden = !msg;
  }

  function saveSession(password) {
    try {
      sessionStorage.setItem(
        SESSION_KEY,
        JSON.stringify({ at: Date.now() }),
      );
      sessionStorage.setItem(PWD_KEY, password);
    } catch {
      /* ignore */
    }
  }

  function clearSession() {
    try {
      sessionStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem(PWD_KEY);
    } catch {
      /* ignore */
    }
    cachedPassword = "";
  }

  function savedPassword() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return "";
      const data = JSON.parse(raw);
      if (!data || typeof data.at !== "number") return "";
      if (Date.now() - data.at >= SESSION_MAX_AGE_MS) {
        clearSession();
        return "";
      }
      return sessionStorage.getItem(PWD_KEY) || "";
    } catch {
      return "";
    }
  }

  function showPanel(show) {
    gate.hidden = show;
    panel.hidden = !show;
  }

  function formatWhen(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderEntries(entries) {
    cachedEntries = entries;
    tbody.innerHTML = "";
    const n = entries.length;
    countEl.textContent =
      n === 1 ? "1 submission" : `${n} submission${n ? "s" : ""}`;
    emptyEl.hidden = n > 0;
    table.hidden = n === 0;

    for (const row of entries) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(formatWhen(row.submittedAt))}</td>
        <td>${escapeHtml(row.name || "")}</td>
        <td><a href="mailto:${escapeHtml(row.email || "")}">${escapeHtml(row.email || "")}</a></td>
        <td>${escapeHtml(row.company || "—")}</td>
        <td>${escapeHtml(row.role || "—")}</td>
        <td>${escapeHtml(row.source || "—")}</td>
      `;
      tbody.appendChild(tr);
    }
  }

  function listApiUrl() {
    return (
      document.documentElement.getAttribute("data-list-api") ||
      "/.netlify/functions/list-early-access"
    );
  }

  async function fetchLeads(password) {
    let res;
    try {
      res = await fetch(listApiUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
    } catch {
      throw new Error(
        "Cannot reach the leads API. Use `node dev-server.mjs` locally, or deploy on Netlify with functions enabled.",
      );
    }

    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    if (!res.ok || !data || !data.ok) {
      if (res.status === 404) {
        throw new Error(
          "Leads API not found (404). Use http://localhost:3000/leads.html with npm run dev, or http://127.0.0.1:8888/leads.html with npm run dev:landing.",
        );
      }
      throw new Error(
        (data && data.error) ||
          (res.status === 401
            ? "Incorrect password."
            : `Could not load leads (HTTP ${res.status}).`),
      );
    }
    return data.entries || [];
  }

  async function unlock(password) {
    showGateError("");
    showLoadError("");
    const btn = loginForm.querySelector('button[type="submit"]');
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Checking…";
    }
    try {
      const entries = await fetchLeads(password);
      cachedPassword = password;
      saveSession(password);
      showPanel(true);
      renderEntries(entries);
      passwordInput.value = "";
    } catch (err) {
      showGateError(
        err instanceof Error ? err.message : "Could not unlock.",
      );
      showPanel(false);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Unlock";
      }
    }
  }

  async function refresh() {
    if (!cachedPassword) return;
    showLoadError("");
    const refreshBtn = document.getElementById("leads-refresh");
    if (refreshBtn) refreshBtn.disabled = true;
    try {
      const entries = await fetchLeads(cachedPassword);
      renderEntries(entries);
    } catch (err) {
      showLoadError(
        err instanceof Error ? err.message : "Refresh failed.",
      );
    } finally {
      if (refreshBtn) refreshBtn.disabled = false;
    }
  }

  function exportCsv() {
    if (!cachedEntries.length) return;
    const headers = [
      "Timestamp",
      "Name",
      "Email",
      "Company",
      "Role",
      "Source",
      "User agent",
    ];
    const lines = [headers.join(",")];
    for (const e of cachedEntries) {
      const row = [
        e.submittedAt,
        e.name,
        e.email,
        e.company,
        e.role,
        e.source,
        e.userAgent,
      ].map((cell) => {
        const s = String(cell ?? "");
        if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
        return s;
      });
      lines.push(row.join(","));
    }
    const blob = new Blob([lines.join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `early-access-leads-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function lock() {
    clearSession();
    cachedEntries = [];
    showPanel(false);
    showLoadError("");
    showGateError("");
    passwordInput.focus();
  }

  loginForm.addEventListener("submit", (e) => {
    e.preventDefault();
    unlock(passwordInput.value);
  });

  document.getElementById("leads-refresh")?.addEventListener("click", refresh);
  document.getElementById("leads-export")?.addEventListener("click", exportCsv);
  document.getElementById("leads-lock")?.addEventListener("click", lock);

  const remembered = savedPassword();
  if (remembered) {
    void unlock(remembered);
  } else {
    showPanel(false);
  }
})();
