function fail(code, status = 400) {
  throw Object.assign(new Error(code), {
    code,
    status
  });
}

function textValue(value, min, max, code) {
  const text = String(value || "").trim();
  if (text.length < min || text.length > max) {
    fail(code);
  }
  return text;
}

function nonNegativeInt(value, code, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (
    !Number.isSafeInteger(number) ||
    number < 0 ||
    number > max
  ) {
    fail(code);
  }
  return number;
}

export function validatePlanInput(
  body,
  { partial = false } = {}
) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    fail("invalid_plan");
  }
  const out = {};

  if (!partial || body.code !== undefined) {
    const code = textValue(
      body.code,
      2,
      63,
      "invalid_plan_code"
    ).toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{1,62}$/.test(code)) {
      fail("invalid_plan_code");
    }
    out.code = code;
  }

  if (!partial || body.name !== undefined) {
    out.name = textValue(
      body.name,
      2,
      120,
      "invalid_plan_name"
    );
  }

  if (body.status !== undefined) {
    const status = String(body.status);
    if (!["active", "archived"].includes(status)) {
      fail("invalid_plan_status");
    }
    out.status = status;
  }

  if (!partial || body.currency !== undefined) {
    const currency = String(body.currency || "USD").toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      fail("invalid_plan_currency");
    }
    out.currency = currency;
  }

  const integerFields = {
    monthlyPriceMinor: 1000000000000,
    includedIngest: 1000000000000,
    includedRead: 1000000000000,
    includedTrackedUsers: 100000000,
    maxProjects: 1000000,
    overageIngestPer1000Minor: 1000000000,
    overageReadPer1000Minor: 1000000000,
    overageTrackedUserMinor: 1000000000
  };

  for (const [key, max] of Object.entries(integerFields)) {
    if (!partial || body[key] !== undefined) {
      if (
        partial === false &&
        body[key] === undefined
      ) {
        continue;
      }
      const value = nonNegativeInt(
        body[key],
        "invalid_plan_amount",
        max
      );
      if (key === "maxProjects" && value < 1) {
        fail("invalid_plan_amount");
      }
      out[key] = value;
    }
  }

  if (body.features !== undefined) {
    if (
      !body.features ||
      typeof body.features !== "object" ||
      Array.isArray(body.features)
    ) {
      fail("invalid_plan_features");
    }
    const features = {};
    for (const [key, value] of Object.entries(body.features)) {
      if (
        !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key) ||
        typeof value !== "boolean"
      ) {
        fail("invalid_plan_features");
      }
      features[key] = value;
    }
    out.features = features;
  } else if (!partial) {
    out.features = {};
  }

  if (partial && !Object.keys(out).length) {
    fail("empty_plan_update");
  }
  return out;
}

export function validateSubscriptionPatch(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    fail("invalid_subscription");
  }
  const out = {};

  if (body.planId !== undefined) {
    const value = String(body.planId || "");
    if (!/^[0-9a-f-]{36}$/i.test(value)) {
      fail("invalid_plan_id");
    }
    out.planId = value;
  }

  if (body.status !== undefined) {
    const status = String(body.status);
    if (!["trialing","active","past_due","canceled"].includes(status)) {
      fail("invalid_subscription_status");
    }
    out.status = status;
  }

  for (const key of [
    "provider",
    "providerCustomerRef",
    "providerSubscriptionRef"
  ]) {
    if (body[key] !== undefined) {
      const value = String(body[key] || "").trim();
      if (value.length > 240) fail("invalid_subscription");
      out[key] = value || null;
    }
  }

  for (const key of ["periodStart", "periodEnd"]) {
    if (body[key] !== undefined) {
      const value = String(body[key] || "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        fail("invalid_subscription_period");
      }
      out[key] = value;
    }
  }

  if (body.cancelAtPeriodEnd !== undefined) {
    if (typeof body.cancelAtPeriodEnd !== "boolean") {
      fail("invalid_subscription");
    }
    out.cancelAtPeriodEnd = body.cancelAtPeriodEnd;
  }

  if (!Object.keys(out).length) {
    fail("empty_subscription_update");
  }
  return out;
}

export function validateEntitlementOverrides(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    fail("invalid_entitlements");
  }
  const allowed = new Set([
    "maxProjects",
    "includedIngest",
    "includedRead",
    "includedTrackedUsers",
    "realtime",
    "clientTokens",
    "androidAttestation",
    "prioritySupport"
  ]);
  const out = {};
  for (const [key, value] of Object.entries(body)) {
    if (!allowed.has(key)) fail("invalid_entitlement_key");
    if (value === null) {
      out[key] = null;
      continue;
    }
    if (
      key.startsWith("included") ||
      key === "maxProjects"
    ) {
      out[key] = nonNegativeInt(
        value,
        "invalid_entitlement_value",
        1000000000000
      );
      if (key === "maxProjects" && out[key] < 1) {
        fail("invalid_entitlement_value");
      }
    } else if (typeof value === "boolean") {
      out[key] = value;
    } else {
      fail("invalid_entitlement_value");
    }
  }
  if (!Object.keys(out).length) {
    fail("empty_entitlement_update");
  }
  return out;
}

export function validateSupportCase(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    fail("invalid_support_case");
  }
  const category = String(body.category || "technical");
  if (!["billing","technical","account","security","other"].includes(category)) {
    fail("invalid_support_category");
  }
  const priority = String(body.priority || "normal");
  if (!["low","normal","high","urgent"].includes(priority)) {
    fail("invalid_support_priority");
  }
  const projectId = body.projectId
    ? String(body.projectId)
    : null;
  if (
    projectId &&
    !/^[0-9a-f-]{36}$/i.test(projectId)
  ) {
    fail("invalid_project_id");
  }
  return {
    subject: textValue(body.subject, 3, 180, "invalid_support_subject"),
    body: textValue(body.body, 3, 10000, "invalid_support_body"),
    category,
    priority,
    projectId
  };
}

export function validateSupportPatch(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    fail("invalid_support_update");
  }
  const out = {};
  if (body.status !== undefined) {
    const value = String(body.status);
    if (!["open","pending_customer","pending_internal","resolved","closed"].includes(value)) {
      fail("invalid_support_status");
    }
    out.status = value;
  }
  if (body.priority !== undefined) {
    const value = String(body.priority);
    if (!["low","normal","high","urgent"].includes(value)) {
      fail("invalid_support_priority");
    }
    out.priority = value;
  }
  if (body.assignedPlatformUserId !== undefined) {
    const value = body.assignedPlatformUserId
      ? String(body.assignedPlatformUserId)
      : null;
    if (
      value &&
      !/^[0-9a-f-]{36}$/i.test(value)
    ) {
      fail("invalid_assignee");
    }
    out.assignedPlatformUserId = value;
  }
  if (!Object.keys(out).length) fail("empty_support_update");
  return out;
}

export function validateSupportMessage(body, { platform = false } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    fail("invalid_support_message");
  }
  const internal = platform
    ? Boolean(body.internal)
    : false;
  return {
    body: textValue(body.body, 1, 10000, "invalid_support_body"),
    internal
  };
}

export function validateInvoiceGenerate(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    fail("invalid_invoice_request");
  }
  const periodStart = String(body.periodStart || "");
  const periodEnd = String(body.periodEnd || "");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(periodStart) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd) ||
    periodEnd <= periodStart
  ) {
    fail("invalid_invoice_period");
  }
  let dueAt = null;
  if (body.dueAt) {
    const date = new Date(body.dueAt);
    if (Number.isNaN(date.getTime())) {
      fail("invalid_invoice_due_at");
    }
    dueAt = date.toISOString();
  }
  return {
    periodStart,
    periodEnd,
    dueAt,
    taxMinor: body.taxMinor === undefined
      ? 0
      : nonNegativeInt(body.taxMinor, "invalid_invoice_tax", 1000000000000),
    notes: body.notes == null
      ? null
      : textValue(body.notes, 1, 2000, "invalid_invoice_notes")
  };
}

export function validateInvoicePatch(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    fail("invalid_invoice_update");
  }
  const status = String(body.status || "");
  if (!["draft","open","paid","void","uncollectible"].includes(status)) {
    fail("invalid_invoice_status");
  }
  return { status };
}
