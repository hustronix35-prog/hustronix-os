/** Extract dual-control pending approval id from API error messages. */
export function parseApprovalIdFromError(message: string): string | null {
  const m = message.match(/Pending approval id:\s*([a-f0-9-]+)/i);
  return m?.[1] ?? null;
}
