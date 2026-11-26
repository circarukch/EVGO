import 'package:evgo/api/evgo_api.dart';
import 'package:evgo/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'fake_backend.dart';

void main() {
  late FakeBackend backend;
  late EvgoApi api;

  setUp(() {
    backend = FakeBackend();
    api = EvgoApi(baseUrl: 'http://test/v1', client: backend.recordingClient);
  });

  Future<void> logIn(WidgetTester tester) async {
    await tester.pumpWidget(EvgoApp(api: api));
    await tester.enterText(find.byType(TextField).first, '9876543210');
    await tester.tap(find.text('Send code'));
    await tester.pumpAndSettle();
    expect(find.text('Test server code: 123456'), findsOneWidget);
    await tester.enterText(find.byType(TextField).last, '123456');
    await tester.tap(find.text('Log in'));
    await tester.pumpAndSettle();
  }

  testWidgets('shows an error for an invalid phone number', (tester) async {
    await tester.pumpWidget(EvgoApp(api: api));
    await tester.enterText(find.byType(TextField).first, '12345');
    await tester.tap(find.text('Send code'));
    await tester.pumpAndSettle();
    expect(find.text('Enter a valid 10-digit Indian mobile number'), findsOneWidget);
  });

  testWidgets('logs in and shows the four tabs', (tester) async {
    await logIn(tester);
    for (final tab in ['Home', 'Travel', 'Charge', 'Wallet']) {
      expect(find.text(tab), findsOneWidget);
    }
    expect(find.text('No upcoming trips. Book a bus from the Travel tab.'), findsOneWidget);
  });

  testWidgets('books a seat, tops up the shortfall, and shows the ticket and trip', (tester) async {
    await logIn(tester);
    await tester.tap(find.text('Travel'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Search buses'));
    await tester.pumpAndSettle();
    expect(find.textContaining('2 chargers at boarding'), findsOneWidget);

    await tester.tap(find.textContaining('06:00 to 11:30'));
    await tester.pumpAndSettle();
    expect(find.text('Cancel 24h+ before: 90% back · 6h+ before: 50% back. Closes 6h before departure.'), findsOneWidget);
    await tester.tap(find.text('S1'));
    await tester.pump();
    await tester.enterText(find.widgetWithText(TextField, 'Passenger name'), 'Priya');
    await tester.tap(find.text('Pay ₹549 from wallet'));
    await tester.pumpAndSettle();

    expect(find.text('Not enough money in wallet'), findsOneWidget);
    await tester.tap(find.text('Add ₹549 to wallet and pay'));
    await tester.pumpAndSettle();
    expect(find.text('Ticket TKS1'), findsOneWidget);

    await tester.tap(find.text('Done'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Home'));
    await tester.pumpAndSettle();
    expect(find.text('Guntur to Hyderabad'), findsOneWidget);
  });

  testWidgets('adds money and shows the wallet history', (tester) async {
    await logIn(tester);
    await tester.tap(find.text('Wallet'));
    await tester.pumpAndSettle();
    expect(find.text('₹0'), findsOneWidget);
    await tester.tap(find.text('+ ₹500'));
    await tester.pumpAndSettle();
    expect(find.text('₹500'), findsOneWidget);
    expect(find.text('Added money to wallet'), findsOneWidget);
  });

  testWidgets('lists chargers for the chosen vehicle type', (tester) async {
    await logIn(tester);
    await tester.tap(find.text('Charge'));
    await tester.pumpAndSettle();
    expect(find.text('Guntur EVGO Hub'), findsOneWidget);
    expect(find.byType(ChoiceChip), findsNWidgets(5));
  });
}
