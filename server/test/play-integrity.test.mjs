import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { PlayIntegrityVerifier } from "../src/play-integrity.mjs";
import { attestationExchangeHash } from "../src/request-proof.mjs";

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    }
  };
}

test("P2 Play Integrity verifier validates request binding and verdicts", async () => {
  const { privateKey } =
    crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048
    });
  const privatePem =
    privateKey.export({
      type: "pkcs8",
      format: "pem"
    });

  const now = Date.parse(
    "2026-09-28T00:00:00Z"
  );
  const request = {
    projectId: "11111111-1111-4111-8111-111111111111",
    userId: "attested-user",
    packageId: "com.rekixo.attested",
    clientNonce: "abcdefghijklmnop",
    clientTimestampMs: now,
    proofPublicKey: "proof-key"
  };
  const requestHash =
    attestationExchangeHash(request);

  const calls = [];
  const fetchFn = async (url, options) => {
    calls.push({ url: String(url), options });
    if (
      String(url) ===
      "https://oauth2.googleapis.com/token"
    ) {
      return response(200, {
        access_token: "oauth-token",
        expires_in: 3600
      });
    }

    return response(200, {
      tokenPayloadExternal: {
        requestDetails: {
          requestPackageName:
            request.packageId,
          requestHash,
          timestampMillis:
            String(now)
        },
        appIntegrity: {
          appRecognitionVerdict:
            "PLAY_RECOGNIZED"
        },
        deviceIntegrity: {
          deviceRecognitionVerdict: [
            "MEETS_DEVICE_INTEGRITY"
          ]
        },
        accountDetails: {
          appLicensingVerdict: "LICENSED"
        }
      }
    });
  };

  const verifier =
    new PlayIntegrityVerifier({
      now: () => now,
      fetchFn,
      apps: [{
        packageName:
          request.packageId,
        serviceAccount: {
          client_email:
            "play@example.iam.gserviceaccount.com",
          private_key:
            privatePem
        },
        requiredDeviceVerdicts: [
          "MEETS_DEVICE_INTEGRITY"
        ],
        requireLicensed: true
      }]
    });

  const verdict = await verifier.verify({
    ...request,
    integrityToken: "opaque-play-token"
  });

  assert.equal(verdict.ok, true);
  assert.equal(
    verdict.provider,
    "google-play-integrity"
  );
  assert.equal(calls.length, 2);
  assert.equal(
    calls[1].options.headers.authorization,
    "Bearer oauth-token"
  );

  const mismatch = await verifier.verify({
    ...request,
    userId: "other-user",
    integrityToken: "opaque-play-token"
  });
  assert.equal(mismatch.ok, false);
  assert.equal(
    mismatch.error,
    "play_integrity_request_mismatch"
  );
});
