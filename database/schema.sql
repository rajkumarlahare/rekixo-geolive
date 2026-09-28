-- Rekixo GeoLive schema snapshot after P3 commercial layer.
-- Production deployments MUST use database/migrations in order.
-- This file is documentation/reference and is not the migration runner input.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  slug text NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','suspended','deleted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, slug)
);

CREATE TABLE admin_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','disabled')),
  failed_login_count integer NOT NULL DEFAULT 0
    CHECK (failed_login_count >= 0),
  locked_until timestamptz,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX admin_users_email_lower_idx
  ON admin_users (lower(email));

CREATE TABLE account_memberships (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  admin_user_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner','admin','viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, admin_user_id)
);

CREATE INDEX account_memberships_user_idx
  ON account_memberships (admin_user_id, account_id);

CREATE TABLE admin_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  csrf_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);

CREATE INDEX admin_sessions_user_active_idx
  ON admin_sessions (admin_user_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'API key',
  key_prefix text NOT NULL,
  secret_hash text NOT NULL UNIQUE,
  scopes text[] NOT NULL CHECK (cardinality(scopes) > 0),
  allowed_origins text[] NOT NULL DEFAULT '{}',
  allowed_packages text[] NOT NULL DEFAULT '{}',
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_admin_user_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  revoked_by_admin_user_id uuid REFERENCES admin_users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX api_keys_key_prefix_unique_idx
  ON api_keys (key_prefix);
CREATE INDEX api_keys_project_created_idx
  ON api_keys (project_id, created_at DESC);
CREATE INDEX api_keys_active_prefix_idx
  ON api_keys (key_prefix)
  WHERE revoked_at IS NULL;

CREATE TABLE users (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  external_user_id text NOT NULL,
  display_name text,
  email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, external_user_id)
);

CREATE TABLE live_user_state (
  project_id uuid NOT NULL,
  external_user_id text NOT NULL,
  location geography(Point, 4326) NOT NULL,
  latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  accuracy_m double precision,
  altitude_m double precision,
  heading_deg double precision,
  speed_mps double precision,
  captured_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  country text,
  state text,
  city text,
  device jsonb,
  metadata jsonb,
  PRIMARY KEY (project_id, external_user_id),
  FOREIGN KEY (project_id, external_user_id)
    REFERENCES users(project_id, external_user_id)
    ON DELETE CASCADE
);

CREATE INDEX live_user_state_geo_idx
  ON live_user_state USING gist (location);
CREATE INDEX live_user_state_project_seen_idx
  ON live_user_state (project_id, received_at DESC);

CREATE TABLE location_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id uuid NOT NULL,
  external_user_id text NOT NULL,
  location geography(Point, 4326) NOT NULL,
  latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  accuracy_m double precision,
  altitude_m double precision,
  heading_deg double precision,
  speed_mps double precision,
  captured_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  country text,
  state text,
  city text,
  device jsonb,
  metadata jsonb,
  FOREIGN KEY (project_id, external_user_id)
    REFERENCES users(project_id, external_user_id)
    ON DELETE CASCADE
);

CREATE INDEX location_history_project_user_time_idx
  ON location_history (project_id, external_user_id, received_at DESC);
CREATE INDEX location_history_geo_idx
  ON location_history USING gist (location);
CREATE INDEX location_history_received_idx
  ON location_history (received_at);

CREATE TABLE audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  admin_user_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_account_time_idx
  ON audit_log (account_id, created_at DESC);
CREATE INDEX audit_log_project_time_idx
  ON audit_log (project_id, created_at DESC);


-- P1D security and operations

CREATE TABLE project_limits (
  project_id uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  ingest_requests_per_minute integer NOT NULL DEFAULT 600,
  read_requests_per_minute integer NOT NULL DEFAULT 300,
  daily_ingest_quota bigint NOT NULL DEFAULT 1000000,
  max_live_users integer NOT NULL DEFAULT 100000,
  history_retention_days integer NOT NULL DEFAULT 30,
  security_event_retention_days integer NOT NULL DEFAULT 90,
  metrics_retention_days integer NOT NULL DEFAULT 90,
  realtime_event_retention_hours integer NOT NULL DEFAULT 24,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE api_rate_limit_counters (
  bucket_key text NOT NULL,
  window_start timestamptz NOT NULL,
  window_seconds integer NOT NULL,
  request_count bigint NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (bucket_key, window_start)
);

CREATE INDEX api_rate_limit_expiry_idx
  ON api_rate_limit_counters (expires_at);

CREATE TABLE project_usage_daily (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  usage_date date NOT NULL,
  ingest_count bigint NOT NULL DEFAULT 0,
  read_count bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, usage_date)
);

CREATE TABLE api_usage_hourly (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key_ref text NOT NULL,
  bucket_hour timestamptz NOT NULL,
  route text NOT NULL,
  status_class smallint NOT NULL,
  request_count bigint NOT NULL DEFAULT 0,
  error_count bigint NOT NULL DEFAULT 0,
  latency_ms_sum bigint NOT NULL DEFAULT 0,
  latency_ms_max integer NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, key_ref, bucket_hour, route, status_class)
);

CREATE INDEX api_usage_hourly_project_time_idx
  ON api_usage_hourly (project_id, bucket_hour DESC);

CREATE TABLE security_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  key_ref text,
  event_type text NOT NULL,
  severity text NOT NULL,
  source_hash text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX security_events_project_time_idx
  ON security_events (project_id, created_at DESC, id DESC);

CREATE TABLE retention_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  history_deleted bigint NOT NULL DEFAULT 0,
  security_events_deleted bigint NOT NULL DEFAULT 0,
  metrics_deleted bigint NOT NULL DEFAULT 0,
  realtime_events_deleted bigint NOT NULL DEFAULT 0,
  client_exchange_nonces_deleted bigint NOT NULL DEFAULT 0,
  client_request_nonces_deleted bigint NOT NULL DEFAULT 0,
  rate_counters_deleted bigint NOT NULL DEFAULT 0,
  sessions_deleted bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'running',
  error_code text
);


CREATE TABLE realtime_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('location')),
  external_user_id text,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX realtime_events_project_sequence_idx
  ON realtime_events (project_id, id ASC);

CREATE INDEX realtime_events_project_time_idx
  ON realtime_events (project_id, created_at DESC);


-- P2 client security

CREATE TABLE project_client_security (
  project_id uuid PRIMARY KEY
    REFERENCES projects(id) ON DELETE CASCADE,
  client_token_ttl_seconds integer NOT NULL DEFAULT 300
    CHECK (client_token_ttl_seconds BETWEEN 60 AND 3600),
  request_max_age_seconds integer NOT NULL DEFAULT 120
    CHECK (request_max_age_seconds BETWEEN 30 AND 600),
  token_exchange_requests_per_minute integer NOT NULL DEFAULT 120
    CHECK (token_exchange_requests_per_minute BETWEEN 1 AND 100000),
  require_request_proof boolean NOT NULL DEFAULT true,
  android_attestation_mode text NOT NULL DEFAULT 'off'
    CHECK (android_attestation_mode IN ('off','optional','required')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE client_exchange_nonces (
  project_id uuid NOT NULL
    REFERENCES projects(id) ON DELETE CASCADE,
  nonce_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, nonce_hash)
);

CREATE INDEX client_exchange_nonces_expiry_idx
  ON client_exchange_nonces (expires_at);

CREATE TABLE client_request_nonces (
  project_id uuid NOT NULL
    REFERENCES projects(id) ON DELETE CASCADE,
  token_jti uuid NOT NULL,
  nonce_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, token_jti, nonce_hash)
);

CREATE INDEX client_request_nonces_expiry_idx
  ON client_request_nonces (expires_at);


-- P3 commercial layer

CREATE TABLE commercial_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE
    CHECK (code ~ '^[a-z0-9][a-z0-9_-]{1,62}$'),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','archived')),
  currency text NOT NULL DEFAULT 'USD'
    CHECK (currency ~ '^[A-Z]{3}$'),
  monthly_price_minor bigint NOT NULL DEFAULT 0
    CHECK (monthly_price_minor >= 0),
  included_ingest bigint NOT NULL DEFAULT 0
    CHECK (included_ingest >= 0),
  included_read bigint NOT NULL DEFAULT 0
    CHECK (included_read >= 0),
  included_tracked_users integer NOT NULL DEFAULT 0
    CHECK (included_tracked_users >= 0),
  max_projects integer NOT NULL DEFAULT 1
    CHECK (max_projects BETWEEN 1 AND 1000000),
  overage_ingest_per_1000_minor bigint NOT NULL DEFAULT 0
    CHECK (overage_ingest_per_1000_minor >= 0),
  overage_read_per_1000_minor bigint NOT NULL DEFAULT 0
    CHECK (overage_read_per_1000_minor >= 0),
  overage_tracked_user_minor bigint NOT NULL DEFAULT 0
    CHECK (overage_tracked_user_minor >= 0),
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_admin_user_id uuid
    REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO commercial_plans (
  code,
  name,
  status,
  currency,
  monthly_price_minor,
  included_ingest,
  included_read,
  included_tracked_users,
  max_projects,
  features
) VALUES (
  'legacy',
  'Legacy',
  'active',
  'USD',
  0,
  1000000000000,
  1000000000000,
  100000000,
  100000,
  '{"realtime":true,"clientTokens":true,"androidAttestation":true,"prioritySupport":true}'::jsonb
)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE account_subscriptions (
  account_id uuid PRIMARY KEY
    REFERENCES accounts(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL
    REFERENCES commercial_plans(id),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('trialing','active','past_due','canceled')),
  provider text NOT NULL DEFAULT 'manual',
  provider_customer_ref text,
  provider_subscription_ref text,
  period_start date NOT NULL DEFAULT date_trunc('month', CURRENT_DATE)::date,
  period_end date NOT NULL DEFAULT (date_trunc('month', CURRENT_DATE) + interval '1 month')::date,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  trial_ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end > period_start)
);

INSERT INTO account_subscriptions (
  account_id,
  plan_id,
  status
)
SELECT
  a.id,
  p.id,
  'active'
FROM accounts a
JOIN commercial_plans p ON p.code = 'legacy'
ON CONFLICT (account_id) DO NOTHING;

CREATE OR REPLACE FUNCTION geolive_assign_legacy_subscription()
RETURNS trigger
LANGUAGE plpgsql
AS $geolive$
BEGIN
  INSERT INTO account_subscriptions (
    account_id,
    plan_id,
    status
  )
  SELECT
    NEW.id,
    p.id,
    'active'
  FROM commercial_plans p
  WHERE p.code = 'legacy'
  ON CONFLICT (account_id) DO NOTHING;

  RETURN NEW;
END;
$geolive$;

CREATE TRIGGER accounts_assign_legacy_subscription
AFTER INSERT ON accounts
FOR EACH ROW
EXECUTE FUNCTION geolive_assign_legacy_subscription();

CREATE TABLE account_entitlement_overrides (
  account_id uuid NOT NULL
    REFERENCES accounts(id) ON DELETE CASCADE,
  entitlement_key text NOT NULL,
  value jsonb NOT NULL,
  updated_by_admin_user_id uuid
    REFERENCES admin_users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, entitlement_key)
);

CREATE TABLE billing_tracked_users_daily (
  project_id uuid NOT NULL
    REFERENCES projects(id) ON DELETE CASCADE,
  usage_date date NOT NULL,
  external_user_id text NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (
    project_id,
    usage_date,
    external_user_id
  )
);

CREATE INDEX billing_tracked_users_usage_date_idx
  ON billing_tracked_users_daily (usage_date);

INSERT INTO billing_tracked_users_daily (
  project_id,
  usage_date,
  external_user_id,
  first_seen_at
)
SELECT
  project_id,
  received_at::date,
  external_user_id,
  min(received_at)
FROM location_history
WHERE received_at >= date_trunc('month', CURRENT_DATE)
GROUP BY
  project_id,
  received_at::date,
  external_user_id
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION geolive_meter_tracked_user()
RETURNS trigger
LANGUAGE plpgsql
AS $billing$
BEGIN
  INSERT INTO billing_tracked_users_daily (
    project_id,
    usage_date,
    external_user_id,
    first_seen_at
  ) VALUES (
    NEW.project_id,
    NEW.received_at::date,
    NEW.external_user_id,
    NEW.received_at
  )
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$billing$;

CREATE TRIGGER location_history_meter_tracked_user
AFTER INSERT ON location_history
FOR EACH ROW
EXECUTE FUNCTION geolive_meter_tracked_user();

ALTER TABLE retention_runs
  ADD COLUMN billing_tracked_users_deleted bigint
    NOT NULL DEFAULT 0;

CREATE TABLE billing_usage_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL
    REFERENCES accounts(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_version text NOT NULL DEFAULT 'v1',
  finalized boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, period_start, period_end),
  CHECK (period_end > period_start)
);

CREATE INDEX billing_usage_account_period_idx
  ON billing_usage_periods (
    account_id,
    period_start DESC
  );

CREATE TABLE billing_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text NOT NULL UNIQUE,
  account_id uuid NOT NULL
    REFERENCES accounts(id) ON DELETE CASCADE,
  plan_id uuid
    REFERENCES commercial_plans(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','open','paid','void','uncollectible')),
  currency text NOT NULL
    CHECK (currency ~ '^[A-Z]{3}$'),
  period_start date NOT NULL,
  period_end date NOT NULL,
  subtotal_minor bigint NOT NULL DEFAULT 0
    CHECK (subtotal_minor >= 0),
  tax_minor bigint NOT NULL DEFAULT 0
    CHECK (tax_minor >= 0),
  total_minor bigint NOT NULL DEFAULT 0
    CHECK (total_minor >= 0),
  due_at timestamptz,
  issued_at timestamptz,
  paid_at timestamptz,
  provider_invoice_ref text,
  notes text,
  generated_by_admin_user_id uuid
    REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end > period_start)
);

CREATE UNIQUE INDEX billing_invoices_account_period_unique_idx
  ON billing_invoices (
    account_id,
    period_start,
    period_end
  )
  WHERE status <> 'void';

CREATE INDEX billing_invoices_account_created_idx
  ON billing_invoices (account_id, created_at DESC);

CREATE TABLE billing_invoice_items (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invoice_id uuid NOT NULL
    REFERENCES billing_invoices(id) ON DELETE CASCADE,
  item_type text NOT NULL
    CHECK (item_type IN ('base','overage','adjustment')),
  description text NOT NULL,
  metric_key text,
  quantity bigint NOT NULL DEFAULT 1,
  unit_amount_minor bigint NOT NULL DEFAULT 0,
  amount_minor bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX billing_invoice_items_invoice_idx
  ON billing_invoice_items (invoice_id, id);

CREATE TABLE platform_roles (
  admin_user_id uuid PRIMARY KEY
    REFERENCES admin_users(id) ON DELETE CASCADE,
  role text NOT NULL
    CHECK (role IN ('superadmin','billing','support','viewer')),
  granted_by_admin_user_id uuid
    REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE support_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL
    REFERENCES accounts(id) ON DELETE CASCADE,
  project_id uuid
    REFERENCES projects(id) ON DELETE SET NULL,
  created_by_admin_user_id uuid
    REFERENCES admin_users(id) ON DELETE SET NULL,
  assigned_platform_user_id uuid
    REFERENCES admin_users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','pending_customer','pending_internal','resolved','closed')),
  priority text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low','normal','high','urgent')),
  category text NOT NULL DEFAULT 'technical'
    CHECK (category IN ('billing','technical','account','security','other')),
  subject text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX support_cases_account_created_idx
  ON support_cases (account_id, created_at DESC);

CREATE INDEX support_cases_status_priority_idx
  ON support_cases (status, priority, updated_at DESC);

CREATE TABLE support_case_messages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_id uuid NOT NULL
    REFERENCES support_cases(id) ON DELETE CASCADE,
  author_admin_user_id uuid
    REFERENCES admin_users(id) ON DELETE SET NULL,
  author_type text NOT NULL
    CHECK (author_type IN ('tenant','platform','system')),
  body text NOT NULL,
  internal boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX support_case_messages_case_idx
  ON support_case_messages (case_id, id);

