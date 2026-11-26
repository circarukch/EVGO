import 'package:flutter/material.dart';

import '../api/evgo_api.dart';
import '../api/models.dart';

/// Charger list filtered by the user's vehicle segment. Map view comes next.
class ChargeScreen extends StatefulWidget {
  const ChargeScreen({super.key, required this.api});

  final EvgoApi api;

  @override
  State<ChargeScreen> createState() => _ChargeScreenState();
}

class _ChargeScreenState extends State<ChargeScreen> {
  static const segments = ['2W', '3W', '4W', 'BUS', 'TRUCK'];
  String _segment = '4W';
  late Future<List<ChargerSummary>> _chargers = widget.api.searchChargers(segment: _segment);

  void _pick(String s) {
    final chargers = widget.api.searchChargers(segment: s);
    setState(() {
      _segment = s;
      _chargers = chargers;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.all(12),
          child: Wrap(
            spacing: 8,
            children: [
              for (final s in segments)
                ChoiceChip(label: Text(s), selected: _segment == s, onSelected: (_) => _pick(s)),
            ],
          ),
        ),
        Expanded(
          child: FutureBuilder<List<ChargerSummary>>(
            future: _chargers,
            builder: (context, snap) {
              if (snap.connectionState != ConnectionState.done) {
                return const Center(child: CircularProgressIndicator());
              }
              if (snap.hasError) return Center(child: Text('Could not load chargers: ${snap.error}'));
              final list = snap.data!;
              if (list.isEmpty) return const Center(child: Text('No public chargers for this vehicle type yet.'));
              return ListView(
                children: [
                  for (final c in list)
                    ListTile(
                      leading: const Icon(Icons.ev_station),
                      title: Text(c.placeName),
                      subtitle: Text(
                        '${c.connectors.map((k) => '${k.type} ${k.powerKw.toStringAsFixed(0)} kW').join(' · ')}'
                        '\n${c.operator} · ${c.availableCount} available',
                      ),
                      isThreeLine: true,
                      trailing: c.pricePerKwhInr == null ? null : Text('₹${c.pricePerKwhInr!.toStringAsFixed(0)}/kWh'),
                    ),
                ],
              );
            },
          ),
        ),
      ],
    );
  }
}
