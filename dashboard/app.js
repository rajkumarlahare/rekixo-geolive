const canvas = document.querySelector("#globe");
const ctx = canvas.getContext("2d");
const search = document.querySelector("#search");
const projectSelect = document.querySelector("#project");
const authOverlay = document.querySelector("#authOverlay");
const projectModal = document.querySelector("#projectModal");

const state = {
  csrf: "",
  user: null,
  platformRole: null,
  accounts: [],
  projects: [],
  billingAccountId: "",
  commercial: null,
  tenantSupportCaseId: "",
  platform: {
    plans: [],
    accounts: [],
    supportCases: [],
    overview: null,
    selectedAccountId: "",
    accountCommercial: null,
    selectedSupportCaseId: ""
  },
  projectId: "",
  users: [],
  filtered: [],
  summary: { total: 0, online: 0, recent: 0, offline: 0, inactive: 0 },
  activeStatus: "",
  rotation: -20,
  zoom: 1,
  paused: false,
  refreshes: 0,
  pollTimer: null,
  projectMode: "create",
  keys: [],
  clusters: [],
  useClusters: false,
  realtimeSocket: null,
  realtimeRetryTimer: null,
  realtimeRetryMs: 1000,
  realtimeSequence: "0",
  realtimeProjectId: "",
  clusterRefreshTimer: null,
  liveRefreshTimer: null
};

const colors = {
  online: "#54d878",
  recent: "#ffc64d",
  offline: "#ff6666",
  inactive: "#8a96a6"
};

const setText = (id, value) => {
  const el = document.querySelector("#" + id);
  if (el) el.textContent = value;
};

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (options.mutate && state.csrf) {
    headers.set("x-csrf-token", state.csrf);
  }

  const response = await fetch(path, {
    method: options.method || "GET",
    headers,
    body: options.body,
    credentials: "same-origin"
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `HTTP ${response.status}`);
    error.code = payload.error || "request_failed";
    error.status = response.status;
    throw error;
  }
  return payload;
}

function initials(name) {
  return String(name || "RK")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "RK";
}

function projectById(id = state.projectId) {
  return state.projects.find((project) => project.id === id) || null;
}

function canWriteProject(project = projectById()) {
  return Boolean(project && ["owner", "admin"].includes(project.role));
}

function accountById(id) {
  return state.accounts.find(
    (account) => account.id === id
  ) || null;
}

function activeAccountId() {
  const project = projectById();
  if (project?.accountId) {
    return project.accountId;
  }
  if (
    state.billingAccountId &&
    accountById(state.billingAccountId)
  ) {
    return state.billingAccountId;
  }
  return state.accounts[0]?.id || "";
}

function canWriteAccount(account = accountById(activeAccountId())) {
  return Boolean(
    account &&
    ["owner", "admin"].includes(account.role)
  );
}

function populateProjectSelect() {
  projectSelect.innerHTML = "";
  if (!state.projects.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No projects yet";
    projectSelect.appendChild(option);
    projectSelect.disabled = true;
  } else {
    for (const project of state.projects) {
      const option = document.createElement("option");
      option.value = project.id;
      option.textContent = project.status === "suspended"
        ? `${project.name} · Suspended`
        : project.name;
      projectSelect.appendChild(option);
    }
    projectSelect.disabled = false;
  }

  const remembered = sessionStorage.getItem("geolive.projectId");
  if (remembered && state.projects.some((p) => p.id === remembered)) {
    state.projectId = remembered;
  } else if (!state.projects.some((p) => p.id === state.projectId)) {
    state.projectId = state.projects[0]?.id || "";
  }
  projectSelect.value = state.projectId;

  const writableAccounts = state.accounts.filter((account) =>
    ["owner", "admin"].includes(account.role)
  );
  document.querySelector("#newProject").disabled = writableAccounts.length === 0;
  document.querySelector("#editProject").disabled = !canWriteProject();
  document.querySelector("#manageKeys").disabled = !state.projectId;
  document.querySelector("#manageOps").disabled = !state.projectId;
  document.querySelector("#manageBilling").disabled =
    state.accounts.length === 0;
  document.querySelector("#platformConsole").hidden =
    !state.platformRole;
}

function applyIdentity() {
  setText("adminName", state.user?.displayName || "Admin");
  setText("adminEmail", state.user?.email || "Not signed in");
  setText("avatar", initials(state.user?.displayName));
  document.querySelector("#logout").hidden = !state.user;
  search.disabled = !state.user;
}

function resetData() {
  state.users = [];
  state.filtered = [];
  state.clusters = [];
  state.useClusters = false;
  state.summary = { total: 0, online: 0, recent: 0, offline: 0, inactive: 0 };
  state.refreshes = 0;
  updateStats();
  rebuildGeoFilters();
  showDetail({});
  document.querySelector("#emptyState").hidden = false;
  setText("projectState", "No project selected");
  setText("lastUpdated", "Last updated: —");
}

function updateStats() {
  setText("total", state.summary.total);
  setText("online", state.summary.online);
  setText("offline", state.summary.offline);
  setText("recent", state.summary.recent);
  setText("updates", state.refreshes);
  setText("allCount", state.summary.total);
  setText("onlineSide", state.summary.online);
  setText("recentSide", state.summary.recent);
  setText("offlineSide", state.summary.offline);
  setText("liveBadge", state.summary.online);
  setText(
    "showingCount",
    state.useClusters
      ? state.summary.total
      : state.filtered.length
  );
}

function unique(field) {
  return [...new Set(state.users.map((u) => u[field]).filter(Boolean))].sort();
}

function fillSelect(id, values, label) {
  const el = document.querySelector("#" + id);
  const current = el.value;
  el.innerHTML = `<option value="">All ${label}</option>`;
  for (const value of values) {
    const option = document.createElement("option");
    option.value = option.textContent = value;
    el.appendChild(option);
  }
  if (values.includes(current)) el.value = current;
}

function rebuildGeoFilters() {
  fillSelect("country", unique("country"), "Countries");
  fillSelect("state", unique("state"), "States");
  fillSelect("city", unique("city"), "Cities");
}

function applyFilters() {
  const q = search.value.toLowerCase().trim();
  const country = document.querySelector("#country").value;
  const region = document.querySelector("#state").value;
  const city = document.querySelector("#city").value;

  state.filtered = state.users.filter((u) =>
    (!state.activeStatus || u.status === state.activeStatus) &&
    (!q || [u.userId, u.name, u.email].some((v) =>
      String(v || "").toLowerCase().includes(q)
    )) &&
    (!country || u.country === country) &&
    (!region || u.state === region) &&
    (!city || u.city === city)
  );

  const hasFilters = Boolean(
    q ||
    state.activeStatus ||
    country ||
    region ||
    city
  );
  state.useClusters = Boolean(
    !hasFilters &&
    state.summary.total > 500 &&
    state.clusters.length
  );

  updateStats();
  const markerCount = state.useClusters
    ? state.clusters.length
    : state.filtered.length;
  document.querySelector("#emptyState").hidden =
    Boolean(state.projectId && markerCount);
}

function clusterGridDegrees() {
  if (state.zoom <= 0.8) return 15;
  if (state.zoom <= 1.0) return 10;
  if (state.zoom <= 1.2) return 6;
  if (state.zoom <= 1.35) return 4;
  return 2.5;
}

async function loadClusters() {
  const project = projectById();
  if (!project || state.summary.total <= 500) {
    state.clusters = [];
    state.useClusters = false;
    return;
  }

  const payload = await api(
    `/v1/admin/projects/${project.id}/clusters?gridDegrees=${encodeURIComponent(clusterGridDegrees())}`
  );
  state.clusters = payload.clusters || [];
  applyFilters();
}

function scheduleClusterRefresh(delay = 250) {
  clearTimeout(state.clusterRefreshTimer);
  state.clusterRefreshTimer = setTimeout(() => {
    loadClusters().catch(() => {});
  }, delay);
}

async function refreshLiveSummary() {
  const project = projectById();
  if (!project) return;

  const summaryPayload = await api(
    `/v1/admin/projects/${project.id}/summary`
  );
  state.summary = {
    total: summaryPayload.total || 0,
    online: summaryPayload.online || 0,
    recent: summaryPayload.recent || 0,
    offline: summaryPayload.offline || 0,
    inactive: summaryPayload.inactive || 0
  };

  if (state.summary.total > 500) {
    await loadClusters();
  } else {
    state.clusters = [];
  }
  applyFilters();
}

function scheduleLiveRefresh() {
  clearTimeout(state.liveRefreshTimer);
  state.liveRefreshTimer = setTimeout(() => {
    refreshLiveSummary().catch(() => {});
  }, 1000);
}

async function loadProject({ quiet = false } = {}) {
  const project = projectById();
  if (!project) {
    resetData();
    return;
  }

  sessionStorage.setItem("geolive.projectId", project.id);
  setText("projectState", `${project.status.toUpperCase()} · ${project.role}`);

  try {
    const summaryPayload = await api(
      `/v1/admin/projects/${project.id}/summary`
    );
    state.summary = {
      total: summaryPayload.total || 0,
      online: summaryPayload.online || 0,
      recent: summaryPayload.recent || 0,
      offline: summaryPayload.offline || 0,
      inactive: summaryPayload.inactive || 0
    };

    const requests = [
      api(`/v1/admin/projects/${project.id}/users?limit=500`)
    ];
    if (state.summary.total > 500) {
      requests.push(
        api(
          `/v1/admin/projects/${project.id}/clusters?gridDegrees=${encodeURIComponent(clusterGridDegrees())}`
        )
      );
    }

    const [usersPayload, clustersPayload] =
      await Promise.all(requests);

    state.users = usersPayload.users || [];
    state.clusters = clustersPayload?.clusters || [];
    state.refreshes += 1;

    rebuildGeoFilters();
    applyFilters();
    setText(
      "lastUpdated",
      `Last updated: ${new Date().toLocaleTimeString()}`
    );

    if (!quiet) showDetail({});
  } catch (error) {
    if (error.status === 401) {
      showLogin("Your session expired. Sign in again.");
      return;
    }
    setText("lastUpdated", `Refresh failed: ${error.code}`);
  }
}

function isNewerSequence(next, current) {
  try {
    return BigInt(String(next || "0")) >
      BigInt(String(current || "0"));
  } catch {
    return false;
  }
}

function applyRealtimeLocation(message) {
  const user = {
    ...(message.payload || {}),
    status: "online"
  };
  if (!user.userId) return;

  const index = state.users.findIndex(
    (item) => item.userId === user.userId
  );
  if (index >= 0) {
    state.users[index] = {
      ...state.users[index],
      ...user
    };
  } else if (state.users.length < 500) {
    state.users.unshift(user);
  }

  if (
    message.sequence &&
    isNewerSequence(
      message.sequence,
      state.realtimeSequence
    )
  ) {
    state.realtimeSequence =
      String(message.sequence);
  }

  state.refreshes += 1;
  rebuildGeoFilters();
  applyFilters();
  scheduleLiveRefresh();
  setText(
    "lastUpdated",
    `Live: ${new Date().toLocaleTimeString()}`
  );
}

function stopRealtime({ resetSequence = false } = {}) {
  clearTimeout(state.realtimeRetryTimer);
  state.realtimeRetryTimer = null;

  const socket = state.realtimeSocket;
  state.realtimeSocket = null;
  if (socket) {
    try {
      socket.close(1000, "project_change");
    } catch {}
  }

  if (resetSequence) {
    state.realtimeSequence = "0";
    state.realtimeProjectId = "";
    state.realtimeRetryMs = 1000;
  }
}

function startRealtime() {
  const project = projectById();
  if (!project || !state.user) return;

  if (state.realtimeProjectId !== project.id) {
    stopRealtime({ resetSequence: true });
    state.realtimeProjectId = project.id;
  } else {
    stopRealtime();
  }

  const protocol =
    location.protocol === "https:" ? "wss:" : "ws:";
  const url = new URL(
    `${protocol}//${location.host}/v1/admin/realtime`
  );
  url.searchParams.set("projectId", project.id);
  url.searchParams.set(
    "after",
    state.realtimeSequence || "0"
  );

  const socket = new WebSocket(url);
  state.realtimeSocket = socket;

  socket.addEventListener("open", () => {
    if (state.realtimeSocket !== socket) return;
    state.realtimeRetryMs = 1000;
    setText(
      "projectState",
      `${project.status.toUpperCase()} · ${project.role} · LIVE`
    );
  });

  socket.addEventListener("message", (event) => {
    if (state.realtimeSocket !== socket) return;

    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }

    if (message.type === "location") {
      if (
        !message.sequence ||
        isNewerSequence(
          message.sequence,
          state.realtimeSequence
        )
      ) {
        applyRealtimeLocation(message);
      }
      return;
    }

    if (message.type === "ready") {
      if (
        message.latestSequence &&
        isNewerSequence(
          message.latestSequence,
          state.realtimeSequence
        )
      ) {
        state.realtimeSequence =
          String(message.latestSequence);
      }
      return;
    }

    if (message.type === "resync_required") {
      state.realtimeSequence =
        String(message.latestSequence || "0");
      loadProject({ quiet: true }).catch(() => {});
    }
  });

  socket.addEventListener("close", () => {
    if (state.realtimeSocket !== socket) return;
    state.realtimeSocket = null;
    if (!state.user || state.projectId !== project.id) return;

    setText(
      "projectState",
      `${project.status.toUpperCase()} · ${project.role} · RECONNECTING`
    );

    const delay = state.realtimeRetryMs;
    state.realtimeRetryMs = Math.min(
      state.realtimeRetryMs * 2,
      15000
    );
    state.realtimeRetryTimer = setTimeout(
      startRealtime,
      delay
    );
  });

  socket.addEventListener("error", () => {
    // close event drives reconnect and polling remains a fallback.
  });
}

function startPolling() {
  clearInterval(state.pollTimer);
  if (!state.projectId) return;
  state.pollTimer = setInterval(
    () => loadProject({ quiet: true }),
    60000
  );
}

function hydrateSession(payload) {
  state.user = payload.user;
  state.platformRole = payload.platformRole || null;
  state.accounts = payload.accounts || [];
  state.projects = payload.projects || [];
  state.csrf = payload.csrfToken || "";
  applyIdentity();
  populateProjectSelect();
  authOverlay.hidden = true;

  if (!state.projects.length) {
    resetData();
    openProjectModal("create");
    return;
  }

  loadProject()
    .then(() => startRealtime())
    .catch(() => {});
  startPolling();
}

function showLogin(message = "") {
  clearInterval(state.pollTimer);
  stopRealtime({ resetSequence: true });
  state.user = null;
  state.platformRole = null;
  state.csrf = "";
  state.projects = [];
  state.accounts = [];
  state.billingAccountId = "";
  state.commercial = null;
  state.tenantSupportCaseId = "";
  state.platform = {
    plans: [],
    accounts: [],
    supportCases: [],
    overview: null,
    selectedAccountId: "",
    accountCommercial: null,
    selectedSupportCaseId: ""
  };
  state.projectId = "";
  populateProjectSelect();
  applyIdentity();
  resetData();
  authOverlay.hidden = false;
  setText("loginError", message);
}

document.querySelector("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  setText("loginError", "");
  const button = document.querySelector("#loginButton");
  button.disabled = true;

  try {
    const payload = await api("/v1/admin/login", {
      method: "POST",
      body: JSON.stringify({
        email: document.querySelector("#loginEmail").value,
        password: document.querySelector("#loginPassword").value
      })
    });
    document.querySelector("#loginPassword").value = "";
    hydrateSession(payload);
  } catch (error) {
    const messages = {
      invalid_credentials: "Email or password is incorrect.",
      login_temporarily_locked: "Too many failed attempts. Try again later.",
      login_rate_limited: "Too many sign-in attempts. Try again shortly.",
      admin_requires_postgres: "Admin control plane requires PostgreSQL."
    };
    setText("loginError", messages[error.code] || "Sign in failed.");
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#logout").addEventListener("click", async () => {
  try {
    await api("/v1/admin/logout", {
      method: "POST",
      mutate: true
    });
  } catch {}
  showLogin();
});

projectSelect.addEventListener("change", () => {
  stopRealtime({ resetSequence: true });
  state.projectId = projectSelect.value;
  document.querySelector("#editProject").disabled = !canWriteProject();
  document.querySelector("#manageKeys").disabled = !state.projectId;
  document.querySelector("#manageOps").disabled = !state.projectId;
  document.querySelector("#manageBilling").disabled =
    state.accounts.length === 0;
  loadProject()
    .then(() => startRealtime())
    .catch(() => {});
  startPolling();
});

document.querySelector("#newProject").addEventListener("click", () => openProjectModal("create"));
document.querySelector("#editProject").addEventListener("click", () => openProjectModal("edit"));
document.querySelector("#manageKeys").addEventListener("click", openKeyModal);
document.querySelector("#manageOps").addEventListener("click", openOpsModal);
document.querySelector("#manageBilling").addEventListener("click", openBillingModal);
document.querySelector("#platformConsole").addEventListener("click", openPlatformModal);
document.querySelector("#projectModalClose").addEventListener("click", closeProjectModal);
document.querySelector("#opsModalClose").addEventListener("click", closeOpsModal);
document.querySelector("#refreshOps").addEventListener("click", loadOperations);
document.querySelector("#projectCancel").addEventListener("click", closeProjectModal);
document.querySelector("#keyModalClose").addEventListener("click", closeKeyModal);
document.querySelector("#refreshKeys").addEventListener("click", loadKeys);

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

function openProjectModal(mode) {
  state.projectMode = mode;
  setText("projectError", "");

  const accountSelect = document.querySelector("#projectAccount");
  accountSelect.innerHTML = "";
  const writableAccounts = state.accounts.filter((account) =>
    ["owner", "admin"].includes(account.role)
  );
  for (const account of writableAccounts) {
    const option = document.createElement("option");
    option.value = account.id;
    option.textContent = `${account.name} · ${account.role}`;
    accountSelect.appendChild(option);
  }

  if (mode === "edit") {
    const project = projectById();
    if (!project || !canWriteProject(project)) return;
    setText("projectModalTitle", "Project settings");
    accountSelect.value = project.accountId;
    accountSelect.disabled = true;
    document.querySelector("#projectName").value = project.name;
    document.querySelector("#projectSlug").value = project.slug;
    document.querySelector("#projectStatus").value = project.status;
    document.querySelector("#accountField").hidden = true;
    document.querySelector("#statusField").hidden = false;
    document.querySelector("#deleteProject").hidden = false;
  } else {
    setText("projectModalTitle", "Create project");
    accountSelect.disabled = false;
    document.querySelector("#projectName").value = "";
    document.querySelector("#projectSlug").value = "";
    document.querySelector("#projectStatus").value = "active";
    document.querySelector("#accountField").hidden = writableAccounts.length <= 1;
    document.querySelector("#statusField").hidden = true;
    document.querySelector("#deleteProject").hidden = true;
  }

  projectModal.hidden = false;
  document.querySelector("#projectName").focus();
}

function closeProjectModal() {
  projectModal.hidden = true;
}

document.querySelector("#projectName").addEventListener("input", (event) => {
  if (state.projectMode !== "create") return;
  const slug = document.querySelector("#projectSlug");
  if (!slug.dataset.manual) slug.value = slugify(event.target.value);
});

document.querySelector("#projectSlug").addEventListener("input", (event) => {
  event.target.dataset.manual = event.target.value ? "1" : "";
  event.target.value = slugify(event.target.value);
});

document.querySelector("#projectForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  setText("projectError", "");

  const body = {
    name: document.querySelector("#projectName").value.trim(),
    slug: document.querySelector("#projectSlug").value.trim().toLowerCase()
  };

  try {
    let project;
    if (state.projectMode === "create") {
      body.accountId = document.querySelector("#projectAccount").value;
      const payload = await api("/v1/admin/projects", {
        method: "POST",
        mutate: true,
        body: JSON.stringify(body)
      });
      project = payload.project;
    } else {
      body.status = document.querySelector("#projectStatus").value;
      const payload = await api(`/v1/admin/projects/${state.projectId}`, {
        method: "PATCH",
        mutate: true,
        body: JSON.stringify(body)
      });
      project = payload.project;
    }

    const me = await api("/v1/admin/me");
    state.projectId = project.id;
    closeProjectModal();
    hydrateSession(me);
  } catch (error) {
    const messages = {
      project_slug_exists: "That project slug is already used in this account.",
      invalid_project_slug: "Use lowercase letters, numbers and hyphens only.",
      project_write_forbidden: "Your role is read-only.",
      csrf_invalid: "Security token expired. Reload and try again."
    };
    setText("projectError", messages[error.code] || `Could not save project: ${error.code}`);
  }
});

document.querySelector("#deleteProject").addEventListener("click", async () => {
  const project = projectById();
  if (!project || !canWriteProject(project)) return;
  if (!confirm(`Delete "${project.name}" from the active project list? Location data is retained.`)) return;

  try {
    await api(`/v1/admin/projects/${project.id}`, {
      method: "DELETE",
      mutate: true
    });
    sessionStorage.removeItem("geolive.projectId");
    state.projectId = "";
    closeProjectModal();
    const me = await api("/v1/admin/me");
    hydrateSession(me);
  } catch (error) {
    setText("projectError", `Could not delete project: ${error.code}`);
  }
});


function parseLines(value) {
  return [...new Set(
    String(value || "")
      .split(/[\n,]+/)
      .map((item) => item.trim())
      .filter(Boolean)
  )];
}

function formatKeyTime(value) {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

async function openKeyModal() {
  if (!state.projectId) return;
  setText("keyError", "");
  document.querySelector("#secretReveal").hidden = true;
  document.querySelector("#oneTimeSecret").textContent = "";
  document.querySelector("#keyForm").hidden = !canWriteProject();
  document.querySelector("#keyModal").hidden = false;
  await loadKeys();
}

function closeKeyModal() {
  document.querySelector("#oneTimeSecret").textContent = "";
  document.querySelector("#secretReveal").hidden = true;
  document.querySelector("#keyModal").hidden = true;
}

function revealSecret(secret) {
  document.querySelector("#oneTimeSecret").textContent = secret;
  document.querySelector("#secretReveal").hidden = false;
}

async function loadKeys() {
  const project = projectById();
  if (!project) return;
  try {
    const payload = await api(`/v1/admin/projects/${project.id}/keys`);
    state.keys = payload.keys || [];
    renderKeys();
  } catch (error) {
    setText("keyError", `Could not load keys: ${error.code}`);
  }
}

function renderKeys() {
  const list = document.querySelector("#keyList");
  list.replaceChildren();

  if (!state.keys.length) {
    const empty = document.createElement("div");
    empty.className = "key-empty";
    empty.textContent = "No API keys for this project yet.";
    list.appendChild(empty);
    return;
  }

  for (const key of state.keys) {
    const row = document.createElement("div");
    row.className = "key-row";

    const identity = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = key.name;
    const prefix = document.createElement("code");
    prefix.textContent = key.prefix + "_••••••";
    const status = document.createElement("span");
    status.className = `key-status ${key.status}`;
    status.textContent = key.status;
    identity.append(name, prefix, status);

    const times = document.createElement("div");
    const expiry = document.createElement("small");
    expiry.textContent = `Expires: ${formatKeyTime(key.expiresAt)}`;
    const used = document.createElement("small");
    used.textContent = `Last used: ${formatKeyTime(key.lastUsedAt)}`;
    times.append(expiry, document.createElement("br"), used);

    const scopes = document.createElement("div");
    scopes.className = "key-scopes";
    for (const scope of key.scopes || []) {
      const chip = document.createElement("span");
      chip.className = "scope-chip";
      chip.textContent = scope;
      scopes.appendChild(chip);
    }

    const actions = document.createElement("div");
    actions.className = "key-actions";
    if (canWriteProject() && key.status === "active") {
      const rotate = document.createElement("button");
      rotate.type = "button";
      rotate.textContent = "Rotate";
      rotate.addEventListener("click", () => rotateKey(key));

      const revoke = document.createElement("button");
      revoke.type = "button";
      revoke.className = "revoke";
      revoke.textContent = "Revoke";
      revoke.addEventListener("click", () => revokeKey(key));
      actions.append(rotate, revoke);
    }

    row.append(identity, times, scopes, actions);
    list.appendChild(row);
  }
}

document.querySelector("#keyType").addEventListener("change", (event) => {
  const names = {
    ingest: "Production ingest",
    read: "Production read",
    issuer: "Client token issuer"
  };
  document.querySelector("#keyName").value =
    names[event.target.value] || "API key";
});

document.querySelector("#keyForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const project = projectById();
  if (!project || !canWriteProject(project)) return;

  setText("keyError", "");
  const button = document.querySelector("#createKeyButton");
  button.disabled = true;

  try {
    const type = document.querySelector("#keyType").value;
    const days = document.querySelector("#keyExpiry").value;
    const expiresAt = days
      ? new Date(Date.now() + Number(days) * 24 * 60 * 60 * 1000).toISOString()
      : null;

    const payload = await api(`/v1/admin/projects/${project.id}/keys`, {
      method: "POST",
      mutate: true,
      body: JSON.stringify({
        name: document.querySelector("#keyName").value.trim(),
        scopes: type === "read"
          ? ["users:read", "summary:read", "events:read"]
          : type === "issuer"
            ? ["tokens:issue"]
            : ["location:write"],
        allowedOrigins: parseLines(document.querySelector("#keyOrigins").value),
        allowedPackages: parseLines(document.querySelector("#keyPackages").value),
        expiresAt
      })
    });

    revealSecret(payload.secret);
    document.querySelector("#keyOrigins").value = "";
    document.querySelector("#keyPackages").value = "";
    await loadKeys();
  } catch (error) {
    const messages = {
      invalid_allowed_origins: "Use exact origins such as https://app.example.com.",
      invalid_allowed_packages: "Use valid app package IDs such as com.example.app.",
      mixed_key_scopes_not_allowed: "Use separate ingest, read and client-token issuer keys.",
      invalid_key_expiry: "Choose a valid future expiry.",
      project_write_forbidden: "Your role is read-only."
    };
    setText("keyError", messages[error.code] || `Could not create key: ${error.code}`);
  } finally {
    button.disabled = false;
  }
});

async function rotateKey(key) {
  if (!confirm(`Rotate "${key.name}"? The current secret will stop working immediately.`)) return;
  setText("keyError", "");
  try {
    const payload = await api(
      `/v1/admin/projects/${state.projectId}/keys/${key.id}/rotate`,
      { method: "POST", mutate: true }
    );
    revealSecret(payload.secret);
    await loadKeys();
  } catch (error) {
    setText("keyError", `Could not rotate key: ${error.code}`);
  }
}

async function revokeKey(key) {
  if (!confirm(`Revoke "${key.name}"? This cannot be undone.`)) return;
  setText("keyError", "");
  try {
    await api(
      `/v1/admin/projects/${state.projectId}/keys/${key.id}/revoke`,
      { method: "POST", mutate: true }
    );
    await loadKeys();
  } catch (error) {
    setText("keyError", `Could not revoke key: ${error.code}`);
  }
}

document.querySelector("#copySecret").addEventListener("click", async () => {
  const secret = document.querySelector("#oneTimeSecret").textContent;
  if (!secret) return;
  try {
    await navigator.clipboard.writeText(secret);
    document.querySelector("#copySecret").textContent = "Copied";
    setTimeout(() => {
      document.querySelector("#copySecret").textContent = "Copy secret";
    }, 1200);
  } catch {
    setText("keyError", "Clipboard access failed. Select and copy the secret manually.");
  }
});


function closeOpsModal() {
  document.querySelector("#opsModal").hidden = true;
}

async function openOpsModal() {
  if (!state.projectId) return;
  document.querySelector("#opsModal").hidden = false;
  await loadOperations();
}

function setLimitFields(limits) {
  document.querySelector("#limitIngestMinute").value =
    limits.ingestRequestsPerMinute;
  document.querySelector("#limitReadMinute").value =
    limits.readRequestsPerMinute;
  document.querySelector("#limitDailyIngest").value =
    limits.dailyIngestQuota;
  document.querySelector("#limitLiveUsers").value =
    limits.maxLiveUsers;
  document.querySelector("#limitHistoryDays").value =
    limits.historyRetentionDays;
  document.querySelector("#limitSecurityDays").value =
    limits.securityEventRetentionDays;
  document.querySelector("#limitMetricsDays").value =
    limits.metricsRetentionDays;
  document.querySelector("#limitRealtimeHours").value =
    limits.realtimeEventRetentionHours;

  const writable = canWriteProject();
  document.querySelectorAll("#limitsForm input").forEach((input) => {
    input.disabled = !writable;
  });
  document.querySelector("#saveLimits").hidden = !writable;
}

function setClientSecurityFields(payload) {
  const policy = payload.policy || {};
  document.querySelector("#clientTokenTtl").value =
    policy.clientTokenTtlSeconds || 300;
  document.querySelector("#clientRequestMaxAge").value =
    policy.requestMaxAgeSeconds || 120;
  document.querySelector("#clientExchangeMinute").value =
    policy.tokenExchangeRequestsPerMinute || 120;
  document.querySelector("#requireRequestProof").checked =
    policy.requireRequestProof !== false;
  document.querySelector("#androidAttestationMode").value =
    policy.androidAttestationMode || "off";

  const packages =
    payload.playIntegrityConfiguredPackages || [];
  setText(
    "clientSecurityStatus",
    payload.clientTokensConfigured
      ? "Signing ready"
      : "Signing key not configured"
  );
  setText(
    "playIntegrityPackages",
    packages.length
      ? `Play Integrity packages: ${packages.join(", ")}`
      : "No Play Integrity package configured."
  );

  const writable = canWriteProject();
  document
    .querySelectorAll("#clientSecurityForm input, #clientSecurityForm select")
    .forEach((element) => {
      element.disabled = !writable;
    });
  document.querySelector("#saveClientSecurity").hidden =
    !writable;
}

function renderSecurityEvents(events) {
  const list = document.querySelector("#securityList");
  list.replaceChildren();

  if (!events.length) {
    const empty = document.createElement("div");
    empty.className = "key-empty";
    empty.textContent = "No recent project security events.";
    list.appendChild(empty);
    return;
  }

  for (const event of events) {
    const row = document.createElement("div");
    row.className = "security-event";

    const severity = document.createElement("span");
    severity.className = `severity ${event.severity}`;
    severity.textContent = event.severity;

    const body = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = event.eventType;
    const meta = document.createElement("small");
    const keyRef = event.keyRef ? ` · ${event.keyRef}` : "";
    meta.textContent = `${new Date(event.createdAt).toLocaleString()}${keyRef}`;
    body.append(title, meta);

    const details = document.createElement("small");
    details.textContent = event.metadata?.route || event.metadata?.group || "—";

    row.append(severity, body, details);
    list.appendChild(row);
  }
}

async function loadOperations() {
  const project = projectById();
  if (!project) return;

  setText("opsError", "");
  try {
    const [
      limitsPayload,
      metricsPayload,
      eventsPayload,
      clientSecurityPayload
    ] = await Promise.all([
      api(`/v1/admin/projects/${project.id}/operations/limits`),
      api(`/v1/admin/projects/${project.id}/operations/metrics?hours=24`),
      api(`/v1/admin/projects/${project.id}/operations/security-events?limit=25`),
      api(`/v1/admin/projects/${project.id}/client-security`)
    ]);

    setLimitFields(limitsPayload.limits);
    setClientSecurityFields(clientSecurityPayload);
    const totals = metricsPayload.metrics?.totals || {};
    setText("opsRequests", totals.requests || 0);
    setText("opsErrors", totals.errors || 0);
    setText("opsLatency", `${totals.averageLatencyMs || 0} ms`);
    setText("opsSecurity", totals.securityEvents || 0);
    renderSecurityEvents(eventsPayload.events || []);
  } catch (error) {
    setText("opsError", `Could not load operations: ${error.code}`);
  }
}


function formatMoney(minor, currency = "USD") {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2
    }).format(Number(minor || 0) / 100);
  } catch {
    return `${currency} ${(Number(minor || 0) / 100).toFixed(2)}`;
  }
}

function compactNumber(value) {
  return new Intl.NumberFormat().format(
    Number(value || 0)
  );
}

function buildTag(textValue) {
  const span = document.createElement("span");
  span.className = "scope-chip";
  span.textContent = textValue;
  return span;
}

function previousMonthPeriod() {
  const now = new Date();
  const start = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth() - 1,
    1
  ));
  const end = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    1
  ));
  return {
    periodStart:
      start.toISOString().slice(0, 10),
    periodEnd:
      end.toISOString().slice(0, 10)
  };
}

function fillBillingAccounts() {
  const select =
    document.querySelector("#billingAccount");
  select.replaceChildren();

  for (const account of state.accounts) {
    const option =
      document.createElement("option");
    option.value = account.id;
    option.textContent =
      `${account.name} · ${account.role}`;
    select.appendChild(option);
  }

  const preferred = activeAccountId();
  state.billingAccountId =
    accountById(preferred)
      ? preferred
      : state.accounts[0]?.id || "";
  select.value = state.billingAccountId;
}

async function openBillingModal() {
  if (!state.accounts.length) return;
  fillBillingAccounts();
  document.querySelector("#billingModal").hidden =
    false;
  await loadBilling();
}

function closeBillingModal() {
  document.querySelector("#billingModal").hidden =
    true;
}

async function loadBilling() {
  const accountId =
    state.billingAccountId ||
    document.querySelector("#billingAccount").value;
  if (!accountId) return;

  state.billingAccountId = accountId;
  setText("billingError", "");

  try {
    const payload = await api(
      `/v1/admin/accounts/${accountId}/commercial`
    );
    state.commercial = payload;
    renderBilling(payload);
  } catch (error) {
    setText(
      "billingError",
      `Could not load billing: ${error.code}`
    );
  }
}

function renderBilling(payload) {
  const plan = payload.plan || {};
  const subscription =
    payload.subscription || {};
  const effective =
    payload.effective || {};
  const usage =
    payload.usage?.metrics || {};
  const currency = plan.currency || "USD";

  setText("billingPlan", plan.name || "—");
  setText(
    "billingPlanPrice",
    formatMoney(
      plan.monthlyPriceMinor || 0,
      currency
    ) + " / month"
  );
  setText(
    "billingStatus",
    subscription.status || "—"
  );
  setText(
    "billingPeriod",
    subscription.periodStart &&
    subscription.periodEnd
      ? `${subscription.periodStart} → ${subscription.periodEnd}`
      : "—"
  );

  setText(
    "billingIngest",
    compactNumber(usage.ingestRequests)
  );
  setText(
    "billingIngestLimit",
    `Included: ${compactNumber(effective.includedIngest)}`
  );
  setText(
    "billingRead",
    compactNumber(usage.readRequests)
  );
  setText(
    "billingReadLimit",
    `Included: ${compactNumber(effective.includedRead)}`
  );
  setText(
    "billingTrackedUsers",
    compactNumber(usage.trackedUsers)
  );
  setText(
    "billingTrackedLimit",
    `Included: ${compactNumber(effective.includedTrackedUsers)}`
  );
  const accountId = payload.account?.id ||
    state.billingAccountId;
  const projects = state.projects.filter(
    (project) =>
      project.accountId === accountId
  ).length;
  setText(
    "billingProjects",
    compactNumber(projects)
  );
  setText(
    "billingProjectLimit",
    `Limit: ${compactNumber(effective.maxProjects)}`
  );

  const tags =
    document.querySelector("#billingEntitlements");
  tags.replaceChildren();
  for (const key of [
    "realtime",
    "clientTokens",
    "androidAttestation",
    "prioritySupport"
  ]) {
    tags.appendChild(
      buildTag(
        `${key}: ${effective[key] ? "enabled" : "disabled"}`
      )
    );
  }

  const invoices =
    document.querySelector("#billingInvoices");
  invoices.replaceChildren();
  const invoiceRows = payload.invoices || [];
  if (!invoiceRows.length) {
    const empty =
      document.createElement("div");
    empty.className = "key-empty";
    empty.textContent =
      "No invoices for this account.";
    invoices.appendChild(empty);
  } else {
    for (const invoice of invoiceRows) {
      const row =
        document.createElement("div");
      row.className = "commercial-row";
      const left =
        document.createElement("div");
      const title =
        document.createElement("strong");
      title.textContent =
        invoice.invoiceNumber;
      const meta =
        document.createElement("small");
      meta.textContent =
        `${invoice.periodStart} → ${invoice.periodEnd} · ${invoice.status}`;
      left.append(title, meta);
      const amount =
        document.createElement("strong");
      amount.textContent =
        formatMoney(
          invoice.totalMinor,
          invoice.currency
        );
      row.append(left, amount);
      invoices.appendChild(row);
    }
  }

  const cases =
    document.querySelector("#billingSupportCases");
  cases.replaceChildren();
  const caseRows = payload.supportCases || [];
  if (!caseRows.length) {
    const empty =
      document.createElement("div");
    empty.className = "key-empty";
    empty.textContent =
      "No support cases.";
    cases.appendChild(empty);
  } else {
    for (const supportCase of caseRows) {
      const row =
        document.createElement("div");
      row.className = "commercial-row";
      const left =
        document.createElement("div");
      const title =
        document.createElement("strong");
      title.textContent =
        supportCase.subject;
      const meta =
        document.createElement("small");
      meta.textContent =
        `${supportCase.category} · ${supportCase.priority} · ${supportCase.status}`;
      left.append(title, meta);
      const when =
        document.createElement("small");
      when.textContent =
        new Date(
          supportCase.updatedAt
        ).toLocaleString();

      const actions =
        document.createElement("div");
      actions.className =
        "commercial-inline-actions";
      const open =
        document.createElement("button");
      open.type = "button";
      open.className = "text-button";
      open.textContent = "Open";
      open.addEventListener(
        "click",
        () => openTenantSupportCase(
          supportCase
        )
      );
      actions.append(when, open);
      row.append(left, actions);
      cases.appendChild(row);
    }
  }

  const account =
    accountById(state.billingAccountId);
  document.querySelector("#supportCaseForm").hidden =
    !account ||
    !["owner","admin"].includes(account.role);
}

async function openTenantSupportCase(
  supportCase
) {
  state.tenantSupportCaseId =
    supportCase.id;
  setText(
    "tenantSupportThreadTitle",
    supportCase.subject
  );
  document.querySelector(
    "#tenantSupportThread"
  ).hidden = false;

  const account =
    accountById(state.billingAccountId);
  document.querySelector(
    "#tenantSupportReplyForm"
  ).hidden =
    !account ||
    !["owner", "admin"].includes(
      account.role
    );

  await loadTenantSupportMessages();
}

async function loadTenantSupportMessages() {
  if (!state.tenantSupportCaseId) return;
  const list =
    document.querySelector(
      "#tenantSupportMessages"
    );
  list.replaceChildren();

  try {
    const payload = await api(
      `/v1/admin/support-cases/${state.tenantSupportCaseId}/messages`
    );
    renderSupportMessages(
      list,
      payload.messages || [],
      { showInternal: false }
    );
  } catch (error) {
    const item =
      document.createElement("div");
    item.className = "key-empty";
    item.textContent =
      `Could not load conversation: ${error.code}`;
    list.appendChild(item);
  }
}

function renderSupportMessages(
  target,
  messages,
  { showInternal = false } = {}
) {
  target.replaceChildren();
  if (!messages.length) {
    const empty =
      document.createElement("div");
    empty.className = "key-empty";
    empty.textContent =
      "No messages yet.";
    target.appendChild(empty);
    return;
  }

  for (const message of messages) {
    if (
      !showInternal &&
      message.internal
    ) {
      continue;
    }

    const row =
      document.createElement("article");
    row.className = "support-message";

    const head =
      document.createElement("div");
    head.className =
      "support-message-head";
    const author =
      document.createElement("strong");
    author.textContent =
      message.authorEmail ||
      message.authorType ||
      "GeoLive";
    const time =
      document.createElement("small");
    time.textContent =
      new Date(
        message.createdAt
      ).toLocaleString();
    head.append(author, time);

    const body =
      document.createElement("p");
    body.textContent = message.body;

    row.append(head, body);

    if (
      showInternal &&
      message.internal
    ) {
      const badge =
        document.createElement("small");
      badge.className =
        "internal-note-badge";
      badge.textContent =
        "Internal note";
      row.appendChild(badge);
    }

    target.appendChild(row);
  }
}

async function openPlatformModal() {
  if (!state.platformRole) return;
  document.querySelector("#platformModal").hidden =
    false;
  await loadPlatform();
}

function closePlatformModal() {
  document.querySelector("#platformModal").hidden =
    true;
}

function platformCan(...roles) {
  return roles.includes(state.platformRole);
}

function platformMoneySummary(byCurrency, key) {
  const entries =
    Object.entries(byCurrency || {});
  if (!entries.length) return "—";
  return entries
    .map(([currency, data]) =>
      formatMoney(data[key] || 0, currency)
    )
    .join(" · ");
}

async function loadPlatform() {
  setText("platformError", "");
  try {
    const canReadSupport =
      platformCan("superadmin", "support", "viewer");
    const [
      overviewPayload,
      plansPayload,
      accountsPayload,
      supportPayload
    ] = await Promise.all([
      api("/v1/platform/overview"),
      api("/v1/platform/plans"),
      api("/v1/platform/accounts?limit=200"),
      canReadSupport
        ? api("/v1/platform/support-cases?limit=100")
        : Promise.resolve({ supportCases: [] })
    ]);

    const selectedAccountId =
      state.platform.selectedAccountId || "";
    const selectedSupportCaseId =
      state.platform.selectedSupportCaseId || "";

    state.platform = {
      overview: overviewPayload.overview,
      plans: plansPayload.plans || [],
      accounts: accountsPayload.accounts || [],
      supportCases:
        supportPayload.supportCases || [],
      selectedAccountId,
      accountCommercial:
        state.platform.accountCommercial || null,
      selectedSupportCaseId
    };
    renderPlatform();

    if (
      selectedAccountId &&
      state.platform.accounts.some(
        (account) => account.id === selectedAccountId
      )
    ) {
      await loadPlatformAccount(selectedAccountId);
    }
    if (
      selectedSupportCaseId &&
      state.platform.supportCases.some(
        (supportCase) =>
          supportCase.id === selectedSupportCaseId
      )
    ) {
      await loadPlatformSupportMessages(
        selectedSupportCaseId
      );
    }
  } catch (error) {
    setText(
      "platformError",
      `Could not load platform console: ${error.code}`
    );
  }
}

function renderPlatform() {
  const overview = state.platform.overview || {};
  setText(
    "platformAccountsCount",
    compactNumber(overview.accounts)
  );
  setText(
    "platformActiveSubs",
    compactNumber(
      overview.subscriptions?.active || 0
    )
  );
  setText(
    "platformBilled",
    platformMoneySummary(
      overview.invoices?.byCurrency,
      "billedMinor"
    )
  );
  setText(
    "platformPaid",
    platformMoneySummary(
      overview.invoices?.byCurrency,
      "paidMinor"
    )
  );
  setText(
    "platformOpenSupport",
    compactNumber(overview.support?.open || 0)
  );
  setText(
    "platformUrgentSupport",
    compactNumber(
      overview.support?.urgent || 0
    )
  );

  document.querySelector("#platformPlanForm").hidden =
    !platformCan("superadmin");

  const plans =
    document.querySelector("#platformPlans");
  plans.replaceChildren();
  for (const plan of state.platform.plans) {
    const row =
      document.createElement("div");
    row.className = "commercial-row";
    const left =
      document.createElement("div");
    const title =
      document.createElement("strong");
    title.textContent =
      `${plan.name} · ${plan.code}`;
    const meta =
      document.createElement("small");
    meta.textContent =
      `${plan.status} · ${formatMoney(plan.monthlyPriceMinor, plan.currency)} / month · max ${plan.maxProjects} projects`;
    left.append(title, meta);
    const usage =
      document.createElement("small");
    usage.textContent =
      `Ingest ${compactNumber(plan.includedIngest)} · Read ${compactNumber(plan.includedRead)} · Users ${compactNumber(plan.includedTrackedUsers)} · Overage I/R/U ${formatMoney(plan.overageIngestPer1000Minor, plan.currency)} / ${formatMoney(plan.overageReadPer1000Minor, plan.currency)} / ${formatMoney(plan.overageTrackedUserMinor, plan.currency)}`;
    row.append(left, usage);
    plans.appendChild(row);
  }

  renderPlatformAccounts();
  renderPlatformSupport();
}

function renderPlatformAccounts() {
  const list =
    document.querySelector("#platformAccounts");
  list.replaceChildren();

  for (const account of state.platform.accounts) {
    const row =
      document.createElement("div");
    row.className =
      "commercial-row commercial-row-stack";

    const identity =
      document.createElement("div");
    const title =
      document.createElement("strong");
    title.textContent = account.name;
    const meta =
      document.createElement("small");
    meta.textContent =
      `${account.projectCount} projects · ${account.plan?.name || "No plan"} · ${account.subscriptionStatus || "unassigned"}`;
    identity.append(title, meta);
    row.appendChild(identity);

    const details =
      document.createElement("button");
    details.type = "button";
    details.className = "text-button";
    details.textContent = "Commercial details";
    details.addEventListener(
      "click",
      () => loadPlatformAccount(account.id)
    );
    row.appendChild(details);

    if (
      platformCan("superadmin","billing")
    ) {
      const controls =
        document.createElement("div");
      controls.className =
        "commercial-controls";

      const planSelect =
        document.createElement("select");
      for (const plan of state.platform.plans) {
        if (plan.status !== "active") continue;
        const option =
          document.createElement("option");
        option.value = plan.id;
        option.textContent = plan.name;
        if (plan.id === account.plan?.id) {
          option.selected = true;
        }
        planSelect.appendChild(option);
      }

      const statusSelect =
        document.createElement("select");
      for (const status of [
        "trialing",
        "active",
        "past_due",
        "canceled"
      ]) {
        const option =
          document.createElement("option");
        option.value = status;
        option.textContent = status;
        option.selected =
          status ===
          (account.subscriptionStatus || "active");
        statusSelect.appendChild(option);
      }

      const save =
        document.createElement("button");
      save.type = "button";
      save.className = "text-button";
      save.textContent = "Save";
      save.addEventListener(
        "click",
        async () => {
          try {
            await api(
              `/v1/platform/accounts/${account.id}/subscription`,
              {
                method: "PATCH",
                mutate: true,
                body: JSON.stringify({
                  planId: planSelect.value,
                  status: statusSelect.value
                })
              }
            );
            await loadPlatform();
          } catch (error) {
            setText(
              "platformError",
              `Subscription update failed: ${error.code}`
            );
          }
        }
      );

      const invoice =
        document.createElement("button");
      invoice.type = "button";
      invoice.className = "text-button";
      invoice.textContent =
        "Invoice previous month";
      invoice.addEventListener(
        "click",
        async () => {
          const period =
            previousMonthPeriod();
          try {
            await api(
              `/v1/platform/accounts/${account.id}/invoices/generate`,
              {
                method: "POST",
                mutate: true,
                body: JSON.stringify(period)
              }
            );
            await loadPlatform();
          } catch (error) {
            setText(
              "platformError",
              `Invoice generation failed: ${error.code}`
            );
          }
        }
      );

      controls.append(
        planSelect,
        statusSelect,
        save,
        invoice
      );
      row.appendChild(controls);
    }

    list.appendChild(row);
  }
}

async function loadPlatformAccount(
  accountId
) {
  state.platform.selectedAccountId =
    accountId;
  setText("platformError", "");

  try {
    const payload = await api(
      `/v1/platform/accounts/${accountId}/commercial`
    );
    state.platform.accountCommercial =
      payload;
    renderPlatformAccountDetail(
      payload
    );
  } catch (error) {
    setText(
      "platformError",
      `Could not load account commercial detail: ${error.code}`
    );
  }
}

function setOverrideControl(
  id,
  overrides,
  key
) {
  const element =
    document.querySelector("#" + id);
  const has = Object.prototype
    .hasOwnProperty.call(
      overrides || {},
      key
    );
  element.value =
    has
      ? String(overrides[key])
      : "";
}

function invoiceTransitions(status) {
  const map = {
    draft: ["draft", "open", "void"],
    open: [
      "open",
      "paid",
      "void",
      "uncollectible"
    ],
    uncollectible: [
      "uncollectible",
      "paid",
      "void"
    ],
    paid: ["paid"],
    void: ["void"]
  };
  return map[status] || [status];
}

function renderPlatformAccountDetail(payload) {
  const panel =
    document.querySelector(
      "#platformAccountDetail"
    );
  panel.hidden = false;

  const account =
    state.platform.accounts.find(
      (item) =>
        item.id ===
        state.platform.selectedAccountId
    );
  const plan = payload.plan || {};
  const subscription =
    payload.subscription || {};
  const usage =
    payload.usage?.metrics || {};
  const overrides =
    payload.overrides || {};

  setText(
    "platformAccountDetailTitle",
    account
      ? `${account.name} · Commercial detail`
      : "Account commercial detail"
  );
  setText(
    "platformAccountPlan",
    plan.name || "—"
  );
  setText(
    "platformAccountPlanPrice",
    formatMoney(
      plan.monthlyPriceMinor || 0,
      plan.currency || "USD"
    ) + " / month"
  );
  setText(
    "platformAccountSubscription",
    subscription.status || "—"
  );
  setText(
    "platformAccountPeriod",
    subscription.periodStart &&
      subscription.periodEnd
      ? `${subscription.periodStart} → ${subscription.periodEnd}`
      : "—"
  );
  setText(
    "platformAccountUsage",
    `${compactNumber(usage.ingestRequests)} · ${compactNumber(usage.readRequests)} · ${compactNumber(usage.trackedUsers)}`
  );

  const entitlementForm =
    document.querySelector(
      "#platformEntitlementForm"
    );
  entitlementForm.hidden =
    !platformCan("superadmin");

  setOverrideControl(
    "entitlementMaxProjects",
    overrides,
    "maxProjects"
  );
  setOverrideControl(
    "entitlementIngest",
    overrides,
    "includedIngest"
  );
  setOverrideControl(
    "entitlementRead",
    overrides,
    "includedRead"
  );
  setOverrideControl(
    "entitlementUsers",
    overrides,
    "includedTrackedUsers"
  );
  setOverrideControl(
    "entitlementRealtime",
    overrides,
    "realtime"
  );
  setOverrideControl(
    "entitlementClientTokens",
    overrides,
    "clientTokens"
  );
  setOverrideControl(
    "entitlementAttestation",
    overrides,
    "androidAttestation"
  );
  setOverrideControl(
    "entitlementPrioritySupport",
    overrides,
    "prioritySupport"
  );

  const invoices =
    document.querySelector(
      "#platformAccountInvoices"
    );
  invoices.replaceChildren();

  const rows = payload.invoices || [];
  if (!rows.length) {
    const empty =
      document.createElement("div");
    empty.className = "key-empty";
    empty.textContent =
      "No invoices for this account.";
    invoices.appendChild(empty);
    return;
  }

  for (const invoice of rows) {
    const row =
      document.createElement("div");
    row.className =
      "commercial-row commercial-row-stack";

    const identity =
      document.createElement("div");
    const title =
      document.createElement("strong");
    title.textContent =
      `${invoice.invoiceNumber} · ${formatMoney(invoice.totalMinor, invoice.currency)}`;
    const meta =
      document.createElement("small");
    meta.textContent =
      `${invoice.periodStart} → ${invoice.periodEnd} · ${invoice.status}`;
    identity.append(title, meta);
    row.appendChild(identity);

    if (
      platformCan(
        "superadmin",
        "billing"
      )
    ) {
      const controls =
        document.createElement("div");
      controls.className =
        "commercial-inline-actions";

      const select =
        document.createElement("select");
      for (
        const status of
        invoiceTransitions(
          invoice.status
        )
      ) {
        const option =
          document.createElement(
            "option"
          );
        option.value = status;
        option.textContent = status;
        option.selected =
          status === invoice.status;
        select.appendChild(option);
      }

      const save =
        document.createElement("button");
      save.type = "button";
      save.className =
        "text-button";
      save.textContent =
        "Update status";
      save.disabled =
        ["paid", "void"].includes(
          invoice.status
        );
      save.addEventListener(
        "click",
        async () => {
          try {
            await api(
              `/v1/platform/invoices/${invoice.id}`,
              {
                method: "PATCH",
                mutate: true,
                body: JSON.stringify({
                  status: select.value
                })
              }
            );
            await loadPlatformAccount(
              state.platform
                .selectedAccountId
            );
            await loadPlatform();
          } catch (error) {
            setText(
              "platformError",
              `Invoice update failed: ${error.code}`
            );
          }
        }
      );

      controls.append(
        select,
        save
      );
      row.appendChild(controls);
    }

    invoices.appendChild(row);
  }
}

function renderPlatformSupport() {
  const list =
    document.querySelector("#platformSupport");
  list.replaceChildren();

  const rows = state.platform.supportCases || [];
  if (!rows.length) {
    const empty =
      document.createElement("div");
    empty.className = "key-empty";
    empty.textContent =
      "Support queue is empty.";
    list.appendChild(empty);
    return;
  }

  for (const supportCase of rows) {
    const row =
      document.createElement("div");
    row.className =
      "commercial-row commercial-row-stack";

    const identity =
      document.createElement("div");
    const title =
      document.createElement("strong");
    title.textContent =
      `${supportCase.accountName || "Account"} · ${supportCase.subject}`;
    const meta =
      document.createElement("small");
    meta.textContent =
      `${supportCase.category} · ${supportCase.priority} · ${supportCase.status}`;
    identity.append(title, meta);
    row.appendChild(identity);

    const open =
      document.createElement("button");
    open.type = "button";
    open.className = "text-button";
    open.textContent = "Open conversation";
    open.addEventListener(
      "click",
      () => openPlatformSupportCase(
        supportCase
      )
    );
    row.appendChild(open);

    if (
      platformCan("superadmin","support")
    ) {
      const controls =
        document.createElement("div");
      controls.className =
        "commercial-controls";

      const status =
        document.createElement("select");
      for (const value of [
        "open",
        "pending_customer",
        "pending_internal",
        "resolved",
        "closed"
      ]) {
        const option =
          document.createElement("option");
        option.value = value;
        option.textContent = value;
        option.selected =
          value === supportCase.status;
        status.appendChild(option);
      }

      const priority =
        document.createElement("select");
      for (const value of [
        "low",
        "normal",
        "high",
        "urgent"
      ]) {
        const option =
          document.createElement("option");
        option.value = value;
        option.textContent = value;
        option.selected =
          value === supportCase.priority;
        priority.appendChild(option);
      }

      const save =
        document.createElement("button");
      save.type = "button";
      save.className = "text-button";
      save.textContent = "Update";
      save.addEventListener(
        "click",
        async () => {
          try {
            await api(
              `/v1/platform/support-cases/${supportCase.id}`,
              {
                method: "PATCH",
                mutate: true,
                body: JSON.stringify({
                  status: status.value,
                  priority: priority.value
                })
              }
            );
            await loadPlatform();
          } catch (error) {
            setText(
              "platformError",
              `Support update failed: ${error.code}`
            );
          }
        }
      );

      controls.append(
        status,
        priority,
        save
      );
      row.appendChild(controls);
    }

    list.appendChild(row);
  }
}

async function openPlatformSupportCase(
  supportCase
) {
  state.platform.selectedSupportCaseId =
    supportCase.id;
  setText(
    "platformSupportThreadTitle",
    `${supportCase.accountName || "Account"} · ${supportCase.subject}`
  );
  document.querySelector(
    "#platformSupportThread"
  ).hidden = false;
  document.querySelector(
    "#platformSupportReplyForm"
  ).hidden =
    !platformCan(
      "superadmin",
      "support"
    );

  await loadPlatformSupportMessages(
    supportCase.id
  );
}

async function loadPlatformSupportMessages(
  caseId =
    state.platform.selectedSupportCaseId
) {
  if (!caseId) return;

  const list =
    document.querySelector(
      "#platformSupportMessages"
    );
  list.replaceChildren();

  try {
    const payload = await api(
      `/v1/platform/support-cases/${caseId}/messages`
    );
    renderSupportMessages(
      list,
      payload.messages || [],
      { showInternal: true }
    );
  } catch (error) {
    const item =
      document.createElement("div");
    item.className = "key-empty";
    item.textContent =
      `Could not load conversation: ${error.code}`;
    list.appendChild(item);
  }
}

function nullableNumberValue(id) {
  const value =
    document.querySelector("#" + id)
      .value.trim();
  return value === ""
    ? null
    : Number(value);
}

function nullableBooleanValue(id) {
  const value =
    document.querySelector("#" + id)
      .value;
  if (value === "") return null;
  return value === "true";
}

document.querySelector("#billingModalClose").addEventListener(
  "click",
  closeBillingModal
);
document.querySelector("#billingAccount").addEventListener(
  "change",
  async (event) => {
    state.billingAccountId = event.target.value;
    await loadBilling();
  }
);
document.querySelector("#tenantSupportThreadClose").addEventListener(
  "click",
  () => {
    state.tenantSupportCaseId = "";
    document.querySelector(
      "#tenantSupportThread"
    ).hidden = true;
  }
);

document.querySelector("#tenantSupportReplyForm").addEventListener(
  "submit",
  async (event) => {
    event.preventDefault();
    if (!state.tenantSupportCaseId) return;

    const account =
      accountById(state.billingAccountId);
    if (
      !account ||
      !["owner", "admin"].includes(
        account.role
      )
    ) {
      return;
    }

    const button =
      document.querySelector(
        "#tenantSupportReplyButton"
      );
    button.disabled = true;

    try {
      await api(
        `/v1/admin/support-cases/${state.tenantSupportCaseId}/messages`,
        {
          method: "POST",
          mutate: true,
          body: JSON.stringify({
            body:
              document.querySelector(
                "#tenantSupportReplyBody"
              ).value.trim()
          })
        }
      );
      document.querySelector(
        "#tenantSupportReplyBody"
      ).value = "";
      await loadTenantSupportMessages();
      await loadBilling();
    } catch (error) {
      setText(
        "billingError",
        `Could not send reply: ${error.code}`
      );
    } finally {
      button.disabled = false;
    }
  }
);

document.querySelector("#supportCaseForm").addEventListener(
  "submit",
  async (event) => {
    event.preventDefault();
    const accountId = state.billingAccountId;
    if (!accountId || !canWriteAccount(accountById(accountId))) {
      return;
    }

    const button =
      document.querySelector("#createSupportCase");
    button.disabled = true;
    setText("billingError", "");

    try {
      const project = projectById();
      await api(
        `/v1/admin/accounts/${accountId}/support-cases`,
        {
          method: "POST",
          mutate: true,
          body: JSON.stringify({
            category:
              document.querySelector("#supportCategory").value,
            priority:
              document.querySelector("#supportPriority").value,
            subject:
              document.querySelector("#supportSubject").value.trim(),
            body:
              document.querySelector("#supportBody").value.trim(),
            projectId:
              project?.accountId === accountId
                ? project.id
                : null
          })
        }
      );
      document.querySelector("#supportSubject").value = "";
      document.querySelector("#supportBody").value = "";
      await loadBilling();
    } catch (error) {
      setText(
        "billingError",
        `Could not create support case: ${error.code}`
      );
    } finally {
      button.disabled = false;
    }
  }
);

document.querySelector("#platformModalClose").addEventListener(
  "click",
  closePlatformModal
);
document.querySelector("#refreshPlatform").addEventListener(
  "click",
  loadPlatform
);
document.querySelector("#platformAccountDetailClose").addEventListener(
  "click",
  () => {
    state.platform.selectedAccountId = "";
    state.platform.accountCommercial = null;
    document.querySelector(
      "#platformAccountDetail"
    ).hidden = true;
  }
);

document.querySelector("#platformEntitlementForm").addEventListener(
  "submit",
  async (event) => {
    event.preventDefault();
    if (
      !platformCan("superadmin") ||
      !state.platform.selectedAccountId
    ) {
      return;
    }

    const button =
      document.querySelector(
        "#saveEntitlements"
      );
    button.disabled = true;
    setText("platformError", "");

    try {
      await api(
        `/v1/platform/accounts/${state.platform.selectedAccountId}/entitlements`,
        {
          method: "PATCH",
          mutate: true,
          body: JSON.stringify({
            maxProjects:
              nullableNumberValue(
                "entitlementMaxProjects"
              ),
            includedIngest:
              nullableNumberValue(
                "entitlementIngest"
              ),
            includedRead:
              nullableNumberValue(
                "entitlementRead"
              ),
            includedTrackedUsers:
              nullableNumberValue(
                "entitlementUsers"
              ),
            realtime:
              nullableBooleanValue(
                "entitlementRealtime"
              ),
            clientTokens:
              nullableBooleanValue(
                "entitlementClientTokens"
              ),
            androidAttestation:
              nullableBooleanValue(
                "entitlementAttestation"
              ),
            prioritySupport:
              nullableBooleanValue(
                "entitlementPrioritySupport"
              )
          })
        }
      );
      await loadPlatformAccount(
        state.platform.selectedAccountId
      );
      await loadPlatform();
    } catch (error) {
      setText(
        "platformError",
        `Could not save entitlement overrides: ${error.code}`
      );
    } finally {
      button.disabled = false;
    }
  }
);

document.querySelector("#platformSupportThreadClose").addEventListener(
  "click",
  () => {
    state.platform.selectedSupportCaseId = "";
    document.querySelector(
      "#platformSupportThread"
    ).hidden = true;
  }
);

document.querySelector("#platformSupportReplyForm").addEventListener(
  "submit",
  async (event) => {
    event.preventDefault();
    if (
      !platformCan(
        "superadmin",
        "support"
      ) ||
      !state.platform.selectedSupportCaseId
    ) {
      return;
    }

    const button =
      document.querySelector(
        "#platformSupportReplyButton"
      );
    button.disabled = true;
    setText("platformError", "");

    try {
      await api(
        `/v1/platform/support-cases/${state.platform.selectedSupportCaseId}/messages`,
        {
          method: "POST",
          mutate: true,
          body: JSON.stringify({
            body:
              document.querySelector(
                "#platformSupportReplyBody"
              ).value.trim(),
            internal:
              document.querySelector(
                "#platformSupportInternal"
              ).checked
          })
        }
      );
      document.querySelector(
        "#platformSupportReplyBody"
      ).value = "";
      document.querySelector(
        "#platformSupportInternal"
      ).checked = false;
      await loadPlatformSupportMessages();
      await loadPlatform();
    } catch (error) {
      setText(
        "platformError",
        `Could not send support message: ${error.code}`
      );
    } finally {
      button.disabled = false;
    }
  }
);


document.querySelector("#platformPlanForm").addEventListener(
  "submit",
  async (event) => {
    event.preventDefault();
    if (!platformCan("superadmin")) return;

    try {
      await api("/v1/platform/plans", {
        method: "POST",
        mutate: true,
        body: JSON.stringify({
          code:
            document.querySelector("#platformPlanCode").value.trim(),
          name:
            document.querySelector("#platformPlanName").value.trim(),
          currency:
            document.querySelector("#platformPlanCurrency").value.trim().toUpperCase(),
          monthlyPriceMinor:
            Number(document.querySelector("#platformPlanPrice").value),
          includedIngest:
            Number(document.querySelector("#platformPlanIngest").value),
          includedRead:
            Number(document.querySelector("#platformPlanRead").value),
          includedTrackedUsers:
            Number(document.querySelector("#platformPlanUsers").value),
          maxProjects:
            Number(document.querySelector("#platformPlanProjects").value),
          overageIngestPer1000Minor:
            Number(document.querySelector("#platformPlanIngestOverage").value),
          overageReadPer1000Minor:
            Number(document.querySelector("#platformPlanReadOverage").value),
          overageTrackedUserMinor:
            Number(document.querySelector("#platformPlanUserOverage").value),
          features: {
            realtime:
              document.querySelector("#platformFeatureRealtime").checked,
            clientTokens:
              document.querySelector("#platformFeatureClientTokens").checked,
            androidAttestation:
              document.querySelector("#platformFeatureAttestation").checked,
            prioritySupport:
              document.querySelector("#platformFeaturePrioritySupport").checked
          }
        })
      });
      document.querySelector("#platformPlanCode").value = "";
      document.querySelector("#platformPlanName").value = "";
      await loadPlatform();
    } catch (error) {
      setText(
        "platformError",
        `Could not create plan: ${error.code}`
      );
    }
  }
);

document.querySelector("#limitsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const project = projectById();
  if (!project || !canWriteProject(project)) return;

  setText("opsError", "");
  const button = document.querySelector("#saveLimits");
  button.disabled = true;

  try {
    const payload = await api(
      `/v1/admin/projects/${project.id}/operations/limits`,
      {
        method: "PATCH",
        mutate: true,
        body: JSON.stringify({
          ingestRequestsPerMinute: Number(document.querySelector("#limitIngestMinute").value),
          readRequestsPerMinute: Number(document.querySelector("#limitReadMinute").value),
          dailyIngestQuota: Number(document.querySelector("#limitDailyIngest").value),
          maxLiveUsers: Number(document.querySelector("#limitLiveUsers").value),
          historyRetentionDays: Number(document.querySelector("#limitHistoryDays").value),
          securityEventRetentionDays: Number(document.querySelector("#limitSecurityDays").value),
          metricsRetentionDays: Number(document.querySelector("#limitMetricsDays").value),
          realtimeEventRetentionHours: Number(document.querySelector("#limitRealtimeHours").value)
        })
      }
    );
    setLimitFields(payload.limits);
  } catch (error) {
    setText("opsError", `Could not save limits: ${error.code}`);
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#clientSecurityForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const project = projectById();
  if (!project || !canWriteProject(project)) return;

  setText("opsError", "");
  const button = document.querySelector("#saveClientSecurity");
  button.disabled = true;

  try {
    await api(
      `/v1/admin/projects/${project.id}/client-security`,
      {
        method: "PATCH",
        mutate: true,
        body: JSON.stringify({
          clientTokenTtlSeconds:
            Number(document.querySelector("#clientTokenTtl").value),
          requestMaxAgeSeconds:
            Number(document.querySelector("#clientRequestMaxAge").value),
          tokenExchangeRequestsPerMinute:
            Number(document.querySelector("#clientExchangeMinute").value),
          requireRequestProof:
            document.querySelector("#requireRequestProof").checked,
          androidAttestationMode:
            document.querySelector("#androidAttestationMode").value
        })
      }
    );

    await loadOperations();
  } catch (error) {
    setText(
      "opsError",
      `Could not save client security: ${error.code}`
    );
  } finally {
    button.disabled = false;
  }
});

document.querySelectorAll(".status-filter").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".status-filter").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    state.activeStatus = button.dataset.status;
    applyFilters();
  });
});

[
  search,
  document.querySelector("#country"),
  document.querySelector("#state"),
  document.querySelector("#city")
].forEach((element) => element.addEventListener("input", applyFilters));

document.querySelector("#reset").addEventListener("click", () => {
  search.value = "";
  state.activeStatus = "";
  for (const id of ["country", "state", "city"]) {
    document.querySelector("#" + id).value = "";
  }
  document.querySelectorAll(".status-filter").forEach((item, index) => {
    item.classList.toggle("active", index === 0);
  });
  applyFilters();
});

document.querySelector("#pause").onclick = () => state.paused = !state.paused;
document.querySelector("#zoomIn").onclick = () => {
  state.zoom = Math.min(1.5, state.zoom + .1);
  scheduleClusterRefresh();
};
document.querySelector("#zoomOut").onclick = () => {
  state.zoom = Math.max(.7, state.zoom - .1);
  scheduleClusterRefresh();
};
document.querySelector("#center").onclick = () => state.rotation = -20;

function resize() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

addEventListener("resize", resize);
resize();

function projectPoint(lat, lng, cx, cy, radius) {
  const phi = lat * Math.PI / 180;
  const lambda = (lng - state.rotation) * Math.PI / 180;
  const x = Math.cos(phi) * Math.sin(lambda);
  const y = Math.sin(phi);
  const z = Math.cos(phi) * Math.cos(lambda);
  return { x: cx + x * radius, y: cy - y * radius, z };
}

function starfield(width, height) {
  ctx.fillStyle = "rgba(255,255,255,.7)";
  for (let i = 0; i < 80; i++) {
    const x = (i * 97.13) % width;
    const y = (i * 53.77) % height;
    ctx.globalAlpha = (i % 5 + 1) / 6;
    ctx.fillRect(x, y, 1, 1);
  }
  ctx.globalAlpha = 1;
}

function draw() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  ctx.clearRect(0, 0, width, height);
  starfield(width, height);

  const cx = width * .5;
  const cy = height * .48;
  const radius = Math.min(width * .37, height * .43) * state.zoom;
  const grad = ctx.createRadialGradient(
    cx - radius * .35,
    cy - radius * .35,
    radius * .1,
    cx,
    cy,
    radius
  );
  grad.addColorStop(0, "#0a3653");
  grad.addColorStop(.65, "#061e31");
  grad.addColorStop(1, "#020812");

  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = "#2d9cff";
  ctx.lineWidth = 1.4;
  ctx.shadowColor = "#2d9cff";
  ctx.shadowBlur = 18;
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.clip();
  ctx.strokeStyle = "rgba(68,150,196,.18)";
  ctx.lineWidth = 1;

  for (let lat = -60; lat <= 60; lat += 30) {
    ctx.beginPath();
    let started = false;
    for (let lng = -180; lng <= 180; lng += 3) {
      const point = projectPoint(lat, lng, cx, cy, radius);
      if (point.z > 0) {
        if (!started) {
          ctx.moveTo(point.x, point.y);
          started = true;
        } else {
          ctx.lineTo(point.x, point.y);
        }
      }
    }
    ctx.stroke();
  }

  for (let lng = -180; lng < 180; lng += 30) {
    ctx.beginPath();
    let started = false;
    for (let lat = -90; lat <= 90; lat += 3) {
      const point = projectPoint(lat, lng, cx, cy, radius);
      if (point.z > 0) {
        if (!started) {
          ctx.moveTo(point.x, point.y);
          started = true;
        } else {
          ctx.lineTo(point.x, point.y);
        }
      }
    }
    ctx.stroke();
  }

  const markers = state.useClusters
    ? state.clusters
    : state.filtered;

  for (const marker of markers) {
    const point = projectPoint(
      marker.latitude,
      marker.longitude,
      cx,
      cy,
      radius
    );
    if (point.z <= 0) {
      marker.__screen = null;
      continue;
    }

    const isCluster = state.useClusters;
    const clusterStatus = isCluster
      ? marker.online > 0
        ? "online"
        : marker.recent > 0
          ? "recent"
          : marker.offline > 0
            ? "offline"
            : "inactive"
      : marker.status;

    const size = isCluster
      ? Math.min(
          21,
          6 + Math.log2((marker.count || 1) + 1) * 2.2
        )
      : 4 + 4 * point.z;

    ctx.beginPath();
    ctx.arc(point.x, point.y, size, 0, Math.PI * 2);
    ctx.fillStyle =
      colors[clusterStatus] || colors.inactive;
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 12;
    ctx.fill();
    ctx.shadowBlur = 0;

    if (isCluster && marker.count > 1) {
      ctx.fillStyle = "#061018";
      ctx.font = "bold 10px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        marker.count > 999
          ? "999+"
          : String(marker.count),
        point.x,
        point.y
      );
    }

    marker.__screen = {
      x: point.x,
      y: point.y,
      z: point.z
    };
  }

  ctx.restore();
  if (!state.paused) state.rotation = (state.rotation + .025) % 360;
  requestAnimationFrame(draw);
}

draw();

canvas.addEventListener("click", (event) => {
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  let best = null;
  let distance = 18;

  const markers = state.useClusters
    ? state.clusters
    : state.filtered;

  for (const marker of markers) {
    if (!marker.__screen) continue;
    const candidate = Math.hypot(
      marker.__screen.x - x,
      marker.__screen.y - y
    );
    if (candidate < distance) {
      best = marker;
      distance = candidate;
    }
  }

  if (best) {
    if (state.useClusters) {
      showClusterDetail(best);
    } else {
      showDetail(best);
    }
  }
});

function showClusterDetail(cluster) {
  setText(
    "detailName",
    `${cluster.count || 0} users in cluster`
  );
  setText("detailEmail", "Server-side aggregated marker");
  setText(
    "detailStatus",
    cluster.online > 0
      ? "online"
      : cluster.recent > 0
        ? "recent"
        : cluster.offline > 0
          ? "offline"
          : "inactive"
  );
  setText(
    "detailLocation",
    `Grid ${clusterGridDegrees()}°`
  );
  setText(
    "detailCoords",
    `${Number(cluster.latitude).toFixed(2)}, ${Number(cluster.longitude).toFixed(2)}`
  );
  setText(
    "detailDevice",
    `Online ${cluster.online || 0} · Recent ${cluster.recent || 0}`
  );
  setText(
    "detailSeen",
    `Offline ${cluster.offline || 0} · Inactive ${cluster.inactive || 0}`
  );
  document.querySelector("#activity").innerHTML =
    "<div><b>Clustered marker</b><small>Zoom in for smaller geographic cells.</small></div>";
}

function showDetail(user) {
  setText("detailName", user.name || user.userId || "Select a user");
  setText("detailEmail", user.email || user.userId || "Click a marker on the globe.");
  setText("detailStatus", user.status || "—");
  setText("detailLocation", [user.city, user.state, user.country].filter(Boolean).join(", ") || "—");
  setText(
    "detailCoords",
    Number.isFinite(user.latitude) && Number.isFinite(user.longitude)
      ? `${user.latitude.toFixed(4)}, ${user.longitude.toFixed(4)}`
      : "—"
  );
  setText(
    "detailDevice",
    [user.device?.platform, user.device?.appVersion, user.device?.osVersion]
      .filter(Boolean)
      .join(" · ") || "—"
  );
  setText("detailSeen", user.lastSeenAt ? new Date(user.lastSeenAt).toLocaleString() : "—");

  document.querySelector("#activity").innerHTML = user.lastSeenAt
    ? `<div><b>Location update</b><small>${new Date(user.lastSeenAt).toLocaleTimeString()}</small></div><div><b>Status: ${user.status}</b><small>Project-isolated live state</small></div>`
    : "";
}

document.querySelector("#detailClose").onclick = () => showDetail({});

async function boot() {
  try {
    const payload = await api("/v1/admin/me");
    hydrateSession(payload);
  } catch (error) {
    if (error.code === "admin_requires_postgres") {
      showLogin("Admin control plane requires PostgreSQL.");
    } else {
      showLogin();
    }
  }
}

resetData();
boot();
