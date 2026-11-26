import 'package:flutter/material.dart';

import 'api/evgo_api.dart';
import 'screens/charge_screen.dart';
import 'screens/home_screen.dart';
import 'screens/travel_screen.dart';
import 'screens/wallet_screen.dart';

void main() {
  runApp(EvgoApp(api: EvgoApi.fromEnvironment()));
}

class EvgoApp extends StatelessWidget {
  const EvgoApp({super.key, required this.api});

  final EvgoApi api;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'EVGO',
      theme: ThemeData(
        colorSchemeSeed: const Color(0xFF0B8457),
        useMaterial3: true,
      ),
      home: AppShell(api: api),
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
      const HomeScreen(),
      TravelScreen(api: widget.api),
      ChargeScreen(api: widget.api),
      const WalletScreen(),
    ];
    return Scaffold(
      body: SafeArea(child: pages[_index]),
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
