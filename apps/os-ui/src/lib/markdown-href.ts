/** Allow only safe URL schemes in rendered markdown links. */
export function safeMarkdownHref(href: string | undefined): string | undefined {
  if (!href) return undefined;
  const trimmed = href.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("#") || trimmed.startsWith("/")) return trimmed;
  try {
    const url = new URL(trimmed);
    const scheme = url.protocol.replace(/:$/, "").toLowerCase();
    if (scheme === "http" || scheme === "https" || scheme === "mailto" || scheme === "tel") {
      return trimmed;
    }
  } catch {
    return undefined;
  }
  return undefined;
}
