import crypto from "node:crypto";
import {
  attestationExchangeHash
} from "./request-proof.mjs";

const PLAY_SCOPE =
  "https://www.googleapis.com/auth/playintegrity";
const DEFAULT_TOKEN_URI =
  "https://oauth2.googleapis.com/token";

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function safeString(value, max = 20000) {
  const text = String(value || "");
  return text.length <= max ? text : "";
}

export class PlayIntegrityVerifier {
  constructor({
    apps = [],
    fetchFn = globalThis.fetch,
    now = () => Date.now()
  } = {}) {
    this.apps = new Map(
      apps.map((app) => [app.packageName, app])
    );
    this.fetch = fetchFn;
    this.now = now;
    this.accessTokens = new Map();
  }

  get configuredPackages() {
    return [...this.apps.keys()].sort();
  }

  async #accessToken(app) {
    const cached = this.accessTokens.get(
      app.packageName
    );
    if (
      cached &&
      cached.expiresAt > this.now() + 60000
    ) {
      return cached.token;
    }

    const account = app.serviceAccount;
    if (
      !account?.client_email ||
      !account?.private_key
    ) {
      throw Object.assign(
        new Error(
          "play_integrity_service_account_missing"
        ),
        {
          code:
            "play_integrity_service_account_missing",
          status: 503
        }
      );
    }

    const tokenUri =
      account.token_uri || DEFAULT_TOKEN_URI;
    const nowSeconds =
      Math.floor(this.now() / 1000);
    const header = base64url(
      JSON.stringify({
        alg: "RS256",
        typ: "JWT"
      })
    );
    const claims = base64url(
      JSON.stringify({
        iss: account.client_email,
        scope: PLAY_SCOPE,
        aud: tokenUri,
        iat: nowSeconds,
        exp: nowSeconds + 3600
      })
    );
    const signingInput = `${header}.${claims}`;
    const signature = crypto.sign(
      "RSA-SHA256",
      Buffer.from(signingInput, "utf8"),
      account.private_key
    ).toString("base64url");

    const response = await this.fetch(tokenUri, {
      method: "POST",
      headers: {
        "content-type":
          "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        grant_type:
          "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion:
          `${signingInput}.${signature}`
      }).toString()
    });

    const payload =
      await response.json().catch(() => ({}));
    if (
      !response.ok ||
      typeof payload.access_token !== "string"
    ) {
      throw Object.assign(
        new Error(
          "play_integrity_oauth_failed"
        ),
        {
          code: "play_integrity_oauth_failed",
          status: 503
        }
      );
    }

    const expiresIn = Math.min(
      Math.max(
        Number(payload.expires_in) || 3600,
        60
      ),
      3600
    );
    this.accessTokens.set(app.packageName, {
      token: payload.access_token,
      expiresAt:
        this.now() + expiresIn * 1000
    });
    return payload.access_token;
  }

  async verify({
    projectId,
    userId,
    packageId,
    clientNonce,
    clientTimestampMs,
    proofPublicKey,
    integrityToken
  }) {
    const app = this.apps.get(
      String(packageId || "")
    );
    if (!app) {
      return {
        ok: false,
        error:
          "play_integrity_package_not_configured"
      };
    }

    const token = safeString(
      integrityToken,
      25000
    );
    if (!token) {
      return {
        ok: false,
        error: "invalid_integrity_token"
      };
    }

    const accessToken =
      await this.#accessToken(app);
    const endpoint =
      `https://playintegrity.googleapis.com/v1/${encodeURIComponent(app.packageName)}:decodeIntegrityToken`;

    const response = await this.fetch(endpoint, {
      method: "POST",
      headers: {
        authorization:
          `Bearer ${accessToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        integrity_token: token
      })
    });

    const decoded =
      await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        ok: false,
        error:
          "play_integrity_decode_failed"
      };
    }

    const payload =
      decoded.tokenPayloadExternal || {};
    const request =
      payload.requestDetails || {};
    const appIntegrity =
      payload.appIntegrity || {};
    const device =
      payload.deviceIntegrity || {};
    const account =
      payload.accountDetails || {};

    const expectedHash =
      attestationExchangeHash({
        projectId,
        userId,
        packageId,
        clientNonce,
        clientTimestampMs,
        proofPublicKey
      });

    if (
      request.requestPackageName !==
        app.packageName ||
      request.requestHash !== expectedHash
    ) {
      return {
        ok: false,
        error:
          "play_integrity_request_mismatch"
      };
    }

    const timestamp =
      Number(request.timestampMillis);
    const maxAgeSeconds =
      Math.min(
        Math.max(
          Number(
            app.maxVerdictAgeSeconds
          ) || 120,
          30
        ),
        600
      );
    if (
      !Number.isFinite(timestamp) ||
      Math.abs(this.now() - timestamp) >
        maxAgeSeconds * 1000
    ) {
      return {
        ok: false,
        error:
          "play_integrity_verdict_stale"
      };
    }

    const requiredAppVerdict =
      app.requiredAppVerdict ||
      "PLAY_RECOGNIZED";
    if (
      appIntegrity.appRecognitionVerdict !==
      requiredAppVerdict
    ) {
      return {
        ok: false,
        error:
          "play_integrity_app_untrusted"
      };
    }

    const requiredDeviceVerdicts =
      Array.isArray(
        app.requiredDeviceVerdicts
      ) &&
      app.requiredDeviceVerdicts.length
        ? app.requiredDeviceVerdicts
        : ["MEETS_DEVICE_INTEGRITY"];
    const actualDeviceVerdicts =
      Array.isArray(
        device.deviceRecognitionVerdict
      )
        ? device.deviceRecognitionVerdict
        : [];

    if (
      requiredDeviceVerdicts.some(
        (item) =>
          !actualDeviceVerdicts.includes(item)
      )
    ) {
      return {
        ok: false,
        error:
          "play_integrity_device_untrusted"
      };
    }

    if (
      app.requireLicensed &&
      account.appLicensingVerdict !== "LICENSED"
    ) {
      return {
        ok: false,
        error:
          "play_integrity_unlicensed"
      };
    }

    return {
      ok: true,
      provider: "google-play-integrity",
      packageId: app.packageName,
      appVerdict:
        appIntegrity.appRecognitionVerdict,
      deviceVerdicts:
        actualDeviceVerdicts,
      licensingVerdict:
        account.appLicensingVerdict || null
    };
  }
}
