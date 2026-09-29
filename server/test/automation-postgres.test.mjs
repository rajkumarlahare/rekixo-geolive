import test from "node:test";
import assert from "node:assert/strict";
import {
  createPgPoolFromEnv
} from "../src/database.mjs";
import {
  PostgresGeoLiveStore
} from "../src/store-postgres.mjs";
import {
  PostgresAutomationStore
} from "../src/automation-store-postgres.mjs";

const enabled = Boolean(
  process.env.DATABASE_URL
);

test("P4B Postgres geofence enter/dwell/exit schedules idempotent webhook deliveries", {
  skip: enabled
    ? false
    : "DATABASE_URL not configured"
}, async () => {
  const pool =
    createPgPoolFromEnv();
  const geo =
    new PostgresGeoLiveStore({
      pool
    });
  const automation =
    new PostgresAutomationStore({
      pool,
      webhookSigningKeys: [
        {
          kid: "ci",
          secret:
            Buffer.alloc(
              32,
              9
            )
        }
      ]
    });

  assert.equal(
    await geo.ready(),
    true
  );
  assert.equal(
    await automation.ready(),
    true
  );

  const stamp = Date.now();
  const account =
    await pool.query(
      "INSERT INTO accounts (name) VALUES ($1) RETURNING id",
      [`P4B CI ${stamp}`]
    );
  const accountId =
    account.rows[0].id;
  const projectRow =
    await pool.query(
      `INSERT INTO projects (
        account_id,
        slug,
        name
      ) VALUES ($1,$2,$3)
      RETURNING id`,
      [
        accountId,
        `p4b-ci-${stamp}`,
        "P4B CI"
      ]
    );
  const otherRow =
    await pool.query(
      `INSERT INTO projects (
        account_id,
        slug,
        name
      ) VALUES ($1,$2,$3)
      RETURNING id`,
      [
        accountId,
        `p4b-other-${stamp}`,
        "P4B Other"
      ]
    );

  const project = {
    id: projectRow.rows[0].id,
    accountId
  };

  try {
    await assert.rejects(
      () =>
        automation.createGeofence({
          project,
          actorUserId: null,
          input: {
            name: "Invalid bow tie",
            status: "active",
            shapeType: "polygon",
            points: [
              [81.62, 21.24],
              [81.64, 21.26],
              [81.62, 21.26],
              [81.64, 21.24],
              [81.62, 21.24]
            ],
            dwellSeconds: 60,
            metadata: {}
          }
        }),
      (error) =>
        error.code ===
          "invalid_geofence_polygon" &&
        error.status === 400
    );

    const geofence =
      await automation
        .createGeofence({
          project,
          actorUserId: null,
          input: {
            name: "CI Circle",
            status: "active",
            shapeType: "circle",
            latitude: 21.25,
            longitude: 81.63,
            radiusM: 500,
            dwellSeconds: 1,
            metadata: {}
          }
        });

    const createdEndpoint =
      await automation
        .createWebhookEndpoint({
          project,
          actorUserId: null,
          input: {
            name: "CI Hook",
            url:
              "https://example.com/geolive",
            status: "active"
          }
        });
    assert.match(
      createdEndpoint.secret,
      /^rgl_whsec_/
    );

    const alertRule =
      await automation
        .createAlertRule({
          project,
          actorUserId: null,
          input: {
            name: "CI Rule",
            geofenceId:
              geofence.id,
            webhookEndpointId:
              createdEndpoint
                .endpoint.id,
            eventTypes: [
              "enter",
              "dwell",
              "exit"
            ],
            enabled: true
          }
        });

    const insideAt =
      new Date(
        Date.now() - 3000
      ).toISOString();
    const enter =
      await geo.upsertLocation(
        project.id,
        {
          userId: "user-1",
          latitude: 21.25,
          longitude: 81.63,
          receivedAt:
            insideAt,
          capturedAt:
            insideAt
        }
      );

    assert.deepEqual(
      enter._automationEvents.map(
        (event) =>
          event.eventType
      ),
      ["enter"]
    );

    const dwell =
      await automation
        .emitDueDwellEvents({
          limit: 10
        });
    assert.equal(
      dwell.length,
      1
    );
    assert.equal(
      dwell[0].eventType,
      "dwell"
    );

    const outsideAt =
      new Date().toISOString();
    const exit =
      await geo.upsertLocation(
        project.id,
        {
          userId: "user-1",
          latitude: 21.35,
          longitude: 81.75,
          receivedAt:
            outsideAt,
          capturedAt:
            outsideAt
        }
      );
    assert.deepEqual(
      exit._automationEvents.map(
        (event) =>
          event.eventType
      ),
      ["exit"]
    );

    const events =
      await automation.listEvents(
        project.id,
        { limit: 20 }
      );
    assert.deepEqual(
      events.events
        .map(
          (event) =>
            event.eventType
        )
        .sort(),
      [
        "dwell",
        "enter",
        "exit"
      ]
    );

    const enterEvents =
      await automation.listEvents(
        project.id,
        {
          limit: 20,
          eventType: "enter",
          geofenceId:
            geofence.id,
          userId: "user-1"
        }
      );
    assert.equal(
      enterEvents.events.length,
      1
    );
    assert.equal(
      enterEvents.events[0]
        .eventType,
      "enter"
    );

    const realtime =
      await pool.query(
        `SELECT id, event_type
        FROM realtime_events
        WHERE project_id = $1
        ORDER BY id ASC`,
        [project.id]
      );
    assert.deepEqual(
      realtime.rows
        .map((row) => row.event_type)
        .filter((type) =>
          type.startsWith(
            "geofence."
          )
        ),
      [
        "geofence.enter",
        "geofence.dwell",
        "geofence.exit"
      ]
    );

    const deliveries =
      await automation
        .listDeliveries(
          project.id,
          { limit: 20 }
        );
    assert.equal(
      deliveries.deliveries.length,
      3
    );
    assert.equal(
      deliveries.deliveries.every(
        (item) =>
          item.status ===
          "pending"
      ),
      true
    );

    const enterDeliveries =
      await automation
        .listDeliveries(
          project.id,
          {
            limit: 20,
            status: "pending",
            endpointId:
              createdEndpoint
                .endpoint.id,
            eventType: "enter"
          }
        );
    assert.equal(
      enterDeliveries
        .deliveries.length,
      1
    );
    assert.equal(
      enterDeliveries
        .deliveries[0]
        .eventType,
      "enter"
    );
    assert.equal(
      enterDeliveries
        .deliveries[0]
        .geofenceName,
      "CI Circle"
    );

    const observedDelivery =
      enterDeliveries
        .deliveries[0];
    await pool.query(
      `INSERT INTO webhook_delivery_attempts (
        webhook_delivery_id,
        attempt_number,
        started_at,
        completed_at,
        response_status,
        latency_ms,
        error_text
      ) VALUES (
        $1,1,now(),now(),503,42,
        'http_503'
      )`,
      [observedDelivery.id]
    );

    const details =
      await automation
        .getDeliveryDetails(
          project.id,
          observedDelivery
            .deliveryId
        );
    assert.equal(
      details.delivery.eventType,
      "enter"
    );
    assert.equal(
      details.delivery.endpointName,
      "CI Hook"
    );
    assert.equal(
      details.attempts.length,
      1
    );
    assert.deepEqual(
      {
        attemptNumber:
          details.attempts[0]
            .attemptNumber,
        responseStatus:
          details.attempts[0]
            .responseStatus,
        latencyMs:
          details.attempts[0]
            .latencyMs,
        errorText:
          details.attempts[0]
            .errorText
      },
      {
        attemptNumber: 1,
        responseStatus: 503,
        latencyMs: 42,
        errorText: "http_503"
      }
    );
    await assert.rejects(
      () =>
        automation
          .getDeliveryDetails(
            otherRow.rows[0].id,
            observedDelivery
              .deliveryId
          ),
      (error) =>
        error.code ===
          "webhook_delivery_not_found" &&
        error.status === 404
    );

    await automation
      .updateAlertRule({
        project,
        actorUserId: null,
        alertRuleId:
          alertRule.id,
        patch: {
          enabled: false
        }
      });

    const disabledDeliveries =
      await automation
        .listDeliveries(
          project.id,
          { limit: 20 }
        );
    assert.equal(
      disabledDeliveries.deliveries
        .every(
          (item) =>
            item.status === "dead" &&
            item.lastError ===
              "alert_rule_disabled"
        ),
      true
    );

    const retryId =
      disabledDeliveries
        .deliveries[0]
        .deliveryId;
    await pool.query(
      `UPDATE webhook_deliveries
      SET response_status = 503,
          response_body_excerpt =
            'stale',
          delivered_at = now()
      WHERE delivery_id = $1`,
      [retryId]
    );
    await automation
      .retryWebhookDelivery({
        project,
        actorUserId: null,
        deliveryId: retryId
      });
    const retried =
      (
        await automation
          .listDeliveries(
            project.id,
            { limit: 20 }
          )
      ).deliveries.find(
        (item) =>
          item.deliveryId ===
          retryId
      );
    assert.equal(
      retried.status,
      "retry"
    );
    assert.equal(
      retried.attemptCount,
      0
    );
    assert.equal(
      retried.responseStatus,
      null
    );
    assert.equal(
      retried.responseBodyExcerpt,
      null
    );
    assert.equal(
      retried.lastError,
      null
    );
    assert.equal(
      retried.deliveredAt,
      null
    );

    const reenterAt =
      new Date().toISOString();
    await geo.upsertLocation(
      project.id,
      {
        userId: "user-1",
        latitude: 21.25,
        longitude: 81.63,
        receivedAt: reenterAt,
        capturedAt: reenterAt
      }
    );
    assert.equal(
      Number(
        (
          await pool.query(
            `SELECT count(*)::int AS count
            FROM geofence_user_state
            WHERE project_id = $1
              AND geofence_id = $2
              AND external_user_id = 'user-1'`,
            [
              project.id,
              geofence.id
            ]
          )
        ).rows[0].count
      ),
      1
    );

    await automation
      .updateGeofence({
        project,
        actorUserId: null,
        geofenceId:
          geofence.id,
        patch: {
          status: "paused"
        }
      });
    assert.equal(
      Number(
        (
          await pool.query(
            `SELECT count(*)::int AS count
            FROM geofence_user_state
            WHERE project_id = $1
              AND geofence_id = $2
              AND external_user_id = 'user-1'`,
            [
              project.id,
              geofence.id
            ]
          )
        ).rows[0].count
      ),
      0
    );

    await automation
      .updateGeofence({
        project,
        actorUserId: null,
        geofenceId:
          geofence.id,
        patch: {
          status: "active"
        }
      });
    const baseline =
      await geo.upsertLocation(
        project.id,
        {
          userId: "user-1",
          latitude: 21.25,
          longitude: 81.63,
          receivedAt:
            new Date().toISOString()
        }
      );
    assert.deepEqual(
      baseline._automationEvents
        .map(
          (event) =>
            event.eventType
        ),
      ["enter"]
    );

    await geo.upsertLocation(
      otherRow.rows[0].id,
      {
        userId: "user-1",
        latitude: 21.25,
        longitude: 81.63,
        receivedAt:
          outsideAt
      }
    );
    const otherEvents =
      await automation.listEvents(
        otherRow.rows[0].id,
        { limit: 20 }
      );
    assert.equal(
      otherEvents.events.length,
      0
    );
  } finally {
    await pool.query(
      "DELETE FROM accounts WHERE id = $1",
      [accountId]
    );
    await pool.end();
  }
});
