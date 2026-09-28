const canvas = document.querySelector("#globe");
const ctx = canvas.getContext("2d");
const search = document.querySelector("#search");
const projectSelect = document.querySelector("#project");
const authOverlay = document.querySelector("#authOverlay");
const projectModal = document.querySelector("#projectModal");

const state = {
  csrf: "",
  user: null,
  accounts: [],
  projects: [],
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
  projectMode: "create"
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
  setText("showingCount", state.filtered.length);
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

  updateStats();
  document.querySelector("#emptyState").hidden =
    Boolean(state.projectId && state.filtered.length);
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
    const [usersPayload, summaryPayload] = await Promise.all([
      api(`/v1/admin/projects/${project.id}/users?limit=1000`),
      api(`/v1/admin/projects/${project.id}/summary`)
    ]);

    state.users = usersPayload.users || [];
    state.summary = {
      total: summaryPayload.total || 0,
      online: summaryPayload.online || 0,
      recent: summaryPayload.recent || 0,
      offline: summaryPayload.offline || 0,
      inactive: summaryPayload.inactive || 0
    };
    state.refreshes += 1;

    rebuildGeoFilters();
    applyFilters();
    setText("lastUpdated", `Last updated: ${new Date().toLocaleTimeString()}`);

    if (!quiet) showDetail({});
  } catch (error) {
    if (error.status === 401) {
      showLogin("Your session expired. Sign in again.");
      return;
    }
    setText("lastUpdated", `Refresh failed: ${error.code}`);
  }
}

function startPolling() {
  clearInterval(state.pollTimer);
  if (!state.projectId) return;
  state.pollTimer = setInterval(() => loadProject({ quiet: true }), 15000);
}

function hydrateSession(payload) {
  state.user = payload.user;
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

  loadProject();
  startPolling();
}

function showLogin(message = "") {
  clearInterval(state.pollTimer);
  state.user = null;
  state.csrf = "";
  state.projects = [];
  state.accounts = [];
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
  state.projectId = projectSelect.value;
  document.querySelector("#editProject").disabled = !canWriteProject();
  loadProject();
  startPolling();
});

document.querySelector("#newProject").addEventListener("click", () => openProjectModal("create"));
document.querySelector("#editProject").addEventListener("click", () => openProjectModal("edit"));
document.querySelector("#projectModalClose").addEventListener("click", closeProjectModal);
document.querySelector("#projectCancel").addEventListener("click", closeProjectModal);

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
document.querySelector("#zoomIn").onclick = () => state.zoom = Math.min(1.5, state.zoom + .1);
document.querySelector("#zoomOut").onclick = () => state.zoom = Math.max(.7, state.zoom - .1);
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

  for (const user of state.filtered) {
    const point = projectPoint(user.latitude, user.longitude, cx, cy, radius);
    if (point.z <= 0) {
      user.__screen = null;
      continue;
    }

    const size = 4 + 4 * point.z;
    ctx.beginPath();
    ctx.arc(point.x, point.y, size, 0, Math.PI * 2);
    ctx.fillStyle = colors[user.status] || colors.inactive;
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 12;
    ctx.fill();
    ctx.shadowBlur = 0;
    user.__screen = { x: point.x, y: point.y, z: point.z };
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

  for (const user of state.filtered) {
    if (!user.__screen) continue;
    const candidate = Math.hypot(user.__screen.x - x, user.__screen.y - y);
    if (candidate < distance) {
      best = user;
      distance = candidate;
    }
  }

  if (best) showDetail(best);
});

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
