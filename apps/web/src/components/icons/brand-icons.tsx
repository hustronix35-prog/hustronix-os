import { cn } from "@/lib/cn";

/** Slack logo , official-style wordmark colors on transparent background */
export function SlackIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn("h-[22px] w-[22px] shrink-0", className)}
      viewBox="0 0 54 54"
      aria-hidden
    >
      <path
        fill="#E01E5A"
        d="M11 21a4 4 0 1 1-4-4h4v4Zm4 0a4 4 0 0 1 8 0v10a4 4 0 1 1-8 0V21Z"
      />
      <path
        fill="#36C5F0"
        d="M33 11a4 4 0 1 1 4 4v-4h-4Zm0 4a4 4 0 0 1 0 8H21a4 4 0 1 1 0-8h12Z"
      />
      <path
        fill="#2EB67D"
        d="M43 33a4 4 0 1 1-4 4h4v-4Zm-4 0a4 4 0 0 1-8 0V21a4 4 0 1 1 8 0v12Z"
      />
      <path
        fill="#ECB22E"
        d="M21 43a4 4 0 1 1 4-4v4h-4Zm0-4a4 4 0 0 1 0-8h12a4 4 0 1 1 0 8H21Z"
      />
    </svg>
  );
}

/** GitHub invertocat , white on dark UI */
export function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn("h-[22px] w-[22px] shrink-0 text-hx-text", className)}
      viewBox="0 0 98 96"
      aria-hidden
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M48.854 0C21.839 0 0 22 0 49.217c0 21.756 13.993 40.172 33.405 46.69 2.427.49 3.316-1.059 3.316-2.362 0-1.141-.08-5.052-.08-9.127-13.59 2.934-16.42-5.867-16.42-5.867-2.184-5.704-5.42-7.17-5.42-7.17-4.448-3.015.324-3.015.324-3.015 4.934.326 7.523 5.052 7.523 5.052 4.367 7.496 11.404 5.378 14.235 4.074.404-3.178 1.699-5.378 3.074-6.6-10.839-1.141-22.243-5.378-22.243-24.283 0-5.378 1.94-9.778 5.014-13.2-.485-1.222-2.184-6.275.486-13.038 0 0 4.125-1.304 13.426 5.052a46.97 46.97 0 0 1 12.214-1.63c4.125 0 8.33.571 12.213 1.63 9.302-6.356 13.427-5.052 13.427-5.052 2.67 6.763.97 11.816.485 13.038 3.155 3.422 5.015 7.822 5.015 13.2 0 18.905-11.404 23.06-22.324 24.283 1.78 1.548 3.316 4.481 3.316 9.126 0 6.6-.08 11.897-.08 13.526 0 1.304.89 2.853 3.316 2.364 19.412-6.52 33.405-24.935 33.405-46.691C97.707 22 75.788 0 48.854 0z"
      />
    </svg>
  );
}

/** Atlassian Jira , blue mark */
export function JiraIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn("h-[22px] w-[22px] shrink-0", className)}
      viewBox="0 0 256 256"
      aria-hidden
    >
      <path fill="#2684FF" d="M116 121 62 76c-6-5-6-14 0-19l54-45 54 45c6 5 6 14 0 19l-54 45Z" />
      <path
        fill="#2684FF"
        d="m116 178 37 31c6 5 6 14 0 19l-54 45-54-45c-6-5-6-14 0-19l37-31Z"
        opacity={0.85}
      />
      <path fill="#0052CC" d="M179 103h71v108l-71-58z" />
    </svg>
  );
}

export function ManualSignalIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn("shrink-0 text-hx-muted", className)}
      viewBox="0 0 24 24"
      width={22}
      height={22}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden
    >
      <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
}

/** LinkedIn , wordmark glyph */
export function LinkedInIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn("size-5 shrink-0", className)}
      viewBox="0 0 24 24"
      aria-hidden
      fill="currentColor"
    >
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

/** Instagram , camera glyph */
export function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn("size-5 shrink-0", className)}
      viewBox="0 0 24 24"
      aria-hidden
      fill="currentColor"
    >
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z" />
    </svg>
  );
}

/** X (Twitter) , official X mark */
export function XIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn("size-5 shrink-0", className)}
      viewBox="0 0 24 24"
      aria-hidden
      fill="currentColor"
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

/** Sidebar “Signals” , central pulse + radiating arcs */
export function BroadcastIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn("shrink-0", className)}
      viewBox="0 0 24 24"
      width={20}
      height={20}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
      <path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48 0a6 6 0 0 1 0-8.49" />
      <path d="M18.36 5.64a10 10 0 0 1 0 12.73m-12.73 0a10 10 0 0 1 0-12.73" />
    </svg>
  );
}
