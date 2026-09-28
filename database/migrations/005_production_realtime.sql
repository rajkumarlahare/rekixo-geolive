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

ALTER TABLE project_limits
  ADD COLUMN realtime_event_retention_hours integer NOT NULL DEFAULT 24
    CHECK (realtime_event_retention_hours BETWEEN 1 AND 720);

ALTER TABLE retention_runs
  ADD COLUMN realtime_events_deleted bigint NOT NULL DEFAULT 0;
