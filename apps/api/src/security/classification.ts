export type DataClassification =
  | "public"
  | "internal"
  | "confidential"
  | "strategic"
  | "irreversible"
  | "regulated";

const ORDER: DataClassification[] = [
  "public",
  "internal",
  "confidential",
  "strategic",
  "irreversible",
  "regulated",
];

export function classificationRank(cls: DataClassification): number {
  return ORDER.indexOf(cls);
}

export function canAccessClassification(
  allowed: DataClassification[],
  requested: DataClassification,
): boolean {
  return allowed.includes(requested);
}

export function maxClassification(
  allowed: DataClassification[],
): DataClassification {
  return allowed.reduce<DataClassification>(
    (max, cls) => (classificationRank(cls) > classificationRank(max) ? cls : max),
    "public",
  );
}
