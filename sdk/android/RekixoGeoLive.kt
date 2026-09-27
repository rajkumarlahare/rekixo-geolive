package com.rekixo.geolive

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import java.util.concurrent.Executor
import java.util.concurrent.Executors

data class GeoLiveObservation(
    val latitude: Double,
    val longitude: Double,
    val accuracyM: Double? = null,
    val altitudeM: Double? = null,
    val headingDeg: Double? = null,
    val speedMps: Double? = null,
    val capturedAt: String = Instant.now().toString()
)

/**
 * Transport-only adapter.
 *
 * The host Android app owns runtime permission prompts, foreground/background
 * location policy, and LocationServices. Never embed a dashboard/admin secret.
 * In production prefer a short-lived location:write token from a trusted backend.
 */
class RekixoGeoLiveClient(
    baseUrl: String,
    private val ingestToken: String,
    private val userId: String,
    private val executor: Executor = Executors.newSingleThreadExecutor()
) {
    private val endpoint = baseUrl.trimEnd('/') + "/v1/locations"

    fun send(
        observation: GeoLiveObservation,
        platform: String = "android",
        appVersion: String? = null,
        onResult: (Result<Unit>) -> Unit = {}
    ) {
        executor.execute {
            runCatching {
                require(observation.latitude in -90.0..90.0)
                require(observation.longitude in -180.0..180.0)

                val body = JSONObject()
                    .put("userId", userId)
                    .put("latitude", observation.latitude)
                    .put("longitude", observation.longitude)
                    .put("capturedAt", observation.capturedAt)

                observation.accuracyM?.let { body.put("accuracyM", it) }
                observation.altitudeM?.let { body.put("altitudeM", it) }
                observation.headingDeg?.let { body.put("headingDeg", it) }
                observation.speedMps?.let { body.put("speedMps", it) }

                val device = JSONObject().put("platform", platform)
                appVersion?.let { device.put("appVersion", it) }
                body.put("device", device)

                val connection = (URL(endpoint).openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    connectTimeout = 10_000
                    readTimeout = 10_000
                    doOutput = true
                    setRequestProperty("Authorization", "Bearer $ingestToken")
                    setRequestProperty("Content-Type", "application/json")
                }

                connection.outputStream.use {
                    it.write(body.toString().toByteArray(Charsets.UTF_8))
                }
                val code = connection.responseCode
                connection.disconnect()
                check(code in 200..299) { "GeoLive HTTP $code" }
            }.also(onResult)
        }
    }
}
