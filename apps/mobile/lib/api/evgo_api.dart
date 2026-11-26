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

  /// Logged-in mobile number, shown on the account sheet.
  String? phone;

  /// Called after [logOut], so the app can return to the login screen.
  void Function()? onLoggedOut;

  /// Forgets this device's session. The user can log back in with a new OTP.
  void logOut() {
    token = null;
    phone = null;
    onLoggedOut?.call();
  }

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

  Future<dynamic> _delete(String path) async {
    final res = await _client.delete(Uri.parse('$baseUrl$path'), headers: _headers);
    return _decode(res);
  }

  dynamic _decode(http.Response res) {
    final data = res.body.isEmpty ? null : jsonDecode(res.body);
    if (res.statusCode == 401 && token != null) {
      // Session expired or was revoked: drop it so the app shows the login screen.
      logOut();
    }
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
    this.phone = (r['user'] as Map<String, dynamic>?)?['phone'] as String? ?? phone;
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

  // ---- Charging ----

  /// Starts a session. Throws [ApiException] 402 with `shortfallPaise` when the wallet is below the minimum.
  Future<ChargingSessionView> startCharging(String chargePointId, int connectorId) async => ChargingSessionView.fromJson(
      await _post('/charging/sessions', {'chargePointId': chargePointId, 'connectorId': connectorId}) as Map<String, dynamic>);

  /// Pay by UPI, no wallet: ask the customer's bank to block [amountPaise] for this session.
  Future<UpiBlockView> createUpiBlock(String chargePointId, int connectorId, int amountPaise) async => UpiBlockView.fromJson(
      await _post('/charging/upi-blocks', {'chargePointId': chargePointId, 'connectorId': connectorId, 'amountPaise': amountPaise})
          as Map<String, dynamic>);

  /// Call after the customer approves in their UPI app. Session is null while approval is pending.
  Future<(UpiBlockView, ChargingSessionView?)> startWithUpiBlock(String blockId) async {
    final r = await _post('/charging/upi-blocks/$blockId/start') as Map<String, dynamic>;
    final s = r['session'];
    return (
      UpiBlockView.fromJson(r['block'] as Map<String, dynamic>),
      s == null ? null : ChargingSessionView.fromJson(s as Map<String, dynamic>)
    );
  }

  Future<UpiBlockView> cancelUpiBlock(String blockId) async =>
      UpiBlockView.fromJson(await _delete('/charging/upi-blocks/$blockId') as Map<String, dynamic>);

  /// Development and demo only: stands in for the customer's UPI app.
  Future<void> mockUpiDecision(String blockId, {required bool approve}) async =>
      _post('/charging/upi-blocks/$blockId/${approve ? 'mock-approve' : 'mock-decline'}');

  /// Latest sessions, the running one first.
  Future<List<ChargingSessionView>> recentCharging({int limit = 5}) async {
    final r = await _get('/charging/sessions', {'limit': '$limit'}) as Map<String, dynamic>;
    return [for (final s in r['sessions'] as List) ChargingSessionView.fromJson(s as Map<String, dynamic>)];
  }

  Future<ChargingSessionView?> activeCharging() async {
    final r = await _get('/charging/sessions/active') as Map<String, dynamic>;
    final s = r['session'];
    return s == null ? null : ChargingSessionView.fromJson(s as Map<String, dynamic>);
  }

  Future<ChargingSessionView> chargingSession(String id) async =>
      ChargingSessionView.fromJson(await _get('/charging/sessions/$id') as Map<String, dynamic>);

  Future<ChargingSessionView> stopCharging(String id) async =>
      ChargingSessionView.fromJson(await _post('/charging/sessions/$id/stop') as Map<String, dynamic>);

  // ---- Booking ----

  Future<SeatMap> seats(String tripId) async {
    final r = await _get('/trips/$tripId/seats') as Map<String, dynamic>;
    final tiers = [for (final t in (r['cancellationPolicy'] as List?) ?? const []) RefundTier.fromJson(t as Map<String, dynamic>)]
      ..sort((a, b) => b.minHoursBefore.compareTo(a.minHoursBefore));
    return SeatMap(
      seats: (r['seats'] as List).map((j) => SeatInfo.fromJson(j as Map<String, dynamic>)).toList(),
      refundTiers: tiers,
    );
  }

  /// Holds seats for a few minutes. Returns the order id.
  Future<String> holdSeats(String tripId, List<String> seatLabels, String passengerName) async {
    final r = await _post('/bookings', {
      'tripId': tripId,
      'seats': [
        for (final s in seatLabels) {'seatLabel': s, 'passengerName': passengerName}
      ],
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

  /// Starts paying for held seats by UPI, card or netbanking on the gateway's checkout.
  Future<CheckoutSession> startTicketCheckout(String orderId) async {
    final r = await _post('/bookings/$orderId/checkout') as Map<String, dynamic>;
    return CheckoutSession.fromJson(r['checkout'] as Map<String, dynamic>, r['gateway'] as String, r['amountPaise'] as int);
  }

  /// After checkout closes: issues the tickets if the payment went through.
  Future<TicketPayment> checkTicketCheckout(String orderId) async =>
      TicketPayment.fromJson(await _post('/bookings/$orderId/checkout/check') as Map<String, dynamic>);

  /// Test mode only: stands in for paying on the checkout.
  Future<TicketPayment> mockPayTicket(String orderId, String method) async =>
      TicketPayment.fromJson(await _post('/bookings/$orderId/checkout/mock-pay', {'method': method}) as Map<String, dynamic>);

  Future<CancelResult> cancelBooking(String orderId) async =>
      CancelResult.fromJson(await _post('/bookings/$orderId/cancel') as Map<String, dynamic>);

  // ---- Wallet ----

  Future<WalletSummary> wallet() async => WalletSummary.fromJson(await _get('/wallet') as Map<String, dynamic>);

  /// Starts adding money: returns the top-up id and the checkout to open.
  Future<(String, CheckoutSession)> startTopUp(int amountPaise) async {
    final t = await _post('/wallet/topups', {'amountPaise': amountPaise}) as Map<String, dynamic>;
    return (t['topUpId'] as String, CheckoutSession.fromJson(t['checkout'] as Map<String, dynamic>, t['gateway'] as String, amountPaise));
  }

  /// After checkout closes: SUCCEEDED, PENDING or FAILED.
  Future<String> checkTopUp(String topUpId) async {
    final r = await _post('/wallet/topups/$topUpId/check') as Map<String, dynamic>;
    return r['status'] as String;
  }

  /// Test mode only: stands in for paying on the checkout.
  Future<String> mockPayTopUp(String topUpId, String method) async {
    final r = await _post('/wallet/topups/$topUpId/mock-confirm', {'method': method}) as Map<String, dynamic>;
    return r['status'] as String;
  }
}
