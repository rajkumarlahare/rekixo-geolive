-- GeoLive Cloudflare D1 core schema.
-- Cloudflare-native durable schema for the production Worker.

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','deleted')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS account_memberships (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  admin_user_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','viewer')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_id, admin_user_id)
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id TEXT PRIMARY KEY,
  admin_user_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS admin_sessions_user_expiry_idx
  ON admin_sessions(admin_user_id, expires_at);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','deleted')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(account_id, slug)
);
CREATE INDEX IF NOT EXISTS projects_account_status_idx
  ON projects(account_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS project_limits (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  ingest_requests_per_minute INTEGER NOT NULL DEFAULT 6000,
  read_requests_per_minute INTEGER NOT NULL DEFAULT 3000,
  daily_ingest_quota INTEGER NOT NULL DEFAULT 10000000,
  max_live_users INTEGER NOT NULL DEFAULT 100000,
  history_retention_days INTEGER NOT NULL DEFAULT 30,
  security_event_retention_days INTEGER NOT NULL DEFAULT 30,
  metrics_retention_days INTEGER NOT NULL DEFAULT 90,
  realtime_retention_hours INTEGER NOT NULL DEFAULT 24,
  geofence_event_retention_days INTEGER NOT NULL DEFAULT 90,
  webhook_delivery_retention_days INTEGER NOT NULL DEFAULT 30,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS client_security_policy (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  client_token_ttl_seconds INTEGER NOT NULL DEFAULT 300,
  request_max_age_seconds INTEGER NOT NULL DEFAULT 120,
  token_exchange_requests_per_minute INTEGER NOT NULL DEFAULT 120,
  require_request_proof INTEGER NOT NULL DEFAULT 1,
  android_attestation_mode TEXT NOT NULL DEFAULT 'off'
    CHECK (android_attestation_mode IN ('off','optional','required')),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  secret_hash TEXT NOT NULL UNIQUE,
  scopes_json TEXT NOT NULL,
  allowed_origins_json TEXT NOT NULL DEFAULT '[]',
  allowed_packages_json TEXT NOT NULL DEFAULT '[]',
  expires_at TEXT,
  revoked_at TEXT,
  created_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS api_keys_project_active_idx
  ON api_keys(project_id, revoked_at, expires_at);

CREATE TABLE IF NOT EXISTS users (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  external_user_id TEXT NOT NULL,
  display_name TEXT,
  email TEXT,
  first_seen_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(project_id, external_user_id)
);

CREATE TABLE IF NOT EXISTS live_user_state (
  project_id TEXT NOT NULL,
  external_user_id TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  accuracy_m REAL,
  altitude_m REAL,
  heading_deg REAL,
  speed_mps REAL,
  captured_at TEXT,
  received_at TEXT NOT NULL,
  country TEXT,
  state TEXT,
  city TEXT,
  device_json TEXT,
  metadata_json TEXT,
  PRIMARY KEY(project_id, external_user_id),
  FOREIGN KEY(project_id, external_user_id)
    REFERENCES users(project_id, external_user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS live_state_project_time_idx
  ON live_user_state(project_id, received_at DESC, external_user_id);
CREATE INDEX IF NOT EXISTS live_state_project_country_idx
  ON live_user_state(project_id, country, received_at DESC);
CREATE INDEX IF NOT EXISTS live_state_project_state_idx
  ON live_user_state(project_id, state, received_at DESC);
CREATE INDEX IF NOT EXISTS live_state_project_city_idx
  ON live_user_state(project_id, city, received_at DESC);

CREATE TABLE IF NOT EXISTS location_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  external_user_id TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  accuracy_m REAL,
  altitude_m REAL,
  heading_deg REAL,
  speed_mps REAL,
  captured_at TEXT,
  received_at TEXT NOT NULL,
  country TEXT,
  state TEXT,
  city TEXT,
  device_json TEXT,
  metadata_json TEXT,
  FOREIGN KEY(project_id, external_user_id)
    REFERENCES users(project_id, external_user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS history_project_time_idx
  ON location_history(project_id, received_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS history_project_user_time_idx
  ON location_history(project_id, external_user_id, received_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS realtime_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  external_user_id TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS realtime_project_sequence_idx
  ON realtime_events(project_id, id);
CREATE INDEX IF NOT EXISTS realtime_project_time_idx
  ON realtime_events(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS geofences (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','deleted')),
  shape_type TEXT NOT NULL CHECK (shape_type IN ('circle','polygon')),
  center_lat REAL,
  center_lng REAL,
  radius_m REAL,
  polygon_json TEXT,
  dwell_seconds INTEGER NOT NULL DEFAULT 300,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  updated_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  CHECK (
    (shape_type='circle' AND center_lat IS NOT NULL AND center_lng IS NOT NULL AND radius_m BETWEEN 10 AND 1000000 AND polygon_json IS NULL)
    OR
    (shape_type='polygon' AND polygon_json IS NOT NULL AND center_lat IS NULL AND center_lng IS NULL AND radius_m IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS geofences_project_status_idx
  ON geofences(project_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS geofence_user_state (
  project_id TEXT NOT NULL,
  geofence_id TEXT NOT NULL REFERENCES geofences(id) ON DELETE CASCADE,
  external_user_id TEXT NOT NULL,
  is_inside INTEGER NOT NULL DEFAULT 0,
  entered_at TEXT,
  dwell_due_at TEXT,
  dwell_fired_at TEXT,
  last_seen_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(project_id, geofence_id, external_user_id)
);
CREATE INDEX IF NOT EXISTS geofence_user_state_due_idx
  ON geofence_user_state(dwell_due_at, project_id)
  WHERE is_inside=1 AND dwell_due_at IS NOT NULL AND dwell_fired_at IS NULL;

CREATE TABLE IF NOT EXISTS geofence_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  geofence_id TEXT NOT NULL REFERENCES geofences(id) ON DELETE CASCADE,
  external_user_id TEXT NOT NULL,
  source_history_id INTEGER REFERENCES location_history(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('enter','exit','dwell')),
  occurred_at TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS geofence_events_project_time_idx
  ON geofence_events(project_id, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS geofence_events_project_type_time_idx
  ON geofence_events(project_id, event_type, occurred_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','deleted')),
  secret_generation INTEGER NOT NULL DEFAULT 1,
  created_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  updated_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS webhook_endpoints_project_status_idx
  ON webhook_endpoints(project_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS alert_rules (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  geofence_id TEXT REFERENCES geofences(id) ON DELETE CASCADE,
  webhook_endpoint_id TEXT NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  event_types_json TEXT NOT NULL DEFAULT '["enter","exit","dwell"]',
  created_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  updated_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS alert_rules_project_enabled_idx
  ON alert_rules(project_id, enabled, created_at DESC);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  delivery_id TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  webhook_endpoint_id TEXT NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  alert_rule_id TEXT NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  geofence_event_id INTEGER NOT NULL REFERENCES geofence_events(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','retry','delivered','dead')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  response_status INTEGER,
  response_body_excerpt TEXT,
  last_error TEXT,
  delivered_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(alert_rule_id, geofence_event_id)
);
CREATE INDEX IF NOT EXISTS webhook_deliveries_due_idx
  ON webhook_deliveries(status, next_attempt_at, id);
CREATE INDEX IF NOT EXISTS webhook_deliveries_project_status_idx
  ON webhook_deliveries(project_id, status, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS webhook_delivery_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  webhook_delivery_id INTEGER NOT NULL REFERENCES webhook_deliveries(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  response_status INTEGER,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  error_text TEXT,
  UNIQUE(webhook_delivery_id, attempt_number)
);

CREATE TABLE IF NOT EXISTS rate_limit_windows (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  bucket TEXT NOT NULL CHECK (bucket IN ('ingest','read','token_exchange')),
  window_start TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(project_id, bucket, window_start)
);
CREATE INDEX IF NOT EXISTS rate_limit_windows_time_idx
  ON rate_limit_windows(window_start);

CREATE TABLE IF NOT EXISTS usage_daily (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  usage_date TEXT NOT NULL,
  location_writes INTEGER NOT NULL DEFAULT 0,
  api_reads INTEGER NOT NULL DEFAULT 0,
  realtime_events INTEGER NOT NULL DEFAULT 0,
  webhook_attempts INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(project_id, usage_date)
);

CREATE TABLE IF NOT EXISTS security_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key_ref TEXT,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning'
    CHECK (severity IN ('info','warning','critical')),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS security_events_project_time_idx
  ON security_events(project_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_log_project_time_idx
  ON audit_log(project_id, created_at DESC, id DESC);
