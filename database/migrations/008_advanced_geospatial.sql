-- P4A advanced geospatial read foundation.

CREATE INDEX IF NOT EXISTS
  location_history_project_time_id_idx
ON location_history (
  project_id,
  received_at DESC,
  id DESC
);

CREATE INDEX IF NOT EXISTS
  location_history_project_user_time_id_idx
ON location_history (
  project_id,
  external_user_id,
  received_at DESC,
  id DESC
);

UPDATE commercial_plans
SET features =
  COALESCE(features, '{}'::jsonb) ||
  '{"movementHistory":true,"heatmap":true}'::jsonb,
    updated_at = now()
WHERE code = 'legacy';
