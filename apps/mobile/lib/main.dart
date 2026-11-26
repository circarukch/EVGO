import 'package:flutter/material.dart';

import 'api/evgo_api.dart';
import 'brand.dart';
import 'screens/charge_screen.dart';
import 'screens/home_screen.dart';
import 'screens/login_screen.dart';
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
  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'EVGO',
      theme: Brand.theme(),
      home: widget.api.token == null
          ? LoginScreen(api: widget.api, onLoggedIn: () => setState(() {}))
          : AppShell(api: widget.api),
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

  @override
  Widget build(BuildContext context) {
    final pages = [
      HomeScreen(api: widget.api, key: ValueKey('home-$_index')),
      TravelScreen(api: widget.api),
      ChargeScreen(api: widget.api),
      WalletScreen(api: widget.api, key: ValueKey('wallet-$_index')),
    ];
    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            const Padding(
              padding: EdgeInsets.fromLTRB(16, 10, 16, 8),
              child: Align(alignment: Alignment.centerLeft, child: EvgoLogo(height: 28)),
            ),
            const BrandRule(height: 2),
            Expanded(child: pages[_index]),
          ],
        ),
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.home_outlined), label: 'Home'),
          NavigationDestination(icon: Icon(Icons.directions_bus_outlined), label: 'Travel'),
          NavigationDestination(icon: Icon(Icons.ev_station_outlined), label: 'Charge'),
          NavigationDestination(icon: Icon(Icons.account_balance_wallet_outlined), label: 'Wallet'),
        ],
      ),
    );
  }
}
