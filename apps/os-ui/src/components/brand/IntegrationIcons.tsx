import type { ComponentType, ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Box({ size = 28, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden {...rest}>
      {children}
    </svg>
  );
}

/** Official-style Slack hash mark */
export function SlackIcon({ size = 28, ...rest }: IconProps) {
  return (
    <Box size={size} {...rest}>
      <path
        fill="#E01E5A"
        d="M6.34 14.55a1.66 1.66 0 1 1-1.66-1.66h1.66v1.66Zm.83 0a1.66 1.66 0 0 1 3.32 0v4.15a1.66 1.66 0 1 1-3.32 0v-4.15Z"
      />
      <path
        fill="#36C5F0"
        d="M9.49 6.34a1.66 1.66 0 1 1 1.66-1.66v1.66H9.49Zm0 .83a1.66 1.66 0 0 1 0 3.32H5.34a1.66 1.66 0 1 1 0-3.32h4.15Z"
      />
      <path
        fill="#2EB67D"
        d="M17.66 9.49a1.66 1.66 0 1 1 1.66 1.66h-1.66V9.49Zm-.83 0a1.66 1.66 0 0 1-3.32 0V5.34a1.66 1.66 0 1 1 3.32 0v4.15Z"
      />
      <path
        fill="#ECB22E"
        d="M14.51 17.66a1.66 1.66 0 1 1-1.66 1.66v-1.66h1.66Zm0-.83a1.66 1.66 0 0 1 0-3.32h4.15a1.66 1.66 0 1 1 0 3.32h-4.15Z"
      />
    </Box>
  );
}

/** Google "G" mark */
export function GoogleIcon({ size = 28, ...rest }: IconProps) {
  return (
    <Box size={size} {...rest}>
      <path
        fill="#4285F4"
        d="M21.6 12.23c0-.74-.07-1.45-.19-2.14H12v4.05h5.38a4.6 4.6 0 0 1-2 3.02v2.5h3.24c1.89-1.74 2.98-4.3 2.98-7.43Z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.7 0 4.96-.89 6.61-2.42l-3.24-2.5c-.9.6-2.04.96-3.37.96-2.59 0-4.78-1.75-5.56-4.1H3.1v2.58A9.99 9.99 0 0 0 12 22Z"
      />
      <path
        fill="#FBBC05"
        d="M6.44 13.94A6 6 0 0 1 6.12 12c0-.67.12-1.33.32-1.94V7.48H3.1A9.99 9.99 0 0 0 2 12c0 1.61.38 3.14 1.1 4.52l3.34-2.58Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.96c1.47 0 2.79.5 3.83 1.5l2.87-2.87C16.95 2.97 14.7 2 12 2A9.99 9.99 0 0 0 3.1 7.48l3.34 2.58C7.22 7.71 9.41 5.96 12 5.96Z"
      />
    </Box>
  );
}

/** Microsoft 4-square window */
export function MicrosoftIcon({ size = 28, ...rest }: IconProps) {
  return (
    <Box size={size} {...rest}>
      <path fill="#F25022" d="M3 3h8.5v8.5H3V3Z" />
      <path fill="#7FBA00" d="M12.5 3H21v8.5h-8.5V3Z" />
      <path fill="#00A4EF" d="M3 12.5h8.5V21H3v-8.5Z" />
      <path fill="#FFB900" d="M12.5 12.5H21V21h-8.5v-8.5Z" />
    </Box>
  );
}

/** Atlassian/Jira blue mark */
export function JiraIcon({ size = 28, ...rest }: IconProps) {
  return (
    <Box size={size} {...rest}>
      <path
        fill="#2684FF"
        d="M11.53 2H21a1 1 0 0 1 1 1v9.47c0 .43-.17.84-.48 1.14L12.67 21.5a1.6 1.6 0 0 1-2.26 0L2.5 13.59a1.6 1.6 0 0 1 0-2.26L10.39 2.48A1.6 1.6 0 0 1 11.53 2Zm.47 5.3L7.8 11.5 12 15.7l4.2-4.2L12 7.3Z"
      />
      <path fill="#0052CC" d="M12 7.3 7.8 11.5 12 15.7V7.3Z" opacity={0.55} />
    </Box>
  );
}

/** Notion N mark */
export function NotionIcon({ size = 28, ...rest }: IconProps) {
  return (
    <Box size={size} {...rest}>
      <path
        fill="#FFFFFF"
        d="M4.5 3.2h12.2c.5 0 .95.2 1.28.55l2.2 2.35c.28.3.42.7.42 1.1v13.2c0 .88-.72 1.6-1.6 1.6H6.9c-.5 0-.95-.2-1.28-.55L3.42 19.1A1.6 1.6 0 0 1 3 18V4.8c0-.88.72-1.6 1.5-1.6Zm2.4 3.1v10.9l1.7 1.4h8.6V6.9l-1.6-1.6H6.9Zm2.5 1.8h1.55v7.2h-1.1l-2.2 1.55V15.3l1.75-1.25V8.1Zm4.1 0h1.5v5.55c0 1.55-.7 2.35-2.05 2.35-.4 0-.75-.05-1.1-.15v-1.35c.2.08.45.12.7.12.55 0 .95-.35.95-1.1V8.1Z"
      />
    </Box>
  );
}

/** GitHub octocat silhouette */
export function GitHubIcon({ size = 28, ...rest }: IconProps) {
  return (
    <Box size={size} {...rest}>
      <path
        fill="#FFFFFF"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2C6.48 2 2 6.58 2 12.25c0 4.52 2.87 8.35 6.84 9.7.5.1.68-.22.68-.48 0-.24-.01-.87-.01-1.7-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.63.07-.63 1 .07 1.53 1.06 1.53 1.06.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.37-2.22-.26-4.55-1.14-4.55-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.7 0 0 .84-.27 2.75 1.05A9.3 9.3 0 0 1 12 6.8c.85 0 1.7.12 2.5.34 1.9-1.32 2.74-1.05 2.74-1.05.55 1.4.21 2.44.1 2.7.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.8-4.57 5.06.36.32.68.94.68 1.9 0 1.37-.01 2.47-.01 2.81 0 .26.18.59.69.48A10.27 10.27 0 0 0 22 12.25C22 6.58 17.52 2 12 2Z"
      />
    </Box>
  );
}

/** Salesforce cloud */
export function SalesforceIcon({ size = 28, ...rest }: IconProps) {
  return (
    <Box size={size} {...rest}>
      <path
        fill="#00A1E0"
        d="M10.2 7.1c.7-1.5 2.2-2.5 3.9-2.5 1.4 0 2.7.7 3.5 1.8.7-.4 1.5-.6 2.3-.6 2.4 0 4.3 1.9 4.3 4.3 0 .2 0 .4-.05.6 1.5.5 2.55 1.9 2.55 3.55 0 2.1-1.7 3.8-3.8 3.8H6.9C4.2 17.95 2 15.75 2 13.05c0-2.2 1.45-4.05 3.45-4.65.2-2 1.85-3.55 3.9-3.55.3 0 .6.05.85.1Z"
      />
    </Box>
  );
}

/** Linear geometric mark */
export function LinearIcon({ size = 28, ...rest }: IconProps) {
  return (
    <Box size={size} {...rest}>
      <path
        fill="#5E6AD2"
        d="M3.2 15.35A9.95 9.95 0 0 0 15.35 3.2L3.2 15.35Zm2.12 3.53A9.95 9.95 0 0 0 18.88 5.32L5.32 18.88ZM8.2 20.4A9.96 9.96 0 0 0 20.4 8.2L8.2 20.4Z"
      />
    </Box>
  );
}

/** Asana three-dot mark */
export function AsanaIcon({ size = 28, ...rest }: IconProps) {
  return (
    <Box size={size} {...rest}>
      <circle cx="12" cy="6.2" r="3.2" fill="#F06A6A" />
      <circle cx="6.6" cy="16.6" r="3.2" fill="#F06A6A" />
      <circle cx="17.4" cy="16.6" r="3.2" fill="#F06A6A" />
    </Box>
  );
}

export type IntegrationBrandId =
  | "slack"
  | "google"
  | "microsoft"
  | "jira"
  | "notion"
  | "github"
  | "salesforce"
  | "linear"
  | "asana";

const brandMap: Record<IntegrationBrandId, ComponentType<IconProps>> = {
  slack: SlackIcon,
  google: GoogleIcon,
  microsoft: MicrosoftIcon,
  jira: JiraIcon,
  notion: NotionIcon,
  github: GitHubIcon,
  salesforce: SalesforceIcon,
  linear: LinearIcon,
  asana: AsanaIcon,
};

export function IntegrationBrandIcon({
  brand,
  size = 28,
  ...rest
}: IconProps & { brand: IntegrationBrandId }) {
  const Icon = brandMap[brand];
  return <Icon size={size} {...rest} />;
}

const SLUG_TO_BRAND: Record<string, IntegrationBrandId> = {
  slack: "slack",
  github: "github",
  notion: "notion",
  jira: "jira",
  atlassian: "jira",
  google: "google",
  "google-drive": "google",
  "google-calendar": "google",
  "google-mail": "google",
  microsoft: "microsoft",
  "microsoft-teams": "microsoft",
  "microsoft-teams-v2": "microsoft",
  salesforce: "salesforce",
  linear: "linear",
  asana: "asana",
};

export function slugToBrandId(slug: string): IntegrationBrandId | null {
  const key = slug.trim().toLowerCase();
  if (SLUG_TO_BRAND[key]) return SLUG_TO_BRAND[key];
  const hit = Object.entries(SLUG_TO_BRAND).find(([s]) => key.startsWith(s) || key.includes(s));
  return hit?.[1] ?? null;
}

export function ProviderCatalogIcon({
  slug,
  name,
  logoUrl,
  size = 26,
}: {
  slug: string;
  name: string;
  logoUrl?: string;
  size?: number;
}) {
  const brand = slugToBrandId(slug);
  if (brand) return <IntegrationBrandIcon brand={brand} size={size} />;
  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt=""
        width={size}
        height={size}
        style={{ display: "block", objectFit: "contain" }}
      />
    );
  }
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        display: "grid",
        placeItems: "center",
        fontSize: Math.round(size * 0.45),
        fontWeight: 650,
        color: "var(--text-secondary)",
      }}
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}
