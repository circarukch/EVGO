import 'dart:convert';

import 'package:http/http.dart' as http;

import 'models.dart';

class ApiException implements Exception {
  ApiException(this.statusCode, this.message, [this.body = const {}]);

  final int statusCode;
  final String message;
  final Map<String, dynamic> body;

  @override
  String toString() => message;
}

class EvgoApi {
  EvgoApi({required this.baseUrl, http.Client? client}) : _client = client ?? http.Client();

  factory EvgoApi.fromEnvironment() => EvgoApi(
        baseUrl: const String.fromEnvironment('API_BASE_URL', defaultValue: 'http://localhost:3001/v1'),
      );

  final String baseUrl;
  final http.Client _client;

  /// Bearer token after login. Kept in memory for now; secure storage comes next.
  String? token;

  Map<String, String> get _headers => {
        'content-type': 'application/json',
        if (token != null) 'authorization': 'Bearer $token',
      };

  Future<dynamic> _get(String path, [Map<String, String>? query]) async {
    final res = await _client.get(Uri.parse('$baseUrl$path').replace(queryParameters: query), headers: _headers);
    return _decode(res);
  }

  Future<dynamic> _post(String path, [Object? body]) async {
    final res = await _client.post(Uri.parse('$baseUrl$path'), headers: _headers, body: jsonEncode(body ?? {}));
    return _decode(res);
  }

  dynamic _decode(http.Response res) {
    final data = res.body.isEmpty ? null : jsonDecode(res.body);
    if (res.statusCode >= 400) {
      final map = data is Map<String, dynamic> ? data : <String, dynamic>{};
      final msg = map['message'];
      throw ApiException(res.statusCode, msg is String ? msg : 'Request failed (${res.statusCode})', map);
    }
    return data;
  }

  // ---- Login ----

  /// Sends an OTP. Returns the code itself only from a development server.
  Future<String?> requestOtp(String phone) async {
    final r = await _post('/auth/otp/request', {'phone': phone});
    return (r as Map<String, dynamic>)['devCode'] as String?;
  }

  Future<void> verifyOtp(String phone, String code) async {
    final r = await _post('/auth/otp/verify', {'phone': phone, 'code': code}) as Map<String, dynamic>;
    token = r['accessToken'] as String;
  }

  // ---- Catalog ----

  Future<List<TripSummary>> searchTrips(String from, String to) async {
    final list = await _get('/trips', {'from': from, 'to': to}) as List;
    return list.map((j) => TripSummary.fromJson(j as Map<String, dynamic>)).toList();
  }

  Future<List<ChargerSummary>> searchChargers({String? segment, String? city}) async {
    final list = await _get('/chargers', {
      if (segment != null) 'segment': segment,
      if (city != null) 'city': city,
    }) as List;
    return list.map((j) => ChargerSummary.fromJson(j as Map<String, dynamic>)).toList();
  }

  // ---- Booking ----

  Future<SeatMap> seats(String tripId) async {
    final r = await _get('/trips/$tripId/seats') as Map<String, dynamic>;
    final tiers = [
      for (final t in (r['cancellationPolicy'] as List?) ?? const []) RefundTier.fromJson(t as Map<String, dynamic>)
    ]..sort((a, b) => b.minHoursBefore.compareTo(a.minHoursBefore));
    return SeatMap(
      seats: (r['seats'] as List).map((j) => SeatInfo.fromJson(j as Map<String, dynamic>)).toList(),
      refundTiers: tiers,
    );
  }

  /// Holds seats for a few minutes. Returns the order id.
  Future<String> holdSeats(String tripId, List<String> seatLabels, String passengerName) async {
    final r = await _post('/bookings', {
      'tripId': tripId,
      'seats': [for (final s in seatLabels) {'seatLabel': s, 'passengerName': passengerName}],
    }) as Map<String, dynamic>;
    return r['orderId'] as String;
  }

  /// Pays from the wallet. Throws [ApiException] 402 with `shortfallPaise` when the wallet is short.
  Future<List<Ticket>> payWithWallet(String orderId) async {
    final r = await _post('/bookings/$orderId/pay') as Map<String, dynamic>;
    return (r['tickets'] as List).map((j) => Ticket.fromJson(j as Map<String, dynamic>)).toList();
  }

  Future<List<BookingSummary>> myBookings() async {
    final list = await _get('/bookings') as List;
    return list.map((j) => BookingSummary.fromJson(j as Map<String, dynamic>)).toList();
  }

  Future<int> cancelBooking(String orderId) async {
    final r = await _post('/bookings/$orderId/cancel') as Map<String, dynamic>;
    return r['refundPaise'] as int;
  }

  // ---- Wallet ----

  Future<WalletSummary> wallet() async => WalletSummary.fromJson(await _get('/wallet') as Map<String, dynamic>);

  /// Adds money. In development the payment is confirmed by the mock gateway;
  /// production opens the Razorpay or Cashfree checkout here instead.
  Future<void> addMoney(int amountPaise) async {
    final t = await _post('/wallet/topups', {'amountPaise': amountPaise}) as Map<String, dynamic>;
    if (t['gateway'] == 'mock') await _post('/wallet/topups/${t['topUpId']}/mock-confirm');
  }
}
