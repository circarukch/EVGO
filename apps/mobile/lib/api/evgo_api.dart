import 'dart:convert';

import 'package:http/http.dart' as http;

import 'models.dart';

class EvgoApi {
  EvgoApi({required this.baseUrl, http.Client? client}) : _client = client ?? http.Client();

  factory EvgoApi.fromEnvironment() => EvgoApi(
        baseUrl: const String.fromEnvironment('API_BASE_URL', defaultValue: 'http://localhost:3001/v1'),
      );

  final String baseUrl;
  final http.Client _client;

  Future<List<TripSummary>> searchTrips(String from, String to) async {
    final res = await _client.get(Uri.parse('$baseUrl/trips').replace(queryParameters: {'from': from, 'to': to}));
    _check(res);
    return (jsonDecode(res.body) as List).map((j) => TripSummary.fromJson(j as Map<String, dynamic>)).toList();
  }

  Future<List<ChargerSummary>> searchChargers({String? segment, String? city}) async {
    final params = <String, String>{
      if (segment != null) 'segment': segment,
      if (city != null) 'city': city,
    };
    final res = await _client.get(Uri.parse('$baseUrl/chargers').replace(queryParameters: params));
    _check(res);
    return (jsonDecode(res.body) as List).map((j) => ChargerSummary.fromJson(j as Map<String, dynamic>)).toList();
  }

  void _check(http.Response res) {
    if (res.statusCode >= 400) {
      throw Exception('EVGO API ${res.statusCode}: ${res.body}');
    }
  }
}
