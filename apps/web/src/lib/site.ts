const DEFAULT_SITE_ORIGIN = "https://hustronix.online";

/**
 * Public site origin for metadata, sitemap, and JSON-LD.
 * Set `NEXT_PUBLIC_SITE_URL` to an absolute URL (e.g. `https://hustronix.online` or `http://localhost:3000` for local dev).
 */
export function getSiteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!raw) return DEFAULT_SITE_ORIGIN;
  try {
    return new URL(raw).origin;
  } catch {
    return DEFAULT_SITE_ORIGIN;
  }
}

export function isSeoNoIndex(): boolean {
  return (
    process.env.NEXT_PUBLIC_SITE_ENV === "staging" ||
    process.env.NEXT_PUBLIC_NOINDEX === "1"
  );
}
