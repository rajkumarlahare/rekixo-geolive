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
