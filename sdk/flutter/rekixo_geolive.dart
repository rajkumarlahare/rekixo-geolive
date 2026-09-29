import 'dart:convert';
import 'dart:io';

typedef GeoLiveTokenProvider = Future<String> Function();

typedef GeoLiveRequestProofProvider =
    Future<GeoLiveRequestProof> Function(List<int> bodyBytes);

class GeoLiveRequestProof {
  const GeoLiveRequestProof({
    required this.timestamp,
    required this.nonce,
    required this.signature,
  });

  final String timestamp;
  final String nonce;
  final String signature;
}

class RekixoGeoLiveClient {
  RekixoGeoLiveClient({
    required this.baseUrl,
    required this.userId,
    this.ingestToken,
    this.tokenProvider,
    this.requestProofProvider,
    this.packageId,
  }) {
    if ((ingestToken == null || ingestToken!.trim().isEmpty) &&
        tokenProvider == null) {
      throw ArgumentError(
        'ingestToken or tokenProvider is required',
      );
    }
  }

  final String baseUrl;
  final String userId;
  final String? ingestToken;
  final GeoLiveTokenProvider? tokenProvider;
  final GeoLiveRequestProofProvider? requestProofProvider;
  final String? packageId;

  Future<String> _resolveToken() async {
    final value = tokenProvider != null
        ? await tokenProvider!()
        : ingestToken;
    final token = (value ?? '').trim();
    if (token.isEmpty) {
      throw StateError('GeoLive ingest token is unavailable.');
    }
    return token;
  }

  Future<void> sendLocation({
    required double latitude,
    required double longitude,
    double? accuracyM,
    double? altitudeM,
    double? headingDeg,
    double? speedMps,
    DateTime? capturedAt,
    String platform = 'flutter',
    String? appVersion,
  }) async {
    if (latitude < -90 || latitude > 90) {
      throw ArgumentError.value(latitude, 'latitude');
    }
    if (longitude < -180 || longitude > 180) {
      throw ArgumentError.value(longitude, 'longitude');
    }

    final payload = <String, Object?>{
      'userId': userId,
      'latitude': latitude,
      'longitude': longitude,
      if (accuracyM != null) 'accuracyM': accuracyM,
      if (altitudeM != null) 'altitudeM': altitudeM,
      if (headingDeg != null) 'headingDeg': headingDeg,
      if (speedMps != null) 'speedMps': speedMps,
      'capturedAt':
          (capturedAt ?? DateTime.now()).toUtc().toIso8601String(),
      'device': <String, Object?>{
        'platform': platform,
        if (appVersion != null) 'appVersion': appVersion,
      },
    };
    final body = utf8.encode(jsonEncode(payload));
    final token = await _resolveToken();
    final client = HttpClient();

    try {
      final cleanBase =
          baseUrl.trim().replaceFirst(RegExp(r'/+$'), '');
      if (cleanBase.isEmpty) {
        throw ArgumentError.value(baseUrl, 'baseUrl');
      }

      final uri = Uri.parse('$cleanBase/v1/locations');
      if (uri.scheme != 'http' && uri.scheme != 'https') {
        throw ArgumentError.value(
          baseUrl,
          'baseUrl',
          'GeoLive baseUrl must use http or https',
        );
      }

      final request = await client.postUrl(uri);
      request.headers.set(
        HttpHeaders.authorizationHeader,
        'Bearer $token',
      );

      final package = packageId?.trim();
      if (package != null && package.isNotEmpty) {
        request.headers.set(
          'X-GeoLive-Package',
          package,
        );
      }

      if (requestProofProvider != null) {
        final proof = await requestProofProvider!(body);
        if (proof.timestamp.trim().isEmpty ||
            proof.nonce.trim().isEmpty ||
            proof.signature.trim().isEmpty) {
          throw StateError(
            'GeoLive requestProofProvider returned incomplete proof.',
          );
        }
        request.headers.set(
          'X-GeoLive-Request-Timestamp',
          proof.timestamp,
        );
        request.headers.set(
          'X-GeoLive-Request-Nonce',
          proof.nonce,
        );
        request.headers.set(
          'X-GeoLive-Request-Signature',
          proof.signature,
        );
      }

      request.headers.contentType = ContentType.json;
      request.add(body);

      final response = await request.close();
      if (response.statusCode < 200 ||
          response.statusCode >= 300) {
        final text =
            await utf8.decoder.bind(response).join();
        throw HttpException(
          'GeoLive HTTP ${response.statusCode}: $text',
          uri: uri,
        );
      }
      await response.drain();
    } finally {
      client.close(force: true);
    }
  }
}
