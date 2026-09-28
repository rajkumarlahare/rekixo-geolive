import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.mjs";
import {
  authenticateRequest,
  originAllowed,
  packageAllowed
} from "./auth.mjs";
import { MemoryGeoLiveStore } from "./store-memory.mjs";
import { createConfiguredStore } from "./store-factory.mjs";
import { PostgresAdminStore } from "./admin-store-postgres.mjs";
import { PostgresApiKeyStore } from "./api-key-store-postgres.mjs";
import { PostgresOperationsStore } from "./operations-store-postgres.mjs";
import { PostgresRealtimeStore } from "./realtime-store-postgres.mjs";
import { PostgresClientSecurityStore } from "./client-security-store-postgres.mjs";
import { ClientTokenService } from "./client-token.mjs";
import { PlayIntegrityVerifier } from "./play-integrity.mjs";
import {
  validateClientExchangeBody,
  validateClientLocationRequest
} from "./client-security.mjs";
import { createRealtimeGateway } from "./realtime-gateway.mjs";
import { handleAdminApi } from "./admin-api.mjs";
import { InputError, validateLocation } from "./validation.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dashboardDir = path.resolve(__dirname, "../../dashboard");

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "permissions-policy": "geolocation=(), camera=(), microphone=()"
};

function json(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers
  });
  res.end(body);
}

async function readJsonPayload(
  req,
  maxBytes = 32 * 1024
) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      throw new InputError("body_too_large");
    }
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks);
  if (raw.length === 0) {
    return {
      body: {},
      raw
    };
  }

  try {
    return {
      body: JSON.parse(raw.toString("utf8")),
      raw
    };
  } catch {
    throw new InputError("invalid_json");
  }
}

async function readJson(
  req,
  maxBytes = 32 * 1024
) {
  return (
    await readJsonPayload(req, maxBytes)
  ).body;
}

function isHttpOrigin(value) {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return ["http:", "https:"].includes(parsed.protocol) && parsed.origin === value;
  } catch {
    return false;
  }
}

function preflightHeaders(origin) {
  if (!isHttpOrigin(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    vary: "Origin",
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "Authorization,Content-Type,X-GeoLive-Key,X-GeoLive-Package,X-CSRF-Token,X-GeoLive-Request-Timestamp,X-GeoLive-Request-Nonce,X-GeoLive-Request-Signature",
    "access-control-max-age": "600"
  };
}

function corsHeaders(origin, config, key) {
  if (!origin || !originAllowed(origin, key, config.allowedOrigins)) return {};
  return {
    "access-control-allow-origin": origin,
    vary: "Origin",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "Authorization,Content-Type,X-GeoLive-Key,X-GeoLive-Package,X-GeoLive-Request-Timestamp,X-GeoLive-Request-Nonce,X-GeoLive-Request-Signature",
    "access-control-expose-headers": "X-RateLimit-Limit,X-RateLimit-Remaining,X-RateLimit-Reset,Retry-After",
    "access-control-max-age": "600"
  };
}

function validateClientRestrictions(req, origin, config, key) {
  if (origin && !originAllowed(origin, key, config.allowedOrigins)) {
    return { ok: false, status: 403, error: "origin_not_allowed" };
  }
  const packageId = typeof req.headers["x-geolive-package"] === "string"
    ? req.headers["x-geolive-package"].trim()
    : "";
  if (!packageAllowed(packageId, key)) {
    return { ok: false, status: 403, error: "package_not_allowed" };
  }
  return { ok: true };
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8"
};

async function serveDashboard(res, pathname) {
  const relative = pathname === "/" || pathname === "/dashboard" || pathname === "/dashboard/"
    ? "index.html"
    : pathname.replace(/^\/dashboard\//, "");
  if (!["index.html", "styles.css", "app.js"].includes(relative)) return false;

  try {
    const content = await fs.readFile(path.join(dashboardDir, relative));
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      "content-security-policy": "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      "content-type": MIME[path.extname(relative)] || "application/octet-stream",
      "cache-control": relative === "index.html" ? "no-store" : "public, max-age=300"
    });
    res.end(content);
    return true;
  } catch {
    return false;
  }
}

export function createGeoLiveServer({
  config = loadConfig(),
  store = new MemoryGeoLiveStore(),
  adminStore = null,
  keyStore = null,
  opsStore = null,
  clientSecurityStore = null,
  clientTokenService = null,
  playIntegrityVerifier = null,
  realtimeGateway = null
} = {}) {
  const eventClients = new Map();

  function publish(projectId, payload) {
    const clients = eventClients.get(projectId);
    if (!clients) return;
    const frame = `event: location\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const response of clients) response.write(frame);
  }

  async function authorizePublic(req, requiredScope) {
    return authenticateRequest(req, {
      keyStore,
      environmentKeys: config.keys,
      clientTokenService
    }, requiredScope);
  }

  function apiKeyRef(key) {
    if (key?.clientToken && key?.jti) {
      return `client:${key.jti}`;
    }
    if (key?.prefix && key?.id) {
      return `db:${key.id}`;
    }
    return `env:${key?.id || "unknown"}`;
  }

  function rateHeaders(rate) {
    if (!rate) return {};
    return {
      "x-ratelimit-limit": String(rate.limit),
      "x-ratelimit-remaining": String(rate.remaining),
      "x-ratelimit-reset": rate.resetAt,
      ...(rate.allowed
        ? {}
        : { "retry-after": String(rate.retryAfterSeconds) })
    };
  }

  async function recordUsage({
    auth,
    route,
    statusCode,
    startedAt
  }) {
    if (!opsStore || !auth?.key?.projectId) return;
    await opsStore.recordUsage({
      projectId: auth.key.projectId,
      keyRef: apiKeyRef(auth.key),
      route,
      statusCode,
      latencyMs: Date.now() - startedAt
    });
  }

  async function enforceOperations(auth, group, route) {
    if (!opsStore) {
      return { ok: true, headers: {}, limits: null };
    }

    const projectId = auth.key.projectId;
    const limits = await opsStore.getProjectLimits(projectId);
    const perMinute =
      group === "ingest"
        ? limits.ingestRequestsPerMinute
        : limits.readRequestsPerMinute;

    const rate = await opsStore.consumeProjectRateLimit(
      projectId,
      group,
      perMinute
    );

    if (!rate.allowed) {
      await opsStore.recordSecurityEvent({
        projectId,
        keyRef: apiKeyRef(auth.key),
        eventType: "api.rate_limited",
        severity: "warning",
        metadata: { group, route }
      });
      return {
        ok: false,
        status: 429,
        error: "rate_limited",
        headers: rateHeaders(rate),
        limits
      };
    }

    if (group === "ingest") {
      const quota = await opsStore.consumeDailyIngestQuota(
        projectId,
        limits.dailyIngestQuota
      );
      if (!quota.allowed) {
        await opsStore.recordSecurityEvent({
          projectId,
          keyRef: apiKeyRef(auth.key),
          eventType: "api.daily_ingest_quota_exceeded",
          severity: "warning",
          metadata: { route }
        });
        return {
          ok: false,
          status: 429,
          error: "daily_ingest_quota_exceeded",
          headers: rateHeaders(rate),
          limits
        };
      }
    } else {
      await opsStore.recordRead(projectId);
    }

    return {
      ok: true,
      headers: rateHeaders(rate),
      limits
    };
  }

  async function recordRestrictionFailure(auth, error, route) {
    if (!opsStore || !auth?.key?.projectId) return;
    await opsStore.recordSecurityEvent({
      projectId: auth.key.projectId,
      keyRef: apiKeyRef(auth.key),
      eventType: `api.${error}`,
      severity: "warning",
      metadata: { route }
    });
  }

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://localhost");
      const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";

      if (req.method === "OPTIONS") {
        const headers = preflightHeaders(origin);
        if (origin && !headers["access-control-allow-origin"]) {
          return json(res, 403, { error: "origin_not_allowed" });
        }
        res.writeHead(204, {
          ...SECURITY_HEADERS,
          ...headers
        });
        return res.end();
      }

      if (await handleAdminApi({
        req,
        res,
        url,
        config,
        adminStore,
        keyStore,
        opsStore,
        clientSecurityStore,
        geoStore: store
      })) {
        return;
      }

      if (req.method === "GET" && (url.pathname === "/" || url.pathname.startsWith("/dashboard"))) {
        if (await serveDashboard(res, url.pathname)) return;
      }

      if (req.method === "GET" && url.pathname === "/health") {
        return json(res, 200, {
          ok: true,
          service: "rekixo-geolive",
          version: "0.7.0"
        });
      }

      if (req.method === "GET" && url.pathname === "/ready") {
        const persistenceReady = typeof store.ready === "function"
          ? await store.ready()
          : true;
        const adminReady = adminStore
          ? await adminStore.ready()
          : !config.isProduction;
        const apiKeyReady = keyStore
          ? await keyStore.ready()
          : !config.isProduction;
        const operationsReady = opsStore
          ? await opsStore.ready()
          : !config.isProduction;
        const realtimeReady = realtimeGateway
          ? realtimeGateway.ready()
          : !config.isProduction;
        const clientSecurityReady =
          clientSecurityStore
            ? await clientSecurityStore.ready()
            : !config.isProduction;
        const clientTokensConfigured =
          Boolean(clientTokenService?.configured);
        const clientTokensReady =
          !config.clientTokens?.required ||
          clientTokensConfigured;
        const ready = persistenceReady
          && adminReady
          && apiKeyReady
          && operationsReady
          && realtimeReady
          && clientSecurityReady
          && clientTokensReady
          && (!config.isProduction || config.persistence === "postgres");

        return json(res, ready ? 200 : 503, {
          ready,
          persistence: config.persistence,
          persistenceReady,
          adminReady,
          apiKeyReady,
          operationsReady,
          realtimeReady,
          clientSecurityReady,
          clientTokensConfigured,
          clientTokensRequired:
            Boolean(
              config.clientTokens?.required
            ),
          playIntegrityConfiguredPackages:
            playIntegrityVerifier
              ?.configuredPackages || [],
          realtime: realtimeGateway
            ? realtimeGateway.status()
            : null,
          environmentCredentialCount: config.keys.length,
          legacyCredentialBridgeActive: config.keys.length > 0
        });
      }

      if (
        req.method === "POST" &&
        url.pathname ===
          "/v1/client-tokens/exchange"
      ) {
        const startedAt = Date.now();
        const auth = await authorizePublic(
          req,
          "tokens:issue"
        );
        if (!auth.ok) {
          return json(
            res,
            auth.status,
            { error: auth.error }
          );
        }

        if (
          !auth.key?.prefix ||
          !/^[0-9a-f-]{36}$/i.test(
            String(auth.key.id || "")
          )
        ) {
          return json(res, 403, {
            error:
              "client_token_issuer_requires_database_key"
          });
        }

        if (
          !clientTokenService?.configured
        ) {
          return json(res, 503, {
            error:
              "client_tokens_not_configured"
          });
        }
        if (!clientSecurityStore) {
          return json(res, 503, {
            error:
              "client_security_store_unavailable"
          });
        }

        if (
          origin &&
          !originAllowed(
            origin,
            auth.key,
            config.allowedOrigins
          )
        ) {
          await recordRestrictionFailure(
            auth,
            "origin_not_allowed",
            "client_tokens.exchange"
          );
          return json(res, 403, {
            error: "origin_not_allowed"
          });
        }

        const input =
          validateClientExchangeBody(
            await readJson(
              req,
              64 * 1024
            )
          );
        const policy =
          await clientSecurityStore.getPolicy(
            auth.key.projectId
          );

        const now = Date.now();
        if (
          Math.abs(
            now -
            input.clientTimestampMs
          ) >
          policy.requestMaxAgeSeconds *
            1000
        ) {
          await recordRestrictionFailure(
            auth,
            "client_exchange_stale",
            "client_tokens.exchange"
          );
          return json(res, 401, {
            error:
              "client_exchange_stale"
          });
        }

        if (
          policy.requireRequestProof &&
          !input.proofPublicKey
        ) {
          return json(res, 400, {
            error:
              "client_proof_key_required"
          });
        }

        const issuerPackages =
          auth.key.allowedPackages || [];
        if (
          issuerPackages.length &&
          (
            !input.packageId ||
            !issuerPackages.includes(
              input.packageId
            )
          )
        ) {
          await recordRestrictionFailure(
            auth,
            "package_not_allowed",
            "client_tokens.exchange"
          );
          return json(res, 403, {
            error: "package_not_allowed"
          });
        }

        let tokenRate = null;
        if (opsStore) {
          tokenRate =
            await opsStore
              .consumeProjectRateLimit(
                auth.key.projectId,
                "token_exchange",
                policy
                  .tokenExchangeRequestsPerMinute
              );
          if (!tokenRate.allowed) {
            await opsStore.recordSecurityEvent({
              projectId:
                auth.key.projectId,
              keyRef:
                apiKeyRef(auth.key),
              eventType:
                "api.client_token_exchange_rate_limited",
              severity: "warning",
              metadata: {}
            });
            await recordUsage({
              auth,
              route:
                "client_tokens.exchange",
              statusCode: 429,
              startedAt
            });
            return json(
              res,
              429,
              { error: "rate_limited" },
              rateHeaders(tokenRate)
            );
          }
        }

        const exchangeNonceUnused =
          await clientSecurityStore
            .consumeExchangeNonce(
              auth.key.projectId,
              input.clientNonce,
              new Date(
                now +
                policy.requestMaxAgeSeconds *
                  2000
              ).toISOString()
            );

        if (!exchangeNonceUnused) {
          if (opsStore) {
            await opsStore.recordSecurityEvent({
              projectId:
                auth.key.projectId,
              keyRef:
                apiKeyRef(auth.key),
              eventType:
                "api.client_token_exchange_replayed",
              severity: "warning",
              metadata: {}
            });
          }
          await recordUsage({
            auth,
            route:
              "client_tokens.exchange",
            statusCode: 409,
            startedAt
          });
          return json(
            res,
            409,
            {
              error:
                "client_exchange_replayed"
            },
            rateHeaders(tokenRate)
          );
        }

        let attested = false;
        let attestationSummary = null;

        if (input.platform === "android") {
          const mode =
            policy.androidAttestationMode;

          if (
            mode === "required" &&
            !input.attestation
          ) {
            await recordUsage({
              auth,
              route:
                "client_tokens.exchange",
              statusCode: 403,
              startedAt
            });
            return json(
              res,
              403,
              {
                error:
                  "android_attestation_required"
              },
              rateHeaders(tokenRate)
            );
          }

          if (input.attestation) {
            if (
              input.attestation.provider !==
              "google-play-integrity"
            ) {
              return json(res, 400, {
                error:
                  "unsupported_attestation_provider"
              });
            }
            if (!playIntegrityVerifier) {
              return json(res, 503, {
                error:
                  "play_integrity_not_configured"
              });
            }

            const verdict =
              await playIntegrityVerifier.verify({
                projectId:
                  auth.key.projectId,
                userId: input.userId,
                packageId:
                  input.packageId,
                clientNonce:
                  input.clientNonce,
                clientTimestampMs:
                  input.clientTimestampMs,
                proofPublicKey:
                  input.proofPublicKey,
                integrityToken:
                  input.attestation.token
              });

            if (!verdict.ok) {
              if (opsStore) {
                await opsStore
                  .recordSecurityEvent({
                    projectId:
                      auth.key.projectId,
                    keyRef:
                      apiKeyRef(auth.key),
                    eventType:
                      "api.android_attestation_failed",
                    severity: "warning",
                    metadata: {
                      reason:
                        verdict.error,
                      packageId:
                        input.packageId ||
                        null
                    }
                  });
              }
              await recordUsage({
                auth,
                route:
                  "client_tokens.exchange",
                statusCode: 403,
                startedAt
              });
              return json(
                res,
                403,
                {
                  error:
                    verdict.error
                },
                rateHeaders(tokenRate)
              );
            }

            attested = true;
            attestationSummary = {
              provider:
                verdict.provider,
              packageId:
                verdict.packageId,
              appVerdict:
                verdict.appVerdict,
              deviceVerdicts:
                verdict.deviceVerdicts,
              licensingVerdict:
                verdict.licensingVerdict
            };
          }
        } else if (input.attestation) {
          return json(res, 400, {
            error:
              "attestation_not_supported_for_platform"
          });
        }

        const issued =
          clientTokenService.issue({
            projectId:
              auth.key.projectId,
            userId: input.userId,
            issuerKeyId: auth.key.id,
            ttlSeconds:
              policy.clientTokenTtlSeconds,
            packageId:
              input.packageId,
            platform:
              input.platform,
            attested,
            proofPublicKey:
              input.proofPublicKey
          });

        await recordUsage({
          auth,
          route:
            "client_tokens.exchange",
          statusCode: 201,
          startedAt
        });

        return json(
          res,
          201,
          {
            token: issued.token,
            tokenType: "Bearer",
            expiresAt:
              issued.expiresAt,
            projectId:
              auth.key.projectId,
            userId:
              input.userId,
            attested,
            attestation:
              attestationSummary,
            proofRequired:
              policy.requireRequestProof
          },
          {
            ...corsHeaders(
              origin,
              config,
              auth.key
            ),
            ...rateHeaders(tokenRate)
          }
        );
      }

      if (req.method === "POST" && url.pathname === "/v1/locations") {
        const startedAt = Date.now();
        const auth = await authorizePublic(req, "location:write");
        if (!auth.ok) return json(res, auth.status, { error: auth.error });

        const restrictions = validateClientRestrictions(
          req,
          origin,
          config,
          auth.key
        );
        if (!restrictions.ok) {
          await recordRestrictionFailure(
            auth,
            restrictions.error,
            "locations.write"
          );
          await recordUsage({
            auth,
            route: "locations.write",
            statusCode: restrictions.status,
            startedAt
          });
          return json(
            res,
            restrictions.status,
            { error: restrictions.error }
          );
        }

        const payload =
          await readJsonPayload(req);
        const input =
          validateLocation(payload.body);

        if (auth.key.clientToken) {
          if (!clientSecurityStore) {
            return json(res, 503, {
              error:
                "client_security_store_unavailable"
            });
          }

          const policy =
            await clientSecurityStore.getPolicy(
              auth.key.projectId
            );
          const requestSecurity =
            await validateClientLocationRequest({
              req,
              rawBody: payload.raw,
              input,
              auth,
              policy,
              store:
                clientSecurityStore
            });

          if (!requestSecurity.ok) {
            if (opsStore) {
              await opsStore.recordSecurityEvent({
                projectId:
                  auth.key.projectId,
                keyRef:
                  apiKeyRef(auth.key),
                eventType:
                  `api.${requestSecurity.error}`,
                severity: "warning",
                metadata: {
                  route:
                    "locations.write"
                }
              });
            }
            await recordUsage({
              auth,
              route:
                "locations.write",
              statusCode:
                requestSecurity.status,
              startedAt
            });
            return json(
              res,
              requestSecurity.status,
              {
                error:
                  requestSecurity.error
              }
            );
          }
        }

        const operations =
          await enforceOperations(
            auth,
            "ingest",
            "locations.write"
          );
        if (!operations.ok) {
          await recordUsage({
            auth,
            route: "locations.write",
            statusCode: operations.status,
            startedAt
          });
          return json(
            res,
            operations.status,
            { error: operations.error },
            operations.headers
          );
        }

        const headers = {
          ...corsHeaders(
            origin,
            config,
            auth.key
          ),
          ...operations.headers
        };
        const receivedAt =
          new Date().toISOString();

        try {
          const record = await store.upsertLocation(
            auth.key.projectId,
            {
              ...input,
              receivedAt
            }
          );

          const realtimeEvent =
            record._realtimeEvent || {
              projectId: auth.key.projectId,
              type: "location",
              userId: record.userId,
              payload: {
                ...record,
                _realtimeEvent: undefined
              }
            };
          const publicRecord = { ...record };
          delete publicRecord._realtimeEvent;

          publish(
            auth.key.projectId,
            { type: "location", user: publicRecord }
          );
          const publishedEvent = realtimeGateway
            ? await realtimeGateway.publish({
                ...realtimeEvent,
                payload: publicRecord
              })
            : realtimeEvent;

          await recordUsage({
            auth,
            route: "locations.write",
            statusCode: 202,
            startedAt
          });
          return json(
            res,
            202,
            {
              accepted: true,
              userId: record.userId,
              receivedAt,
              eventSequence:
                publishedEvent?.sequence || null
            },
            headers
          );
        } catch (error) {
          if (
            error?.code ===
            "project_live_user_quota_exceeded"
          ) {
            if (opsStore) {
              await opsStore.recordSecurityEvent({
                projectId: auth.key.projectId,
                keyRef: apiKeyRef(auth.key),
                eventType: "api.live_user_quota_exceeded",
                severity: "warning",
                metadata: { route: "locations.write" }
              });
            }
            await recordUsage({
              auth,
              route: "locations.write",
              statusCode: 429,
              startedAt
            });
            return json(
              res,
              429,
              { error: error.code },
              headers
            );
          }
          throw error;
        }
      }

      if (req.method === "GET" && url.pathname === "/v1/users") {
        const startedAt = Date.now();
        const auth = await authorizePublic(req, "users:read");
        if (!auth.ok) return json(res, auth.status, { error: auth.error });

        const restrictions = validateClientRestrictions(
          req,
          origin,
          config,
          auth.key
        );
        if (!restrictions.ok) {
          await recordRestrictionFailure(
            auth,
            restrictions.error,
            "users.read"
          );
          await recordUsage({
            auth,
            route: "users.read",
            statusCode: restrictions.status,
            startedAt
          });
          return json(
            res,
            restrictions.status,
            { error: restrictions.error }
          );
        }

        const operations = await enforceOperations(
          auth,
          "read",
          "users.read"
        );
        if (!operations.ok) {
          await recordUsage({
            auth,
            route: "users.read",
            statusCode: operations.status,
            startedAt
          });
          return json(
            res,
            operations.status,
            { error: operations.error },
            operations.headers
          );
        }

        const page =
          typeof store.listUsersPage === "function"
            ? await store.listUsersPage(auth.key.projectId, {
                search: url.searchParams.get("search") || "",
                status: url.searchParams.get("status") || "",
                country: url.searchParams.get("country") || "",
                state: url.searchParams.get("state") || "",
                city: url.searchParams.get("city") || "",
                limit: url.searchParams.get("limit") || 100,
                cursor: url.searchParams.get("cursor") || "",
                thresholds: config.thresholds
              })
            : {
                users: await store.listUsers(auth.key.projectId, {
                  search: url.searchParams.get("search") || "",
                  status: url.searchParams.get("status") || "",
                  country: url.searchParams.get("country") || "",
                  state: url.searchParams.get("state") || "",
                  city: url.searchParams.get("city") || "",
                  limit: url.searchParams.get("limit") || 100,
                  thresholds: config.thresholds
                }),
                nextCursor: null
              };

        await recordUsage({
          auth,
          route: "users.read",
          statusCode: 200,
          startedAt
        });
        return json(
          res,
          200,
          {
            projectId: auth.key.projectId,
            ...page
          },
          {
            ...corsHeaders(origin, config, auth.key),
            ...operations.headers
          }
        );
      }

      if (req.method === "GET" && url.pathname === "/v1/clusters") {
        const startedAt = Date.now();
        const auth = await authorizePublic(req, "users:read");
        if (!auth.ok) return json(res, auth.status, { error: auth.error });

        const restrictions = validateClientRestrictions(
          req,
          origin,
          config,
          auth.key
        );
        if (!restrictions.ok) {
          await recordRestrictionFailure(
            auth,
            restrictions.error,
            "clusters.read"
          );
          await recordUsage({
            auth,
            route: "clusters.read",
            statusCode: restrictions.status,
            startedAt
          });
          return json(
            res,
            restrictions.status,
            { error: restrictions.error }
          );
        }

        const operations = await enforceOperations(
          auth,
          "read",
          "clusters.read"
        );
        if (!operations.ok) {
          await recordUsage({
            auth,
            route: "clusters.read",
            statusCode: operations.status,
            startedAt
          });
          return json(
            res,
            operations.status,
            { error: operations.error },
            operations.headers
          );
        }

        if (typeof store.clusterUsers !== "function") {
          return json(res, 501, {
            error: "clustering_unavailable"
          });
        }

        const clusters = await store.clusterUsers(
          auth.key.projectId,
          {
            gridDegrees:
              url.searchParams.get("gridDegrees") || 8,
            status: url.searchParams.get("status") || "",
            country: url.searchParams.get("country") || "",
            state: url.searchParams.get("state") || "",
            city: url.searchParams.get("city") || "",
            thresholds: config.thresholds
          }
        );

        await recordUsage({
          auth,
          route: "clusters.read",
          statusCode: 200,
          startedAt
        });

        return json(
          res,
          200,
          {
            projectId: auth.key.projectId,
            clusters
          },
          {
            ...corsHeaders(origin, config, auth.key),
            ...operations.headers
          }
        );
      }

      if (req.method === "GET" && url.pathname === "/v1/summary") {
        const startedAt = Date.now();
        const auth = await authorizePublic(req, "summary:read");
        if (!auth.ok) return json(res, auth.status, { error: auth.error });

        const restrictions = validateClientRestrictions(
          req,
          origin,
          config,
          auth.key
        );
        if (!restrictions.ok) {
          await recordRestrictionFailure(
            auth,
            restrictions.error,
            "summary.read"
          );
          await recordUsage({
            auth,
            route: "summary.read",
            statusCode: restrictions.status,
            startedAt
          });
          return json(
            res,
            restrictions.status,
            { error: restrictions.error }
          );
        }

        const operations = await enforceOperations(
          auth,
          "read",
          "summary.read"
        );
        if (!operations.ok) {
          await recordUsage({
            auth,
            route: "summary.read",
            statusCode: operations.status,
            startedAt
          });
          return json(
            res,
            operations.status,
            { error: operations.error },
            operations.headers
          );
        }

        const summary = await store.summary(
          auth.key.projectId,
          config.thresholds
        );
        await recordUsage({
          auth,
          route: "summary.read",
          statusCode: 200,
          startedAt
        });
        return json(
          res,
          200,
          {
            projectId: auth.key.projectId,
            ...summary
          },
          {
            ...corsHeaders(origin, config, auth.key),
            ...operations.headers
          }
        );
      }

      if (req.method === "GET" && url.pathname === "/v1/events") {
        const startedAt = Date.now();
        const auth = await authorizePublic(req, "events:read");
        if (!auth.ok) return json(res, auth.status, { error: auth.error });

        const restrictions = validateClientRestrictions(
          req,
          origin,
          config,
          auth.key
        );
        if (!restrictions.ok) {
          await recordRestrictionFailure(
            auth,
            restrictions.error,
            "events.read"
          );
          await recordUsage({
            auth,
            route: "events.read",
            statusCode: restrictions.status,
            startedAt
          });
          return json(
            res,
            restrictions.status,
            { error: restrictions.error }
          );
        }

        const operations = await enforceOperations(
          auth,
          "read",
          "events.read"
        );
        if (!operations.ok) {
          await recordUsage({
            auth,
            route: "events.read",
            statusCode: operations.status,
            startedAt
          });
          return json(
            res,
            operations.status,
            { error: operations.error },
            operations.headers
          );
        }

        const headers = {
          ...corsHeaders(origin, config, auth.key),
          ...operations.headers
        };
        await recordUsage({
          auth,
          route: "events.read",
          statusCode: 200,
          startedAt
        });
        res.writeHead(200, {
          ...SECURITY_HEADERS,
          ...headers,
          "content-type": "text/event-stream",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive"
        });
        res.write(`event: ready\ndata: ${JSON.stringify({ projectId: auth.key.projectId })}\n\n`);

        let set = eventClients.get(auth.key.projectId);
        if (!set) {
          set = new Set();
          eventClients.set(auth.key.projectId, set);
        }
        set.add(res);

        const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 25000);
        req.on("close", () => {
          clearInterval(heartbeat);
          set.delete(res);
          if (set.size === 0) eventClients.delete(auth.key.projectId);
        });
        return;
      }

      return json(res, 404, { error: "not_found" });
    } catch (error) {
      if (error instanceof InputError) {
        return json(res, 400, { error: error.code });
      }
      if (error?.status && error?.code) {
        return json(res, error.status, { error: error.code });
      }
      console.error("GeoLive request failed", error);
      return json(res, 500, { error: "internal_error" });
    }
  });
}

async function start() {
  const config = loadConfig();
  const store = await createConfiguredStore(config);
  const adminStore = config.persistence === "postgres"
    ? new PostgresAdminStore({ pool: store.pool })
    : null;
  const keyStore = config.persistence === "postgres"
    ? new PostgresApiKeyStore({ pool: store.pool })
    : null;
  const opsStore = config.persistence === "postgres"
    ? new PostgresOperationsStore({ pool: store.pool })
    : null;
  const realtimeStore = config.persistence === "postgres"
    ? new PostgresRealtimeStore({ pool: store.pool })
    : null;
  const clientSecurityStore =
    config.persistence === "postgres"
      ? new PostgresClientSecurityStore({
          pool: store.pool
        })
      : null;
  const clientTokenService =
    new ClientTokenService({
      signingKeys:
        config.clientTokens
          ?.signingKeys || []
    });
  const playIntegrityVerifier =
    new PlayIntegrityVerifier({
      apps:
        config.clientTokens
          ?.playIntegrityApps || []
    });

  if (config.persistence === "postgres" && typeof store.assertReady === "function") {
    await store.assertReady();
    await adminStore.assertReady();
    await keyStore.assertReady();
    await opsStore.assertReady();
    await realtimeStore.assertReady();
    await clientSecurityStore.assertReady();
  }

  const realtimeGateway = createRealtimeGateway({
    config,
    keyStore,
    adminStore,
    opsStore,
    realtimeStore
  });

  const server = createGeoLiveServer({
    config,
    store,
    adminStore,
    keyStore,
    opsStore,
    clientSecurityStore,
    clientTokenService,
    playIntegrityVerifier,
    realtimeGateway
  });
  realtimeGateway.attach(server);
  realtimeGateway.start();

  server.listen(config.port, () => {
    console.log(
      `Rekixo GeoLive listening on http://localhost:${config.port} (${config.persistence})`
    );
  });

  async function shutdown(signal) {
    console.log(`GeoLive received ${signal}; shutting down.`);
    server.close(async () => {
      try {
        realtimeGateway.close();
        if (typeof store.close === "function") await store.close();
      } finally {
        process.exit(0);
      }
    });
    setTimeout(() => process.exit(1), 10000).unref();
  }

  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  start().catch((error) => {
    console.error("GeoLive failed to start", error);
    process.exit(1);
  });
}
