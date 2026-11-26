import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

/// In-memory stand-in for the EVGO API, enough for widget tests.
class FakeBackend {
  int balancePaise = 0;
  final held = <String>{};
  final booked = <String>{};
  bool cancelled = false;
  String paidMethod = 'wallet';
  List<Map<String, dynamic>> lastTickets = [];
  bool topUpPaid = false;
  final history = <Map<String, dynamic>>[];
  bool loggedIn = false;

  /// The second test customer.
  static const otherPhone = '9123456780';

  late final MockClient client = MockClient((req) async {
    final path = req.url.path.replaceFirst('/v1', '');
    final body = req.body.isEmpty ? <String, dynamic>{} : jsonDecode(req.body) as Map<String, dynamic>;
    http.Response json(Object o, [int status = 200]) =>
        http.Response(jsonEncode(o), status, headers: {'content-type': 'application/json; charset=utf-8'});

    if (path == '/auth/otp/request') {
      if (body['phone'] != '9876543210' && body['phone'] != otherPhone)
        return json({'message': 'Enter a valid 10-digit Indian mobile number'}, 400);
      return json({'phone': '+91${body['phone']}', 'expiresInSec': 300, 'devCode': '123456'});
    }
    if (path == '/auth/otp/verify') {
      if (body['code'] != '123456') return json({'message': 'Wrong code'}, 401);
      loggedIn = true;
      if (body['phone'] == otherPhone) {
        return json({
          'accessToken': 'tok2',
          'user': {'id': 'u2', 'phone': '+91$otherPhone'}
        });
      }
      return json({
        'accessToken': 'tok',
        'user': {'id': 'u1', 'phone': '+919876543210'}
      });
    }
    // A second customer with nothing yet: the server only ever returns their own (empty) data.
    if (req.headers['authorization'] == 'Bearer tok2') {
      if (path == '/wallet') return json({'balancePaise': 0, 'history': []});
      if (path == '/bookings' && req.method == 'GET') return json([]);
      if (path == '/charging/sessions' && req.method == 'GET') return json({'sessions': []});
      if (path == '/charging/sessions/active') return json({'session': null});
      if (path.startsWith('/trips') || path.startsWith('/chargers')) {
        // shared catalogue: fall through
      } else {
        return json({'message': 'Not available for this test user'}, 404);
      }
    }
    if (req.headers['authorization'] != 'Bearer tok' && !path.startsWith('/trips') && !path.startsWith('/chargers')) {
      return json({'message': 'Log in first'}, 401);
    }
    if (path == '/trips') {
      return json([
        {
          'id': 'T1',
          'operator': 'EVGO',
          'departs': '06:00',
          'arrives': '11:30',
          'departsAt': '2026-12-01T00:30:00.000Z',
          'busType': 'e-bus AC seater',
          'seatsLeft': 4,
          'fareInr': 549,
          'chargersAtBoarding': 2,
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
    if (path == '/bookings/O1aaaaaa-0000/cancel') {
      cancelled = true;
      final toWallet = paidMethod == 'wallet';
      if (toWallet) balancePaise += 49410;
      return json({
        'orderId': 'O1aaaaaa-0000',
        'refundPaise': 49410,
        'refundTo': paidMethod,
        'refundStatus': toWallet ? 'SUCCEEDED' : 'PENDING',
        'balancePaise': balancePaise
      }, 201);
    }
    if (path == '/bookings/O1/checkout') {
      return json({
        'orderId': 'O1',
        'gateway': 'mock',
        'amountPaise': 54900 * held.length,
        'checkout': {'gatewayOrderId': 'ord_O1', 'paymentSessionId': 'mock_session_ord_O1', 'environment': null},
      }, 201);
    }
    if (path == '/bookings/O1/checkout/mock-pay') {
      paidMethod = body['method'] as String;
      lastTickets = _issue();
      return json({
        'orderId': 'O1',
        'status': 'PAID',
        'tickets': lastTickets,
        'payment': {'method': paidMethod}
      }, 201);
    }
    if (path == '/bookings/O1/checkout/check') {
      return json({'orderId': 'O1', 'status': lastTickets.isEmpty ? 'PENDING' : 'PAID', 'tickets': lastTickets}, 201);
    }
    if (path == '/bookings' && req.method == 'GET') {
      return json([
        if (booked.isNotEmpty)
          {
            'orderId': 'O1aaaaaa-0000',
            'status': cancelled ? 'PARTIALLY_REFUNDED' : 'PAID',
            'totalPaise': 54900 * booked.length,
            'bookedAt': '2026-11-26T09:00:00Z',
            'route': 'Guntur to Hyderabad',
            'departsAt': '2026-12-04T00:30:00Z',
            'departs': '06:00',
            'boarding': {'name': 'Guntur Bus Stand', 'city': 'Guntur', 'at': '2026-12-04T00:30:00Z', 'time': '06:00'},
            'dropping': {'name': 'MGBS', 'city': 'Hyderabad', 'at': '2026-12-04T06:00:00Z', 'time': '11:30'},
            'operator': 'EVGO Bus Lines',
            'bus': {'registration': 'AP 07 EV 1234'},
            'payment': {'method': paidMethod, 'amountPaise': 54900 * booked.length},
            'refundPaise': cancelled ? 49410 : 0,
            'cancellationPolicy': [
              {'minHoursBefore': 24, 'refundPercent': 90},
              {'minHoursBefore': 6, 'refundPercent': 50},
            ],
            'tickets': [
              for (final s in booked)
                {'seatLabel': s, 'ticketCode': 'TK$s', 'passengerName': 'Priya', 'status': 'CONFIRMED', 'farePaise': 54900}
            ]
          }
      ]);
    }
    if (path == '/bookings/O1/pay') {
      final total = 54900 * held.length;
      if (balancePaise < total) {
        return json({'message': 'Not enough money in wallet', 'balancePaise': balancePaise, 'shortfallPaise': total - balancePaise}, 402);
      }
      balancePaise -= total;
      history.add({'amountPaise': -total, 'memo': 'Bus ticket, Guntur to Hyderabad'});
      paidMethod = 'wallet';
      return json({
        'status': 'PAID',
        'tickets': _issue(),
        'payment': {'method': 'wallet'}
      }, 201);
    }
    if (path == '/wallet') return json({'balancePaise': balancePaise, 'history': history.reversed.toList()});
    if (path == '/wallet/topups') {
      topUpPaid = false;
      return json({
        'topUpId': 'P1',
        'amountPaise': body['amountPaise'],
        'gateway': 'mock',
        'checkout': {'gatewayOrderId': 'topup_P1', 'paymentSessionId': 'mock_session_topup_P1', 'environment': null},
      }, 201);
    }
    if (path == '/wallet/topups/P1/mock-confirm') {
      // The fake remembers nothing about amounts per top-up; credit the last requested amount.
      balancePaise += _lastTopUp;
      topUpPaid = true;
      final by = {'upi': ' by UPI', 'card': ' by card', 'netbanking': ' by netbanking'}[body['method']] ?? '';
      history.add({'amountPaise': _lastTopUp, 'memo': 'Added money to wallet$by'});
      return json({'status': 'SUCCEEDED'}, 201);
    }
    if (path == '/wallet/topups/P1/check') return json({'status': topUpPaid ? 'SUCCEEDED' : 'FAILED'}, 201);
    if (path == '/chargers') {
      return json([
        {
          'id': 'GNT-HUB-01',
          'operator': 'EVGO',
          'pricePerKwhInr': 18,
          'segments': ['4W'],
          'place': {'id': 'gnt-hub', 'name': 'Guntur EVGO Hub', 'city': 'Guntur', 'lat': 16.3067, 'lng': 80.4365},
          'connectors': [
            {'id': 1, 'type': 'CCS2', 'powerKw': 60, 'status': session == null ? 'Available' : 'Charging'}
          ],
        },
        {
          'id': 'HYD-LBN-01',
          'operator': 'EVGO',
          'pricePerKwhInr': 18,
          'segments': ['4W'],
          'place': {'id': 'hyd-lbn', 'name': 'Hyderabad LB Nagar', 'city': 'Hyderabad', 'lat': 17.3457, 'lng': 78.5522},
          'connectors': [
            {'id': 1, 'type': 'CCS2', 'powerKw': 60, 'status': 'Faulted'}
          ],
        },
        {
          'id': 'VJW-BNZ-01',
          'operator': 'EVGO',
          'pricePerKwhInr': 15,
          'segments': ['4W'],
          'place': {'id': 'vjw-bnz', 'name': 'Vijayawada Benz Circle', 'city': 'Vijayawada', 'lat': 16.4985, 'lng': 80.6563},
          'connectors': [
            {'id': 1, 'type': 'Type2', 'powerKw': 22, 'status': 'Available'}
          ],
        },
        {
          'id': 'SRY-DEP-01',
          'operator': 'EVGO',
          'pricePerKwhInr': 20,
          'segments': ['BUS'],
          'place': {'id': 'sry-dep', 'name': 'Suryapet Bus Depot', 'city': 'Suryapet', 'lat': 17.1405, 'lng': 79.6231},
          'connectors': [
            {'id': 1, 'type': 'CCS2', 'powerKw': 240, 'status': 'Available'}
          ],
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
    if (path == '/charging/upi-blocks' && req.method == 'POST') {
      block = {
        'id': 'b1',
        'status': 'PENDING',
        'gateway': 'mock',
        'amountPaise': body['amountPaise'],
        'cp': body['chargePointId'],
        'k': body['connectorId']
      };
      return json({...block!, 'upiIntentUrl': 'upi://mandate?am=500'}, 201);
    }
    if (path == '/charging/upi-blocks/b1/mock-approve') {
      block!['status'] = 'AUTHORIZED';
      return json(block!, 201);
    }
    if (path == '/charging/upi-blocks/b1/mock-decline') {
      block!['status'] = 'FAILED';
      return json(block!, 201);
    }
    if (path == '/charging/upi-blocks/b1/start') {
      if (block!['status'] == 'FAILED') return json({'message': 'The payment was not approved in your UPI app'}, 402);
      if (block!['status'] == 'PENDING') return json({'block': block, 'session': null}, 201);
      if (block!['status'] == 'AUTHORIZED') {
        block!['status'] = 'IN_USE';
        session = {'energyWh': 0, 'status': 'ACTIVE', 'chargePointId': block!['cp'], 'connectorId': block!['k'], 'block': block};
      }
      return json({'block': block, 'session': _session()}, 201);
    }
    if (path == '/charging/sessions' && req.method == 'GET')
      return json({
        'sessions': session == null ? [] : [_session()]
      });
    if (path == '/charging/sessions/active') return json({'session': session?['status'] == 'ACTIVE' ? _session() : null});
    if (path == '/charging/sessions/s1') {
      session!['energyWh'] = (session!['energyWh'] as int) + 1500;
      return json(_session());
    }
    if (path == '/charging/sessions/s1/stop') {
      session!['status'] = 'STOPPED';
      final cost = (session!['energyWh'] as int) * 18 ~/ 10;
      if (session!['block'] != null) {
        (session!['block'] as Map)['status'] = 'CAPTURED';
        (session!['block'] as Map)['capturedPaise'] = cost;
        return json(_session(), 201);
      }
      balancePaise -= cost;
      return json({..._session(), 'balancePaise': balancePaise}, 201);
    }
    return json({'message': 'not found'}, 404);
  });

  int _lastTopUp = 0;

  /// Held seats become tickets.
  List<Map<String, dynamic>> _issue() {
    final tickets = [
      for (final s in held) {'ticketCode': 'TK$s', 'seatLabel': s, 'passengerName': 'Priya'}
    ];
    booked.addAll(held);
    held.clear();
    return tickets;
  }

  Map<String, Object?>? session;
  Map<String, Object?>? block;

  Map<String, Object?> _session() {
    final wh = session!['energyWh'] as int;
    final b = session!['block'] as Map<String, Object?>?;
    return {
      'id': 's1',
      'status': session!['status'],
      'chargePointId': session!['chargePointId'],
      'connectorId': session!['connectorId'],
      'placeName': 'Guntur EVGO Hub',
      'connectorType': 'CCS2',
      'perKwhInr': 18,
      'startedAt': DateTime.now().toIso8601String(),
      'energyKwh': wh / 1000,
      'powerKw': session!['status'] == 'ACTIVE' ? 51 : 0,
      'costPaise': wh * 18 ~/ 10,
      'payment': b == null
          ? {'method': 'wallet'}
          : {
              'method': 'upi',
              'blockedPaise': b['amountPaise'],
              'capturedPaise': b['capturedPaise'] ?? 0,
              'status': b['status'],
              'releasedPaise': session!['status'] == 'STOPPED' ? (b['amountPaise'] as int) - (b['capturedPaise'] as int? ?? 0) : 0,
            },
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
