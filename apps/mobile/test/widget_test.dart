import 'dart:convert';

import 'package:evgo/api/evgo_api.dart';
import 'package:evgo/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  final client = MockClient((req) async {
    if (req.url.path.endsWith('/chargers')) {
      return http.Response(
        jsonEncode([
          {
            'id': 'GNT-HUB-01',
            'operator': 'EVGO',
            'place': {'name': 'Guntur EVGO Hub'},
            'connectors': [
              {'type': 'CCS2', 'powerKw': 60, 'status': 'Available'}
            ],
            'pricePerKwhInr': 18,
          }
        ]),
        200,
      );
    }
    return http.Response(
      jsonEncode([
        {
          'id': 'T-0600',
          'operator': 'EVGO',
          'departs': '06:00',
          'arrives': '11:30',
          'busType': 'e-bus AC seater',
          'seatsLeft': 23,
          'fareInr': 549,
          'chargersAtBoarding': 2,
        }
      ]),
      200,
    );
  });
  final api = EvgoApi(baseUrl: 'http://test/v1', client: client);

  testWidgets('shows four tabs with bus and charging in one app', (tester) async {
    await tester.pumpWidget(EvgoApp(api: api));
    expect(find.text('Home'), findsOneWidget);
    expect(find.text('Travel'), findsOneWidget);
    expect(find.text('Charge'), findsOneWidget);
    expect(find.text('Wallet'), findsOneWidget);
  });

  testWidgets('searches Guntur to Hyderabad buses', (tester) async {
    await tester.pumpWidget(EvgoApp(api: api));
    await tester.tap(find.text('Travel'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Search buses'));
    await tester.pumpAndSettle();
    expect(find.textContaining('2 chargers at boarding'), findsOneWidget);
    expect(find.text('₹549'), findsOneWidget);
  });

  testWidgets('lists chargers for the chosen vehicle type', (tester) async {
    await tester.pumpWidget(EvgoApp(api: api));
    await tester.tap(find.text('Charge'));
    await tester.pumpAndSettle();
    expect(find.text('Guntur EVGO Hub'), findsOneWidget);
    expect(find.byType(ChoiceChip), findsNWidgets(5));
  });
}
