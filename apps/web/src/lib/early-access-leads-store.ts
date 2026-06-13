import fs from "node:fs/promises";
import path from "node:path";

export type EarlyAccessLead = {
  id: string;
  submittedAt: string;
  name: string;
  email: string;
  company: string;
  role: string;
  source: string;
  userAgent: string;
};

const DATA_FILE = path.join(
  process.cwd(),
  "..",
  "..",
  "netlify-landing",
  ".data",
  "early-access-leads.json",
);

const MAX_ENTRIES = 5000;

export async function readEarlyAccessLeads(): Promise<EarlyAccessLead[]> {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const data = JSON.parse(raw) as unknown;
    return Array.isArray(data) ? (data as EarlyAccessLead[]) : [];
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return [];
    throw err;
  }
}

export async function appendEarlyAccessLead(
  entry: EarlyAccessLead,
): Promise<number> {
  const leads = await readEarlyAccessLeads();
  leads.unshift(entry);
  if (leads.length > MAX_ENTRIES) leads.length = MAX_ENTRIES;
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(leads, null, 2), "utf8");
  return leads.length;
}
