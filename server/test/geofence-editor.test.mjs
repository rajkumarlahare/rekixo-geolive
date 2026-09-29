import test from "node:test";
import assert from "node:assert/strict";
import {
  circlePoints,
  closePolygon,
  haversineMeters,
  normalizeLongitude,
  screenToGeo
} from "../../dashboard/geofence-editor.js";

test("P4D screen projection inverts the visible globe center", () => {
  const point = screenToGeo({
    x: 500,
    y: 240,
    width: 1000,
    height: 500,
    rotationDegrees: 81.63,
    zoom: 1
  });

  assert.ok(point);
  assert.ok(
    Math.abs(
      point.latitude
    ) < 0.000001
  );
  assert.ok(
    Math.abs(
      point.longitude -
        81.63
    ) < 0.000001
  );

  assert.equal(
    screenToGeo({
      x: 0,
      y: 0,
      width: 1000,
      height: 500,
      rotationDegrees: 0,
      zoom: 1
    }),
    null
  );
});

test("P4D geofence circle geometry and distance are stable", () => {
  const center = {
    latitude: 21.25,
    longitude: 81.63
  };
  const points = circlePoints(
    center,
    250,
    48
  );

  assert.equal(
    points.length,
    49
  );
  assert.deepEqual(
    points[0],
    points.at(-1)
  );

  for (
    const [longitude, latitude]
    of points.slice(0, 48)
  ) {
    const distance =
      haversineMeters(
        center,
        {
          latitude,
          longitude
        }
      );
    assert.ok(
      Math.abs(
        distance - 250
      ) < 0.5
    );
  }
});

test("P4D polygon closure does not duplicate an already closed shape", () => {
  const open = [
    [81.62, 21.24],
    [81.64, 21.24],
    [81.64, 21.26]
  ];
  const closed =
    closePolygon(open);
  assert.equal(
    closed.length,
    4
  );
  assert.deepEqual(
    closed[0],
    closed.at(-1)
  );

  assert.equal(
    closePolygon(
      closed
    ).length,
    4
  );
  assert.equal(
    normalizeLongitude(540),
    -180
  );
});
