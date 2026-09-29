import test from "node:test";
import assert from "node:assert/strict";
import {
  parseAutomationListQuery,
  validateAlertRule,
  validateGeofence,
  validateWebhookEndpoint
} from "../src/automation-validation.mjs";

test("P4B validates circle and polygon geofences", () => {
  const circle = validateGeofence({
    name: "Warehouse",
    shapeType: "circle",
    latitude: 21.25,
    longitude: 81.63,
    radiusM: 250,
    dwellSeconds: 120
  });
  assert.equal(circle.shapeType, "circle");
  assert.equal(circle.radiusM, 250);

  const polygon = validateGeofence({
    name: "Site",
    shapeType: "polygon",
    points: [
      [81.62, 21.24],
      [81.64, 21.24],
      [81.64, 21.26],
      [81.62, 21.26]
    ]
  });
  assert.deepEqual(
    polygon.points[0],
    polygon.points.at(-1)
  );

  assert.throws(
    () =>
      validateGeofence({
        name: "Bad",
        shapeType: "circle",
        latitude: 91,
        longitude: 0,
        radiusM: 100
      }),
    (error) =>
      error.code ===
      "invalid_geofence_latitude"
  );
});

test("P4B validates webhook URL policy and alert events", () => {
  assert.equal(
    validateWebhookEndpoint(
      {
        name: "Production",
        url: "https://hooks.example.com/geolive"
      },
      { isProduction: true }
    ).url,
    "https://hooks.example.com/geolive"
  );

  assert.throws(
    () =>
      validateWebhookEndpoint(
        {
          name: "Insecure",
          url: "http://hooks.example.com"
        },
        { isProduction: true }
      ),
    (error) =>
      error.code ===
      "invalid_webhook_url"
  );

  const rule = validateAlertRule({
    name: "Notify",
    webhookEndpointId:
      "11111111-1111-4111-8111-111111111111",
    eventTypes: [
      "enter",
      "exit",
      "enter"
    ]
  });
  assert.deepEqual(
    rule.eventTypes,
    ["enter", "exit"]
  );

  assert.throws(
    () =>
      validateAlertRule({
        name: "Bad rule",
        webhookEndpointId:
          "11111111-1111-4111-8111-111111111111",
        eventTypes: ["teleport"]
      }),
    (error) =>
      error.code ===
      "invalid_alert_event_types"
  );
});

test("P4E automation history filters validate and normalize", () => {
  const query =
    parseAutomationListQuery(
      new URLSearchParams({
        limit: "50",
        cursor: "opaque",
        eventType: "enter",
        status: "dead",
        geofenceId:
          "11111111-1111-4111-8111-111111111111",
        endpointId:
          "22222222-2222-4222-8222-222222222222",
        userId: "worker-42"
      })
    );

  assert.deepEqual(query, {
    limit: 50,
    cursor: "opaque",
    eventType: "enter",
    status: "dead",
    geofenceId:
      "11111111-1111-4111-8111-111111111111",
    endpointId:
      "22222222-2222-4222-8222-222222222222",
    userId: "worker-42"
  });
});

test("P4E automation history filters reject invalid values", () => {
  assert.throws(
    () =>
      parseAutomationListQuery(
        new URLSearchParams({
          eventType: "unknown"
        })
      ),
    (error) =>
      error.code ===
        "invalid_automation_event_type"
  );

  assert.throws(
    () =>
      parseAutomationListQuery(
        new URLSearchParams({
          status: "failed"
        })
      ),
    (error) =>
      error.code ===
        "invalid_webhook_delivery_status"
  );

  assert.throws(
    () =>
      parseAutomationListQuery(
        new URLSearchParams({
          endpointId: "not-a-uuid"
        })
      ),
    (error) =>
      error.code ===
        "invalid_webhook_endpoint_id"
  );
});

