export class GeospatialInputError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function fail(code) {
  throw new GeospatialInputError(code);
}

function parseTimestamp(value, fallback, code) {
  const raw = value == null || value === ""
    ? fallback
    : value;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    fail(code);
  }
  return date;
}

export function parseGeospatialWindow(
  searchParams,
  {
    defaultHours = 24,
    maxDays = 31
  } = {}
) {
  const now = new Date();
  const to = parseTimestamp(
    searchParams.get("to"),
    now,
    "invalid_history_to"
  );
  const from = parseTimestamp(
    searchParams.get("from"),
    new Date(
      to.getTime() -
        defaultHours * 60 * 60 * 1000
    ),
    "invalid_history_from"
  );

  if (from.getTime() >= to.getTime()) {
    fail("invalid_history_window");
  }
  const maxMs =
    maxDays * 24 * 60 * 60 * 1000;
  if (
    to.getTime() - from.getTime() >
    maxMs
  ) {
    fail("history_window_too_large");
  }

  return {
    from: from.toISOString(),
    to: to.toISOString()
  };
}

function optionalUserId(searchParams) {
  const value =
    String(
      searchParams.get("userId") || ""
    ).trim();
  if (!value) return "";
  if (value.length > 160) {
    fail("invalid_user_id");
  }
  return value;
}

export function parseMovementHistoryQuery(
  searchParams
) {
  const userId = optionalUserId(
    searchParams
  );
  if (!userId) {
    fail("user_id_required");
  }

  const limit = Number(
    searchParams.get("limit") || 250
  );
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 1000
  ) {
    fail("invalid_history_limit");
  }

  const cursor =
    String(
      searchParams.get("cursor") || ""
    );
  if (cursor.length > 1024) {
    fail("invalid_cursor");
  }

  return {
    userId,
    limit,
    cursor,
    ...parseGeospatialWindow(
      searchParams
    )
  };
}

export function parseHeatmapQuery(
  searchParams
) {
  const gridDegrees = Number(
    searchParams.get("gridDegrees") ||
      2
  );
  if (
    !Number.isFinite(gridDegrees) ||
    gridDegrees < 0.25 ||
    gridDegrees > 45
  ) {
    fail("invalid_heatmap_grid");
  }

  return {
    userId:
      optionalUserId(searchParams),
    gridDegrees,
    ...parseGeospatialWindow(
      searchParams
    )
  };
}
