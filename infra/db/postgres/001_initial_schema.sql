-- Hustronix PostgreSQL production schema.
-- Mirrors the current SQLite runtime tables while adding organization-ready
-- columns, RLS hooks, and append-only authority event storage.

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  username citext UNIQUE NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  email_verified_at timestamptz
);

CREATE TABLE IF NOT EXISTS organizations (
  id text PRIMARY KEY,
  slug citext UNIQUE NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organization_memberships (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'strategist', 'operator', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);

CREATE TABLE IF NOT EXISTS api_keys (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  key_val text NOT NULL,
  PRIMARY KEY(user_id, provider)
);

CREATE TABLE IF NOT EXISTS owner_reputation (
  owner text PRIMARY KEY,
  failed_executions integer NOT NULL DEFAULT 0,
  successful_executions integer NOT NULL DEFAULT 0,
  reputation_modifier double precision NOT NULL DEFAULT 1.0,
  is_locked boolean NOT NULL DEFAULT false,
  current_load double precision NOT NULL DEFAULT 0,
  max_capacity double precision NOT NULL DEFAULT 8,
  department text NOT NULL DEFAULT 'General',
  last_updated timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key text NOT NULL,
  value text NOT NULL,
  PRIMARY KEY(user_id, key)
);

CREATE TABLE IF NOT EXISTS decision_ledger (
  id text PRIMARY KEY,
  user_id text NOT NULL DEFAULT 'system',
  org_id text,
  fingerprint text UNIQUE,
  vow text NOT NULL,
  expected_outcomes jsonb,
  constraints jsonb,
  reversal_conditions text,
  institutional_reasoning jsonb,
  decision_reasoning text,
  confidence double precision NOT NULL DEFAULT 0.8,
  status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT', 'ACTIVE', 'UNDER_REVIEW', 'COMPLETED', 'REVERSED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_update timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_decision_ledger_user_status ON decision_ledger(user_id, status);
CREATE INDEX IF NOT EXISTS idx_decision_ledger_org_status ON decision_ledger(org_id, status);

CREATE TABLE IF NOT EXISTS execution_ledger (
  task_id text PRIMARY KEY,
  decision_id text NOT NULL REFERENCES decision_ledger(id) ON DELETE CASCADE,
  parent_task_id text,
  owner text NOT NULL DEFAULT 'system',
  type text NOT NULL DEFAULT 'ACTION' CHECK(type IN ('ACTION', 'KILL', 'VERIFY', 'BLOCK')),
  priority integer NOT NULL DEFAULT 3 CHECK(priority BETWEEN 1 AND 5),
  weight double precision NOT NULL DEFAULT 1.0,
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'ACTIVE', 'DONE', 'KILLED', 'BLOCKED')),
  blocked_reasons jsonb,
  dependencies jsonb,
  success_condition text,
  failure_condition text,
  started_at timestamptz,
  completed_at timestamptz,
  last_update timestamptz NOT NULL DEFAULT now(),
  fencing_token bigint NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_execution_decision ON execution_ledger(decision_id);
CREATE INDEX IF NOT EXISTS idx_execution_owner_status ON execution_ledger(owner, status);

CREATE TABLE IF NOT EXISTS external_signals (
  id text PRIMARY KEY,
  user_id text NOT NULL DEFAULT 'system',
  org_id text,
  source text CHECK(source IN ('GITHUB', 'SLACK', 'JIRA', 'MANUAL')),
  content text,
  owner text,
  detected_at timestamptz NOT NULL DEFAULT now(),
  grace_expires_at timestamptz,
  linked_execution_id text REFERENCES execution_ledger(task_id),
  state text NOT NULL DEFAULT 'UNVERIFIED' CHECK(state IN ('UNVERIFIED', 'GRACE', 'LINKED', 'KILLED')),
  intent text,
  risk text,
  intent_confidence double precision,
  related_decision_id text,
  intent_extracted_at timestamptz,
  intelligence_error text,
  urgency text,
  affected_systems jsonb,
  op_classification text,
  source_subtype text,
  external_id text,
  ingest_meta jsonb
);

CREATE INDEX IF NOT EXISTS idx_signals_user_state ON external_signals(user_id, state);
CREATE INDEX IF NOT EXISTS idx_signals_org_state ON external_signals(org_id, state);
CREATE INDEX IF NOT EXISTS idx_signals_external_id ON external_signals(source, external_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial PRIMARY KEY,
  action text NOT NULL,
  reason text NOT NULL,
  affected_entity_id text,
  timestamp timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id text NOT NULL DEFAULT 'default',
  role text NOT NULL,
  content text NOT NULL,
  timestamp timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_user_session_time ON messages(user_id, session_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS learning_log (
  id text PRIMARY KEY,
  user_id text NOT NULL DEFAULT 'system',
  decision_id text,
  mistake_analysis text,
  weight_shifts jsonb,
  surfaced_insight text,
  timestamp timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  user_agent text,
  ip inet,
  device_fingerprint text,
  suspicious_reason text,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_last_seen ON user_sessions(user_id, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS api_access_tokens (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  token_prefix text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

CREATE TABLE IF NOT EXISTS security_events (
  id text PRIMARY KEY,
  event_type text NOT NULL,
  severity text NOT NULL CHECK(severity IN ('info', 'warning', 'critical')),
  user_id text,
  auth_kind text,
  ip inet,
  user_agent text,
  request_id text,
  metadata_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_events_user_time ON security_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_type_time ON security_events(event_type, created_at DESC);

CREATE TABLE IF NOT EXISTS ledger_events (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  aggregate_type text NOT NULL CHECK(aggregate_type IN ('decision', 'execution', 'signal', 'capability')),
  aggregate_id text NOT NULL,
  event_type text NOT NULL,
  payload_json jsonb NOT NULL,
  actor_type text NOT NULL CHECK(actor_type IN ('user', 'agent', 'service', 'system')),
  actor_id text NOT NULL,
  policy_version text NOT NULL,
  capability_id text,
  causation_event_id text,
  correlation_id text NOT NULL,
  previous_hash text,
  event_hash text NOT NULL UNIQUE,
  signature text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ledger_events_aggregate ON ledger_events(org_id, aggregate_type, aggregate_id, created_at);

CREATE TABLE IF NOT EXISTS oauth_login_states (
  state text PRIMARY KEY,
  provider text NOT NULL CHECK(provider IN ('google', 'github')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oauth_identities (
  provider text NOT NULL,
  provider_user_id text NOT NULL,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(provider, provider_user_id)
);

CREATE TABLE IF NOT EXISTS oauth_pending_states (
  state text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_otp_challenges (
  challenge_token text PRIMARY KEY,
  username citext NOT NULL,
  purpose text NOT NULL CHECK(purpose IN ('signup', 'login')),
  user_id text,
  code_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS login_totp_challenges (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS signal_embeddings (
  signal_id text PRIMARY KEY REFERENCES external_signals(id) ON DELETE CASCADE,
  model text NOT NULL,
  dims integer NOT NULL,
  embedding bytea NOT NULL,
  content_hash text NOT NULL,
  embedded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ingestion_dedupe (
  provider text NOT NULL,
  external_id text NOT NULL,
  user_id text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(provider, external_id, user_id)
);

CREATE TABLE IF NOT EXISTS meeting_ingestions (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  title text,
  source text,
  signal_ids jsonb NOT NULL DEFAULT '[]',
  decision_ids jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- PostgreSQL full-text indexes replacing SQLite FTS5 virtual tables.
CREATE INDEX IF NOT EXISTS idx_signals_fts ON external_signals
  USING gin (to_tsvector('english', coalesce(content, '') || ' ' || coalesce(owner, '') || ' ' || coalesce(source, '')));
CREATE INDEX IF NOT EXISTS idx_decisions_fts ON decision_ledger
  USING gin (to_tsvector('english', coalesce(vow, '') || ' ' || coalesce(decision_reasoning, '')));
CREATE INDEX IF NOT EXISTS idx_executions_fts ON execution_ledger
  USING gin (to_tsvector('english', coalesce(owner, '') || ' ' || coalesce(success_condition, '') || ' ' || coalesce(failure_condition, '')));

-- RLS is enabled in permissive compatibility mode until the runtime sets app.current_org_id.
ALTER TABLE decision_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE execution_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS decision_ledger_org_isolation ON decision_ledger;
CREATE POLICY decision_ledger_org_isolation ON decision_ledger
  USING (
    current_setting('app.current_org_id', true) IS NULL
    OR current_setting('app.current_org_id', true) = ''
    OR org_id = current_setting('app.current_org_id', true)
    OR user_id = current_setting('app.current_org_id', true)
  );

DROP POLICY IF EXISTS external_signals_org_isolation ON external_signals;
CREATE POLICY external_signals_org_isolation ON external_signals
  USING (
    current_setting('app.current_org_id', true) IS NULL
    OR current_setting('app.current_org_id', true) = ''
    OR org_id = current_setting('app.current_org_id', true)
    OR user_id = current_setting('app.current_org_id', true)
  );

DROP POLICY IF EXISTS execution_ledger_org_isolation ON execution_ledger;
CREATE POLICY execution_ledger_org_isolation ON execution_ledger
  USING (
    current_setting('app.current_org_id', true) IS NULL
    OR current_setting('app.current_org_id', true) = ''
    OR EXISTS (
      SELECT 1 FROM decision_ledger d
      WHERE d.id = execution_ledger.decision_id
        AND (d.org_id = current_setting('app.current_org_id', true)
          OR d.user_id = current_setting('app.current_org_id', true))
    )
  );

DROP POLICY IF EXISTS ledger_events_org_isolation ON ledger_events;
CREATE POLICY ledger_events_org_isolation ON ledger_events
  USING (
    current_setting('app.current_org_id', true) IS NULL
    OR current_setting('app.current_org_id', true) = ''
    OR org_id = current_setting('app.current_org_id', true)
  );
