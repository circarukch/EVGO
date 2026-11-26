import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/models.dart';
import '../brand.dart';
import 'station_map.dart';

String plugLabel(String type) => switch (type) {
      'LEV_AC' => 'LEV AC',
      'BharatDC001' || 'BHARAT_DC001' => 'Bharat DC-001',
      'TYPE2' => 'Type2',
      'GBT' => 'GB/T',
      _ => type,
    };

String statusLabel(String status) => switch (status) {
      'Available' => 'Free now',
      'Charging' || 'Occupied' || 'Preparing' || 'SuspendedEV' || 'SuspendedEVSE' || 'Finishing' => 'In use',
      'Faulted' || 'Unavailable' => 'Out of service',
      _ => status,
    };

/// Bottom sheet for one station: every plug with its power, price and live status.
Future<void> showStationSheet(
  BuildContext context,
  Station station, {
  required void Function(ChargerSummary charger, ConnectorInfo connector) onStart,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (sheet) => DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.55,
      maxChildSize: 0.9,
      builder: (_, scroll) => ListView(
        controller: scroll,
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(station.place.name, style: Theme.of(sheet).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700)),
                    Text(
                      '${station.place.city} · ${station.chargers.map((c) => c.operator).toSet().join(', ')}',
                      style: Theme.of(sheet).textTheme.bodyMedium,
                    ),
                    Text(station.powerSummary,
                        style: Theme.of(sheet).textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600, color: Brand.blue)),
                  ],
                ),
              ),
              _AvailabilityBadge(station: station),
            ],
          ),
          const SizedBox(height: 8),
          if (station.place.lat != null)
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton.icon(
                icon: const Icon(Icons.directions),
                label: const Text('Directions'),
                onPressed: () => launchUrl(
                  Uri.parse('https://www.google.com/maps/dir/?api=1&destination=${station.place.lat},${station.place.lng}'),
                  mode: LaunchMode.externalApplication,
                ),
              ),
            ),
          const Divider(),
          for (final charger in station.chargers)
            for (final k in charger.connectors)
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: CircleAvatar(
                  backgroundColor: (k.isAvailable ? Brand.green : Colors.grey).withValues(alpha: 0.15),
                  foregroundColor: k.isAvailable ? Brand.green : Colors.grey,
                  child: Text(k.current, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13)),
                ),
                title: Text('${plugLabel(k.type)} · ${k.current} · ${kwLabel(k.powerKw)}'),
                subtitle: Text(
                  '${charger.pricePerKwhInr == null ? '' : '₹${charger.pricePerKwhInr!.toStringAsFixed(0)}/kWh · '}'
                  '${statusLabel(k.status)} · ${charger.id} #${k.id}',
                ),
                trailing: k.isAvailable
                    ? FilledButton(
                        key: Key('start-${charger.id}-${k.id}'),
                        onPressed: () {
                          Navigator.pop(sheet);
                          onStart(charger, k);
                        },
                        child: const Text('Start'),
                      )
                    : null,
              ),
        ],
      ),
    ),
  );
}

class _AvailabilityBadge extends StatelessWidget {
  const _AvailabilityBadge({required this.station});
  final Station station;

  @override
  Widget build(BuildContext context) {
    final color = stationColor(station);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(color: color.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(12)),
      child: Text(
        station.allOutOfService ? 'Offline' : '${station.available} of ${station.connectors.length} free',
        style: TextStyle(color: color == Colors.grey ? Colors.grey.shade700 : color, fontWeight: FontWeight.w700),
      ),
    );
  }
}
