-- Rekixo GeoLive schema snapshot after P1C.
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
