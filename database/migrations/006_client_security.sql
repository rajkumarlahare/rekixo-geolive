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

ALTER TABLE retention_runs
  ADD COLUMN client_exchange_nonces_deleted bigint NOT NULL DEFAULT 0,
  ADD COLUMN client_request_nonces_deleted bigint NOT NULL DEFAULT 0;
