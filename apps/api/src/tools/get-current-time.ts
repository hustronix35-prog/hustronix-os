export const definition = {
  name: "get_current_time",
  description:
    "Get the current date and time. Optionally specify a timezone (IANA format, e.g. 'America/New_York').",
  parameters: {
    type: "object" as const,
    properties: {
      timezone: {
        type: "string",
        description:
          "IANA timezone name (e.g. 'Asia/Kolkata', 'America/New_York'). Defaults to the system timezone.",
      },
    },
    required: [],
  },
};

export async function handler(
  input: Record<string, unknown>
): Promise<string> {
  const tz = (input.timezone as string) ?? undefined;

  try {
    const now = new Date();
    const formatted = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      dateStyle: "full",
      timeStyle: "long",
    }).format(now);

    return formatted;
  } catch {
    return `Error: Invalid timezone "${tz}". Use IANA format like "America/New_York".`;
  }
}
