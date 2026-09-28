export class GeoLiveClient {
  constructor({
    baseUrl,
    ingestToken,
    userId,
    defaults = {},
    packageId = ""
  }) {
    if (!baseUrl || !ingestToken || !userId) {
      throw new Error("baseUrl, ingestToken and userId are required.");
    }
    this.baseUrl = String(baseUrl).replace(/\/$/, "");
    this.ingestToken = ingestToken;
    this.userId = userId;
    this.defaults = { ...defaults };
    this.packageId = String(packageId || "").trim();
    this.watchId = null;
    this.lastSentAt = 0;
  }

  async sendLocation(location) {
    const headers = {
      authorization: `Bearer ${this.ingestToken}`,
      "content-type": "application/json"
    };
    if (this.packageId) {
      headers["x-geolive-package"] = this.packageId;
    }

    const response = await fetch(`${this.baseUrl}/v1/locations`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...this.defaults,
        ...location,
        userId: this.userId,
        capturedAt: location.capturedAt || new Date().toISOString()
      })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(
        payload.error || `GeoLive request failed: ${response.status}`
      );
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  startBrowserTracking({
    minimumIntervalMs = 30000,
    enableHighAccuracy = true,
    maximumAge = 10000
  } = {}) {
    if (
      typeof navigator === "undefined" ||
      !navigator.geolocation
    ) {
      throw new Error("Browser geolocation is unavailable.");
    }
    if (this.watchId !== null) return this.watchId;

    this.watchId = navigator.geolocation.watchPosition(
      async (position) => {
        const now = Date.now();
        if (now - this.lastSentAt < minimumIntervalMs) return;
        this.lastSentAt = now;

        try {
          await this.sendLocation({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracyM: position.coords.accuracy,
            altitudeM: position.coords.altitude ?? undefined,
            headingDeg: position.coords.heading ?? undefined,
            speedMps: position.coords.speed ?? undefined,
            capturedAt: new Date(position.timestamp).toISOString(),
            device: { platform: "web" }
          });
        } catch (error) {
          this.lastSentAt = 0;
          console.error("GeoLive location send failed", error);
        }
      },
      (error) =>
        console.error("GeoLive geolocation error", error),
      { enableHighAccuracy, maximumAge }
    );

    return this.watchId;
  }

  stopBrowserTracking() {
    if (
      this.watchId !== null &&
      typeof navigator !== "undefined" &&
      navigator.geolocation
    ) {
      navigator.geolocation.clearWatch(this.watchId);
    }
    this.watchId = null;
  }
}
