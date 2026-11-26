import 'package:flutter/material.dart';

/// Trips timeline: upcoming bus departures and charging sessions in one list.
/// Placeholder content until Booking and Charging modules are live.
class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text('Your trips', style: text.headlineSmall),
        const SizedBox(height: 12),
        const Card(
          child: ListTile(
            leading: Icon(Icons.directions_bus),
            title: Text('Guntur to Hyderabad'),
            subtitle: Text('Fri 06:00 · Seat 14 · EVGO e-bus'),
          ),
        ),
        const Card(
          child: ListTile(
            leading: Icon(Icons.ev_station),
            title: Text('Charging at Guntur EVGO Hub'),
            subtitle: Text('Reserved 05:30 · CCS2 60 kW · stops at 80%'),
          ),
        ),
        const SizedBox(height: 16),
        const Wrap(spacing: 8, children: [
          ActionChip(avatar: Icon(Icons.search, size: 18), label: Text('Book a bus')),
          ActionChip(avatar: Icon(Icons.qr_code_scanner, size: 18), label: Text('Scan charger')),
        ]),
      ],
    );
  }
}
