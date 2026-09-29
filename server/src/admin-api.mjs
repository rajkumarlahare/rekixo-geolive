import {
  burnPasswordCheck,
  normalizeAdminEmail,
  randomCsrfToken,
  randomSessionToken,
  sha256Secret,
  timingSafeHexEqual,
  verifyPassword
} from "./passwords.mjs";
import { AdminStoreError } from "./admin-store-postgres.mjs";
import {
  validateClientSecurityPatch
} from "./client-security.mjs";
import {
  normalizeAllowedOrigins,
  normalizeAllowedPackages,
  normalizeExpiry,
  safeKeyName,
  validateApiKeyScopes
} from "./integration-keys.mjs";
import {
  validatePlanInput,
  validateSubscriptionPatch,
  validateEntitlementOverrides,
  validateSupportCase,
  validateSupportPatch,
  validateSupportMessage,
  validateInvoiceGenerate,
  validateInvoicePatch
} from "./commercial-validation.mjs";
import {
  parseHeatmapQuery,
  parseMovementHistoryQuery
} from "./geospatial-validation.mjs";

const COOKIE_NAME = "geolive_admin_session";

function sendJson(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    ...headers
  });
  res.end(body);
}

async function readJson(req, maxBytes = 32 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      throw new AdminStoreError("body_too_large", 400);
    }
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AdminStoreError("invalid_json", 400);
  }
}

function parseCookies(header) {
  const result = {};
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    result[key] = decodeURIComponent(value);
  }
  return result;
}

function sessionToken(req) {
  const cookies = parseCookies(req.headers.cookie);
  if (cookies[COOKIE_NAME]) return cookies[COOKIE_NAME];

  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.startsWith("Bearer gla_")) {
    return auth.slice(7).trim();
  }
  return "";
}

function sessionCookie(token, config) {
  const maxAge = Math.max(60, Math.floor(config.admin.sessionHours * 3600));
  return [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    config.isProduction ? "Secure" : "",
    `Max-Age=${maxAge}`
  ].filter(Boolean).join("; ");
}

function clearCookie(config) {
  return [
    `${COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    config.isProduction ? "Secure" : "",
    "Max-Age=0"
  ].filter(Boolean).join("; ");
}

async function requireSession(req, adminStore) {
  const token = sessionToken(req);
  if (!token) throw new AdminStoreError("admin_auth_required", 401);
  const session = await adminStore.getSession(sha256Secret(token));
  if (!session) throw new AdminStoreError("admin_auth_required", 401);
  return session;
}

function requireCsrf(req, session) {
  const value = req.headers["x-csrf-token"];
  if (
    typeof value !== "string" ||
    !timingSafeHexEqual(sha256Secret(value), session.csrfHash)
  ) {
    throw new AdminStoreError("csrf_invalid", 403);
  }
}

function validateProjectInput(body, { partial = false } = {}) {
  const out = {};

  if (!partial || body.name !== undefined) {
    const name = String(body.name || "").trim();
    if (name.length < 2 || name.length > 120) {
      throw new AdminStoreError("invalid_project_name", 400);
    }
    out.name = name;
  }

  if (!partial || body.slug !== undefined) {
    const slug = String(body.slug || "").trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)) {
      throw new AdminStoreError("invalid_project_slug", 400);
    }
    out.slug = slug;
  }

  if (body.status !== undefined) {
    const status = String(body.status);
    if (!["active", "suspended"].includes(status)) {
      throw new AdminStoreError("invalid_project_status", 400);
    }
    out.status = status;
  }

  return out;
}

function validateLimitsInput(body) {
  const ranges = {
    ingestRequestsPerMinute: [1, 1000000],
    readRequestsPerMinute: [1, 1000000],
    dailyIngestQuota: [1, 1000000000],
    maxLiveUsers: [1, 10000000],
    historyRetentionDays: [1, 3650],
    securityEventRetentionDays: [7, 3650],
    metricsRetentionDays: [7, 3650],
    realtimeEventRetentionHours: [1, 720]
  };
  const out = {};
  for (const [key, [min, max]] of Object.entries(ranges)) {
    if (body[key] === undefined) continue;
    const value = Number(body[key]);
    if (!Number.isSafeInteger(value) || value < min || value > max) {
      throw new AdminStoreError("invalid_project_limits", 400);
    }
    out[key] = value;
  }
  if (!Object.keys(out).length) {
    throw new AdminStoreError("empty_project_limits_update", 400);
  }
  return out;
}

function sourceHash(req, config) {
  let source =
    String(req.socket?.remoteAddress || "unknown");

  if (config?.admin?.trustProxy) {
    const forwarded =
      req.headers["x-forwarded-for"];
    const first =
      Array.isArray(forwarded)
        ? forwarded[0]
        : String(forwarded || "")
            .split(",")[0]
            .trim();
    if (first) source = first;
  }

  return sha256Secret(source);
}

function validateKeyInput(body, { partial = false } = {}) {
  const out = {};

  if (!partial || body.name !== undefined) {
    out.name = safeKeyName(body.name, partial ? undefined : "API key");
  }

  if (!partial || body.scopes !== undefined) {
    out.scopes = validateApiKeyScopes(body.scopes);
  }

  if (body.allowedOrigins !== undefined) {
    out.allowedOrigins = normalizeAllowedOrigins(body.allowedOrigins);
  } else if (!partial) {
    out.allowedOrigins = [];
  }

  if (body.allowedPackages !== undefined) {
    out.allowedPackages = normalizeAllowedPackages(body.allowedPackages);
  } else if (!partial) {
    out.allowedPackages = [];
  }

  if (body.expiresAt !== undefined) {
    out.expiresAt = normalizeExpiry(body.expiresAt);
  } else if (!partial) {
    out.expiresAt = new Date(
      Date.now() + 90 * 24 * 60 * 60 * 1000
    ).toISOString();
  }

  return out;
}

async function sessionPayload(
  adminStore,
  session,
  commercialStore = null
) {
  const [accounts, projects, platformRole] =
    await Promise.all([
      adminStore.listAccounts(session.user.id),
      adminStore.listProjects(session.user.id),
      commercialStore
        ? commercialStore.getPlatformRole(
            session.user.id
          )
        : null
    ]);
  return {
    user: session.user,
    accounts,
    projects,
    platformRole
  };
}

export async function handleAdminApi({
  req,
  res,
  url,
  config,
  adminStore,
  keyStore,
  opsStore,
  clientSecurityStore,
  commercialStore,
  geoStore
}) {
  const adminRequest =
    url.pathname.startsWith("/v1/admin/");
  const platformRequest =
    url.pathname.startsWith("/v1/platform/");
  if (!adminRequest && !platformRequest) {
    return false;
  }

  if (!adminStore) {
    sendJson(res, 503, { error: "admin_requires_postgres" });
    return true;
  }

  try {
    if (req.method === "POST" && url.pathname === "/v1/admin/login") {
      const body = await readJson(req);
      const loginSourceHash = sourceHash(req, config);

      if (opsStore) {
        const sourceLimit = await opsStore.consumeRateLimit({
          bucketKey: `admin-login-source:${loginSourceHash}`,
          limit: 60,
          windowSeconds: 60
        });
        const identityLimit = await opsStore.consumeRateLimit({
          bucketKey: `admin-login-identity:${sha256Secret(
            String(body.email || "").trim().toLowerCase()
          )}`,
          limit: 10,
          windowSeconds: 60
        });
        if (!sourceLimit.allowed || !identityLimit.allowed) {
          await opsStore.recordSecurityEvent({
            eventType: "admin.login_rate_limited",
            severity: "warning",
            sourceHash: loginSourceHash,
            metadata: {}
          });
          throw new AdminStoreError("login_rate_limited", 429);
        }
      }

      let email;
      try {
        email = normalizeAdminEmail(body.email);
      } catch {
        await burnPasswordCheck(body.password);
        throw new AdminStoreError("invalid_credentials", 401);
      }

      const user = await adminStore.findUserForLogin(email);
      if (!user) {
        await burnPasswordCheck(body.password);
        if (opsStore) {
          await opsStore.recordSecurityEvent({
            eventType: "admin.login_failed",
            severity: "warning",
            sourceHash: loginSourceHash,
            metadata: { reason: "invalid_credentials" }
          });
        }
        throw new AdminStoreError("invalid_credentials", 401);
      }

      if (
        user.locked_until &&
        new Date(user.locked_until).getTime() > Date.now()
      ) {
        await burnPasswordCheck(body.password);
        if (opsStore) {
          await opsStore.recordSecurityEvent({
            eventType: "admin.login_locked",
            severity: "warning",
            sourceHash: loginSourceHash,
            metadata: {}
          });
        }
        throw new AdminStoreError("login_temporarily_locked", 429);
      }

      const valid = user.status === "active"
        ? await verifyPassword(body.password, user.password_hash)
        : false;

      if (!valid) {
        await adminStore.recordLoginFailure(user.id, {
          maxFailures: config.admin.maxFailedLogins,
          lockMinutes: config.admin.lockMinutes
        });
        if (opsStore) {
          await opsStore.recordSecurityEvent({
            eventType: "admin.login_failed",
            severity: "warning",
            sourceHash: loginSourceHash,
            metadata: { reason: "invalid_credentials" }
          });
        }
        throw new AdminStoreError("invalid_credentials", 401);
      }

      const rawSession = randomSessionToken();
      const rawCsrf = randomCsrfToken();
      const expiresAt = new Date(
        Date.now() + config.admin.sessionHours * 3600 * 1000
      );

      const created = await adminStore.createSession({
        userId: user.id,
        tokenHash: sha256Secret(rawSession),
        csrfHash: sha256Secret(rawCsrf),
        expiresAt
      });

      const session = {
        sessionId: created.id,
        csrfHash: sha256Secret(rawCsrf),
        expiresAt: created.expiresAt,
        user: {
          id: user.id,
          email: user.email,
          displayName: user.display_name
        }
      };
      const payload = await sessionPayload(
        adminStore,
        session,
        commercialStore
      );

      sendJson(
        res,
        200,
        {
          ...payload,
          csrfToken: rawCsrf,
          expiresAt: expiresAt.toISOString()
        },
        {
          "set-cookie": sessionCookie(rawSession, config)
        }
      );
      return true;
    }

    const session = await requireSession(req, adminStore);

    if (req.method === "GET" && url.pathname === "/v1/admin/me") {
      const rawCsrf = randomCsrfToken();
      await adminStore.rotateCsrf(
        session.sessionId,
        sha256Secret(rawCsrf)
      );
      const payload = await sessionPayload(
        adminStore,
        session,
        commercialStore
      );
      sendJson(res, 200, {
        ...payload,
        csrfToken: rawCsrf,
        expiresAt:
          session.expiresAt instanceof Date
            ? session.expiresAt.toISOString()
            : session.expiresAt
      });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/v1/admin/logout") {
      requireCsrf(req, session);
      await adminStore.revokeSession(
        session.sessionId,
        session.user.id
      );
      sendJson(
        res,
        200,
        { ok: true },
        { "set-cookie": clearCookie(config) }
      );
      return true;
    }

    if (req.method === "GET" && url.pathname === "/v1/admin/projects") {
      const projects = await adminStore.listProjects(session.user.id);
      sendJson(res, 200, { projects });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/v1/admin/projects") {
      requireCsrf(req, session);
      const body = await readJson(req);
      const accountId = String(body.accountId || "");
      if (!accountId) {
        throw new AdminStoreError("account_required", 400);
      }
      await adminStore.authorizeAccount(
        session.user.id,
        accountId,
        { write: true }
      );
      let maxProjects = null;
      if (commercialStore) {
        const effective =
          await commercialStore.assertProjectCreateAllowed(
            accountId
          );
        maxProjects =
          Number(effective.maxProjects);
      }
      const input = validateProjectInput(body);
      const project = await adminStore.createProject(
        session.user.id,
        {
          accountId,
          ...input,
          maxProjects
        }
      );
      sendJson(res, 201, { project });
      return true;
    }

    if (platformRequest) {
      if (!commercialStore) {
        sendJson(res, 503, {
          error: "commercial_requires_postgres"
        });
        return true;
      }

      const anyPlatformRole = [
        "superadmin",
        "billing",
        "support",
        "viewer"
      ];

      if (
        req.method === "GET" &&
        url.pathname === "/v1/platform/overview"
      ) {
        const role =
          await commercialStore.requirePlatformRole(
            session.user.id,
            anyPlatformRole
          );
        const overview =
          await commercialStore.platformOverview();
        sendJson(res, 200, {
          role,
          overview
        });
        return true;
      }

      if (
        req.method === "GET" &&
        url.pathname === "/v1/platform/plans"
      ) {
        await commercialStore.requirePlatformRole(
          session.user.id,
          anyPlatformRole
        );
        const plans =
          await commercialStore.listPlans({
            includeArchived: true
          });
        sendJson(res, 200, { plans });
        return true;
      }

      if (
        req.method === "POST" &&
        url.pathname === "/v1/platform/plans"
      ) {
        requireCsrf(req, session);
        await commercialStore.requirePlatformRole(
          session.user.id,
          ["superadmin"]
        );
        const plan =
          await commercialStore.createPlan(
            session.user.id,
            validatePlanInput(
              await readJson(req)
            )
          );
        sendJson(res, 201, { plan });
        return true;
      }

      const planMatch = url.pathname.match(
        /^\/v1\/platform\/plans\/([0-9a-f-]{36})$/
      );
      if (
        planMatch &&
        req.method === "PATCH"
      ) {
        requireCsrf(req, session);
        await commercialStore.requirePlatformRole(
          session.user.id,
          ["superadmin"]
        );
        const plan =
          await commercialStore.updatePlan(
            session.user.id,
            planMatch[1],
            validatePlanInput(
              await readJson(req),
              { partial: true }
            )
          );
        sendJson(res, 200, { plan });
        return true;
      }

      if (
        req.method === "GET" &&
        url.pathname === "/v1/platform/accounts"
      ) {
        await commercialStore.requirePlatformRole(
          session.user.id,
          anyPlatformRole
        );
        const accounts =
          await commercialStore.listPlatformAccounts({
            limit:
              url.searchParams.get("limit") ||
              100
          });
        sendJson(res, 200, { accounts });
        return true;
      }

      const platformAccountCommercial =
        url.pathname.match(
          /^\/v1\/platform\/accounts\/([0-9a-f-]{36})\/commercial$/
        );
      if (
        platformAccountCommercial &&
        req.method === "GET"
      ) {
        const platformRole =
          await commercialStore.requirePlatformRole(
            session.user.id,
            anyPlatformRole
          );
        const commercial =
          await commercialStore
            .accountCommercialOverview(
              platformAccountCommercial[1]
            );
        if (platformRole === "billing") {
          delete commercial.supportCases;
        }
        sendJson(res, 200, {
          accountId:
            platformAccountCommercial[1],
          ...commercial
        });
        return true;
      }

      const platformSubscription =
        url.pathname.match(
          /^\/v1\/platform\/accounts\/([0-9a-f-]{36})\/subscription$/
        );
      if (
        platformSubscription &&
        req.method === "PATCH"
      ) {
        requireCsrf(req, session);
        await commercialStore.requirePlatformRole(
          session.user.id,
          ["superadmin","billing"]
        );
        const commercial =
          await commercialStore.setSubscription({
            accountId:
              platformSubscription[1],
            actorUserId:
              session.user.id,
            patch:
              validateSubscriptionPatch(
                await readJson(req)
              )
          });
        sendJson(res, 200, commercial);
        return true;
      }

      const platformEntitlements =
        url.pathname.match(
          /^\/v1\/platform\/accounts\/([0-9a-f-]{36})\/entitlements$/
        );
      if (
        platformEntitlements &&
        req.method === "PATCH"
      ) {
        requireCsrf(req, session);
        await commercialStore.requirePlatformRole(
          session.user.id,
          ["superadmin"]
        );
        const entitlements =
          await commercialStore
            .setEntitlementOverrides({
              accountId:
                platformEntitlements[1],
              actorUserId:
                session.user.id,
              overrides:
                validateEntitlementOverrides(
                  await readJson(req)
                )
            });
        sendJson(res, 200, entitlements);
        return true;
      }

      const invoiceGenerate =
        url.pathname.match(
          /^\/v1\/platform\/accounts\/([0-9a-f-]{36})\/invoices\/generate$/
        );
      if (
        invoiceGenerate &&
        req.method === "POST"
      ) {
        requireCsrf(req, session);
        await commercialStore.requirePlatformRole(
          session.user.id,
          ["superadmin","billing"]
        );
        const input =
          validateInvoiceGenerate(
            await readJson(req)
          );
        const invoice =
          await commercialStore
            .generateInvoice({
              accountId:
                invoiceGenerate[1],
              actorUserId:
                session.user.id,
              ...input
            });
        sendJson(res, 201, invoice);
        return true;
      }

      const platformInvoice =
        url.pathname.match(
          /^\/v1\/platform\/invoices\/([0-9a-f-]{36})$/
        );
      if (
        platformInvoice &&
        req.method === "PATCH"
      ) {
        requireCsrf(req, session);
        await commercialStore.requirePlatformRole(
          session.user.id,
          ["superadmin","billing"]
        );
        const input =
          validateInvoicePatch(
            await readJson(req)
          );
        const invoice =
          await commercialStore.updateInvoice({
            invoiceId:
              platformInvoice[1],
            actorUserId:
              session.user.id,
            status: input.status
          });
        sendJson(res, 200, { invoice });
        return true;
      }

      if (
        req.method === "GET" &&
        url.pathname ===
          "/v1/platform/support-cases"
      ) {
        await commercialStore.requirePlatformRole(
          session.user.id,
          ["superadmin","support","viewer"]
        );
        const cases =
          await commercialStore
            .listPlatformSupportCases({
              status:
                url.searchParams.get("status") ||
                "",
              limit:
                url.searchParams.get("limit") ||
                100
            });
        sendJson(res, 200, {
          supportCases: cases
        });
        return true;
      }

      const platformCase = url.pathname.match(
        /^\/v1\/platform\/support-cases\/([0-9a-f-]{36})(?:\/(messages))?$/
      );
      if (platformCase) {
        const caseId = platformCase[1];
        const resource =
          platformCase[2] || "";

        if (
          req.method === "GET" &&
          resource === "messages"
        ) {
          await commercialStore
            .requirePlatformRole(
              session.user.id,
              ["superadmin","support","viewer"]
            );
          const messages =
            await commercialStore
              .listCaseMessages(
                caseId,
                { includeInternal: true }
              );
          sendJson(res, 200, {
            caseId,
            messages
          });
          return true;
        }

        if (
          req.method === "PATCH" &&
          resource === ""
        ) {
          requireCsrf(req, session);
          await commercialStore
            .requirePlatformRole(
              session.user.id,
              ["superadmin","support"]
            );
          const supportCase =
            await commercialStore
              .updateSupportCase({
                caseId,
                actorUserId:
                  session.user.id,
                patch:
                  validateSupportPatch(
                    await readJson(req)
                  )
              });
          sendJson(res, 200, {
            supportCase
          });
          return true;
        }

        if (
          req.method === "POST" &&
          resource === "messages"
        ) {
          requireCsrf(req, session);
          await commercialStore
            .requirePlatformRole(
              session.user.id,
              ["superadmin","support"]
            );
          const input =
            validateSupportMessage(
              await readJson(req),
              { platform: true }
            );
          const message =
            await commercialStore
              .addSupportMessage({
                caseId,
                actorUserId:
                  session.user.id,
                platform: true,
                ...input
              });
          sendJson(res, 201, {
            caseId,
            message
          });
          return true;
        }
      }

      sendJson(res, 404, {
        error: "not_found"
      });
      return true;
    }

    if (adminRequest && commercialStore) {
      const accountCommercial =
        url.pathname.match(
          /^\/v1\/admin\/accounts\/([0-9a-f-]{36})\/(commercial|invoices|support-cases)$/
        );

      if (accountCommercial) {
        const accountId =
          accountCommercial[1];
        const resource =
          accountCommercial[2];

        const account =
          await adminStore.authorizeAccount(
            session.user.id,
            accountId,
            {
              write:
                req.method === "POST"
            }
          );

        if (
          resource === "commercial" &&
          req.method === "GET"
        ) {
          const commercial =
            await commercialStore
              .accountCommercialOverview(
                accountId
              );
          sendJson(res, 200, {
            account,
            ...commercial
          });
          return true;
        }

        if (
          resource === "invoices" &&
          req.method === "GET"
        ) {
          const invoices =
            await commercialStore.listInvoices(
              accountId
            );
          sendJson(res, 200, {
            accountId,
            invoices
          });
          return true;
        }

        if (
          resource === "support-cases" &&
          req.method === "GET"
        ) {
          const supportCases =
            await commercialStore
              .listSupportCases(accountId);
          sendJson(res, 200, {
            accountId,
            supportCases
          });
          return true;
        }

        if (
          resource === "support-cases" &&
          req.method === "POST"
        ) {
          requireCsrf(req, session);
          const input =
            validateSupportCase(
              await readJson(req)
            );
          const supportCase =
            await commercialStore
              .createSupportCase({
                accountId,
                actorUserId:
                  session.user.id,
                ...input
              });
          sendJson(res, 201, {
            supportCase
          });
          return true;
        }
      }

      const tenantCase = url.pathname.match(
        /^\/v1\/admin\/support-cases\/([0-9a-f-]{36})\/messages$/
      );
      if (tenantCase) {
        const caseId = tenantCase[1];
        const accountId =
          await commercialStore
            .accountHasCaseAccess(
              session.user.id,
              caseId
            );
        if (!accountId) {
          throw new AdminStoreError(
            "support_case_not_found",
            404
          );
        }

        if (req.method === "GET") {
          const messages =
            await commercialStore
              .listCaseMessages(caseId);
          sendJson(res, 200, {
            caseId,
            messages
          });
          return true;
        }

        if (req.method === "POST") {
          await adminStore.authorizeAccount(
            session.user.id,
            accountId,
            { write: true }
          );
          requireCsrf(req, session);
          const input =
            validateSupportMessage(
              await readJson(req)
            );
          const message =
            await commercialStore
              .addSupportMessage({
                caseId,
                actorUserId:
                  session.user.id,
                platform: false,
                ...input
              });
          sendJson(res, 201, {
            caseId,
            message
          });
          return true;
        }
      }
    }

    const keyRoute = url.pathname.match(
      /^\/v1\/admin\/projects\/([0-9a-f-]{36})\/keys(?:\/([0-9a-f-]{36})(?:\/(rotate|revoke))?)?$/
    );

    if (keyRoute) {
      if (!keyStore) {
        sendJson(res, 503, { error: "api_keys_require_postgres" });
        return true;
      }

      const projectId = keyRoute[1];
      const keyId = keyRoute[2] || "";
      const action = keyRoute[3] || "";

      if (req.method === "GET" && !keyId) {
        await adminStore.authorizeProject(
          session.user.id,
          projectId
        );
        const keys = await keyStore.listKeys(projectId);
        sendJson(res, 200, { projectId, keys });
        return true;
      }

      if (req.method === "POST" && !keyId) {
        requireCsrf(req, session);
        const project = await adminStore.authorizeProject(
          session.user.id,
          projectId,
          { write: true }
        );
        const input = validateKeyInput(await readJson(req));

        const created = await keyStore.createKey({
          project,
          actorUserId: session.user.id,
          ...input
        });

        sendJson(res, 201, {
          key: created.key,
          secret: created.secret,
          secretShownOnce: true
        });
        return true;
      }

      if (req.method === "PATCH" && keyId && !action) {
        requireCsrf(req, session);
        const project = await adminStore.authorizeProject(
          session.user.id,
          projectId,
          { write: true }
        );
        const input = validateKeyInput(
          await readJson(req),
          { partial: true }
        );
        delete input.scopes;

        if (!Object.keys(input).length) {
          throw new AdminStoreError("empty_api_key_update", 400);
        }

        const key = await keyStore.updateKey({
          project,
          actorUserId: session.user.id,
          keyId,
          ...input
        });
        sendJson(res, 200, { key });
        return true;
      }

      if (
        req.method === "POST" &&
        keyId &&
        action === "rotate"
      ) {
        requireCsrf(req, session);
        const project = await adminStore.authorizeProject(
          session.user.id,
          projectId,
          { write: true }
        );
        const rotated = await keyStore.rotateKey({
          project,
          actorUserId: session.user.id,
          keyId
        });
        sendJson(res, 201, {
          key: rotated.key,
          secret: rotated.secret,
          secretShownOnce: true
        });
        return true;
      }

      if (
        req.method === "POST" &&
        keyId &&
        action === "revoke"
      ) {
        requireCsrf(req, session);
        const project = await adminStore.authorizeProject(
          session.user.id,
          projectId,
          { write: true }
        );
        const key = await keyStore.revokeKey({
          project,
          actorUserId: session.user.id,
          keyId
        });
        sendJson(res, 200, { key });
        return true;
      }
    }

    const clientSecurityMatch = url.pathname.match(
      /^\/v1\/admin\/projects\/([0-9a-f-]{36})\/client-security$/
    );

    if (clientSecurityMatch) {
      if (!clientSecurityStore) {
        sendJson(res, 503, {
          error: "client_security_requires_postgres"
        });
        return true;
      }

      const projectId = clientSecurityMatch[1];

      if (req.method === "GET") {
        await adminStore.authorizeProject(
          session.user.id,
          projectId
        );
        const policy =
          await clientSecurityStore.getPolicy(
            projectId
          );
        sendJson(res, 200, {
          projectId,
          policy,
          clientTokensConfigured:
            Boolean(
              config.clientTokens
                ?.signingKeys?.length
            ),
          playIntegrityConfiguredPackages:
            (
              config.clientTokens
                ?.playIntegrityApps || []
            ).map((item) => item.packageName)
        });
        return true;
      }

      if (req.method === "PATCH") {
        requireCsrf(req, session);
        const project =
          await adminStore.authorizeProject(
            session.user.id,
            projectId,
            { write: true }
          );
        const patch =
          validateClientSecurityPatch(
            await readJson(req)
          );
        const policy =
          await clientSecurityStore.updatePolicy({
            project,
            actorUserId:
              session.user.id,
            patch
          });
        sendJson(res, 200, {
          projectId,
          policy
        });
        return true;
      }
    }

    const operationsMatch = url.pathname.match(
      /^\/v1\/admin\/projects\/([0-9a-f-]{36})\/operations\/(limits|metrics|security-events)$/
    );

    if (operationsMatch) {
      if (!opsStore) {
        sendJson(res, 503, { error: "operations_require_postgres" });
        return true;
      }

      const projectId = operationsMatch[1];
      const resource = operationsMatch[2];

      if (req.method === "GET" && resource === "limits") {
        await adminStore.authorizeProject(session.user.id, projectId);
        const limits = await opsStore.getProjectLimits(projectId);
        sendJson(res, 200, { projectId, limits });
        return true;
      }

      if (req.method === "PATCH" && resource === "limits") {
        requireCsrf(req, session);
        const project = await adminStore.authorizeProject(
          session.user.id,
          projectId,
          { write: true }
        );
        const patch = validateLimitsInput(await readJson(req));
        const limits = await opsStore.updateProjectLimits({
          project,
          actorUserId: session.user.id,
          patch
        });
        sendJson(res, 200, { projectId, limits });
        return true;
      }

      if (req.method === "GET" && resource === "metrics") {
        await adminStore.authorizeProject(session.user.id, projectId);
        const metrics = await opsStore.getProjectMetrics(projectId, {
          hours: url.searchParams.get("hours") || 24
        });
        sendJson(res, 200, { projectId, metrics });
        return true;
      }

      if (req.method === "GET" && resource === "security-events") {
        await adminStore.authorizeProject(session.user.id, projectId);
        const page = await opsStore.listSecurityEvents(projectId, {
          limit: url.searchParams.get("limit") || 50,
          cursor: url.searchParams.get("cursor") || ""
        });
        sendJson(res, 200, { projectId, ...page });
        return true;
      }
    }

    const projectMatch = url.pathname.match(
      /^\/v1\/admin\/projects\/([0-9a-f-]{36})(?:\/(users|summary|clusters|history|heatmap))?$/
    );

    if (projectMatch) {
      const projectId = projectMatch[1];
      const resource = projectMatch[2] || "";

      if (req.method === "GET" && resource === "users") {
        await adminStore.authorizeProject(
          session.user.id,
          projectId
        );
        const page =
          typeof geoStore.listUsersPage === "function"
            ? await geoStore.listUsersPage(projectId, {
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
                users: await geoStore.listUsers(projectId, {
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
        sendJson(res, 200, { projectId, ...page });
        return true;
      }

      if (
        req.method === "GET" &&
        resource === "history"
      ) {
        await adminStore
          .authorizeProject(
            session.user.id,
            projectId
          );

        if (commercialStore) {
          await commercialStore
            .assertProjectFeature(
              projectId,
              "movementHistory"
            );
        }

        if (
          typeof geoStore
            .listMovementHistoryPage !==
          "function"
        ) {
          sendJson(res, 501, {
            error:
              "movement_history_unavailable"
          });
          return true;
        }

        const query =
          parseMovementHistoryQuery(
            url.searchParams
          );
        const page =
          await geoStore
            .listMovementHistoryPage(
              projectId,
              query
            );
        sendJson(res, 200, {
          projectId,
          userId: query.userId,
          window: {
            from: query.from,
            to: query.to
          },
          ...page
        });
        return true;
      }

      if (
        req.method === "GET" &&
        resource === "heatmap"
      ) {
        await adminStore
          .authorizeProject(
            session.user.id,
            projectId
          );

        if (commercialStore) {
          await commercialStore
            .assertProjectFeature(
              projectId,
              "heatmap"
            );
        }

        if (
          typeof geoStore
            .heatmapHistory !==
          "function"
        ) {
          sendJson(res, 501, {
            error:
              "heatmap_unavailable"
          });
          return true;
        }

        const query =
          parseHeatmapQuery(
            url.searchParams
          );
        const cells =
          await geoStore
            .heatmapHistory(
              projectId,
              query
            );
        sendJson(res, 200, {
          projectId,
          window: {
            from: query.from,
            to: query.to
          },
          gridDegrees:
            query.gridDegrees,
          userId:
            query.userId || null,
          cells
        });
        return true;
      }

      if (req.method === "GET" && resource === "summary") {
        await adminStore.authorizeProject(
          session.user.id,
          projectId
        );
        const summary = await geoStore.summary(
          projectId,
          config.thresholds
        );
        sendJson(res, 200, { projectId, ...summary });
        return true;
      }

      if (req.method === "GET" && resource === "clusters") {
        await adminStore.authorizeProject(
          session.user.id,
          projectId
        );
        if (typeof geoStore.clusterUsers !== "function") {
          sendJson(res, 501, { error: "clustering_unavailable" });
          return true;
        }
        const clusters = await geoStore.clusterUsers(projectId, {
          gridDegrees: url.searchParams.get("gridDegrees") || 8,
          status: url.searchParams.get("status") || "",
          country: url.searchParams.get("country") || "",
          state: url.searchParams.get("state") || "",
          city: url.searchParams.get("city") || "",
          thresholds: config.thresholds
        });
        sendJson(res, 200, { projectId, clusters });
        return true;
      }

      if (resource === "" && req.method === "PATCH") {
        requireCsrf(req, session);
        const body = await readJson(req);
        const patch = validateProjectInput(
          body,
          { partial: true }
        );
        if (!Object.keys(patch).length) {
          throw new AdminStoreError(
            "empty_project_update",
            400
          );
        }
        const project = await adminStore.updateProject(
          session.user.id,
          projectId,
          patch
        );
        sendJson(res, 200, { project });
        return true;
      }

      if (resource === "" && req.method === "DELETE") {
        requireCsrf(req, session);
        await adminStore.deleteProject(
          session.user.id,
          projectId
        );
        sendJson(res, 200, { ok: true });
        return true;
      }
    }

    sendJson(res, 404, { error: "not_found" });
    return true;
  } catch (error) {
    if (
      error instanceof AdminStoreError ||
      (error?.status && error?.code)
    ) {
      sendJson(
        res,
        error.status || 400,
        { error: error.code }
      );
      return true;
    }

    console.error("GeoLive admin API failed", error);
    sendJson(res, 500, { error: "internal_error" });
    return true;
  }
}
