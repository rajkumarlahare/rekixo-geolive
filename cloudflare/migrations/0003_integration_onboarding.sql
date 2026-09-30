-- Productized integration onboarding metadata.
-- Secrets are never stored here; API key material remains hash-only in api_keys.

CREATE TABLE IF NOT EXISTS project_integrations (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (
    platform IN ('backend','website','android','ios','flutter','react-native')
  ),
  credential_mode TEXT NOT NULL CHECK (
    credential_mode IN ('server_key','server_relay','client_token')
  ),
  app_identifier TEXT,
  origin TEXT,
  status TEXT NOT NULL DEFAULT 'configured' CHECK (
    status IN ('configured','active','paused')
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS project_integrations_platform_idx
  ON project_integrations(platform, credential_mode, updated_at DESC);
