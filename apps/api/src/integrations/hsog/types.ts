/** HSOG → Hustronix OS ingest bundle (one-file smoke export). */

export type HsogPerson = {
  id: string;
  name: string;
  first_name?: string;
  role?: string;
  department?: string;
  seniority?: string;
  location?: string;
  timezone?: string;
  email?: string;
};

export type HsogProduct = { id: string; name: string; category?: string };
export type HsogProject = {
  id: string;
  name: string;
  sponsor_id?: string;
  dri_id?: string;
  product_id?: string;
  customer_id?: string;
  target_day?: number;
};
export type HsogDepartment = { id: string; name: string; leader_id?: string };
export type HsogCustomer = {
  id: string;
  name: string;
  industry?: string;
  arr_usd?: number;
  products?: string[];
  health_score?: number;
  renewal_day?: number;
  risk_level?: string;
  known_issues?: string[];
};

export type HsogArtifact = {
  artifact_id: string;
  artifact_type: string;
  evidence_quality?: string;
  visibility_scope?: string;
  related_entity_ids?: string[];
  ground_truth_fact_ids?: string[];
};

export type HsogEvent = {
  event_id: string;
  day: number;
  date?: string;
  scenario_id: string;
  event_type: string;
  actors?: string[];
  entity_ids?: string[];
  visibility_scope?: string;
  ground_truth_fact_ids?: string[];
  summary?: string;
  private?: boolean;
  artifacts?: HsogArtifact[];
};

export type HsogScenarioMeta = { id: string; title?: string; event_count?: number };

export type HsogIngestBundle = {
  version: number;
  benchmark?: string;
  seed?: string;
  start_date?: string;
  max_days?: number;
  company?: Record<string, unknown>;
  products?: HsogProduct[];
  projects?: HsogProject[];
  departments?: HsogDepartment[];
  customers?: HsogCustomer[];
  people?: HsogPerson[];
  scenarios?: HsogScenarioMeta[];
  events?: HsogEvent[];
  stats?: Record<string, number>;
};

export type HsogIngestOptions = {
  userId: string;
  /** Create DRAFT decisions + executions for each scenario. Default true. */
  decisions?: boolean;
  /** Commit this scenario id to ACTIVE (at most one). Default product_launch_slip. Empty string = none. */
  activateScenarioId?: string | null;
  /** Heuristic intelligence pass (no LLM). Default true. */
  enrich?: boolean;
  /** Activate PENDING tasks under the ACTIVE decision, within owner capacity. */
  startSprint?: boolean;
  /** Patch org.* settings from company profile. Default false. */
  orgProfile?: boolean;
  dryRun?: boolean;
};

export type HsogIngestResult = {
  userId: string;
  orgId: string;
  bundle: { path: string; events: number; artifacts: number; people: number; customers: number };
  signals: { inserted: number; duplicates: number; errors: number };
  entities: { upserted: number };
  roster: { upserted: number };
  decisions: { created: number; activated: string | null };
  sprint: { activated: number; blocked: number };
  notifications: number;
  enriched: number;
};
