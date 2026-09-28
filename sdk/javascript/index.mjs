export class GeoLiveClient {
  constructor({
    baseUrl,
    ingestToken = "",
    tokenProvider = null,
    requestProofProvider = null,
    userId,
    defaults = {},
    packageId = ""
  }) {
    if (
      !baseUrl ||
      !userId ||
      (!ingestToken && typeof tokenProvider !== "function")
    ) {
      throw new Error(
        "baseUrl, userId and ingestToken or tokenProvider are required."
      );
    }
    this.baseUrl = String(baseUrl).replace(/\/$/, "");
    this.ingestToken = String(ingestToken || "");
    this.tokenProvider = tokenProvider;
    this.requestProofProvider = requestProofProvider;
    this.userId = userId;
    this.defaults = { ...defaults };
    this.packageId = String(packageId || "").trim();
    this.watchId = null;
    this.lastSentAt = 0;
  }

  async resolveToken() {
    const value = this.tokenProvider
      ? await this.tokenProvider()
      : this.ingestToken;
    const token = String(value || "").trim();
    if (!token) {
      throw new Error("GeoLive ingest token is unavailable.");
    }
    return token;
  }

  async sendLocation(location) {
    const token = await this.resolveToken();
    const body = JSON.stringify({
      ...this.defaults,
      ...location,
      userId: this.userId,
      capturedAt:
        location.capturedAt ||
        new Date().toISOString()
    });

    const headers = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    };
    if (this.packageId) {
      headers["x-geolive-package"] =
        this.packageId;
    }

    if (this.requestProofProvider) {
      const proof =
        await this.requestProofProvider({
          method: "POST",
          path: "/v1/locations",
          body
        });
      if (
        !proof?.timestamp ||
        !proof?.nonce ||
        !proof?.signature
      ) {
        throw new Error(
          "GeoLive requestProofProvider must return timestamp, nonce and signature."
        );
      }
      headers["x-geolive-request-timestamp"] =
        String(proof.timestamp);
      headers["x-geolive-request-nonce"] =
        String(proof.nonce);
      headers["x-geolive-request-signature"] =
        String(proof.signature);
    }

    const response = await fetch(
      `${this.baseUrl}/v1/locations`,
      {
        method: "POST",
        headers,
        body
      }
    );

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
