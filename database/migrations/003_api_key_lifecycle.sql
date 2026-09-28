ALTER TABLE api_keys
  ADD COLUMN name text NOT NULL DEFAULT 'API key',
  ADD COLUMN allowed_packages text[] NOT NULL DEFAULT '{}',
  ADD COLUMN last_used_at timestamptz,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN created_by_admin_user_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  ADD COLUMN revoked_by_admin_user_id uuid REFERENCES admin_users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX api_keys_key_prefix_unique_idx
  ON api_keys (key_prefix);

CREATE INDEX api_keys_project_created_idx
  ON api_keys (project_id, created_at DESC);

CREATE INDEX api_keys_active_prefix_idx
  ON api_keys (key_prefix)
  WHERE revoked_at IS NULL;

ALTER TABLE api_keys
  ADD CONSTRAINT api_keys_scopes_nonempty
  CHECK (cardinality(scopes) > 0);
