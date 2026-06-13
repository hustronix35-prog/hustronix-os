export const profileUser = {
  name: "Rohit Verma",
  role: "Founder",
  email: "rohit@acmegrowth.io",
  phone: "+91 98765 43210",
  location: "Bengaluru, India",
  department: "Leadership",
  memberSince: "12 Mar 2024",
  bio: "Building decision infrastructure for high-growth teams.",
};

export const profileTabs = [
  "Overview",
  "Company",
  "Preferences",
  "Security",
  "Activity",
  "Sessions",
  "Notifications",
] as const;

export const activityRows = [
  {
    activity: "Decision updated",
    details: "Resolve System Over Capacity",
    source: "Web",
    when: "2 May 2026, 14:22",
    ip: "103.21.x.x",
  },
  {
    activity: "Signal linked",
    details: "Slack #product-alerts",
    source: "Slack",
    when: "2 May 2026, 11:05",
    ip: "—",
  },
  {
    activity: "API key used",
    details: "analytics-pipeline",
    source: "GitHub",
    when: "1 May 2026, 09:18",
    ip: "52.1.x.x",
  },
];

export const apiKeys = [
  {
    name: "analytics-pipeline",
    created: "12 Jan 2026",
    lastUsed: "2 May 2026",
    status: "Active" as const,
  },
  {
    name: "staging-automation",
    created: "3 Mar 2026",
    lastUsed: "—",
    status: "Revoked" as const,
  },
];

export const sessions = [
  {
    device: "Chrome on Windows",
    location: "Bengaluru, IN",
    ip: "103.21.x.x",
    last: "Active now",
    status: "Active now" as const,
  },
  {
    device: "Chrome on macOS",
    location: "Mumbai, IN",
    ip: "49.36.x.x",
    last: "1 hour ago",
    status: "Active" as const,
  },
];
