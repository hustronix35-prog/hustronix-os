/** Single-line friendly preview for dense tables; full text stays in the inspector. */
export function previewText(text: string, maxChars: number): string {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (!normalized) return "—";
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars).trimEnd()}…`;
}
