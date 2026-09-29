const DEMO_PROJECTS = [
  {
    id: "demo-project-global",
    accountId: "demo-account",
    name: "GeoLive Global Demo",
    slug: "geolive-global-demo",
    status: "active",
    role: "viewer"
  },
  {
    id: "demo-project-india",
    accountId: "demo-account",
    name: "India Operations Demo",
    slug: "india-operations-demo",
    status: "active",
    role: "viewer"
  }
];

const DEMO_ACCOUNT = {
  id: "demo-account",
  name: "Rekixo Demo Workspace",
  role: "viewer"
};

const DEMO_LOCATIONS = [
  ["Mumbai", "Maharashtra", "India", 19.076, 72.8777, 1320],
  ["Delhi", "Delhi", "India", 28.6139, 77.209, 1210],
  ["Bengaluru", "Karnataka", "India", 12.9716, 77.5946, 1040],
  ["Raipur", "Chhattisgarh", "India", 21.2514, 81.6296, 620],
  ["New York", "New York", "United States", 40.7128, -74.006, 1060],
  ["San Francisco", "California", "United States", 37.7749, -122.4194, 780],
  ["Austin", "Texas", "United States", 30.2672, -97.7431, 590],
  ["London", "England", "United Kingdom", 51.5072, -0.1276, 760],
  ["Berlin", "Berlin", "Germany", 52.52, 13.405, 510],
  ["Dubai", "Dubai", "United Arab Emirates", 25.2048, 55.2708, 680],
  ["Singapore", "Singapore", "Singapore", 1.3521, 103.8198, 620],
  ["Tokyo", "Tokyo", "Japan", 35.6762, 139.6503, 830],
  ["Sydney", "New South Wales", "Australia", -33.8688, 151.2093, 520],
  ["São Paulo", "São Paulo", "Brazil", -23.5505, -46.6333, 760],
  ["Toronto", "Ontario", "Canada", 43.6532, -79.3832, 580],
  ["Johannesburg", "Gauteng", "South Africa", -26.2041, 28.0473, 600]
];

const DEMO_TOTAL = DEMO_LOCATIONS.reduce((sum, item) => sum + item[5], 0);

const NAMES = [
  "Aarav Sharma", "Ananya Patel", "Rohan Verma", "Priya Singh",
  "Emma Johnson", "Liam Williams", "Sophia Brown", "Noah Davis",
  "Mia Wilson", "Lucas Martin", "Olivia Taylor", "Ethan Anderson",
  "Aisha Khan", "Arjun Rao", "Meera Nair", "Kabir Mehta",
  "Yuki Tanaka", "Hana Sato", "Mateo Silva", "Lena Fischer"
];

const ago = (minutes) =>
  new Date(Date.now() - minutes * 60 * 1000).toISOString();

function buildUsers() {
  const users = [];
  let index = 0;
  for (const location of DEMO_LOCATIONS) {
    const [city, state, country, latitude, longitude] = location;
    for (let i = 0; i < 16; i += 1) {
      index += 1;
      const statusCycle = i % 10;
      const status =
        statusCycle < 5 ? "online" :
        statusCycle < 7 ? "recent" :
        statusCycle < 9 ? "offline" : "inactive";
      const seenMinutes =
        status === "online" ? i % 4 :
        status === "recent" ? 8 + i * 2 :
        status === "offline" ? 90 + i * 14 : 1440 + i * 60;
      const name = NAMES[(index - 1) % NAMES.length];
      users.push({
        userId: `demo-user-${String(index).padStart(4, "0")}`,
        name,
        email: `user${index}@demo.rekixo.local`,
        status,
        country,
        state,
        city,
        latitude: latitude + ((i % 5) - 2) * 0.07,
        longitude: longitude + ((i % 7) - 3) * 0.08,
        lastSeenAt: ago(seenMinutes),
        device: {
          platform: i % 3 === 0 ? "iOS" : "Android",
          appVersion: `2.${(i % 6) + 1}.${i % 10}`,
          osVersion: i % 3 === 0 ? `iOS ${17 + (i % 2)}` : `Android ${13 + (i % 3)}`
        }
      });
    }
  }
  return users;
}

const USERS = buildUsers();

const GEOFENCES = [
  {
    id: "gf-raipur-hub",
    name: "Raipur Operations Hub",
    status: "active",
    shapeType: "circle",
    latitude: 21.2514,
    longitude: 81.6296,
    radiusM: 6500,
    dwellSeconds: 300
  },
  {
    id: "gf-mumbai-core",
    name: "Mumbai Core Zone",
    status: "active",
    shapeType: "circle",
    latitude: 19.076,
    longitude: 72.8777,
    radiusM: 11500,
    dwellSeconds: 600
  },
  {
    id: "gf-sf-downtown",
    name: "San Francisco Downtown",
    status: "paused",
    shapeType: "polygon",
    points: [
      [-122.431, 37.783],
      [-122.402, 37.789],
      [-122.394, 37.768],
      [-122.424, 37.761],
      [-122.431, 37.783]
    ],
    dwellSeconds: 120
  }
];

const ENDPOINTS = [
  {
    id: "wh-ops",
    name: "Operations Events",
    url: "https://example.invalid/geolive/events",
    status: "active",
    secretGeneration: 3
  },
  {
    id: "wh-crm",
    name: "CRM Automation",
    url: "https://example.invalid/crm/geofence",
    status: "active",
    secretGeneration: 2
  }
];

const ALERT_RULES = [
  {
    id: "rule-raipur",
    name: "Raipur enter + dwell",
    geofenceId: "gf-raipur-hub",
    webhookEndpointId: "wh-ops",
    eventTypes: ["enter", "dwell"],
    enabled: true
  },
  {
    id: "rule-mumbai",
    name: "Mumbai lifecycle",
    geofenceId: "gf-mumbai-core",
    webhookEndpointId: "wh-crm",
    eventTypes: ["enter", "exit", "dwell"],
    enabled: true
  }
];

const EVENT_TYPES = ["enter", "dwell", "exit", "enter", "exit", "dwell"];
const GEOFENCE_EVENTS = Array.from({ length: 18 }, (_, i) => {
  const geofence = GEOFENCES[i % 2];
  const user = USERS[(i * 9 + 3) % USERS.length];
  return {
    eventId: `evt-demo-${i + 1}`,
    eventType: EVENT_TYPES[i % EVENT_TYPES.length],
    geofenceId: geofence.id,
    geofenceName: geofence.name,
    userId: user.userId,
    occurredAt: ago(4 + i * 11),
    payload: {
      location: {
        latitude: user.latitude,
        longitude: user.longitude
      }
    }
  };
});

const WEBHOOK_DELIVERIES = GEOFENCE_EVENTS.slice(0, 12).map((event, i) => {
  const endpoint = ENDPOINTS[i % ENDPOINTS.length];
  const status = ["delivered", "delivered", "retry", "pending", "dead", "delivered"][i % 6];
  return {
    deliveryId: `delivery-demo-${i + 1}`,
    eventId: event.eventId,
    eventType: event.eventType,
    geofenceId: event.geofenceId,
    geofenceName: event.geofenceName,
    userId: event.userId,
    webhookEndpointId: endpoint.id,
    endpointName: endpoint.name,
    endpointUrl: endpoint.url,
    alertRuleId: i % 2 ? "rule-mumbai" : "rule-raipur",
    alertRuleName: i % 2 ? "Mumbai lifecycle" : "Raipur enter + dwell",
    status,
    attemptCount: status === "pending" ? 0 : status === "delivered" ? 1 : 3,
    responseStatus: status === "delivered" ? 204 : status === "retry" ? 503 : null,
    lastError: status === "dead" ? "upstream_timeout" : status === "retry" ? "temporary_upstream_failure" : "",
    createdAt: ago(6 + i * 13),
    deliveredAt: status === "delivered" ? ago(5 + i * 13) : null,
    nextAttemptAt: ["retry", "pending"].includes(status) ? new Date(Date.now() + (i + 1) * 60000).toISOString() : null,
    responseBodyExcerpt: status === "delivered" ? "accepted" : status === "retry" ? "service unavailable" : ""
  };
});

const PLAN = {
  id: "plan-growth",
  code: "growth",
  name: "Growth",
  status: "active",
  currency: "USD",
  monthlyPriceMinor: 4900,
  maxProjects: 10,
  includedIngest: 1000000,
  includedRead: 2000000,
  includedTrackedUsers: 25000,
  overageIngestPer1000Minor: 2,
  overageReadPer1000Minor: 1,
  overageTrackedUserMinor: 5
};

const EFFECTIVE = {
  maxProjects: 10,
  includedIngest: 1000000,
  includedRead: 2000000,
  includedTrackedUsers: 25000,
  realtime: true,
  movementHistory: true,
  heatmap: true,
  geofences: true,
  webhooks: true,
  clientTokens: true,
  androidAttestation: true,
  prioritySupport: true
};

const INVOICES = [
  {
    id: "inv-demo-2026-08",
    invoiceNumber: "RGL-DEMO-2026-08",
    periodStart: "2026-08-01",
    periodEnd: "2026-09-01",
    status: "paid",
    totalMinor: 4900,
    currency: "USD"
  },
  {
    id: "inv-demo-2026-09",
    invoiceNumber: "RGL-DEMO-2026-09",
    periodStart: "2026-09-01",
    periodEnd: "2026-10-01",
    status: "open",
    totalMinor: 5240,
    currency: "USD"
  }
];

const SUPPORT_CASES = [
  {
    id: "case-demo-1",
    accountId: DEMO_ACCOUNT.id,
    accountName: DEMO_ACCOUNT.name,
    category: "integration",
    priority: "high",
    status: "open",
    subject: "Webhook retry behaviour",
    updatedAt: ago(42)
  },
  {
    id: "case-demo-2",
    accountId: DEMO_ACCOUNT.id,
    accountName: DEMO_ACCOUNT.name,
    category: "billing",
    priority: "normal",
    status: "pending_customer",
    subject: "Usage threshold clarification",
    updatedAt: ago(340)
  }
];

const SUPPORT_MESSAGES = {
  "case-demo-1": [
    {
      authorEmail: "viewer@demo.rekixo.local",
      authorType: "tenant",
      body: "Can you confirm how failed webhook deliveries are retried?",
      internal: false,
      createdAt: ago(80)
    },
    {
      authorEmail: "support@rekixo.local",
      authorType: "support",
      body: "Retries use the configured delivery policy and remain visible in the delivery inspector.",
      internal: false,
      createdAt: ago(55)
    },
    {
      authorEmail: "support@rekixo.local",
      authorType: "support",
      body: "Demo note: this public environment never sends outbound webhooks.",
      internal: true,
      createdAt: ago(52)
    }
  ],
  "case-demo-2": [
    {
      authorEmail: "viewer@demo.rekixo.local",
      authorType: "tenant",
      body: "Is usage calculated per project or per account?",
      internal: false,
      createdAt: ago(390)
    },
    {
      authorEmail: "billing@rekixo.local",
      authorType: "support",
      body: "Commercial usage is aggregated at account level while operational metrics remain project scoped.",
      internal: false,
      createdAt: ago(360)
    }
  ]
};

function sessionPayload() {
  return {
    user: {
      id: "demo-viewer",
      displayName: "Public Demo Viewer",
      email: "viewer@demo.rekixo.local"
    },
    platformRole: "viewer",
    accounts: [DEMO_ACCOUNT],
    projects: DEMO_PROJECTS,
    csrfToken: "demo-read-only"
  };
}

function projectSummary(projectId) {
  if (projectId === "demo-project-india") {
    return {
      total: 4190,
      todayActive: 3472,
      online: 1380,
      recent: 760,
      offline: 1475,
      inactive: 575
    };
  }
  return {
    total: DEMO_TOTAL,
    todayActive: Math.round(DEMO_TOTAL * 0.82),
    online: Math.round(DEMO_TOTAL * 0.34),
    recent: Math.round(DEMO_TOTAL * 0.18),
    offline: Math.round(DEMO_TOTAL * 0.35),
    inactive: DEMO_TOTAL -
      Math.round(DEMO_TOTAL * 0.34) -
      Math.round(DEMO_TOTAL * 0.18) -
      Math.round(DEMO_TOTAL * 0.35)
  };
}

function filteredLocations(url, projectId) {
  const country = url.searchParams.get("country") || "";
  const state = url.searchParams.get("state") || "";
  const city = url.searchParams.get("city") || "";
  const indiaOnly = projectId === "demo-project-india";
  return DEMO_LOCATIONS.filter(([c, s, co]) =>
    (!indiaOnly || co === "India") &&
    (!country || co === country) &&
    (!state || s === state) &&
    (!city || c === city)
  );
}

function clustersFor(url, projectId) {
  const status = url.searchParams.get("status") || "";
  return filteredLocations(url, projectId).map(([city, state, country, latitude, longitude, count], i) => {
    const online = Math.round(count * (0.31 + (i % 3) * 0.025));
    const recent = Math.round(count * 0.17);
    const offline = Math.round(count * 0.36);
    const inactive = Math.max(0, count - online - recent - offline);
    const counts = { online, recent, offline, inactive };
    const filteredCount = status ? counts[status] || 0 : count;
    return {
      latitude,
      longitude,
      city,
      state,
      country,
      count: filteredCount,
      online: status && status !== "online" ? 0 : online,
      recent: status && status !== "recent" ? 0 : recent,
      offline: status && status !== "offline" ? 0 : offline,
      inactive: status && status !== "inactive" ? 0 : inactive
    };
  }).filter((item) => item.count > 0);
}

function usersFor(url, projectId) {
  const q = (url.searchParams.get("search") || "").toLowerCase();
  const status = url.searchParams.get("status") || "";
  const country = url.searchParams.get("country") || "";
  const state = url.searchParams.get("state") || "";
  const city = url.searchParams.get("city") || "";
  const indiaOnly = projectId === "demo-project-india";

  let rows = USERS.filter((user) =>
    (!indiaOnly || user.country === "India") &&
    (!status || user.status === status) &&
    (!country || user.country === country) &&
    (!state || user.state === state) &&
    (!city || user.city === city)
  );

  if (q) {
    rows = rows.filter((user) =>
      [
        user.userId,
        user.name,
        user.email,
        user.city,
        user.state,
        user.country
      ].some((value) => String(value || "").toLowerCase().includes(q))
    );
  }

  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") || 50)));
  const offset = Math.max(0, Number(url.searchParams.get("cursor") || 0));
  const users = rows.slice(offset, offset + limit);
  const nextCursor = offset + limit < rows.length ? String(offset + limit) : null;
  return { users, nextCursor };
}

function commercialPayload() {
  return {
    account: DEMO_ACCOUNT,
    plan: PLAN,
    subscription: {
      status: "active",
      periodStart: "2026-09-01",
      periodEnd: "2026-10-01"
    },
    effective: EFFECTIVE,
    overrides: {},
    usage: {
      metrics: {
        ingestRequests: 684320,
        readRequests: 1284510,
        trackedUsers: DEMO_TOTAL
      }
    },
    invoices: INVOICES,
    supportCases: SUPPORT_CASES
  };
}

function deliveryDetail(id) {
  const delivery = WEBHOOK_DELIVERIES.find((item) => item.deliveryId === id) || WEBHOOK_DELIVERIES[0];
  const attempts = Array.from({ length: Math.max(1, delivery.attemptCount || 1) }, (_, i) => ({
    attemptNumber: i + 1,
    responseStatus:
      delivery.status === "delivered" && i === (delivery.attemptCount || 1) - 1
        ? 204
        : delivery.status === "pending"
          ? null
          : i === 0 ? 503 : null,
    errorText:
      delivery.status === "delivered" && i === (delivery.attemptCount || 1) - 1
        ? ""
        : delivery.status === "pending" ? "" : "temporary_upstream_failure",
    latencyMs: 85 + i * 130,
    startedAt: ago(7 + i * 2)
  }));
  return { delivery, attempts };
}

function historyFor(url) {
  const userId = url.searchParams.get("userId") || USERS[0].userId;
  const user = USERS.find((item) => item.userId === userId) || USERS[0];
  return {
    points: Array.from({ length: 48 }, (_, i) => ({
      userId,
      latitude: user.latitude + Math.sin(i / 5) * 0.06,
      longitude: user.longitude + Math.cos(i / 6) * 0.08,
      recordedAt: ago(i * 12)
    })),
    nextCursor: null
  };
}

function heatmapFor(projectId) {
  return {
    cells: filteredLocations(new URL("https://demo.local"), projectId).map((item, i) => ({
      latitude: item[3],
      longitude: item[4],
      count: 25 + ((i * 47) % 260)
    }))
  };
}

export function demoModeEnabled(locationLike = globalThis.location) {
  try {
    const params = new URLSearchParams(locationLike?.search || "");
    return params.get("demo") === "1";
  } catch {
    return false;
  }
}

export function demoRealtimeMessage(sequence = Date.now()) {
  const user = USERS[Math.floor(Math.random() * USERS.length)];
  return {
    type: "location",
    sequence: String(sequence),
    payload: {
      ...user,
      status: "online",
      latitude: user.latitude + (Math.random() - 0.5) * 0.015,
      longitude: user.longitude + (Math.random() - 0.5) * 0.015,
      lastSeenAt: new Date().toISOString()
    }
  };
}

export async function demoApi(path, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const url = new URL(path, "https://demo.rekixo.local");
  const pathname = url.pathname;

  if (pathname === "/v1/admin/me" || pathname === "/v1/admin/login") {
    return sessionPayload();
  }
  if (pathname === "/v1/admin/logout") {
    return { ok: true };
  }

  if (method !== "GET") {
    const error = new Error("Public demo is read-only.");
    error.code = "demo_read_only";
    error.status = 403;
    throw error;
  }

  const projectMatch = pathname.match(/^\/v1\/admin\/projects\/([^/]+)(?:\/(.*))?$/);
  if (projectMatch) {
    const projectId = projectMatch[1];
    const resource = projectMatch[2] || "";

    if (resource === "summary") return projectSummary(projectId);
    if (resource === "clusters") return { clusters: clustersFor(url, projectId) };
    if (resource === "users") return usersFor(url, projectId);
    if (resource === "facets") {
      const locations = filteredLocations(new URL("https://demo.local"), projectId);
      return {
        countries: [...new Set(locations.map((item) => item[2]))].sort(),
        states: [...new Set(locations.map((item) => item[1]))].sort(),
        cities: [...new Set(locations.map((item) => item[0]))].sort()
      };
    }
    if (resource === "operations/metrics") {
      return {
        metrics: {
          totals: {
            requests: 184296,
            errors: 37,
            averageLatencyMs: 42,
            securityEvents: 6
          }
        }
      };
    }
    if (resource === "operations/limits") {
      return {
        limits: {
          ingestRequestsPerMinute: 1200,
          readRequestsPerMinute: 2400,
          dailyIngestQuota: 1000000,
          maxLiveUsers: 25000,
          historyRetentionDays: 30,
          securityEventRetentionDays: 90,
          metricsRetentionDays: 90,
          realtimeEventRetentionHours: 24,
          geofenceEventRetentionDays: 90,
          webhookDeliveryRetentionDays: 30
        }
      };
    }
    if (resource === "operations/security-events") {
      return {
        events: [
          { severity: "info", eventType: "api_key_used", createdAt: ago(9), keyRef: "rgl_live_demo", metadata: { route: "/v1/location" } },
          { severity: "warning", eventType: "rate_limit_near_threshold", createdAt: ago(38), keyRef: "rgl_live_demo", metadata: { group: "ingest" } },
          { severity: "info", eventType: "client_token_issued", createdAt: ago(72), keyRef: "issuer_demo", metadata: { route: "/v1/client-tokens" } }
        ]
      };
    }
    if (resource === "client-security") {
      return {
        clientTokensConfigured: true,
        playIntegrityConfiguredPackages: ["com.rekixo.finworkar.demo"],
        policy: {
          clientTokenTtlSeconds: 300,
          requestMaxAgeSeconds: 120,
          tokenExchangeRequestsPerMinute: 120,
          requireRequestProof: true,
          androidAttestationMode: "enforce"
        }
      };
    }
    if (resource === "geofences") return { geofences: GEOFENCES };
    if (resource === "webhook-endpoints") return { endpoints: ENDPOINTS };
    if (resource === "alert-rules") return { alertRules: ALERT_RULES };
    if (resource === "geofence-events") return { events: GEOFENCE_EVENTS, nextCursor: null };
    if (resource === "webhook-deliveries") return { deliveries: WEBHOOK_DELIVERIES, nextCursor: null };
    if (resource.startsWith("webhook-deliveries/")) {
      return deliveryDetail(resource.split("/")[1]);
    }
    if (resource === "keys") {
      return {
        keys: [
          { id: "key-demo-1", name: "Production ingest", prefix: "rgl_live_demo", status: "active", scopes: ["location:write"], expiresAt: "2026-12-31T00:00:00.000Z", lastUsedAt: ago(3) },
          { id: "key-demo-2", name: "Read analytics", prefix: "rgl_read_demo", status: "active", scopes: ["users:read", "history:read", "summary:read", "events:read"], expiresAt: "2027-01-31T00:00:00.000Z", lastUsedAt: ago(18) },
          { id: "key-demo-3", name: "Client token issuer", prefix: "rgl_issue_demo", status: "active", scopes: ["tokens:issue"], expiresAt: null, lastUsedAt: ago(61) }
        ]
      };
    }
    if (resource === "heatmap") return heatmapFor(projectId);
    if (resource === "history") return historyFor(url);
  }

  const commercialMatch = pathname.match(/^\/v1\/admin\/accounts\/([^/]+)\/commercial$/);
  if (commercialMatch) return commercialPayload();

  const tenantMessages = pathname.match(/^\/v1\/admin\/support-cases\/([^/]+)\/messages$/);
  if (tenantMessages) {
    return { messages: SUPPORT_MESSAGES[tenantMessages[1]] || [] };
  }

  if (pathname === "/v1/platform/overview") {
    return {
      overview: {
        accounts: 42,
        subscriptions: { active: 36, trialing: 3, pastDue: 2, canceled: 1 },
        invoices: {
          byCurrency: {
            USD: { billedMinor: 184200, paidMinor: 161900 }
          }
        },
        support: { open: 7, urgent: 1 }
      }
    };
  }
  if (pathname === "/v1/platform/plans") {
    return {
      plans: [
        { ...PLAN, id: "plan-starter", code: "starter", name: "Starter", monthlyPriceMinor: 1900, maxProjects: 3, includedIngest: 200000, includedRead: 500000, includedTrackedUsers: 5000 },
        PLAN,
        { ...PLAN, id: "plan-scale", code: "scale", name: "Scale", monthlyPriceMinor: 12900, maxProjects: 50, includedIngest: 5000000, includedRead: 10000000, includedTrackedUsers: 100000 }
      ]
    };
  }
  if (pathname === "/v1/platform/accounts") {
    return {
      accounts: [
        { ...DEMO_ACCOUNT, projectCount: 2, plan: PLAN, subscriptionStatus: "active" },
        { id: "acct-northstar", name: "Northstar Logistics", projectCount: 6, plan: PLAN, subscriptionStatus: "active" },
        { id: "acct-fieldops", name: "FieldOps Labs", projectCount: 3, plan: { ...PLAN, name: "Starter", id: "plan-starter" }, subscriptionStatus: "trialing" }
      ]
    };
  }
  if (pathname === "/v1/platform/support-cases") {
    return { supportCases: SUPPORT_CASES };
  }

  const platformCommercial = pathname.match(/^\/v1\/platform\/accounts\/([^/]+)\/commercial$/);
  if (platformCommercial) return commercialPayload();

  const platformMessages = pathname.match(/^\/v1\/platform\/support-cases\/([^/]+)\/messages$/);
  if (platformMessages) {
    return { messages: SUPPORT_MESSAGES[platformMessages[1]] || [] };
  }

  const error = new Error(`Demo endpoint not implemented: ${pathname}`);
  error.code = "demo_endpoint_unavailable";
  error.status = 404;
  throw error;
}
