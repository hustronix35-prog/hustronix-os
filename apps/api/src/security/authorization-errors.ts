export class AuthorizationError extends Error {
  readonly code = "FORBIDDEN";
  readonly requiredPermission?: string;

  constructor(message: string, requiredPermission?: string) {
    super(message);
    this.name = "AuthorizationError";
    this.requiredPermission = requiredPermission;
  }
}

export class CapabilityDeniedError extends Error {
  readonly code = "CAPABILITY_DENIED";

  constructor(message: string) {
    super(message);
    this.name = "CapabilityDeniedError";
  }
}

export class TenantIsolationError extends Error {
  readonly code = "TENANT_ISOLATION";

  constructor(message: string) {
    super(message);
    this.name = "TenantIsolationError";
  }
}

export class PromptInjectionBlockedError extends Error {
  readonly code = "PROMPT_INJECTION_BLOCKED";
  readonly classification: "SUSPICIOUS" | "MALICIOUS";

  constructor(message: string, classification: "SUSPICIOUS" | "MALICIOUS") {
    super(message);
    this.name = "PromptInjectionBlockedError";
    this.classification = classification;
  }
}
