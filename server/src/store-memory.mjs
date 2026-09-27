import { presenceStatus } from "./status.mjs";

export class MemoryGeoLiveStore {
  #projects = new Map();

  #project(projectId) {
    let project = this.#projects.get(projectId);
    if (!project) {
      project = { users: new Map(), history: [] };
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
    project.history.push({ ...row });
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
