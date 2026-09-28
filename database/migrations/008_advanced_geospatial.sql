-- geolive:nontransactional
-- P4A advanced geospatial read foundation.
-- Every split statement is idempotent because this migration runs
-- outside a transaction to build large history indexes concurrently.

CREATE INDEX CONCURRENTLY IF NOT EXISTS
  location_history_project_time_id_idx
ON location_history (
  project_id,
  received_at DESC,
  id DESC
);

-- geolive:split
CREATE INDEX CONCURRENTLY IF NOT EXISTS
  location_history_project_user_time_id_idx
ON location_history (
  project_id,
  external_user_id,
  received_at DESC,
  id DESC
);

-- geolive:split
UPDATE commercial_plans
SET features =
  COALESCE(features, '{}'::jsonb) ||
  '{"movementHistory":true,"heatmap":true}'::jsonb,
    updated_at = now()
WHERE code = 'legacy';
