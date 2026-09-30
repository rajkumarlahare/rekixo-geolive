import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Cloudflare quick setup creates an isolated project and scoped credentials in one admin action", async () => {
  const [admin, migration] = await Promise.all([
    readFile("cloudflare/src/admin.mjs", "utf8"),
    readFile("cloudflare/migrations/0003_integration_onboarding.sql", "utf8")
  ]);

  assert.match(
    migration,
    /CREATE TABLE IF NOT EXISTS project_integrations/
  );
  assert.match(
    migration,
    /platform IN \('backend','website','android','ios','flutter','react-native'\)/
  );
  assert.match(
    migration,
    /credential_mode IN \('server_key','server_relay','client_token'\)/
  );

  assert.match(
    admin,
    /path === "\/v1\/admin\/integration-setups"/
  );
  assert.match(
    admin,
    /async function createIntegrationSetup/
  );
  assert.match(
    admin,
    /env\.DB\.batch\(\[/
  );
  assert.match(
    admin,
    /"Production ingest"/
  );
  assert.match(
    admin,
    /JSON\.stringify\(\["location:write"\]\)/
  );
  assert.match(
    admin,
    /"Privacy delete"/
  );
  assert.match(
    admin,
    /JSON\.stringify\(\["privacy:delete"\]\)/
  );
  assert.match(
    admin,
    /sha256Secret\(ingestSecret\)/
  );
  assert.match(
    admin,
    /sha256Secret\(privacySecret\)/
  );
  assert.match(
    admin,
    /clientDirectAvailable: false/
  );
  assert.match(
    admin,
    /resource === "integration-setup"/
  );
});

test("dashboard quick setup keeps production secrets server-side for web and mobile clients", async () => {
  const [html, app, css] = await Promise.all([
    readFile("dashboard/index.html", "utf8"),
    readFile("dashboard/app.js", "utf8"),
    readFile("dashboard/styles.css", "utf8")
  ]);

  for (const id of [
    "setupModal",
    "setupForm",
    "setupAccount",
    "setupName",
    "setupSlug",
    "setupPlatform",
    "setupOrigin",
    "setupAppId",
    "setupIngestSecret",
    "setupPrivacySecret",
    "setupCode",
    "checkSetupConnection",
    "finishSetup"
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }

  for (const platform of [
    "backend",
    "website",
    "android",
    "ios",
    "flutter",
    "react-native"
  ]) {
    assert.match(
      html,
      new RegExp(`value="${platform}"`)
    );
  }

  assert.match(
    app,
    /\/v1\/admin\/integration-setups/
  );
  assert.match(
    app,
    /openSetupWizard/
  );
  assert.match(
    app,
    /Website \+ backend relay/
  );
  assert.match(
    app,
    /Mobile \+ backend relay/
  );
  assert.match(
    app,
    /process\.env\.GEOLIVE_API_KEY/
  );
  assert.match(
    app,
    /Do not embed it in an APK or app bundle/
  );
  assert.match(
    css,
    /\.setup-modal-card/
  );
  assert.match(
    css,
    /\.setup-secret-grid/
  );
});

test("quick setup never depends on client-token support that Cloudflare has not shipped yet", async () => {
  const [admin, app] = await Promise.all([
    readFile("cloudflare/src/admin.mjs", "utf8"),
    readFile("dashboard/app.js", "utf8")
  ]);

  assert.match(
    admin,
    /setupCredentialMode\(platform\)/
  );
  assert.match(
    admin,
    /platform === "backend"[\s\S]*"server_key"[\s\S]*"server_relay"/
  );
  assert.match(
    app,
    /Direct short-lived client tokens can replace the relay when the Cloudflare P2 runtime is enabled/
  );
});
