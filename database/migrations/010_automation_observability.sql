-- geolive:nontransactional
-- P4E automation observability query indexes.
-- Concurrent recreation keeps high-volume event/delivery writes
-- available during production rollout and is retry-safe after an
-- interrupted concurrent index build.

DROP INDEX CONCURRENTLY IF EXISTS
  geofence_events_project_type_time_idx;

-- geolive:split
CREATE INDEX CONCURRENTLY
  geofence_events_project_type_time_idx
ON geofence_events (
  project_id,
  event_type,
  occurred_at DESC,
  id DESC
);

-- geolive:split
DROP INDEX CONCURRENTLY IF EXISTS
  geofence_events_project_geofence_time_idx;

-- geolive:split
CREATE INDEX CONCURRENTLY
  geofence_events_project_geofence_time_idx
ON geofence_events (
  project_id,
  geofence_id,
  occurred_at DESC,
  id DESC
);

-- geolive:split
DROP INDEX CONCURRENTLY IF EXISTS
  geofence_events_project_user_time_idx;

-- geolive:split
CREATE INDEX CONCURRENTLY
  geofence_events_project_user_time_idx
ON geofence_events (
  project_id,
  external_user_id,
  occurred_at DESC,
  id DESC
);

-- geolive:split
DROP INDEX CONCURRENTLY IF EXISTS
  webhook_deliveries_project_status_time_idx;

-- geolive:split
CREATE INDEX CONCURRENTLY
  webhook_deliveries_project_status_time_idx
ON webhook_deliveries (
  project_id,
  status,
  created_at DESC,
  id DESC
);

-- geolive:split
DROP INDEX CONCURRENTLY IF EXISTS
  webhook_deliveries_project_endpoint_time_idx;

-- geolive:split
CREATE INDEX CONCURRENTLY
  webhook_deliveries_project_endpoint_time_idx
ON webhook_deliveries (
  project_id,
  webhook_endpoint_id,
  created_at DESC,
  id DESC
);
