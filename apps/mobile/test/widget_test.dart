import 'package:evgo/api/evgo_api.dart';
import 'package:evgo/main.dart';
import 'package:evgo/screens/charge_screen.dart';
import 'package:evgo/screens/station_map.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'fake_backend.dart';

void main() {
  late FakeBackend backend;
  late EvgoApi api;

  setUp(() {
    mapTilesEnabled = false;
    backend = FakeBackend();
    api = EvgoApi(baseUrl: 'http://test/v1', client: backend.recordingClient);
  });

  Future<void> logIn(WidgetTester tester, {String phone = '9876543210', bool fresh = true}) async {
    if (fresh) await tester.pumpWidget(EvgoApp(api: api));
    await tester.enterText(find.byType(TextField).first, phone);
    await tester.tap(find.text('Send code'));
    await tester.pumpAndSettle();
    expect(find.text('Test server code: 123456'), findsOneWidget);
    await tester.enterText(find.byType(TextField).last, '123456');
    await tester.tap(find.text('Log in'));
    await tester.pumpAndSettle();
  }

  /// Home is a long page; scroll it until [text] is on screen.
  Future<void> scrollTo(WidgetTester tester, String text) async {
    await tester.scrollUntilVisible(find.text(text), 200, scrollable: find.byType(Scrollable).first);
    await tester.ensureVisible(find.text(text));
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
    expect(find.text('Want a ticket?'), findsOneWidget);
    expect(find.text('Want to charge your EV?'), findsOneWidget);
    await scrollTo(tester, 'No trips or charging yet');
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
    expect(find.textContaining('Cashfree checkout · test mode'), findsOneWidget);
    await tester.tap(find.byKey(const Key('checkout-upi')));
    await tester.pumpAndSettle();
    expect(find.text('Ticket TKS1'), findsOneWidget);

    await tester.tap(find.text('Done'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Home'));
    await tester.pumpAndSettle();
    await scrollTo(tester, 'Guntur to Hyderabad');
    expect(find.text('Guntur to Hyderabad'), findsOneWidget);
    expect(find.textContaining('Fri 4 Dec · 06:00 · Seat S1'), findsOneWidget); // the date, not just the time

    // Tap for the full ticket.
    await tester.tap(find.text('Guntur to Hyderabad'));
    await tester.pumpAndSettle();
    expect(find.text('Trip details'), findsOneWidget);
    expect(find.text('Fri, 4 Dec 2026'), findsOneWidget);
    expect(find.text('Guntur Bus Stand\nGuntur'), findsOneWidget);
    expect(find.text('MGBS\nHyderabad'), findsOneWidget);
    expect(find.text('Journey 5 h 30 min'), findsOneWidget);
    expect(find.text('Priya · Seat S1'), findsOneWidget);
    expect(find.text('Ticket TKS1'), findsOneWidget);
    expect(find.text('AP 07 EV 1234'), findsOneWidget);
    expect(find.text('Confirmed'), findsOneWidget);
    await scrollTo(tester, 'Cancel ticket');
    await tester.tap(find.byKey(const Key('cancel-ticket')));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Cancel ticket').last);
    await tester.pumpAndSettle();
    expect(find.text('Cancelled. ₹494.10 refunded to your wallet'), findsOneWidget);
    await tester.drag(find.byType(ListView).first, const Offset(0, 2000));
    await tester.pumpAndSettle();
    expect(find.text('Cancelled, partly refunded'), findsOneWidget);
    expect(find.byKey(const Key('cancel-ticket')), findsNothing);
  });

  testWidgets('adds money and shows the wallet history', (tester) async {
    await logIn(tester);
    await tester.tap(find.text('Wallet'));
    await tester.pumpAndSettle();
    expect(find.text('₹0'), findsOneWidget);
    await tester.tap(find.text('+ ₹500'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('checkout-card')));
    await tester.pumpAndSettle();
    expect(find.text('₹500'), findsOneWidget);
    expect(find.text('Added money to wallet by card'), findsOneWidget);
  });

  testWidgets('books a seat by UPI with no wallet, and refunds back to UPI on cancel', (tester) async {
    await logIn(tester);
    await tester.tap(find.text('Travel'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Search buses'));
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('06:00 to 11:30'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('S1'));
    await tester.pump();
    await tester.enterText(find.widgetWithText(TextField, 'Passenger name'), 'Priya');
    expect(find.text('Pay ₹549 · UPI, card or netbanking'), findsOneWidget);
    await tester.tap(find.byKey(const Key('pay-online')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('checkout-upi')));
    await tester.pumpAndSettle();
    expect(find.text('Ticket TKS1'), findsOneWidget);

    await tester.tap(find.text('Done'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Home'));
    await tester.pumpAndSettle();
    await scrollTo(tester, 'Guntur to Hyderabad');
    await tester.tap(find.text('Guntur to Hyderabad'));
    await tester.pumpAndSettle();
    await scrollTo(tester, 'Cancel ticket');
    await tester.tap(find.byKey(const Key('cancel-ticket')));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Cancel ticket').last);
    await tester.pumpAndSettle();
    expect(find.text('Cancelled. ₹494.10 is on its way back to your UPI account (usually 3 to 5 working days)'), findsOneWidget);
    await tester.drag(find.byType(ListView).first, const Offset(0, 2000));
    await tester.pumpAndSettle();
    await scrollTo(tester, 'Refunded to UPI');
    expect(find.text('Refunded to UPI'), findsOneWidget);
  });

  testWidgets('shows stations on the map and as a list, with vehicle filters', (tester) async {
    await logIn(tester);
    await tester.tap(find.text('Charge'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('pin-gnt-hub')), findsOneWidget);
    expect(find.byTooltip('Hyderabad LB Nagar: offline · DC up to 60 kW'), findsOneWidget); // its only plug is faulted
    expect(find.byTooltip('Guntur EVGO Hub: 1 of 1 free · DC up to 60 kW'), findsOneWidget);
    expect(find.byTooltip('Vijayawada Benz Circle: 1 of 1 free · AC up to 22 kW'), findsOneWidget);
    // Power labels under the pins; a label that would cover a nearby pin waits until the user zooms in.
    expect(find.text('240 kW DC'), findsOneWidget);
    expect(find.textContaining(RegExp(r'^\d+ kW (AC|DC)')), findsWidgets);
    // Four filters in one row: vehicle, AC/DC, power, plug.
    for (final f in ['Vehicle', 'AC / DC', 'Power', 'Plug']) {
      expect(find.text(f), findsOneWidget);
    }
    await tester.tap(find.byKey(const Key('filter-vehicle')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Bus').last);
    await tester.pumpAndSettle();
    expect(find.descendant(of: find.byKey(const Key('filter-vehicle')), matching: find.text('Bus')), findsOneWidget);
    await tester.tap(find.byKey(const Key('filter-vehicle')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Any vehicle').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('List'));
    await tester.pumpAndSettle();
    expect(find.text('Guntur EVGO Hub'), findsOneWidget);
    expect(find.text('Guntur · DC up to 60 kW · from ₹18/kWh'), findsOneWidget);
    expect(find.text('Vijayawada · AC up to 22 kW · from ₹15/kWh'), findsOneWidget);
  });

  testWidgets('filters chargers by AC/DC and by power', (tester) async {
    await logIn(tester);
    await tester.tap(find.text('Charge'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('List'));
    await tester.pumpAndSettle();
    expect(find.text('Suryapet Bus Depot'), findsOneWidget);

    await tester.tap(find.byKey(const Key('filter-current')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('AC chargers').last);
    await tester.pumpAndSettle();
    expect(find.text('Vijayawada Benz Circle'), findsOneWidget);
    expect(find.text('Guntur EVGO Hub'), findsNothing);

    await tester.tap(find.byKey(const Key('filter-current')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('DC fast chargers').last);
    await tester.pumpAndSettle();
    expect(find.text('Vijayawada Benz Circle'), findsNothing);
    expect(find.text('Guntur EVGO Hub'), findsOneWidget);

    await tester.tap(find.byKey(const Key('filter-power')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('120 kW and above').last);
    await tester.pumpAndSettle();
    expect(find.text('120 kW+'), findsOneWidget);
    expect(find.text('Suryapet Bus Depot'), findsOneWidget);
    expect(find.text('Guntur EVGO Hub'), findsNothing);

    await tester.tap(find.byKey(const Key('filter-current')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('AC chargers').last);
    await tester.pumpAndSettle();
    expect(find.text('No chargers match these filters yet.'), findsOneWidget);
    await tester.tap(find.byKey(const Key('clear-filters')));
    await tester.pumpAndSettle();
    expect(find.text('Vijayawada Benz Circle'), findsOneWidget);
    expect(find.text('Any'), findsNWidgets(4)); // all four filters back to Any
  });

  testWidgets('starts charging from the station sheet, watches it live, stops and sees the bill', (tester) async {
    backend.balancePaise = 50000;
    await logIn(tester);
    await tester.tap(find.text('Charge'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('List'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Guntur EVGO Hub'));
    await tester.pumpAndSettle();
    expect(find.text('1 of 1 free'), findsOneWidget);
    await tester.tap(find.byKey(const Key('start-GNT-HUB-01-1')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('pay-wallet')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));
    expect(find.text('0.00 kWh'), findsOneWidget);
    await tester.pump(const Duration(seconds: 3));
    await tester.pump();
    expect(find.text('1.50 kWh'), findsOneWidget);
    expect(find.text('₹27'), findsOneWidget);

    await tester.tap(find.text('Stop charging'));
    await tester.pump(const Duration(milliseconds: 500));
    expect(find.text('Stop charging?'), findsOneWidget);
    await tester.tap(find.widgetWithText(FilledButton, 'Stop'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));
    expect(find.text('Charging done'), findsOneWidget);
    await scrollTo(tester, 'Wallet balance');
    expect(find.text('₹473'), findsOneWidget); // wallet after paying ₹27
  });

  testWidgets('asks for money when the wallet is below the minimum to charge', (tester) async {
    await logIn(tester);
    await tester.tap(find.text('Charge'));
    await tester.pumpAndSettle();
    // Map pins open the same sheet.
    tester.widget<GestureDetector>(find.byKey(const Key('pin-gnt-hub'))).onTap!();
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('start-GNT-HUB-01-1')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('pay-wallet')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));
    expect(find.text('Keep at least ₹100 in your wallet to start charging'), findsOneWidget);
    expect(find.text('Add ₹100'), findsOneWidget);
  });

  Future<void> startByUpi(WidgetTester tester) async {
    await logIn(tester); // wallet is empty: UPI needs none
    await tester.tap(find.text('Charge'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('List'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Guntur EVGO Hub'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('start-GNT-HUB-01-1')));
    await tester.pumpAndSettle();
    expect(find.text('Pay by UPI'), findsOneWidget);
    expect(find.text('Hold ₹500 by UPI and start'), findsOneWidget); // 60 kW DC: ₹300 / ₹500 / ₹1000
    await tester.tap(find.byKey(const Key('pay-upi')));
    await tester.pumpAndSettle();
    expect(find.text('UPI app (test)'), findsOneWidget);
  }

  testWidgets('pays by UPI with no wallet: holds ₹500, charges, pays what was used and releases the rest', (tester) async {
    await startByUpi(tester);
    await tester.tap(find.byKey(const Key('mock-upi-approve')));
    for (var i = 0; i < 6; i++) {
      await tester.pump(const Duration(milliseconds: 200));
    }
    expect(find.text('Charging'), findsWidgets);
    expect(find.text('Held by UPI'), findsOneWidget);
    await tester.pump(const Duration(seconds: 3));
    await tester.pump();
    expect(find.text('1.50 kWh'), findsOneWidget);

    await tester.tap(find.text('Stop charging'));
    await tester.pump(const Duration(milliseconds: 500));
    await tester.tap(find.widgetWithText(FilledButton, 'Stop'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));
    expect(find.text('Charging done'), findsOneWidget);
    await scrollTo(tester, 'Released to your bank');
    expect(find.text('UPI'), findsOneWidget); // Paid by
    expect(find.text('Released to your bank'), findsOneWidget);
    expect(find.text('₹473'), findsOneWidget); // ₹500 held − ₹27 used
    await scrollTo(tester, 'Share receipt');
    expect(find.text('GST (18%)'), findsOneWidget);
    expect(find.byKey(const Key('share-receipt')), findsOneWidget);
    expect(backend.balancePaise, 0);
  });

  testWidgets('Home shows a running charge live, and recent charging after it stops', (tester) async {
    await startByUpi(tester);
    await tester.tap(find.byKey(const Key('mock-upi-approve')));
    for (var i = 0; i < 6; i++) {
      await tester.pump(const Duration(milliseconds: 200));
    }
    // Leave the live screen running and go Home.
    await tester.pageBack();
    await tester.pump(const Duration(milliseconds: 500));
    await tester.pump(const Duration(milliseconds: 500));
    await tester.tap(find.text('Home'));
    await tester.pump(const Duration(milliseconds: 500));
    await scrollTo(tester, 'Your trips');
    expect(find.byKey(const Key('home-live-charging')), findsOneWidget);
    expect(find.text('Charging now · Guntur EVGO Hub'), findsOneWidget);
    expect(find.text('₹500 held by UPI · tap to stop'), findsOneWidget);
    expect(find.text('No trips or charging yet'), findsNothing);

    // Tap it: the live screen, with Stop.
    await tester.tap(find.byKey(const Key('home-live-charging')));
    await tester.pump(const Duration(milliseconds: 500));
    await tester.pump(const Duration(milliseconds: 500));
    await tester.tap(find.text('Stop charging'));
    await tester.pump(const Duration(milliseconds: 500));
    await tester.tap(find.widgetWithText(FilledButton, 'Stop'));
    await tester.pump(const Duration(milliseconds: 500));
    await tester.tap(find.text('Done'));
    for (var i = 0; i < 4; i++) {
      await tester.pump(const Duration(milliseconds: 500));
    }
    expect(find.byKey(const Key('home-live-charging')), findsNothing);
    expect(find.text('Recent charging'), findsOneWidget);
    expect(find.byKey(const Key('recent-s1')), findsOneWidget);
  });

  Future<void> logOutFromMenu(WidgetTester tester) async {
    await tester.tap(find.byTooltip('Account'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Log out').first);
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Log out'));
    await tester.pumpAndSettle();
  }

  testWidgets('a different number that logs in sees none of the previous user\'s charging, trips or wallet', (tester) async {
    await startByUpi(tester);
    await tester.tap(find.byKey(const Key('mock-upi-approve')));
    for (var i = 0; i < 6; i++) {
      await tester.pump(const Duration(milliseconds: 200));
    }
    await tester.tap(find.text('Stop charging'));
    await tester.pump(const Duration(milliseconds: 500));
    await tester.tap(find.widgetWithText(FilledButton, 'Stop'));
    await tester.pump(const Duration(milliseconds: 500));
    await tester.tap(find.text('Done'));
    for (var i = 0; i < 4; i++) {
      await tester.pump(const Duration(milliseconds: 500));
    }
    await tester.tap(find.text('Home'));
    await tester.pumpAndSettle();
    await scrollTo(tester, 'Recent charging');
    expect(find.byKey(const Key('recent-s1')), findsOneWidget);

    await logOutFromMenu(tester);
    await logIn(tester, phone: FakeBackend.otherPhone, fresh: false);
    expect(api.phone, '+91${FakeBackend.otherPhone}');
    await scrollTo(tester, 'No trips or charging yet');
    expect(find.text('No trips or charging yet'), findsOneWidget);
    expect(find.text('Recent charging'), findsNothing);
    expect(find.byKey(const Key('recent-s1')), findsNothing);
    await tester.tap(find.text('Wallet'));
    await tester.pumpAndSettle();
    expect(find.text('₹0'), findsOneWidget);
    expect(find.text('No transactions yet'), findsOneWidget);
  });

  testWidgets('when the session ends, screens opened on top close and nothing of the user stays behind the login page', (tester) async {
    await startByUpi(tester);
    await tester.tap(find.byKey(const Key('mock-upi-approve')));
    for (var i = 0; i < 6; i++) {
      await tester.pump(const Duration(milliseconds: 200));
    }
    expect(find.text('Stop charging'), findsOneWidget); // live charging screen is open on top
    api.token = 'expired';
    for (var i = 0; i < 8; i++) {
      await tester.pump(const Duration(milliseconds: 500));
    }
    expect(find.text('Send code'), findsOneWidget);
    expect(find.text('Stop charging'), findsNothing);
    expect(find.byType(BackButton), findsNothing);
  });

  testWidgets('shows recent activity from the account menu: tickets and wallet, newest first, tap for details', (tester) async {
    await logIn(tester);
    await tester.tap(find.text('Wallet'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('+ ₹1000'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('checkout-card')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Travel'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Search buses'));
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('06:00 to 11:30'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('S1'));
    await tester.pump();
    await tester.enterText(find.widgetWithText(TextField, 'Passenger name'), 'Priya');
    await tester.tap(find.byKey(const Key('pay-wallet')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Done'));
    await tester.pumpAndSettle();

    await tester.tap(find.byTooltip('Account'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('account-activity')));
    await tester.pumpAndSettle();
    expect(find.text('Recent activity'), findsOneWidget);
    expect(find.byKey(const Key('activity-trip-O1aaaaaa-0000')), findsOneWidget);
    expect(find.text('Added money to wallet by card'), findsOneWidget);
    expect(find.text('+₹1000'), findsOneWidget);
    // The ticket payment is shown once, as the trip, not again as a wallet line.
    expect(find.text('Bus ticket, Guntur to Hyderabad'), findsNothing);

    await tester.tap(find.byKey(const Key('activity-filter-wallet')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('activity-trip-O1aaaaaa-0000')), findsNothing);
    expect(find.text('Added money to wallet by card'), findsOneWidget);
    await tester.tap(find.byKey(const Key('activity-filter-all')));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('activity-trip-O1aaaaaa-0000')));
    await tester.pumpAndSettle();
    expect(find.text('Trip details'), findsOneWidget);
    expect(find.text('Ticket TKS1'), findsOneWidget);
  });

  testWidgets('a new account sees an empty recent activity', (tester) async {
    await logIn(tester, phone: FakeBackend.otherPhone);
    await tester.tap(find.byTooltip('Account'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('account-activity')));
    await tester.pumpAndSettle();
    expect(find.textContaining('Nothing here yet'), findsOneWidget);
  });

  testWidgets('a declined UPI request does not start charging', (tester) async {
    await startByUpi(tester);
    await tester.tap(find.byKey(const Key('mock-upi-decline')));
    for (var i = 0; i < 6; i++) {
      await tester.pump(const Duration(milliseconds: 200));
    }
    expect(find.text('Charging did not start'), findsOneWidget);
    expect(find.text('The payment was not approved in your UPI app'), findsOneWidget);
    expect(find.text('No money was taken.'), findsOneWidget);
    await tester.tap(find.text('OK'));
    await tester.pumpAndSettle();
    expect(backend.session, isNull);
  });

  test('reads charger codes typed or scanned', () {
    expect(parseChargerCode('GNT-HUB-01-1'), ('GNT-HUB-01', 1));
    expect(parseChargerCode(' evgo:gnt-hub-01:2 '), ('GNT-HUB-01', 2));
    expect(parseChargerCode('SRY-PLZ-01 #1'), ('SRY-PLZ-01', 1));
    expect(parseChargerCode('hello'), isNull);
  });

  testWidgets('home choices open the bus and charging tabs', (tester) async {
    await logIn(tester);
    await tester.tap(find.text('Book a bus'));
    await tester.pumpAndSettle();
    expect(find.text('Search buses'), findsOneWidget);

    await tester.tap(find.text('Home'));
    await tester.pumpAndSettle();
    await scrollTo(tester, 'Find a charger');
    await tester.tap(find.text('Find a charger'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('pin-gnt-hub')), findsOneWidget);
  });

  testWidgets('Need a charger? lists AC and DC chargers, filters them, and sends a quote request', (tester) async {
    await logIn(tester);
    await scrollTo(tester, 'Need a charger?');
    await tester.tap(find.byKey(const Key('choice-shop')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('shop-product-smp-ac-7')), findsOneWidget);
    expect(find.byKey(const Key('shop-product-smp-dc-240')), findsOneWidget);
    expect(find.text('Sample'), findsWidgets);
    expect(find.text('₹32,000'), findsOneWidget);

    await tester.tap(find.text('DC fast').first);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('shop-product-smp-ac-7')), findsNothing);
    expect(find.byKey(const Key('shop-product-smp-dc-60')), findsOneWidget);
    await tester.ensureVisible(find.byKey(const Key('shop-kw-ultra')));
    await tester.tap(find.byKey(const Key('shop-kw-ultra')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('shop-product-smp-dc-60')), findsNothing);
    expect(find.byKey(const Key('shop-product-smp-dc-240')), findsOneWidget);

    await tester.ensureVisible(find.byKey(const Key('shop-product-smp-dc-240')));
    await tester.tap(find.byKey(const Key('shop-product-smp-dc-240')));
    await tester.pumpAndSettle();
    expect(find.text('Price on quote'), findsWidgets);
    expect(find.byKey(const Key('shop-sample-note')), findsOneWidget);
    await scrollTo(tester, '415 V three phase');

    await tester.tap(find.byKey(const Key('shop-request-quote')));
    await tester.pumpAndSettle();
    // Phone is filled in from the login; the site type from what the charger suits.
    expect(find.text('9876543210'), findsOneWidget);
    await tester.ensureVisible(find.byKey(const Key('quote-send')));
    await tester.tap(find.byKey(const Key('quote-send')));
    await tester.pumpAndSettle();
    expect(find.text('Enter your name'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('quote-name')), 'Ravi');
    await tester.enterText(find.byKey(const Key('quote-city')), 'Guntur');
    await tester.ensureVisible(find.byKey(const Key('quote-qty-plus')));
    await tester.tap(find.byKey(const Key('quote-qty-plus')));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byKey(const Key('quote-send')));
    await tester.tap(find.byKey(const Key('quote-send')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('quote-sent')), findsOneWidget);
    expect(backend.quotes.single, containsPair('productId', 'smp-dc-240'));
    expect(backend.quotes.single, containsPair('siteType', 'Highway'));
    expect(backend.quotes.single, containsPair('quantity', 2));
    await tester.tap(find.byKey(const Key('quote-sent-ok')));
    await tester.pumpAndSettle();

    // Back on the shop: the request shows under "Your quote requests".
    await tester.pageBack();
    await tester.pumpAndSettle();
    await scrollTo(tester, 'Your quote requests');
    expect(find.byKey(const Key('my-quote-L1')), findsOneWidget);
    expect(find.text('Received'), findsOneWidget);
  });

  testWidgets('logs out from the account menu and the same user logs in again', (tester) async {
    await logIn(tester);
    await tester.tap(find.byTooltip('Account'));
    await tester.pumpAndSettle();
    expect(find.text('+919876543210'), findsOneWidget);
    await tester.tap(find.text('Log out').first);
    await tester.pumpAndSettle();
    expect(find.text('Log out of EVGO?'), findsOneWidget);
    await tester.tap(find.widgetWithText(FilledButton, 'Log out'));
    await tester.pumpAndSettle();

    expect(api.token, isNull);
    expect(find.text('Send code'), findsOneWidget);

    await logIn(tester);
    expect(find.text('Want a ticket?'), findsOneWidget);
  });

  testWidgets('returns to login when the server rejects the session', (tester) async {
    await logIn(tester);
    api.token = 'expired';
    await tester.tap(find.text('Wallet'));
    await tester.pumpAndSettle();
    expect(find.text('Send code'), findsOneWidget);
  });

  testWidgets('tapping the logo goes to Home, from a tab or from the seat screen', (tester) async {
    await logIn(tester);
    await tester.tap(find.text('Wallet'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('logo-home')));
    await tester.pumpAndSettle();
    expect(find.text('Want a ticket?'), findsOneWidget);

    await tester.tap(find.text('Travel'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Search buses'));
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('06:00 to 11:30'));
    await tester.pumpAndSettle();
    expect(find.text('S1'), findsOneWidget);
    await tester.tap(find.byKey(const Key('logo-home')).last);
    await tester.pumpAndSettle();
    expect(find.text('S1'), findsNothing);
    expect(find.text('Want a ticket?'), findsOneWidget);
  });
}
