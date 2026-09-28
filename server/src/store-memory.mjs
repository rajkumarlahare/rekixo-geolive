import { presenceStatus } from "./status.mjs";
import {
  decodeCursor,
  encodeCursor
} from "./cursor.mjs";

export class MemoryGeoLiveStore {
  #projects = new Map();

  #project(projectId) {
    let project = this.#projects.get(projectId);
    if (!project) {
      project = {
        users: new Map(),
        history: [],
        historySequence: 0
      };
      this.#projects.set(projectId, project);
    }
    return project;
  }

  async upsertLocation(projectId, observation) {
    const project = this.#project(projectId);
    const existing = project.users.get(observation.userId) || {};
    const row = {
      ...existing,
      ...observation,
      projectId,
      firstSeenAt: existing.firstSeenAt || observation.receivedAt,
      lastSeenAt: observation.receivedAt
    };
    project.users.set(observation.userId, row);
    project.historySequence += 1;
    project.history.push({
      ...row,
      historyId:
        String(project.historySequence)
    });
    if (project.history.length > 10000) {
      project.history.splice(0, project.history.length - 10000);
    }
    return { ...row };
  }

  async listUsers(projectId, { search = "", status = "", country = "", state = "", city = "", limit = 500, thresholds } = {}) {
    const project = this.#project(projectId);
    const now = new Date();
    const needle = search.toLowerCase().trim();
    return [...project.users.values()]
      .map((row) => ({ ...row, status: presenceStatus(row.lastSeenAt, now, thresholds) }))
      .filter((row) => !needle || [row.userId, row.name, row.email].some((v) => String(v || "").toLowerCase().includes(needle)))
      .filter((row) => !status || row.status === status)
      .filter((row) => !country || row.country === country)
      .filter((row) => !state || row.state === state)
      .filter((row) => !city || row.city === city)
      .sort((a, b) => new Date(b.lastSeenAt) - new Date(a.lastSeenAt))
      .slice(0, Math.min(Math.max(Number(limit) || 500, 1), 1000));
  }

  async listMovementHistoryPage(
    projectId,
    {
      userId,
      from,
      to,
      limit = 250,
      cursor = ""
    } = {}
  ) {
    const project =
      this.#project(projectId);
    const pageSize = Math.min(
      Math.max(Number(limit) || 250, 1),
      1000
    );

    const decoded = cursor
      ? decodeCursor(
          cursor,
          ["receivedAt", "id"]
        )
      : null;

    const fromMs =
      new Date(from).getTime();
    const toMs =
      new Date(to).getTime();
    const cursorMs = decoded
      ? new Date(decoded.receivedAt)
          .getTime()
      : null;
    const cursorId = decoded
      ? BigInt(String(decoded.id))
      : null;

    const rows = project.history
      .filter(
        (row) =>
          row.userId === userId
      )
      .filter((row) => {
        const seen =
          new Date(
            row.receivedAt ||
              row.lastSeenAt
          ).getTime();
        return (
          seen >= fromMs &&
          seen < toMs
        );
      })
      .filter((row) => {
        if (!decoded) return true;
        const seen =
          new Date(
            row.receivedAt ||
              row.lastSeenAt
          ).getTime();
        const id =
          BigInt(row.historyId);
        return (
          seen < cursorMs ||
          (
            seen === cursorMs &&
            id < cursorId
          )
        );
      })
      .sort((a, b) => {
        const time =
          new Date(
            b.receivedAt ||
              b.lastSeenAt
          ).getTime() -
          new Date(
            a.receivedAt ||
              a.lastSeenAt
          ).getTime();
        if (time) return time;
        return Number(
          BigInt(b.historyId) -
            BigInt(a.historyId)
        );
      });

    const page =
      rows.slice(0, pageSize + 1);
    const hasMore =
      page.length > pageSize;
    const points =
      page
        .slice(0, pageSize)
        .map((row) => ({
          historyId:
            row.historyId,
          userId: row.userId,
          latitude: row.latitude,
          longitude: row.longitude,
          accuracyM: row.accuracyM,
          altitudeM: row.altitudeM,
          headingDeg: row.headingDeg,
          speedMps: row.speedMps,
          capturedAt:
            row.capturedAt,
          receivedAt:
            row.receivedAt ||
            row.lastSeenAt,
          country: row.country,
          state: row.state,
          city: row.city
        }));

    const last = points.at(-1);
    return {
      points,
      nextCursor:
        hasMore && last
          ? encodeCursor({
              receivedAt:
                last.receivedAt,
              id: last.historyId
            })
          : null
    };
  }

  async heatmapHistory(
    projectId,
    {
      from,
      to,
      gridDegrees = 2,
      userId = ""
    } = {}
  ) {
    const project =
      this.#project(projectId);
    const fromMs =
      new Date(from).getTime();
    const toMs =
      new Date(to).getTime();
    const grid = Math.min(
      Math.max(
        Number(gridDegrees) || 2,
        0.25
      ),
      45
    );
    const cells = new Map();

    for (
      const row of project.history
    ) {
      if (
        userId &&
        row.userId !== userId
      ) {
        continue;
      }
      const seen =
        new Date(
          row.receivedAt ||
            row.lastSeenAt
        ).getTime();
      if (
        seen < fromMs ||
        seen >= toMs
      ) {
        continue;
      }

      const latitude =
        Math.floor(
          (row.latitude + 90) /
            grid
        ) *
          grid -
        90 +
        grid / 2;
      const longitude =
        Math.floor(
          (row.longitude + 180) /
            grid
        ) *
          grid -
        180 +
        grid / 2;
      const key =
        `${latitude}:${longitude}`;

      let cell =
        cells.get(key);
      if (!cell) {
        cell = {
          latitude,
          longitude,
          count: 0,
          users: new Set(),
          firstSeenAt:
            row.receivedAt ||
            row.lastSeenAt,
          lastSeenAt:
            row.receivedAt ||
            row.lastSeenAt
        };
        cells.set(key, cell);
      }

      cell.count += 1;
      cell.users.add(row.userId);
      if (
        seen <
        new Date(
          cell.firstSeenAt
        ).getTime()
      ) {
        cell.firstSeenAt =
          row.receivedAt ||
          row.lastSeenAt;
      }
      if (
        seen >
        new Date(
          cell.lastSeenAt
        ).getTime()
      ) {
        cell.lastSeenAt =
          row.receivedAt ||
          row.lastSeenAt;
      }
    }

    return [...cells.values()]
      .map((cell) => ({
        latitude:
          cell.latitude,
        longitude:
          cell.longitude,
        count: cell.count,
        uniqueUsers:
          cell.users.size,
        firstSeenAt:
          cell.firstSeenAt,
        lastSeenAt:
          cell.lastSeenAt
      }))
      .sort(
        (a, b) =>
          b.count - a.count
      )
      .slice(0, 10000);
  }

  async clusterUsers(
    projectId,
    {
      gridDegrees = 8,
      status = "",
      country = "",
      state = "",
      city = "",
      thresholds
    } = {}
  ) {
    const users = await this.listUsers(projectId, {
      status,
      country,
      state,
      city,
      limit: 1000,
      thresholds
    });
    const grid = Math.min(
      Math.max(Number(gridDegrees) || 8, 0.25),
      45
    );
    const cells = new Map();

    for (const user of users) {
      const lat =
        Math.floor((user.latitude + 90) / grid) * grid -
        90 +
        grid / 2;
      const lng =
        Math.floor((user.longitude + 180) / grid) * grid -
        180 +
        grid / 2;
      const key = `${lat}:${lng}`;
      let cell = cells.get(key);
      if (!cell) {
        cell = {
          latitude: lat,
          longitude: lng,
          count: 0,
          online: 0,
          recent: 0,
          offline: 0,
          inactive: 0
        };
        cells.set(key, cell);
      }
      cell.count += 1;
      cell[user.status] += 1;
    }

    return [...cells.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 5000);
  }

  async summary(projectId, thresholds) {
    const users = await this.listUsers(projectId, { limit: 1000, thresholds });
    const counts = { total: users.length, online: 0, recent: 0, offline: 0, inactive: 0 };
    for (const user of users) counts[user.status] += 1;
    return counts;
  }

  async historyCount(projectId) {
    return this.#project(projectId).history.length;
  }
}
