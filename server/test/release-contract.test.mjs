import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("release metadata and canonical schema stay in sync", async () => {
  const [
    packageJson,
    openapi,
    server,
    schema
  ] = await Promise.all([
    readFile("package.json", "utf8"),
    readFile("openapi.yaml", "utf8"),
    readFile("server/src/server.mjs", "utf8"),
    readFile("database/schema.sql", "utf8")
  ]);

  const pkg = JSON.parse(packageJson);
  assert.equal(pkg.version, "0.17.0");
  assert.match(openapi, /version:\s*0\.17\.0/);
  assert.match(server, /SERVICE_VERSION\s*=\s*"0\.17\.0"/);

  assert.match(schema, /CREATE TABLE geofences\s*\(/);
  assert.match(schema, /CREATE TABLE webhook_endpoints\s*\(/);
  assert.match(schema, /CREATE TABLE alert_rules\s*\(/);
  assert.match(schema, /CREATE TABLE webhook_deliveries\s*\(/);
  assert.match(
    schema,
    /geofence_events_project_type_time_idx/
  );
  assert.match(
    schema,
    /webhook_deliveries_project_status_time_idx/
  );
});
