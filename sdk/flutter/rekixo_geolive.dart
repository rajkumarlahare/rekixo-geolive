import 'dart:convert';
import 'dart:io';

class RekixoGeoLiveClient {
  RekixoGeoLiveClient({
    required this.baseUrl,
    required this.ingestToken,
    required this.userId,
  });

  final String baseUrl;
  final String ingestToken;
  final String userId;

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

    final client = HttpClient();
    try {
      final cleanBase = baseUrl.replaceFirst(RegExp(r'/$'), '');
      final uri = Uri.parse('$cleanBase/v1/locations');
      final request = await client.postUrl(uri);
      request.headers.set(HttpHeaders.authorizationHeader, 'Bearer $ingestToken');
      request.headers.contentType = ContentType.json;
      request.write(jsonEncode({
        'userId': userId,
        'latitude': latitude,
        'longitude': longitude,
        if (accuracyM != null) 'accuracyM': accuracyM,
        if (altitudeM != null) 'altitudeM': altitudeM,
        if (headingDeg != null) 'headingDeg': headingDeg,
        if (speedMps != null) 'speedMps': speedMps,
        'capturedAt': (capturedAt ?? DateTime.now()).toUtc().toIso8601String(),
        'device': {
          'platform': platform,
          if (appVersion != null) 'appVersion': appVersion,
        },
      }));

      final response = await request.close();
      if (response.statusCode < 200 || response.statusCode >= 300) {
        final text = await utf8.decoder.bind(response).join();
        throw HttpException('GeoLive HTTP ${response.statusCode}: $text', uri: uri);
      }
      await response.drain();
    } finally {
      client.close(force: true);
    }
  }
}
