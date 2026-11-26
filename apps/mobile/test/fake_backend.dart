import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

/// In-memory stand-in for the EVGO API, enough for widget tests.
class FakeBackend {
  int balancePaise = 0;
  final held = <String>{};
  final booked = <String>{};
  final history = <Map<String, dynamic>>[];
  bool loggedIn = false;

  late final MockClient client = MockClient((req) async {
    final path = req.url.path.replaceFirst('/v1', '');
    final body = req.body.isEmpty ? <String, dynamic>{} : jsonDecode(req.body) as Map<String, dynamic>;
    http.Response json(Object o, [int status = 200]) => http.Response(jsonEncode(o), status, headers: {'content-type': 'application/json; charset=utf-8'});

    if (path == '/auth/otp/request') {
      if (body['phone'] != '9876543210') return json({'message': 'Enter a valid 10-digit Indian mobile number'}, 400);
      return json({'phone': '+919876543210', 'expiresInSec': 300, 'devCode': '123456'});
    }
    if (path == '/auth/otp/verify') {
      if (body['code'] != '123456') return json({'message': 'Wrong code'}, 401);
      loggedIn = true;
      return json({'accessToken': 'tok', 'user': {'id': 'u1', 'phone': '+919876543210'}});
    }
    if (req.headers['authorization'] != 'Bearer tok' && !path.startsWith('/trips') && !path.startsWith('/chargers')) {
      return json({'message': 'Log in first'}, 401);
    }
    if (path == '/trips') {
      return json([
        {
          'id': 'T1', 'operator': 'EVGO', 'departs': '06:00', 'arrives': '11:30', 'departsAt': '2026-12-01T00:30:00.000Z',
          'busType': 'e-bus AC seater', 'seatsLeft': 4, 'fareInr': 549, 'chargersAtBoarding': 2,
        }
      ]);
    }
    if (path == '/trips/T1/seats') {
      return json({
        'cancellationPolicy': [
          {'minHoursBefore': 24, 'refundPercent': 90},
          {'minHoursBefore': 6, 'refundPercent': 50},
        ],
        'seats': [
          for (final s in ['S1', 'S2', 'S3', 'S4'])
            {'seatLabel': s, 'farePaise': 54900, 'status': booked.contains(s) ? 'booked' : (held.contains(s) ? 'held' : 'available')}
        ]
      });
    }
    if (path == '/bookings' && req.method == 'POST') {
      final seats = [for (final s in body['seats'] as List) (s as Map)['seatLabel'] as String];
      held.addAll(seats);
      return json({'orderId': 'O1', 'totalPaise': 54900 * seats.length}, 201);
    }
    if (path == '/bookings' && req.method == 'GET') {
      return json([
        if (booked.isNotEmpty)
          {'orderId': 'O1', 'status': 'PAID', 'totalPaise': 54900 * booked.length, 'route': 'Guntur to Hyderabad', 'departs': '06:00',
            'tickets': [for (final s in booked) {'seatLabel': s}]}
      ]);
    }
    if (path == '/bookings/O1/pay') {
      final total = 54900 * held.length;
      if (balancePaise < total) {
        return json({'message': 'Not enough money in wallet', 'balancePaise': balancePaise, 'shortfallPaise': total - balancePaise}, 402);
      }
      balancePaise -= total;
      history.add({'amountPaise': -total, 'memo': 'Bus ticket, Guntur to Hyderabad'});
      final tickets = [for (final s in held) {'ticketCode': 'TK$s', 'seatLabel': s, 'passengerName': 'Priya'}];
      booked.addAll(held);
      held.clear();
      return json({'status': 'PAID', 'tickets': tickets}, 201);
    }
    if (path == '/wallet') return json({'balancePaise': balancePaise, 'history': history.reversed.toList()});
    if (path == '/wallet/topups') return json({'topUpId': 'P1', 'amountPaise': body['amountPaise'], 'gateway': 'mock'}, 201);
    if (path == '/wallet/topups/P1/mock-confirm') {
      // The fake remembers nothing about amounts per top-up; credit the last requested amount.
      balancePaise += _lastTopUp;
      history.add({'amountPaise': _lastTopUp, 'memo': 'Added money to wallet'});
      return json({'status': 'SUCCEEDED'}, 201);
    }
    if (path == '/chargers') {
      return json([
        {
          'id': 'GNT-HUB-01', 'operator': 'EVGO', 'pricePerKwhInr': 18, 'segments': ['4W'],
          'place': {'id': 'gnt-hub', 'name': 'Guntur EVGO Hub', 'city': 'Guntur', 'lat': 16.3067, 'lng': 80.4365},
          'connectors': [{'id': 1, 'type': 'CCS2', 'powerKw': 60, 'status': session == null ? 'Available' : 'Charging'}],
        },
        {
          'id': 'HYD-LBN-01', 'operator': 'EVGO', 'pricePerKwhInr': 18, 'segments': ['4W'],
          'place': {'id': 'hyd-lbn', 'name': 'Hyderabad LB Nagar', 'city': 'Hyderabad', 'lat': 17.3457, 'lng': 78.5522},
          'connectors': [{'id': 1, 'type': 'CCS2', 'powerKw': 60, 'status': 'Faulted'}],
        },
      ]);
    }
    if (path == '/charging/sessions' && req.method == 'POST') {
      if (balancePaise < 10000) {
        return json({'message': 'Keep at least ₹100 in your wallet to start charging', 'shortfallPaise': 10000 - balancePaise}, 402);
      }
      session = {'energyWh': 0, 'status': 'ACTIVE', 'chargePointId': body['chargePointId'], 'connectorId': body['connectorId']};
      return json(_session(), 201);
    }
    if (path == '/charging/sessions/active') return json({'session': session?['status'] == 'ACTIVE' ? _session() : null});
    if (path == '/charging/sessions/s1') {
      session!['energyWh'] = (session!['energyWh'] as int) + 1500;
      return json(_session());
    }
    if (path == '/charging/sessions/s1/stop') {
      session!['status'] = 'STOPPED';
      final cost = (session!['energyWh'] as int) * 18 ~/ 10;
      balancePaise -= cost;
      return json({..._session(), 'balancePaise': balancePaise}, 201);
    }
    return json({'message': 'not found'}, 404);
  });

  int _lastTopUp = 0;
  Map<String, Object?>? session;

  Map<String, Object?> _session() {
    final wh = session!['energyWh'] as int;
    return {
      'id': 's1', 'status': session!['status'], 'chargePointId': session!['chargePointId'], 'connectorId': session!['connectorId'],
      'placeName': 'Guntur EVGO Hub', 'connectorType': 'CCS2', 'perKwhInr': 18, 'startedAt': DateTime.now().toIso8601String(),
      'energyKwh': wh / 1000, 'powerKw': session!['status'] == 'ACTIVE' ? 51 : 0, 'costPaise': wh * 18 ~/ 10,
    };
  }

  /// Wraps [client] to remember the amount of each top-up request.
  http.Client get recordingClient => _Recording(this);
}

class _Recording extends http.BaseClient {
  _Recording(this.fake);

  final FakeBackend fake;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    if (request is http.Request && request.url.path.endsWith('/wallet/topups')) {
      fake._lastTopUp = (jsonDecode(request.body) as Map<String, dynamic>)['amountPaise'] as int;
    }
    return fake.client.send(request);
  }
}
