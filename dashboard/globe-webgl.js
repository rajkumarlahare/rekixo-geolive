import { PhotorealisticEarthRenderer } from "./photorealistic-earth.js";

export class GeoGlobeRenderer {
  constructor(
    _canvas,
    {
      realContainer = null,
      googleMapsApiKey = "",
      googleTilesRootUrl = "",
      creditContainer = null
    } = {}
  ) {
    this.photorealistic =
      new PhotorealisticEarthRenderer(
        realContainer,
        {
          apiKey:
            googleMapsApiKey,
          tilesRootUrl:
            googleTilesRootUrl,
          creditContainer
        }
      );
  }

  get photorealisticActive() {
    return Boolean(
      this.photorealistic
        ?.active
    );
  }

  ensurePhotorealistic() {
    return this.photorealistic
      ?.initialize?.() ||
      Promise.resolve(false);
  }

  suspendPhotorealistic() {
    this.photorealistic
      ?.destroy?.();
  }

  get label() {
    return (
      this.photorealistic
        ?.label ||
      "Google 3D unavailable"
    );
  }

  maxZoom() {
    return (
      this.photorealistic
        ?.maxZoom?.() ||
      12
    );
  }

  zoomStep(zoom) {
    return (
      this.photorealistic
        ?.zoomStep?.(zoom) ||
      0.1
    );
  }

  dragSensitivity(
    zoom,
    viewportHeight
  ) {
    return (
      this.photorealistic
        ?.dragSensitivity?.(
          zoom,
          viewportHeight
        ) || {
          longitude: 0.03,
          latitude: 0.02
        }
    );
  }

  project(
    latitude,
    longitude
  ) {
    return (
      this.photorealistic
        ?.project?.(
          latitude,
          longitude
        ) ||
      null
    );
  }

  render({
    rotationDegrees = -20,
    latitudeDegrees = 12,
    zoom = 1
  } = {}) {
    return Boolean(
      this.photorealistic
        ?.render?.({
          rotationDegrees,
          latitudeDegrees,
          zoom
        })
    );
  }
}
