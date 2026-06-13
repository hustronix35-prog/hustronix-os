/**
 * Opens Hustronix OAuth start (`/oauth/:slug`) in a dedicated window so the user
 * stays on the app while Slack/GitHub/etc. load in a popup (same pattern as ChatGPT connectors).
 * Falls back to a new tab if the browser blocks popups.
 */
export function openIntegrationOAuthPopup(apiSlug: string): void {
  const url = new URL(`/oauth/${apiSlug}`, window.location.origin).href;
  const w = 560;
  const h = 720;
  const left = Math.max(
    0,
    Math.round(window.screenX + (window.outerWidth - w) / 2),
  );
  const top = Math.max(
    0,
    Math.round(window.screenY + (window.outerHeight - h) / 2),
  );
  const features = [
    `popup=yes`,
    `width=${w}`,
    `height=${h}`,
    `left=${left}`,
    `top=${top}`,
    `scrollbars=yes`,
  ].join(",");

  const name = `hustronix_oauth_${apiSlug}`;
  const win = window.open(url, name, features);

  if (!win || win.closed || typeof win.closed === "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }

  try {
    win.focus();
  } catch {
    /* ignore */
  }
}
