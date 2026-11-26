import 'package:flutter/material.dart';

import '../api/evgo_api.dart';
import '../api/models.dart';
import '../brand.dart';
import 'charging_session_screen.dart';
import 'checkout.dart';
import 'pay_sheet.dart';
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
  String? _current; // 'AC' or 'DC'
  double? _minKw;
  static const powerSteps = <double>[7, 30, 60, 120, 180, 240];
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
    setState(() {
      _chargers = f;
    });
    _loadActive();
  }

  List<Station> _stations(List<ChargerSummary> all) {
    bool keep(ConnectorInfo k) =>
        (_plug == null || k.type == _plug) && (_current == null || k.current == _current) && (_minKw == null || k.powerKw >= _minKw!);
    final filtered = [
      for (final c in all)
        if (c.connectors.any(keep)) c.withConnectors(c.connectors.where(keep).toList())
    ];
    final list = Station.group(filtered);
    list.sort((a, b) => b.available.compareTo(a.available));
    return list;
  }

  Future<void> _openSession(ChargingSessionView s) async {
    await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => ChargingSessionScreen(api: widget.api, initial: s)));
    _reload();
  }

  /// Ask how to pay (UPI by default, wallet optional), then start.
  Future<void> _start(String chargePointId, int connectorId, {double? powerKw, String? title}) async {
    final choice = await showPaySheet(context, title: title ?? '$chargePointId #$connectorId', powerKw: powerKw);
    if (!mounted || choice == null) return;
    switch (choice) {
      case PayByWallet():
        await _startFromWallet(chargePointId, connectorId);
      case PayByUpi(:final amountPaise):
        await _startWithUpi(chargePointId, connectorId, amountPaise);
    }
  }

  Future<void> _startWithUpi(String chargePointId, int connectorId, int amountPaise) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      final block = await widget.api.createUpiBlock(chargePointId, connectorId, amountPaise);
      if (!mounted) return;
      final session = await approveAndStart(context, widget.api, block);
      if (session != null) await _openSession(session);
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _startFromWallet(String chargePointId, int connectorId) async {
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
                  if (await addMoneyWithCheckout(context, widget.api, shortfall)) await _startFromWallet(chargePointId, connectorId);
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
            Container(
              margin: const EdgeInsets.fromLTRB(12, 10, 12, 8),
              padding: const EdgeInsets.all(6),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(16),
                boxShadow: const [BoxShadow(color: Color(0x14000000), blurRadius: 10, offset: Offset(0, 2))],
              ),
              child: Row(
                children: [
                  _FilterTile<String>(
                    key: const Key('filter-vehicle'),
                    icon: Icons.directions_car_outlined,
                    caption: 'Vehicle',
                    value: _segment == null ? 'Any' : segments[_segment]!,
                    active: _segment != null,
                    onSelected: (v) {
                      _segment = v == '' ? null : v;
                      _reload();
                    },
                    items: [
                      const PopupMenuItem(value: '', child: Text('Any vehicle')),
                      for (final e in segments.entries) PopupMenuItem(value: e.key, child: Text(e.value)),
                    ],
                  ),
                  _FilterTile<String>(
                    key: const Key('filter-current'),
                    icon: Icons.bolt,
                    caption: 'AC / DC',
                    value: _current ?? 'Any',
                    active: _current != null,
                    onSelected: (v) => setState(() => _current = v == '' ? null : v),
                    items: const [
                      PopupMenuItem(value: '', child: Text('AC and DC')),
                      PopupMenuItem(value: 'DC', child: Text('DC fast chargers')),
                      PopupMenuItem(value: 'AC', child: Text('AC chargers')),
                    ],
                  ),
                  _FilterTile<double>(
                    key: const Key('filter-power'),
                    icon: Icons.speed,
                    caption: 'Power',
                    value: _minKw == null ? 'Any' : '${kwLabel(_minKw!)}+',
                    active: _minKw != null,
                    onSelected: (v) => setState(() => _minKw = v == 0 ? null : v),
                    items: [
                      const PopupMenuItem(value: 0, child: Text('Any power')),
                      for (final kw in powerSteps) PopupMenuItem(value: kw, child: Text('${kwLabel(kw)} and above')),
                    ],
                  ),
                  _FilterTile<String>(
                    key: const Key('filter-plug'),
                    icon: Icons.power_outlined,
                    caption: 'Plug',
                    value: _plug == null ? 'Any' : plugLabel(_plug!),
                    active: _plug != null,
                    onSelected: (v) => setState(() => _plug = v == '' ? null : v),
                    items: [
                      const PopupMenuItem(value: '', child: Text('Any plug')),
                      for (final p in plugs) PopupMenuItem(value: p, child: Text('${plugLabel(p)} (${isDcPlug(p) ? 'DC' : 'AC'})')),
                    ],
                  ),
                ],
              ),
            ),
            Expanded(
              child: Stack(
                children: [
                  Positioned.fill(child: _body(snap, stations)),
                  Positioned(
                    top: 8,
                    right: 12,
                    child: Material(
                      color: Colors.white,
                      elevation: 2,
                      shape: const StadiumBorder(),
                      child: SegmentedButton<bool>(
                        segments: const [
                          ButtonSegment(value: true, icon: Icon(Icons.map_outlined), label: Text('Map')),
                          ButtonSegment(value: false, icon: Icon(Icons.list), label: Text('List')),
                        ],
                        selected: {_showMap},
                        showSelectedIcon: false,
                        onSelectionChanged: (v) => setState(() => _showMap = v.first),
                      ),
                    ),
                  ),
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
    if (stations.isEmpty) {
      return Center(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          const Text('No chargers match these filters yet.'),
          TextButton(
            key: const Key('clear-filters'),
            onPressed: () => setState(() {
              _plug = null;
              _current = null;
              _minKw = null;
            }),
            child: const Text('Clear filters'),
          ),
        ]),
      );
    }
    void open(Station s) => showStationSheet(context, s,
        onStart: (c, k) =>
            _start(c.id, k.id, powerKw: k.powerKw, title: '${s.place.name} · ${plugLabel(k.type)} ${k.current} ${kwLabel(k.powerKw)}'));
    if (_showMap) return StationMap(stations: stations, onTap: open);
    return ListView(
      padding: const EdgeInsets.only(top: 56, bottom: 88),
      children: [
        for (final s in stations)
          ListTile(
            onTap: () => open(s),
            leading: CircleAvatar(backgroundColor: stationColor(s), foregroundColor: Colors.white, child: const Icon(Icons.ev_station)),
            title: Text(s.place.name),
            subtitle: Text(
              '${s.place.city} · ${s.powerSummary}'
              '${s.fromPricePerKwh == null ? '' : ' · from ₹${s.fromPricePerKwh!.toStringAsFixed(0)}/kWh'}',
            ),
            trailing: Text(s.allOutOfService ? 'Offline' : '${s.available} free',
                style: TextStyle(fontWeight: FontWeight.w700, color: s.available > 0 ? Brand.green : Colors.grey.shade600)),
          ),
      ],
    );
  }
}

/// One of the four equal filters above the map: small caption, current value, opens a menu.
/// Brand blue when it narrows the results.
class _FilterTile<T> extends StatelessWidget {
  const _FilterTile({
    super.key,
    required this.icon,
    required this.caption,
    required this.value,
    required this.active,
    required this.onSelected,
    required this.items,
  });

  final IconData icon;
  final String caption;
  final String value;
  final bool active;
  final void Function(T) onSelected;
  final List<PopupMenuEntry<T>> items;

  @override
  Widget build(BuildContext context) {
    final fg = active ? Colors.white : const Color(0xFF1F2A30);
    return Expanded(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 3),
        child: PopupMenuButton<T>(
          tooltip: caption,
          onSelected: onSelected,
          itemBuilder: (_) => items,
          position: PopupMenuPosition.under,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 150),
            height: 54,
            padding: const EdgeInsets.symmetric(horizontal: 8),
            decoration: BoxDecoration(
              color: active ? Brand.blue : const Color(0xFFF1F6F4),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(children: [
                  Icon(icon, size: 14, color: active ? Colors.white70 : Brand.green),
                  const SizedBox(width: 4),
                  Expanded(
                    child: Text(caption,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(fontSize: 11, color: active ? Colors.white70 : Colors.black54)),
                  ),
                ]),
                const SizedBox(height: 2),
                Row(children: [
                  Expanded(
                    child: FittedBox(
                      fit: BoxFit.scaleDown,
                      alignment: Alignment.centerLeft,
                      child: Text(value, maxLines: 1, style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: fg)),
                    ),
                  ),
                  Icon(Icons.expand_more, size: 16, color: fg),
                ]),
              ],
            ),
          ),
        ),
      ),
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
