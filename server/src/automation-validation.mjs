export class AutomationInputError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function fail(code, status = 400) {
  throw new AutomationInputError(code, status);
}

function text(value, min, max, code) {
  const out = String(value || "").trim();
  if (out.length < min || out.length > max) {
    fail(code);
  }
  return out;
}

function metadata(value) {
  if (value === undefined) return undefined;
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    fail("invalid_geofence_metadata");
  }
  if (
    Buffer.byteLength(
      JSON.stringify(value),
      "utf8"
    ) > 8192
  ) {
    fail("geofence_metadata_too_large");
  }
  return value;
}

function coordinate(value, min, max, code) {
  const number = Number(value);
  if (
    !Number.isFinite(number) ||
    number < min ||
    number > max
  ) {
    fail(code);
  }
  return number;
}

function normalizePolygon(points) {
  if (
    !Array.isArray(points) ||
    points.length < 3 ||
    points.length > 500
  ) {
    fail("invalid_geofence_polygon");
  }

  const normalized = points.map((point) => {
    if (
      !Array.isArray(point) ||
      point.length !== 2
    ) {
      fail("invalid_geofence_polygon");
    }
    return [
      coordinate(
        point[0],
        -180,
        180,
        "invalid_geofence_longitude"
      ),
      coordinate(
        point[1],
        -90,
        90,
        "invalid_geofence_latitude"
      )
    ];
  });

  const [firstLng, firstLat] =
    normalized[0];
  const [lastLng, lastLat] =
    normalized.at(-1);
  if (
    firstLng !== lastLng ||
    firstLat !== lastLat
  ) {
    normalized.push([
      firstLng,
      firstLat
    ]);
  }
  if (normalized.length < 4) {
    fail("invalid_geofence_polygon");
  }

  return normalized;
}

export function validateGeofence(
  body,
  { partial = false } = {}
) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body)
  ) {
    fail("invalid_geofence");
  }

  const out = {};

  if (!partial || body.name !== undefined) {
    out.name = text(
      body.name,
      2,
      120,
      "invalid_geofence_name"
    );
  }

  if (body.status !== undefined) {
    const status = String(body.status);
    if (
      !["active", "paused"].includes(
        status
      )
    ) {
      fail("invalid_geofence_status");
    }
    out.status = status;
  }

  if (
    !partial ||
    body.shapeType !== undefined
  ) {
    const shapeType =
      String(body.shapeType || "");
    if (
      !["circle", "polygon"].includes(
        shapeType
      )
    ) {
      fail("invalid_geofence_shape");
    }
    out.shapeType = shapeType;
  }

  const shapeType =
    out.shapeType ||
    body.shapeType;

  if (
    shapeType === "circle" ||
    body.latitude !== undefined ||
    body.longitude !== undefined ||
    body.radiusM !== undefined
  ) {
    if (
      shapeType !== "circle" &&
      !partial
    ) {
      fail("invalid_geofence_shape");
    }
    if (
      !partial ||
      body.latitude !== undefined
    ) {
      out.latitude = coordinate(
        body.latitude,
        -90,
        90,
        "invalid_geofence_latitude"
      );
    }
    if (
      !partial ||
      body.longitude !== undefined
    ) {
      out.longitude = coordinate(
        body.longitude,
        -180,
        180,
        "invalid_geofence_longitude"
      );
    }
    if (
      !partial ||
      body.radiusM !== undefined
    ) {
      const radiusM = Number(
        body.radiusM
      );
      if (
        !Number.isFinite(radiusM) ||
        radiusM < 10 ||
        radiusM > 1000000
      ) {
        fail("invalid_geofence_radius");
      }
      out.radiusM = radiusM;
    }
  }

  if (
    shapeType === "polygon" ||
    body.points !== undefined
  ) {
    if (
      shapeType !== "polygon" &&
      !partial
    ) {
      fail("invalid_geofence_shape");
    }
    if (
      !partial ||
      body.points !== undefined
    ) {
      out.points =
        normalizePolygon(body.points);
    }
  }

  if (
    body.dwellSeconds !== undefined ||
    !partial
  ) {
    const dwellSeconds = Number(
      body.dwellSeconds ?? 300
    );
    if (
      !Number.isSafeInteger(
        dwellSeconds
      ) ||
      dwellSeconds < 0 ||
      dwellSeconds > 604800
    ) {
      fail(
        "invalid_geofence_dwell_seconds"
      );
    }
    out.dwellSeconds =
      dwellSeconds;
  }

  const cleanMetadata =
    metadata(body.metadata);
  if (cleanMetadata !== undefined) {
    out.metadata = cleanMetadata;
  } else if (!partial) {
    out.metadata = {};
  }

  if (
    partial &&
    !Object.keys(out).length
  ) {
    fail("empty_geofence_update");
  }

  return out;
}

export function validateWebhookEndpoint(
  body,
  {
    partial = false,
    isProduction = false
  } = {}
) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body)
  ) {
    fail("invalid_webhook_endpoint");
  }

  const out = {};

  if (!partial || body.name !== undefined) {
    out.name = text(
      body.name,
      2,
      120,
      "invalid_webhook_name"
    );
  }

  if (!partial || body.url !== undefined) {
    let parsed;
    try {
      parsed = new URL(
        String(body.url || "")
      );
    } catch {
      fail("invalid_webhook_url");
    }

    if (
      parsed.username ||
      parsed.password ||
      parsed.hash
    ) {
      fail("invalid_webhook_url");
    }
    if (
      isProduction
        ? parsed.protocol !== "https:"
        : !["http:", "https:"].includes(
            parsed.protocol
          )
    ) {
      fail("invalid_webhook_url");
    }
    if (
      parsed.href.length > 2048
    ) {
      fail("invalid_webhook_url");
    }

    out.url = parsed.href;
  }

  if (body.status !== undefined) {
    const status = String(body.status);
    if (
      !["active", "paused"].includes(
        status
      )
    ) {
      fail("invalid_webhook_status");
    }
    out.status = status;
  }

  if (
    partial &&
    !Object.keys(out).length
  ) {
    fail("empty_webhook_update");
  }

  return out;
}

export function validateAlertRule(
  body,
  { partial = false } = {}
) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body)
  ) {
    fail("invalid_alert_rule");
  }

  const out = {};
  if (!partial || body.name !== undefined) {
    out.name = text(
      body.name,
      2,
      120,
      "invalid_alert_rule_name"
    );
  }

  if (
    !partial ||
    body.webhookEndpointId !== undefined
  ) {
    const id = String(
      body.webhookEndpointId || ""
    );
    if (
      !/^[0-9a-f-]{36}$/i.test(id)
    ) {
      fail(
        "invalid_webhook_endpoint_id"
      );
    }
    out.webhookEndpointId = id;
  }

  if (body.geofenceId !== undefined) {
    if (
      body.geofenceId === null ||
      body.geofenceId === ""
    ) {
      out.geofenceId = null;
    } else {
      const id = String(
        body.geofenceId
      );
      if (
        !/^[0-9a-f-]{36}$/i.test(id)
      ) {
        fail(
          "invalid_geofence_id"
        );
      }
      out.geofenceId = id;
    }
  } else if (!partial) {
    out.geofenceId = null;
  }

  if (
    body.eventTypes !== undefined ||
    !partial
  ) {
    const values =
      body.eventTypes ??
      ["enter", "exit", "dwell"];
    if (
      !Array.isArray(values) ||
      values.length < 1 ||
      values.length > 3
    ) {
      fail(
        "invalid_alert_event_types"
      );
    }
    const eventTypes = [
      ...new Set(
        values.map(String)
      )
    ];
    if (
      eventTypes.some(
        (value) =>
          ![
            "enter",
            "exit",
            "dwell"
          ].includes(value)
      )
    ) {
      fail(
        "invalid_alert_event_types"
      );
    }
    out.eventTypes =
      eventTypes;
  }

  if (
    body.enabled !== undefined ||
    !partial
  ) {
    const enabled =
      body.enabled === undefined
        ? true
        : body.enabled;
    if (
      typeof enabled !== "boolean"
    ) {
      fail("invalid_alert_enabled");
    }
    out.enabled = enabled;
  }

  if (
    partial &&
    !Object.keys(out).length
  ) {
    fail("empty_alert_rule_update");
  }
  return out;
}

export function parseAutomationListQuery(
  searchParams
) {
  const limit = Number(
    searchParams.get("limit") || 100
  );
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 500
  ) {
    fail("invalid_automation_limit");
  }
  return {
    limit,
    cursor:
      String(
        searchParams.get("cursor") ||
          ""
      )
  };
}
