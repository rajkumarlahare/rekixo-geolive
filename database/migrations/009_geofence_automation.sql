-- P4B geofence automation, alert rules and durable webhook delivery.

ALTER TABLE project_limits
  ADD COLUMN geofence_event_retention_days integer NOT NULL DEFAULT 90
    CHECK (geofence_event_retention_days BETWEEN 7 AND 3650),
  ADD COLUMN webhook_delivery_retention_days integer NOT NULL DEFAULT 30
    CHECK (webhook_delivery_retention_days BETWEEN 7 AND 3650);

ALTER TABLE retention_runs
  ADD COLUMN geofence_events_deleted bigint NOT NULL DEFAULT 0,
  ADD COLUMN webhook_deliveries_deleted bigint NOT NULL DEFAULT 0;

ALTER TABLE realtime_events
  DROP CONSTRAINT realtime_events_event_type_check,
  ADD CONSTRAINT realtime_events_event_type_check
    CHECK (
      event_type IN (
        'location',
        'geofence.enter',
        'geofence.exit',
        'geofence.dwell'
      )
    );

CREATE TABLE geofences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL
    REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','paused','deleted')),
  shape_type text NOT NULL
    CHECK (shape_type IN ('circle','polygon')),
  center geography(Point, 4326),
  radius_m double precision,
  polygon geometry(Polygon, 4326),
  dwell_seconds integer NOT NULL DEFAULT 300
    CHECK (dwell_seconds BETWEEN 0 AND 604800),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_admin_user_id uuid
    REFERENCES admin_users(id) ON DELETE SET NULL,
  updated_by_admin_user_id uuid
    REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (project_id, id),
  CHECK (
    (
      shape_type = 'circle'
      AND center IS NOT NULL
      AND radius_m IS NOT NULL
      AND radius_m BETWEEN 10 AND 1000000
      AND polygon IS NULL
    )
    OR
    (
      shape_type = 'polygon'
      AND polygon IS NOT NULL
      AND ST_SRID(polygon) = 4326
      AND ST_IsValid(polygon)
      AND center IS NULL
      AND radius_m IS NULL
    )
  )
);

CREATE INDEX geofences_project_status_idx
  ON geofences (project_id, status, updated_at DESC);
CREATE INDEX geofences_center_gist_idx
  ON geofences USING gist (center)
  WHERE shape_type = 'circle';
CREATE INDEX geofences_polygon_gist_idx
  ON geofences USING gist (polygon)
  WHERE shape_type = 'polygon';

CREATE TABLE webhook_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL
    REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  url text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','paused','deleted')),
  signing_key_id text NOT NULL,
  secret_generation integer NOT NULL DEFAULT 1
    CHECK (secret_generation BETWEEN 1 AND 1000000000),
  created_by_admin_user_id uuid
    REFERENCES admin_users(id) ON DELETE SET NULL,
  updated_by_admin_user_id uuid
    REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (project_id, id)
);

CREATE INDEX webhook_endpoints_project_status_idx
  ON webhook_endpoints (project_id, status, created_at DESC);

CREATE TABLE alert_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL
    REFERENCES projects(id) ON DELETE CASCADE,
  geofence_id uuid,
  webhook_endpoint_id uuid NOT NULL,
  name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  event_types text[] NOT NULL DEFAULT ARRAY['enter','exit','dwell']::text[],
  created_by_admin_user_id uuid
    REFERENCES admin_users(id) ON DELETE SET NULL,
  updated_by_admin_user_id uuid
    REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (project_id, id),
  FOREIGN KEY (project_id, geofence_id)
    REFERENCES geofences(project_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY (project_id, webhook_endpoint_id)
    REFERENCES webhook_endpoints(project_id, id)
    ON DELETE CASCADE,
  CHECK (
    cardinality(event_types) BETWEEN 1 AND 3
    AND event_types <@ ARRAY['enter','exit','dwell']::text[]
  )
);

CREATE INDEX alert_rules_project_enabled_idx
  ON alert_rules (project_id, enabled, created_at DESC);
CREATE INDEX alert_rules_geofence_idx
  ON alert_rules (geofence_id)
  WHERE geofence_id IS NOT NULL;

CREATE TABLE geofence_user_state (
  project_id uuid NOT NULL,
  geofence_id uuid NOT NULL,
  external_user_id text NOT NULL,
  is_inside boolean NOT NULL DEFAULT false,
  entered_at timestamptz,
  dwell_due_at timestamptz,
  dwell_fired_at timestamptz,
  last_seen_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (
    project_id,
    geofence_id,
    external_user_id
  ),
  FOREIGN KEY (project_id, geofence_id)
    REFERENCES geofences(project_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY (project_id, external_user_id)
    REFERENCES users(project_id, external_user_id)
    ON DELETE CASCADE
);

CREATE INDEX geofence_user_state_due_idx
  ON geofence_user_state (dwell_due_at)
  WHERE is_inside
    AND dwell_due_at IS NOT NULL
    AND dwell_fired_at IS NULL;

CREATE TABLE geofence_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  project_id uuid NOT NULL
    REFERENCES projects(id) ON DELETE CASCADE,
  geofence_id uuid NOT NULL,
  external_user_id text NOT NULL,
  source_history_id bigint
    REFERENCES location_history(id) ON DELETE SET NULL,
  event_type text NOT NULL
    CHECK (event_type IN ('enter','exit','dwell')),
  occurred_at timestamptz NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, id),
  FOREIGN KEY (project_id, geofence_id)
    REFERENCES geofences(project_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY (project_id, external_user_id)
    REFERENCES users(project_id, external_user_id)
    ON DELETE CASCADE
);

CREATE INDEX geofence_events_project_time_idx
  ON geofence_events (
    project_id,
    occurred_at DESC,
    id DESC
  );
CREATE INDEX geofence_events_project_user_time_idx
  ON geofence_events (
    project_id,
    external_user_id,
    occurred_at DESC,
    id DESC
  );
CREATE INDEX geofence_events_geofence_time_idx
  ON geofence_events (
    geofence_id,
    occurred_at DESC,
    id DESC
  );

CREATE TABLE webhook_deliveries (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  delivery_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  project_id uuid NOT NULL
    REFERENCES projects(id) ON DELETE CASCADE,
  webhook_endpoint_id uuid NOT NULL,
  alert_rule_id uuid NOT NULL,
  geofence_event_id bigint NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','retry','delivered','dead')),
  attempt_count integer NOT NULL DEFAULT 0
    CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  response_status integer,
  response_body_excerpt text,
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (alert_rule_id, geofence_event_id),
  FOREIGN KEY (project_id, webhook_endpoint_id)
    REFERENCES webhook_endpoints(project_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY (project_id, alert_rule_id)
    REFERENCES alert_rules(project_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY (project_id, geofence_event_id)
    REFERENCES geofence_events(project_id, id)
    ON DELETE CASCADE
);

CREATE INDEX webhook_deliveries_due_idx
  ON webhook_deliveries (
    next_attempt_at,
    id
  )
  WHERE status IN ('pending','retry');

CREATE INDEX webhook_deliveries_project_time_idx
  ON webhook_deliveries (
    project_id,
    created_at DESC,
    id DESC
  );

CREATE TABLE webhook_delivery_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  webhook_delivery_id bigint NOT NULL
    REFERENCES webhook_deliveries(id) ON DELETE CASCADE,
  attempt_number integer NOT NULL,
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  response_status integer,
  latency_ms integer NOT NULL DEFAULT 0
    CHECK (latency_ms >= 0),
  error_text text,
  UNIQUE (webhook_delivery_id, attempt_number)
);

CREATE INDEX webhook_delivery_attempts_delivery_idx
  ON webhook_delivery_attempts (
    webhook_delivery_id,
    attempt_number DESC
  );

UPDATE commercial_plans
SET features =
  COALESCE(features, '{}'::jsonb) ||
  '{"geofences":true,"webhooks":true}'::jsonb,
    updated_at = now()
WHERE code = 'legacy';
