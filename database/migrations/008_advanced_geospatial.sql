-- geolive:nontransactional
-- P4A advanced geospatial read foundation.
-- Each split statement is retry-safe. The indexes are dropped by
-- their new P4A-specific names before concurrent recreation so an
-- interrupted CREATE INDEX CONCURRENTLY cannot leave an invalid
-- index that a later IF NOT EXISTS would silently preserve.

DROP INDEX CONCURRENTLY IF EXISTS
  location_history_project_time_id_idx;

-- geolive:split
CREATE INDEX CONCURRENTLY
  location_history_project_time_id_idx
ON location_history (
  project_id,
  received_at DESC,
  id DESC
);

-- geolive:split
DROP INDEX CONCURRENTLY IF EXISTS
  location_history_project_user_time_id_idx;

-- geolive:split
CREATE INDEX CONCURRENTLY
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
