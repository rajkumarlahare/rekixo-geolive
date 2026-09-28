CREATE TABLE project_limits (
  project_id uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  ingest_requests_per_minute integer NOT NULL DEFAULT 600
    CHECK (ingest_requests_per_minute BETWEEN 1 AND 1000000),
  read_requests_per_minute integer NOT NULL DEFAULT 300
    CHECK (read_requests_per_minute BETWEEN 1 AND 1000000),
  daily_ingest_quota bigint NOT NULL DEFAULT 1000000
    CHECK (daily_ingest_quota BETWEEN 1 AND 1000000000),
  max_live_users integer NOT NULL DEFAULT 100000
    CHECK (max_live_users BETWEEN 1 AND 10000000),
  history_retention_days integer NOT NULL DEFAULT 30
    CHECK (history_retention_days BETWEEN 1 AND 3650),
  security_event_retention_days integer NOT NULL DEFAULT 90
    CHECK (security_event_retention_days BETWEEN 7 AND 3650),
  metrics_retention_days integer NOT NULL DEFAULT 90
    CHECK (metrics_retention_days BETWEEN 7 AND 3650),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE api_rate_limit_counters (
  bucket_key text NOT NULL,
  window_start timestamptz NOT NULL,
  window_seconds integer NOT NULL CHECK (window_seconds BETWEEN 1 AND 3600),
  request_count bigint NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (bucket_key, window_start)
);

CREATE INDEX api_rate_limit_expiry_idx
  ON api_rate_limit_counters (expires_at);

CREATE TABLE project_usage_daily (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  usage_date date NOT NULL,
  ingest_count bigint NOT NULL DEFAULT 0 CHECK (ingest_count >= 0),
  read_count bigint NOT NULL DEFAULT 0 CHECK (read_count >= 0),
  PRIMARY KEY (project_id, usage_date)
);

CREATE TABLE api_usage_hourly (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key_ref text NOT NULL,
  bucket_hour timestamptz NOT NULL,
  route text NOT NULL,
  status_class smallint NOT NULL CHECK (status_class BETWEEN 1 AND 5),
  request_count bigint NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  error_count bigint NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  latency_ms_sum bigint NOT NULL DEFAULT 0 CHECK (latency_ms_sum >= 0),
  latency_ms_max integer NOT NULL DEFAULT 0 CHECK (latency_ms_max >= 0),
  PRIMARY KEY (project_id, key_ref, bucket_hour, route, status_class)
);

CREATE INDEX api_usage_hourly_project_time_idx
  ON api_usage_hourly (project_id, bucket_hour DESC);

CREATE TABLE security_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  key_ref text,
  event_type text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('info','warning','critical')),
  source_hash text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX security_events_project_time_idx
  ON security_events (project_id, created_at DESC, id DESC);
CREATE INDEX security_events_type_time_idx
  ON security_events (event_type, created_at DESC);

CREATE TABLE retention_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  history_deleted bigint NOT NULL DEFAULT 0,
  security_events_deleted bigint NOT NULL DEFAULT 0,
  metrics_deleted bigint NOT NULL DEFAULT 0,
  rate_counters_deleted bigint NOT NULL DEFAULT 0,
  sessions_deleted bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running','success','failed')),
  error_code text
);

CREATE INDEX retention_runs_started_idx
  ON retention_runs (started_at DESC);
