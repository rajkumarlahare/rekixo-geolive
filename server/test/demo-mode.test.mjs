import test from "node:test";
import assert from "node:assert/strict";

import {
  demoApi,
  demoModeEnabled
} from "../../dashboard/demo-mode.js";

test("demo mode activates only explicitly or on Pages hosts", () => {
  assert.equal(
    demoModeEnabled({ search: "?demo=1", hostname: "localhost" }),
    true
  );
  assert.equal(
    demoModeEnabled({ search: "", hostname: "rekixo-geolive-demo.pages.dev" }),
    true
  );
  assert.equal(
    demoModeEnabled({ search: "", hostname: "geolive.rekixo.com" }),
    false
  );
  assert.equal(
    demoModeEnabled(
      { search: "", hostname: "demo.rekixo.com" },
      { demoMode: true }
    ),
    true
  );
  assert.equal(
    demoModeEnabled({ search: "?demo=1", hostname: "geolive.rekixo.com" }),
    false
  );
});

test("demo session is read-only and project scoped", async () => {
  const session = await demoApi("/v1/admin/me");
  assert.equal(session.user.displayName, "Public Demo Viewer");
  assert.equal(session.platformRole, "viewer");
  assert.equal(session.accounts[0].role, "viewer");
  assert.ok(session.projects.length >= 2);
  assert.ok(session.projects.every((project) => project.role === "viewer"));
});

test("demo map data supports summary, clusters and search", async () => {
  const summary = await demoApi(
    "/v1/admin/projects/demo-project-global/summary"
  );
  assert.ok(summary.total > 500);
  assert.ok(summary.online > 0);

  const clusters = await demoApi(
    "/v1/admin/projects/demo-project-global/clusters?gridDegrees=10"
  );
  assert.ok(clusters.clusters.length >= 10);
  assert.ok(clusters.clusters.every((item) => item.count > 0));

  const users = await demoApi(
    "/v1/admin/projects/demo-project-global/users?search=aarav&limit=20"
  );
  assert.ok(users.users.length > 0);
  assert.ok(
    users.users.every((user) =>
      user.name.toLowerCase().includes("aarav")
    )
  );
});

test("demo exposes analytics and commercial read models", async () => {
  const heatmap = await demoApi(
    "/v1/admin/projects/demo-project-global/heatmap?gridDegrees=6"
  );
  assert.ok(heatmap.cells.length > 0);

  const history = await demoApi(
    "/v1/admin/projects/demo-project-global/history?userId=demo-user-0001"
  );
  assert.equal(history.points.length, 48);

  const commercial = await demoApi(
    "/v1/admin/accounts/demo-account/commercial"
  );
  assert.equal(commercial.subscription.status, "active");
  assert.equal(commercial.effective.webhooks, true);
  assert.ok(commercial.invoices.length >= 1);
});

test("demo rejects all state-changing requests", async () => {
  await assert.rejects(
    demoApi(
      "/v1/admin/projects/demo-project-global/geofences",
      { method: "POST", body: "{}" }
    ),
    (error) =>
      error.code === "demo_read_only" &&
      error.status === 403
  );
});
