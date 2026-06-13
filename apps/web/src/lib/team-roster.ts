import {
  ROSTER_FIELD_SCHEMA,
  type RosterDraftMember as SharedRosterDraftMember,
  type RosterFieldKey,
  type RosterFieldSpec,
  type RosterParseResponse,
} from "@hustronix/shared";

export { ROSTER_FIELD_SCHEMA };
export type { RosterFieldKey, RosterFieldSpec, RosterParseResponse };

export type RosterDraftMember = SharedRosterDraftMember & {
  /** UI-only: include in bulk import */
  selected?: boolean;
};

export const ROLE_OPTIONS = [
  "Engineering",
  "Product",
  "Design",
  "Marketing",
  "Sales",
  "Tech",
  "Data",
  "Operations",
  "People / HR",
  "Finance",
  "Member",
] as const;

export const TEAM_SCOPE_OPTIONS = [
  "General",
  "Leadership",
  "Growth",
  "Product",
  "Operations",
  "Execution",
  "Workspace",
] as const;

export type TeamEntrySource = "ledger" | "roster" | "workspace";

export type TeamEntry = {
  id: string;
  name: string;
  email: string;
  role: string;
  team: string;
  capacity: string;
  loadPct: number;
  utilization: number;
  status: "Healthy" | "At Risk" | "Over Capacity";
  slackId?: string;
  talentTier?: string;
  canRemove: boolean;
  isOrgOwner?: boolean;
  source: TeamEntrySource;
  editable: boolean;
  createdAt?: string;
};

export type TeamEntriesResponse = {
  entries: TeamEntry[];
  total: number;
  rosterCount: number;
  ledgerCount: number;
};

export const TALENT_TIER_OPTIONS = [
  "Elite",
  "Senior",
  "Mid-level",
  "Junior",
  "Intern",
  "Starter",
  "Contractor",
] as const;

export type MemberFormState = {
  name: string;
  email: string;
  role: string;
  team: string;
  capacity: string;
  slackId: string;
  talentTier: string;
};

export function emptyMemberForm(): MemberFormState {
  return {
    name: "",
    email: "",
    role: "Member",
    team: "General",
    capacity: "40h / week",
    slackId: "",
    talentTier: "Mid-level",
  };
}

export function draftFromForm(f: MemberFormState): RosterDraftMember {
  return {
    name: f.name.trim(),
    email: f.email.trim().toLowerCase(),
    role: f.role.trim() || "Member",
    team: f.team.trim() || "General",
    capacity: f.capacity.trim() || "40h / week",
    slackId: f.slackId.trim() || undefined,
    talentTier: f.talentTier.trim() || undefined,
  };
}

export function formFromMember(m: {
  name: string;
  email: string;
  role: string;
  team: string;
  capacity: string;
  slackId?: string;
  talentTier?: string;
}): MemberFormState {
  return {
    name: m.name,
    email: m.email,
    role: m.role || "Member",
    team: m.team || "General",
    capacity: m.capacity || "40h / week",
    slackId: m.slackId ?? "",
    talentTier: m.talentTier ?? "Mid-level",
  };
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Failed to read file"));
        return;
      }
      const base64 = result.includes(",") ? result.split(",")[1]! : result;
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Read failed"));
    reader.readAsDataURL(file);
  });
}

export async function parseSpreadsheetFile(file: File): Promise<{
  headers: string[];
  rows: string[][];
}> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("Workbook has no sheets");
  const sheet = wb.Sheets[sheetName]!;
  const aoa = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  }) as string[][];
  if (!aoa.length) throw new Error("Sheet is empty");
  const headers = (aoa[0] ?? []).map((c) => String(c ?? "").trim());
  const rows = aoa.slice(1).map((r) => headers.map((_, i) => String(r[i] ?? "").trim()));
  return { headers, rows };
}

export async function parseRosterUploadFile(file: File): Promise<
  | { kind: "rows"; headers: string[]; rows: string[][] }
  | { kind: "pdf"; fileBase64: string }
> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) {
    const fileBase64 = await readFileAsBase64(file);
    return { kind: "pdf", fileBase64 };
  }
  if (
    name.endsWith(".xlsx") ||
    name.endsWith(".xls") ||
    name.endsWith(".csv") ||
    file.type.includes("spreadsheet") ||
    file.type === "text/csv"
  ) {
    const { headers, rows } = await parseSpreadsheetFile(file);
    return { kind: "rows", headers, rows };
  }
  throw new Error("Use .xlsx, .xls, .csv, or .pdf");
}
