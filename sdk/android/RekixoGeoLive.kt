package com.rekixo.geolive

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.time.Instant
import java.util.concurrent.Executor
import java.util.concurrent.Executors

fun interface GeoLiveTokenProvider {
    fun token(): String
}

data class GeoLiveRequestProof(
    val timestamp: String,
    val nonce: String,
    val signature: String
)

fun interface GeoLiveRequestProofProvider {
    fun proof(bodyBytes: ByteArray): GeoLiveRequestProof
}

object GeoLiveClientSecurity {
    private fun base64Url(bytes: ByteArray): String =
        java.util.Base64.getUrlEncoder()
            .withoutPadding()
            .encodeToString(bytes)

    fun exchangeRequestHash(
        projectId: String,
        userId: String,
        packageId: String,
        clientNonce: String,
        clientTimestampMs: Long,
        proofPublicKey: String
    ): String {
        val canonical = listOf(
            "RGL-TOKEN-EXCHANGE-V1",
            projectId,
            userId,
            packageId,
            clientNonce,
            clientTimestampMs.toString(),
            proofPublicKey
        ).joinToString("\n")
        return base64Url(
            MessageDigest.getInstance("SHA-256")
                .digest(canonical.toByteArray(Charsets.UTF_8))
        )
    }

    fun requestProofCanonical(
        bodyBytes: ByteArray,
        timestamp: String,
        nonce: String
    ): String {
        val bodyHash = base64Url(
            MessageDigest.getInstance("SHA-256")
                .digest(bodyBytes)
        )
        return listOf(
            "RGL-PROOF-V1",
            "POST",
            "/v1/locations",
            timestamp,
            nonce,
            bodyHash
        ).joinToString("\n")
    }
}

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
 *
 * Long-lived API keys are appropriate only when the host accepts extraction risk.
 * Prefer the later short-lived-token/attestation path for untrusted clients.
 * packageId is only defense-in-depth until attestation is enabled.
 */
class RekixoGeoLiveClient(
    baseUrl: String,
    private val ingestToken: String,
    private val userId: String,
    private val packageId: String? = null,
    private val executor: Executor = Executors.newSingleThreadExecutor(),
    private val tokenProvider: GeoLiveTokenProvider? = null,
    private val requestProofProvider: GeoLiveRequestProofProvider? = null
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

                val token = (
                    tokenProvider?.token() ?: ingestToken
                ).trim()
                require(token.isNotEmpty()) {
                    "GeoLive ingest token is unavailable."
                }

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
                    setRequestProperty("Authorization", "Bearer $token")
                    setRequestProperty("Content-Type", "application/json")
                    packageId?.takeIf { it.isNotBlank() }?.let {
                        setRequestProperty("X-GeoLive-Package", it)
                    }
                }

                val bodyBytes =
                    body.toString().toByteArray(Charsets.UTF_8)

                requestProofProvider?.proof(bodyBytes)?.let { proof ->
                    connection.setRequestProperty(
                        "X-GeoLive-Request-Timestamp",
                        proof.timestamp
                    )
                    connection.setRequestProperty(
                        "X-GeoLive-Request-Nonce",
                        proof.nonce
                    )
                    connection.setRequestProperty(
                        "X-GeoLive-Request-Signature",
                        proof.signature
                    )
                }

                connection.outputStream.use {
                    it.write(bodyBytes)
                }
                val code = connection.responseCode
                connection.disconnect()
                check(code in 200..299) { "GeoLive HTTP $code" }
            }.also(onResult)
        }
    }
}
