const CESIUM_VERSION = "1.124.0";
const CESIUM_BASE_URL =
  `https://cdn.jsdelivr.net/npm/cesium@${CESIUM_VERSION}/Build/Cesium/`;
const CESIUM_SCRIPT_URL =
  `${CESIUM_BASE_URL}Cesium.js`;
const CESIUM_STYLE_URL =
  `${CESIUM_BASE_URL}Widgets/widgets.css`;

let cesiumLoadPromise = null;

function cleanApiKey(value) {
  return String(value || "").trim();
}

function emitRendererStatus(detail) {
  if (
    typeof globalThis.dispatchEvent !== "function" ||
    typeof globalThis.CustomEvent !== "function"
  ) {
    return;
  }

  globalThis.dispatchEvent(
    new CustomEvent(
      "geolive:renderer",
      { detail }
    )
  );
}

function ensureStylesheet() {
  if (
    typeof document === "undefined" ||
    document.querySelector(
      'link[data-geolive-cesium="1"]'
    )
  ) {
    return;
  }

  const link =
    document.createElement("link");
  link.rel = "stylesheet";
  link.href = CESIUM_STYLE_URL;
  link.dataset.geoliveCesium = "1";
  document.head.appendChild(link);
}

async function loadCesium() {
  if (globalThis.Cesium) {
    return globalThis.Cesium;
  }

  if (cesiumLoadPromise) {
    return cesiumLoadPromise;
  }

  if (typeof document === "undefined") {
    throw new Error(
      "cesium_browser_required"
    );
  }

  globalThis.CESIUM_BASE_URL =
    CESIUM_BASE_URL;
  ensureStylesheet();

  cesiumLoadPromise =
    new Promise(
      (resolve, reject) => {
        const existing =
          document.querySelector(
            'script[data-geolive-cesium="1"]'
          );

        const complete = () => {
          if (globalThis.Cesium) {
            resolve(
              globalThis.Cesium
            );
          } else {
            reject(
              new Error(
                "cesium_global_missing"
              )
            );
          }
        };

        if (existing) {
          existing.addEventListener(
            "load",
            complete,
            { once: true }
          );
          existing.addEventListener(
            "error",
            () =>
              reject(
                new Error(
                  "cesium_load_failed"
                )
              ),
            { once: true }
          );
          return;
        }

        const script =
          document.createElement(
            "script"
          );
        script.src =
          CESIUM_SCRIPT_URL;
        script.async = true;
        script.crossOrigin =
          "anonymous";
        script.dataset.geoliveCesium =
          "1";
        script.addEventListener(
          "load",
          complete,
          { once: true }
        );
        script.addEventListener(
          "error",
          () =>
            reject(
              new Error(
                "cesium_load_failed"
              )
            ),
          { once: true }
        );
        document.head.appendChild(
          script
        );
      }
    );

  try {
    return await cesiumLoadPromise;
  } catch (error) {
    cesiumLoadPromise = null;
    throw error;
  }
}

function clamp(
  value,
  minimum,
  maximum
) {
  return Math.min(
    maximum,
    Math.max(
      minimum,
      Number(value) || 0
    )
  );
}

function normalizeLongitude(value) {
  return (
    (
      (Number(value) || 0) +
      540
    ) %
      360
  ) - 180;
}

function cameraHeightForZoom(
  zoom
) {
  const minimumZoom = 0.7;
  const maximumZoom = 12;
  const farHeight = 26_000_000;
  const nearHeight = 1_200;
  const normalized =
    (
      clamp(
        zoom,
        minimumZoom,
        maximumZoom
      ) -
      minimumZoom
    ) /
    (
      maximumZoom -
      minimumZoom
    );

  return Math.exp(
    Math.log(farHeight) +
      (
        Math.log(nearHeight) -
        Math.log(farHeight)
      ) *
        normalized
  );
}

export class PhotorealisticEarthRenderer {
  constructor(
    container,
    {
      apiKey = "",
      creditContainer = null
    } = {}
  ) {
    this.container = container;
    this.creditContainer =
      creditContainer;
    this.apiKey =
      cleanApiKey(apiKey);
    this.configured =
      Boolean(
        container &&
        this.apiKey
      );
    this.ready = false;
    this.status =
      this.configured
        ? "idle"
        : "disabled";
    this.viewer = null;
    this.tileset = null;
    this.Cesium = null;
    this.lastView = null;
    this.initializing = null;
    this.scratchNormal = null;
    this.scratchToCamera = null;
    this.scratchWindow = null;

    if (this.configured) {
      queueMicrotask(() => {
        this.initialize().catch(
          () => {}
        );
      });
    }
  }

  get active() {
    return Boolean(
      this.ready &&
      this.viewer &&
      this.Cesium
    );
  }

  get label() {
    if (this.active) {
      return "Google Photorealistic 3D";
    }
    if (
      this.configured &&
      this.status === "loading"
    ) {
      return "Loading real Earth";
    }
    return "";
  }

  maxZoom() {
    return this.active
      ? 12
      : 1.5;
  }

  zoomStep(zoom) {
    if (!this.active) {
      return 0.1;
    }
    if (zoom < 1.5) {
      return 0.1;
    }
    if (zoom < 5) {
      return 0.35;
    }
    return 0.6;
  }

  async initialize() {
    if (
      !this.configured ||
      this.active
    ) {
      return this.active;
    }

    if (this.initializing) {
      return this.initializing;
    }

    this.status = "loading";
    emitRendererStatus({
      mode: "photorealistic-loading",
      label:
        "Loading real Earth"
    });

    this.initializing =
      this.initializeInternal();

    try {
      return await this.initializing;
    } finally {
      this.initializing = null;
    }
  }

  async initializeInternal() {
    let viewer = null;

    try {
      const Cesium =
        await loadCesium();

      if (
        Cesium.RequestScheduler
          ?.requestsByServer
      ) {
        Cesium.RequestScheduler
          .requestsByServer[
            "tile.googleapis.com:443"
          ] = 18;
      }

      viewer =
        new Cesium.Viewer(
          this.container,
          {
            animation: false,
            timeline: false,
            baseLayerPicker: false,
            geocoder: false,
            homeButton: false,
            infoBox: false,
            sceneModePicker: false,
            selectionIndicator:
              false,
            navigationHelpButton:
              false,
            fullscreenButton: false,
            vrButton: false,
            globe: false,
            requestRenderMode: true,
            maximumRenderTimeChange:
              Infinity,
            shouldAnimate: false,
            creditContainer:
              this.creditContainer ||
              undefined
          }
        );

      viewer.scene.backgroundColor =
        Cesium.Color.BLACK;
      viewer.scene
        .screenSpaceCameraController
        .enableInputs = false;

      const tileset =
        await Cesium
          .Cesium3DTileset
          .fromUrl(
            `https://tile.googleapis.com/v1/3dtiles/root.json?key=${encodeURIComponent(this.apiKey)}`,
            {
              showCreditsOnScreen:
                true,
              skipLevelOfDetail:
                true,
              maximumScreenSpaceError:
                16,
              dynamicScreenSpaceError:
                true
            }
          );

      viewer.scene.primitives.add(
        tileset
      );

      this.Cesium = Cesium;
      this.viewer = viewer;
      this.tileset = tileset;
      this.scratchNormal =
        new Cesium.Cartesian3();
      this.scratchToCamera =
        new Cesium.Cartesian3();
      this.scratchWindow =
        new Cesium.Cartesian2();
      this.ready = true;
      this.status = "ready";

      this.container.classList.add(
        "active"
      );
      this.container
        .closest(".globe-card")
        ?.classList.add(
          "real-earth-active"
        );

      this.render({
        rotationDegrees: -20,
        latitudeDegrees: 12,
        zoom: 1
      });

      emitRendererStatus({
        mode: "photorealistic",
        label:
          "Google Photorealistic 3D"
      });
      return true;
    } catch {
      if (
        viewer &&
        !viewer.isDestroyed()
      ) {
        viewer.destroy();
      }
      this.viewer = null;
      this.tileset = null;
      this.Cesium = null;
      this.ready = false;
      this.status = "error";
      this.container?.classList.remove(
        "active"
      );
      this.container
        ?.closest(".globe-card")
        ?.classList.remove(
          "real-earth-active"
        );

      console.warn(
        "GeoLive real Earth renderer unavailable; using the local WebGL fallback."
      );
      emitRendererStatus({
        mode: "fallback",
        label: ""
      });
      return false;
    }
  }

  render({
    rotationDegrees = -20,
    latitudeDegrees = 12,
    zoom = 1
  } = {}) {
    if (!this.active) {
      return false;
    }

    const longitude =
      normalizeLongitude(
        rotationDegrees
      );
    const latitude =
      clamp(
        latitudeDegrees,
        -80,
        80
      );
    const normalizedZoom =
      clamp(
        zoom,
        0.7,
        12
      );

    const previous =
      this.lastView;
    if (
      previous &&
      Math.abs(
        previous.longitude -
          longitude
      ) < 0.015 &&
      Math.abs(
        previous.latitude -
          latitude
      ) < 0.015 &&
      Math.abs(
        previous.zoom -
          normalizedZoom
      ) < 0.005
    ) {
      return true;
    }

    const Cesium = this.Cesium;
    const height =
      cameraHeightForZoom(
        normalizedZoom
      );

    this.viewer.camera.setView({
      destination:
        Cesium.Cartesian3
          .fromDegrees(
            longitude,
            latitude,
            height
          ),
      orientation: {
        heading: 0,
        pitch:
          -Cesium.Math.PI_OVER_TWO,
        roll: 0
      }
    });

    this.lastView = {
      longitude,
      latitude,
      zoom: normalizedZoom
    };
    this.viewer.scene
      .requestRender();
    return true;
  }

  project(
    latitude,
    longitude
  ) {
    if (!this.active) {
      return null;
    }

    const Cesium = this.Cesium;
    const position =
      Cesium.Cartesian3
        .fromDegrees(
          Number(longitude),
          Number(latitude),
          20
        );

    const windowPoint =
      Cesium.SceneTransforms
        .worldToWindowCoordinates(
          this.viewer.scene,
          position,
          this.scratchWindow
        );

    if (!windowPoint) {
      return {
        x: -10000,
        y: -10000,
        z: -1
      };
    }

    const normal =
      Cesium.Ellipsoid.WGS84
        .geodeticSurfaceNormal(
          position,
          this.scratchNormal
        );
    const toCamera =
      Cesium.Cartesian3
        .subtract(
          this.viewer.camera
            .positionWC,
          position,
          this.scratchToCamera
        );
    const visible =
      Cesium.Cartesian3.dot(
        normal,
        toCamera
      ) > 0;

    return {
      x: windowPoint.x,
      y: windowPoint.y,
      z: visible ? 1 : -1
    };
  }

  destroy() {
    if (
      this.viewer &&
      !this.viewer.isDestroyed()
    ) {
      this.viewer.destroy();
    }
    this.viewer = null;
    this.tileset = null;
    this.Cesium = null;
    this.ready = false;
    this.status = "destroyed";
    this.container?.classList.remove(
      "active"
    );
  }
}
