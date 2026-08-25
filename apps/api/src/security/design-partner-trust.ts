/**
 * Design-partner trust boundary — policy defaults before broad ingestion.
 * Connectors stay ingest-only / read-only on day one.
 */
export type TrustPolicy = {
  tenant_isolation: true;
  connectors: "read_only";
  encrypted_transport: true;
  rbac: true;
  audit_log: true;
  train_on_customer_data: boolean;
  retention_days: number;
  deletion: "supported";
  partner_ramp: Array<"READ_ONLY" | "OBSERVE" | "VALIDATE" | "DECIDE" | "EXECUTE">;
};

const DEFAULT_RETENTION_DAYS = 365;

export function defaultTrustPolicy(settings?: Record<string, string | undefined>): TrustPolicy {
  const train = settings?.["data.train_on_customer_data"];
  const retention = Number(settings?.["data.retention_days"] || DEFAULT_RETENTION_DAYS);
  return {
    tenant_isolation: true,
    connectors: "read_only",
    encrypted_transport: true,
    rbac: true,
    audit_log: true,
    train_on_customer_data: train === "1" || train === "true",
    retention_days: Number.isFinite(retention) && retention > 0 ? retention : DEFAULT_RETENTION_DAYS,
    deletion: "supported",
    partner_ramp: ["READ_ONLY", "OBSERVE", "VALIDATE", "DECIDE", "EXECUTE"],
  };
}

export function assertReadOnlyConnector(writeAttempt: boolean): void {
  if (writeAttempt) {
    throw new Error("Design-partner connectors are read-only. Write access is not granted on day one.");
  }
}
