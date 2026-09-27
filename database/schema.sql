-- Rekixo GeoLive production-direction schema.
-- PostgreSQL + PostGIS. Apply only through an immutable migration system in production.

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
  UNIQUE (account_id, slug)
);

CREATE TABLE api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key_prefix text NOT NULL,
  secret_hash text NOT NULL UNIQUE,
  scopes text[] NOT NULL,
  allowed_origins text[] NOT NULL DEFAULT '{}',
  revoked_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

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
