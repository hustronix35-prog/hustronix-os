/** Company Reality Benchmark — evaluator-only ground truth. Never sent to ingest. */

export type CrSource =
  | "slack"
  | "email"
  | "jira"
  | "crm"
  | "github"
  | "meeting"
  | "doc"
  | "support";

export type CrArtifact = {
  /** ISO calendar date (YYYY-MM-DD). Becomes detected_at — no simDay. */
  iso_date: string;
  source: CrSource;
  author: string;
  content: string;
  external_id: string;
  /** Evaluator-only link to ground-truth story; null = ambient noise. */
  story_id: string | null;
};

export type CrStory = {
  id: string;
  title: string;
  expected_entity: string;
  /** Evaluator-only pattern hint (not shown to detection). */
  expected_pattern?: string;
  should_discover: boolean;
  expect_ready: boolean;
  expect_resolve: boolean;
  /** Recurring incident should reopen after RESOLVED. */
  expect_reopen?: boolean;
  /** Correct answer is withhold action (no DRAFT at ready). */
  expect_no_decision?: boolean;
  /** Conflicting evidence — should stay below DECISION_READY until clarified. */
  contradictory?: boolean;
  first_evidence_date: string;
  ready_target_date?: string;
  resolve_date?: string;
  reopen_date?: string;
  artifact_external_ids: string[];
  /** Optional business impact note for Phase 9 economics. */
  impact_usd?: number;
  impact_note?: string;
};

export type CrCorpus = {
  generated_at: string;
  artifact_count: number;
  noise_ratio: number;
  stories: CrStory[];
  artifacts: CrArtifact[];
};

export type FailureClassification = "BUG" | "LIMITATION" | "EXPECTED" | "UX";

export type CrFailure = {
  id: string;
  story_id: string | null;
  metric: string;
  failure: string;
  evidence: string;
  root_cause: string;
  classification: FailureClassification;
  fix_required: boolean;
  regression_test?: string;
};
