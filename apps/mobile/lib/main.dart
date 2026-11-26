import 'package:flutter/material.dart';

import 'api/evgo_api.dart';
import 'brand.dart';
import 'screens/account_sheet.dart';
import 'screens/charge_screen.dart';
import 'screens/home_screen.dart';
import 'screens/login_screen.dart';
import 'screens/shop_screen.dart';
import 'screens/travel_screen.dart';
import 'screens/wallet_screen.dart';

void main() {
  runApp(EvgoApp(api: EvgoApi.fromEnvironment()));
}

class EvgoApp extends StatefulWidget {
  const EvgoApp({super.key, required this.api});

  final EvgoApi api;

  @override
  State<EvgoApp> createState() => _EvgoAppState();
}

class _EvgoAppState extends State<EvgoApp> {
  final _navigator = GlobalKey<NavigatorState>();

  @override
  void initState() {
    super.initState();
    widget.api.onLoggedOut = () {
      // Close every screen opened on top (a ticket, a charging session…) so nothing of the
      // signed-out user stays on screen under the login page.
      _navigator.currentState?.popUntil((route) => route.isFirst);
      if (mounted) setState(() {});
    };
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'EVGO',
      theme: Brand.theme(),
      navigatorKey: _navigator,
      home: widget.api.token == null
          ? LoginScreen(api: widget.api, onLoggedIn: () => setState(() {}))
          // Keyed by account: a different login starts from fresh screens with nothing kept from before.
          : AppShell(key: ValueKey('shell-${widget.api.token}'), api: widget.api),
    );
  }
}

/// One app, four tabs: bus and charging live side by side, not in separate apps.
class AppShell extends StatefulWidget {
  const AppShell({super.key, required this.api});

  final EvgoApi api;

  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell> {
  int _index = 0;

  void _go(int i) => setState(() => _index = i);

  /// Logo tap from any screen: close anything opened on top and show Home.
  void _goHome() {
    Navigator.of(context).popUntil((route) => route.isFirst);
    _go(0);
  }

  @override
  Widget build(BuildContext context) {
    final pages = [
      HomeScreen(
        api: widget.api,
        key: ValueKey('home-$_index'),
        onBookTicket: () => _go(1),
        onCharge: () => _go(2),
        onShop: () => _go(3),
        onWallet: () => _go(4),
      ),
      TravelScreen(api: widget.api, onHome: _goHome),
      ChargeScreen(api: widget.api),
      ShopScreen(api: widget.api),
      WalletScreen(api: widget.api, key: ValueKey('wallet-$_index')),
    ];
    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 4, 4, 4),
              child: Row(
                children: [
                  EvgoLogo(height: 28, onTap: _goHome),
                  const Spacer(),
                  IconButton(
                    tooltip: 'Account',
                    icon: const Icon(Icons.account_circle_outlined, color: Brand.ink),
                    onPressed: () => showAccountSheet(context, widget.api),
                  ),
                ],
              ),
            ),
            const BrandRule(height: 2),
            Expanded(child: pages[_index]),
          ],
        ),
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: _go,
        destinations: const [
          NavigationDestination(icon: Icon(Icons.home_outlined), label: 'Home'),
          NavigationDestination(icon: Icon(Icons.directions_bus_outlined), label: 'Travel'),
          NavigationDestination(icon: Icon(Icons.ev_station_outlined), label: 'Charge'),
          NavigationDestination(icon: Icon(Icons.storefront_outlined), label: 'Shop'),
          NavigationDestination(icon: Icon(Icons.account_balance_wallet_outlined), label: 'Wallet'),
        ],
      ),
    );
  }
}
