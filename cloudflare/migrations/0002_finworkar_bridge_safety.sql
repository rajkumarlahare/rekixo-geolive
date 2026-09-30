-- Durable retry and privacy safety for server-to-server production integrations.

CREATE TABLE IF NOT EXISTS location_ingest_idempotency (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  external_user_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  event_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  PRIMARY KEY(project_id, idempotency_key),
  FOREIGN KEY(project_id, external_user_id)
    REFERENCES users(project_id, external_user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS location_ingest_idempotency_user_idx
  ON location_ingest_idempotency(project_id, external_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS user_privacy_tombstones (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_hash TEXT NOT NULL,
  deleted_at TEXT NOT NULL,
  PRIMARY KEY(project_id, user_hash)
);

CREATE INDEX IF NOT EXISTS user_privacy_tombstones_time_idx
  ON user_privacy_tombstones(project_id, deleted_at DESC);
