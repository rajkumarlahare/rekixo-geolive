import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { loadConfig } from "../src/config.mjs";
import { createPgPoolFromEnv } from "../src/database.mjs";
import { PostgresGeoLiveStore } from "../src/store-postgres.mjs";
import { PostgresAdminStore } from "../src/admin-store-postgres.mjs";
import { PostgresApiKeyStore } from "../src/api-key-store-postgres.mjs";
import { PostgresClientSecurityStore } from "../src/client-security-store-postgres.mjs";
import { ClientTokenService } from "../src/client-token.mjs";
import { PlayIntegrityVerifier } from "../src/play-integrity.mjs";
import { requestProofCanonical } from "../src/request-proof.mjs";
import { hashPassword } from "../src/passwords.mjs";
import { createGeoLiveServer } from "../src/server.mjs";

const enabled = Boolean(process.env.DATABASE_URL);

function proofSignature({
  privateKey,
  body,
  timestamp,
  nonce
}) {
  const canonical = requestProofCanonical({
    method: "POST",
    path: "/v1/locations",
    timestamp,
    nonce,
    body
  });
  return crypto.sign(
    "sha256",
    Buffer.from(canonical),
    privateKey
  ).toString("base64url");
}

test("P2 token exchange, proof replay guard and issuer revocation work end-to-end", {
  skip: enabled ? false : "DATABASE_URL not configured"
}, async () => {
  const signingSecret = crypto.randomBytes(32);
  const config = loadConfig({
    NODE_ENV: "test",
    GEOLIVE_PERSISTENCE: "postgres",
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_SSL: "disable",
    GEOLIVE_CLIENT_TOKEN_KEYS_JSON:
      JSON.stringify([{
        kid: "ci-current",
        secret:
          signingSecret.toString("base64url")
      }])
  });

  const pool = createPgPoolFromEnv();
  const geoStore =
    new PostgresGeoLiveStore({ pool });
  const adminStore =
    new PostgresAdminStore({ pool });
  const keyStore =
    new PostgresApiKeyStore({ pool });
  const clientSecurityStore =
    new PostgresClientSecurityStore({ pool });
  const clientTokenService =
    new ClientTokenService({
      signingKeys:
        config.clientTokens.signingKeys
    });
  const playIntegrityVerifier =
    new PlayIntegrityVerifier({ apps: [] });

  const owner =
    await adminStore.createInitialOwner({
      email:
        `p2-flow-${Date.now()}@example.com`,
      displayName: "P2 Flow Owner",
      passwordHash:
        await hashPassword(
          "GeoLive-P2-Flow-Password-2026"
        ),
      accountName: "P2 Flow Account"
    });

  let server;
  try {
    const project =
      await adminStore.createProject(
        owner.userId,
        {
          accountId: owner.accountId,
          slug: "p2-flow-project",
          name: "P2 Flow Project"
        }
      );

    const packageId = "com.rekixo.p2ci";
    const issuer =
      await keyStore.createKey({
        project,
        actorUserId: owner.userId,
        name: "P2 CI issuer",
        scopes: ["tokens:issue"],
        allowedOrigins: [],
        allowedPackages: [packageId],
        expiresAt:
          new Date(
            Date.now() + 3600000
          ).toISOString()
      });

    const {
      publicKey,
      privateKey
    } = crypto.generateKeyPairSync("ec", {
      namedCurve: "prime256v1"
    });
    const proofPublicKey =
      publicKey.export({
        type: "spki",
        format: "der"
      }).toString("base64url");

    server = createGeoLiveServer({
      config,
      store: geoStore,
      adminStore,
      keyStore,
      clientSecurityStore,
      clientTokenService,
      playIntegrityVerifier
    });
    await new Promise((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    const base =
      `http://127.0.0.1:${address.port}`;

    const exchange = await fetch(
      `${base}/v1/client-tokens/exchange`,
      {
        method: "POST",
        headers: {
          authorization:
            `Bearer ${issuer.secret}`,
          "content-type":
            "application/json"
        },
        body: JSON.stringify({
          userId: "p2-user",
          platform: "android",
          packageId,
          clientNonce:
            crypto.randomBytes(18)
              .toString("base64url"),
          clientTimestampMs:
            Date.now(),
          proofPublicKey
        })
      }
    );
    assert.equal(exchange.status, 201);
    const exchanged =
      await exchange.json();
    assert.match(
      exchanged.token,
      /^rgl_client_/
    );
    assert.equal(
      exchanged.proofRequired,
      true
    );

    const body = JSON.stringify({
      userId: "p2-user",
      latitude: 21.2514,
      longitude: 81.6296,
      device: {
        platform: "android",
        appVersion: "ci"
      }
    });

    async function send({
      nonce,
      timestamp
    }) {
      const signature =
        proofSignature({
          privateKey,
          body,
          timestamp,
          nonce
        });
      return fetch(
        `${base}/v1/locations`,
        {
          method: "POST",
          headers: {
            authorization:
              `Bearer ${exchanged.token}`,
            "content-type":
              "application/json",
            "x-geolive-package":
              packageId,
            "x-geolive-request-timestamp":
              timestamp,
            "x-geolive-request-nonce":
              nonce,
            "x-geolive-request-signature":
              signature
          },
          body
        }
      );
    }

    const firstNonce =
      crypto.randomBytes(18)
        .toString("base64url");
    const firstTimestamp =
      String(Date.now());
    const first = await send({
      nonce: firstNonce,
      timestamp: firstTimestamp
    });
    assert.equal(first.status, 202);

    const replay = await send({
      nonce: firstNonce,
      timestamp: firstTimestamp
    });
    assert.equal(replay.status, 409);
    assert.equal(
      (await replay.json()).error,
      "client_request_replayed"
    );

    const second = await send({
      nonce:
        crypto.randomBytes(18)
          .toString("base64url"),
      timestamp: String(Date.now())
    });
    assert.equal(second.status, 202);

    await keyStore.revokeKey({
      project,
      actorUserId: owner.userId,
      keyId: issuer.key.id
    });

    const afterRevoke = await send({
      nonce:
        crypto.randomBytes(18)
          .toString("base64url"),
      timestamp: String(Date.now())
    });
    assert.equal(
      afterRevoke.status,
      401
    );
    assert.equal(
      (await afterRevoke.json()).error,
      "client_token_issuer_inactive"
    );
  } finally {
    if (server) {
      await new Promise((resolve) =>
        server.close(resolve)
      );
    }
    await pool.query(
      "DELETE FROM admin_users WHERE id = $1",
      [owner.userId]
    );
    await pool.query(
      "DELETE FROM accounts WHERE id = $1",
      [owner.accountId]
    );
    await pool.end();
  }
});
