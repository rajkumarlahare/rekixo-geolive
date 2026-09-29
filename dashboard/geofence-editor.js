const EARTH_RADIUS_M = 6371008.8;

export function normalizeLongitude(
  value
) {
  return (
    (
      Number(value) +
      540
    ) %
      360
  ) - 180;
}

export function screenToGeo({
  x,
  y,
  width,
  height,
  rotationDegrees = 0,
  zoom = 1
}) {
  const safeWidth =
    Math.max(
      1,
      Number(width) || 0
    );
  const safeHeight =
    Math.max(
      1,
      Number(height) || 0
    );
  const radius =
    Math.min(
      safeWidth * 0.37,
      safeHeight * 0.43
    ) *
    Math.min(
      Math.max(
        Number(zoom) || 1,
        0.7
      ),
      1.5
    );

  const cx =
    safeWidth * 0.5;
  const cy =
    safeHeight * 0.48;
  const nx =
    (
      Number(x) - cx
    ) /
    radius;
  const ny =
    (
      cy - Number(y)
    ) /
    radius;
  const squared =
    nx * nx + ny * ny;

  if (
    !Number.isFinite(
      squared
    ) ||
    squared > 1
  ) {
    return null;
  }

  const nz =
    Math.sqrt(
      Math.max(
        0,
        1 - squared
      )
    );
  const latitude =
    Math.asin(
      Math.max(
        -1,
        Math.min(1, ny)
      )
    ) *
    180 /
    Math.PI;
  const relativeLongitude =
    Math.atan2(nx, nz) *
    180 /
    Math.PI;

  return {
    latitude,
    longitude:
      normalizeLongitude(
        relativeLongitude +
        Number(
          rotationDegrees ||
            0
        )
      )
  };
}

export function haversineMeters(
  first,
  second
) {
  const lat1 =
    Number(first.latitude) *
    Math.PI /
    180;
  const lat2 =
    Number(second.latitude) *
    Math.PI /
    180;
  const deltaLat =
    lat2 - lat1;
  const deltaLng =
    (
      Number(second.longitude) -
      Number(first.longitude)
    ) *
    Math.PI /
    180;

  const sinLat =
    Math.sin(
      deltaLat / 2
    );
  const sinLng =
    Math.sin(
      deltaLng / 2
    );
  const a =
    sinLat * sinLat +
    Math.cos(lat1) *
      Math.cos(lat2) *
      sinLng *
      sinLng;

  return (
    2 *
    EARTH_RADIUS_M *
    Math.asin(
      Math.min(
        1,
        Math.sqrt(a)
      )
    )
  );
}

export function destinationPoint(
  center,
  distanceM,
  bearingDegrees
) {
  const angularDistance =
    Number(distanceM) /
    EARTH_RADIUS_M;
  const bearing =
    Number(
      bearingDegrees
    ) *
    Math.PI /
    180;
  const latitude =
    Number(center.latitude) *
    Math.PI /
    180;
  const longitude =
    Number(center.longitude) *
    Math.PI /
    180;

  const sinLatitude =
    Math.sin(latitude);
  const cosLatitude =
    Math.cos(latitude);
  const sinAngular =
    Math.sin(
      angularDistance
    );
  const cosAngular =
    Math.cos(
      angularDistance
    );

  const nextLatitude =
    Math.asin(
      sinLatitude *
        cosAngular +
      cosLatitude *
        sinAngular *
        Math.cos(bearing)
    );

  const nextLongitude =
    longitude +
    Math.atan2(
      Math.sin(bearing) *
        sinAngular *
        cosLatitude,
      cosAngular -
        sinLatitude *
        Math.sin(
          nextLatitude
        )
    );

  return {
    latitude:
      nextLatitude *
      180 /
      Math.PI,
    longitude:
      normalizeLongitude(
        nextLongitude *
        180 /
        Math.PI
      )
  };
}

export function circlePoints(
  center,
  radiusM,
  segments = 96
) {
  const count =
    Math.min(
      180,
      Math.max(
        24,
        Math.round(
          Number(segments) ||
            96
        )
      )
    );
  const points = [];

  for (
    let index = 0;
    index <= count;
    index += 1
  ) {
    const point =
      destinationPoint(
        center,
        radiusM,
        index /
          count *
          360
      );
    points.push([
      point.longitude,
      point.latitude
    ]);
  }
  return points;
}

export function closePolygon(
  points
) {
  const normalized =
    (points || [])
      .map(
        (point) => [
          Number(point[0]),
          Number(point[1])
        ]
      )
      .filter(
        (point) =>
          point.every(
            Number.isFinite
          )
      );

  if (!normalized.length) {
    return [];
  }

  const first =
    normalized[0];
  const last =
    normalized[
      normalized.length - 1
    ];

  if (
    first[0] !== last[0] ||
    first[1] !== last[1]
  ) {
    normalized.push([
      first[0],
      first[1]
    ]);
  }

  return normalized;
}
