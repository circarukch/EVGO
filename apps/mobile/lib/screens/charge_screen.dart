import 'package:flutter/material.dart';

import '../api/evgo_api.dart';
import '../api/models.dart';
import '../brand.dart';
import 'charging_session_screen.dart';
import 'station_map.dart';
import 'station_sheet.dart';

/// Find a charger on the map (or as a list), filter by vehicle and plug, and start charging.
class ChargeScreen extends StatefulWidget {
  const ChargeScreen({super.key, required this.api});

  final EvgoApi api;

  @override
  State<ChargeScreen> createState() => _ChargeScreenState();
}

class _ChargeScreenState extends State<ChargeScreen> {
  static const segments = {'2W': 'Scooter', '3W': 'Auto', '4W': 'Car', 'BUS': 'Bus', 'TRUCK': 'Truck'};
  String? _segment;
  String? _plug;
  bool _showMap = true;
  late Future<List<ChargerSummary>> _chargers = widget.api.searchChargers();
  ChargingSessionView? _active;

  @override
  void initState() {
    super.initState();
    _loadActive();
  }

  Future<void> _loadActive() async {
    try {
      final a = await widget.api.activeCharging();
      if (mounted) setState(() => _active = a);
    } on ApiException {
      // Not fatal for finding chargers.
    }
  }

  void _reload() {
    final f = widget.api.searchChargers(segment: _segment);
    setState(() => _chargers = f);
    _loadActive();
  }

  List<Station> _stations(List<ChargerSummary> all) {
    final filtered = [
      for (final c in all)
        if (_plug == null || c.connectors.any((k) => k.type == _plug)) c
    ];
    final list = Station.group(filtered);
    list.sort((a, b) => b.available.compareTo(a.available));
    return list;
  }

  Future<void> _openSession(ChargingSessionView s) async {
    await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => ChargingSessionScreen(api: widget.api, initial: s)));
    _reload();
  }

  Future<void> _start(String chargePointId, int connectorId) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      final s = await widget.api.startCharging(chargePointId, connectorId);
      await _openSession(s);
    } on ApiException catch (e) {
      final shortfall = e.statusCode == 402 ? e.body['shortfallPaise'] as int? : null;
      messenger.showSnackBar(SnackBar(
        content: Text(e.message),
        action: shortfall == null
            ? null
            : SnackBarAction(
                label: 'Add ${rupees(shortfall)}',
                onPressed: () async {
                  await widget.api.addMoney(shortfall);
                  await _start(chargePointId, connectorId);
                },
              ),
      ));
    }
  }

  Future<void> _enterCode() async {
    final code = TextEditingController();
    final result = await showDialog<String>(
      context: context,
      builder: (d) => AlertDialog(
        title: const Text('Charge with a code'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Scan the QR on the charger, or type the code printed under it, like GNT-HUB-01-1.'),
            TextField(
              controller: code,
              autofocus: true,
              textCapitalization: TextCapitalization.characters,
              decoration: const InputDecoration(labelText: 'Charger code'),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(d), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(d, code.text), child: const Text('Start')),
        ],
      ),
    );
    code.dispose();
    if (result == null || result.trim().isEmpty) return;
    final parsed = parseChargerCode(result);
    if (parsed == null) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('That code does not look right. Example: GNT-HUB-01-1')));
      }
      return;
    }
    await _start(parsed.$1, parsed.$2);
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<List<ChargerSummary>>(
      future: _chargers,
      builder: (context, snap) {
        final all = snap.data ?? const <ChargerSummary>[];
        final plugs = {
          for (final c in all)
            for (final k in c.connectors) k.type
        }.toList()
          ..sort();
        final stations = _stations(all);
        return Column(
          children: [
            if (_active != null)
              Material(
                color: Brand.green,
                child: ListTile(
                  key: const Key('active-session-banner'),
                  leading: const Icon(Icons.bolt, color: Colors.white),
                  title: Text('Charging at ${_active!.placeName}', style: const TextStyle(color: Colors.white)),
                  subtitle: Text('${_active!.energyKwh.toStringAsFixed(1)} kWh · ${rupees(_active!.costPaise)}',
                      style: const TextStyle(color: Colors.white70)),
                  trailing: const Icon(Icons.chevron_right, color: Colors.white),
                  onTap: () => _openSession(_active!),
                ),
              ),
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.fromLTRB(12, 10, 12, 4),
              child: Row(
                children: [
                  ChoiceChip(
                    label: const Text('All vehicles'),
                    selected: _segment == null,
                    onSelected: (_) {
                      _segment = null;
                      _reload();
                    },
                  ),
                  for (final e in segments.entries)
                    Padding(
                      padding: const EdgeInsets.only(left: 6),
                      child: ChoiceChip(
                        label: Text(e.value),
                        selected: _segment == e.key,
                        onSelected: (_) {
                          _segment = e.key;
                          _reload();
                        },
                      ),
                    ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 4, 12, 8),
              child: Row(
                children: [
                  PopupMenuButton<String?>(
                    tooltip: 'Plug type',
                    onSelected: (v) => setState(() => _plug = v == '' ? null : v),
                    itemBuilder: (_) => [
                      const PopupMenuItem(value: '', child: Text('Any plug')),
                      for (final p in plugs) PopupMenuItem(value: p, child: Text(plugLabel(p))),
                    ],
                    child: Chip(avatar: const Icon(Icons.power, size: 18), label: Text(_plug == null ? 'Any plug' : plugLabel(_plug!))),
                  ),
                  const Spacer(),
                  SegmentedButton<bool>(
                    segments: const [
                      ButtonSegment(value: true, icon: Icon(Icons.map_outlined), label: Text('Map')),
                      ButtonSegment(value: false, icon: Icon(Icons.list), label: Text('List')),
                    ],
                    selected: {_showMap},
                    showSelectedIcon: false,
                    onSelectionChanged: (v) => setState(() => _showMap = v.first),
                  ),
                ],
              ),
            ),
            Expanded(
              child: Stack(
                children: [
                  Positioned.fill(child: _body(snap, stations)),
                  Positioned(
                    right: 16,
                    bottom: 16,
                    child: FloatingActionButton.extended(
                      heroTag: 'charge-code',
                      backgroundColor: Brand.blue,
                      foregroundColor: Colors.white,
                      onPressed: _enterCode,
                      icon: const Icon(Icons.qr_code_scanner),
                      label: const Text('Scan to charge'),
                    ),
                  ),
                ],
              ),
            ),
          ],
        );
      },
    );
  }

  Widget _body(AsyncSnapshot<List<ChargerSummary>> snap, List<Station> stations) {
    if (snap.connectionState != ConnectionState.done) return const Center(child: CircularProgressIndicator());
    if (snap.hasError) return Center(child: Text('Could not load chargers: ${snap.error}'));
    if (stations.isEmpty) return const Center(child: Text('No public chargers for this filter yet.'));
    void open(Station s) => showStationSheet(context, s, onStart: (c, k) => _start(c.id, k.id));
    if (_showMap) return StationMap(stations: stations, onTap: open);
    return ListView(
      padding: const EdgeInsets.only(bottom: 88),
      children: [
        for (final s in stations)
          ListTile(
            onTap: () => open(s),
            leading: CircleAvatar(backgroundColor: stationColor(s), foregroundColor: Colors.white, child: const Icon(Icons.ev_station)),
            title: Text(s.place.name),
            subtitle: Text(
              '${s.place.city} · up to ${s.maxPowerKw.toStringAsFixed(0)} kW'
              '${s.fromPricePerKwh == null ? '' : ' · from ₹${s.fromPricePerKwh!.toStringAsFixed(0)}/kWh'}',
            ),
            trailing: Text(s.allOutOfService ? 'Offline' : '${s.available} free',
                style: TextStyle(fontWeight: FontWeight.w700, color: s.available > 0 ? Brand.green : Colors.grey.shade600)),
          ),
      ],
    );
  }
}

/// "GNT-HUB-01-1", "GNT-HUB-01 #1", "GNT-HUB-01/1" or the QR payload "EVGO:GNT-HUB-01:1" → (charger, connector).
(String, int)? parseChargerCode(String raw) {
  final s = raw.trim().toUpperCase().replaceFirst(RegExp(r'^EVGO:'), '');
  final m = RegExp(r'^([A-Z0-9._-]+?)\s*[-:#/ ]\s*(\d{1,2})$').firstMatch(s);
  if (m == null) return null;
  return (m.group(1)!, int.parse(m.group(2)!));
}
