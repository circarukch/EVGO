import 'package:flutter/material.dart';

import '../api/evgo_api.dart';
import '../api/models.dart';
import '../brand.dart';
import 'charging_session_screen.dart';
import 'trip_details_screen.dart';

enum _Kind { trip, charging, wallet }

/// One line of activity: a bus ticket, a charging session, or money in or out of the wallet.
class _Item {
  _Item(
      {required this.kind,
      required this.at,
      required this.title,
      required this.subtitle,
      required this.amount,
      this.positive = false,
      this.onTap,
      required this.key});

  final _Kind kind;
  final DateTime at;
  final String title;
  final String subtitle;
  final String amount;
  final bool positive;
  final VoidCallback? onTap;
  final String key;
}

/// Everything this account has done, newest first: bus tickets, charging and wallet.
/// Opened from the account menu. Only the logged-in user's own data is ever loaded.
class ActivityScreen extends StatefulWidget {
  const ActivityScreen({super.key, required this.api});

  final EvgoApi api;

  @override
  State<ActivityScreen> createState() => _ActivityScreenState();
}

class _ActivityScreenState extends State<ActivityScreen> {
  late Future<List<_Item>> _items = _load();
  _Kind? _filter;

  Future<List<_Item>> _load() async {
    final (bookings, charging, wallet) = await (
      widget.api.myBookings(),
      widget.api.recentCharging(limit: 50),
      widget.api.wallet(),
    ).wait;
    final items = <_Item>[
      for (final b in bookings)
        _Item(
          kind: _Kind.trip,
          key: 'activity-trip-${b.orderId}',
          at: b.bookedAt ?? b.departsAt ?? DateTime.now(),
          title: b.route,
          subtitle: [
            if (b.departsAt != null) 'Travel ${shortDate(b.departsAt!)}, ${b.departs}',
            '${b.tickets.length} seat${b.tickets.length == 1 ? '' : 's'}',
            _bookingStatus(b.status),
          ].join(' · '),
          amount: rupees(b.totalPaise),
          onTap: () => _open(TripDetailsScreen(api: widget.api, booking: b)),
        ),
      for (final s in charging)
        _Item(
          kind: _Kind.charging,
          key: 'activity-charging-${s.id}',
          at: s.startedAt,
          title: s.placeName,
          subtitle: s.status == 'ACTIVE'
              ? 'Charging now · ${s.energyKwh.toStringAsFixed(1)} kWh so far'
              : '${s.energyKwh.toStringAsFixed(1)} kWh · ${s.paidByUpi ? 'Paid by UPI' : 'Wallet'}',
          amount: rupees(s.costPaise),
          onTap: () => _open(ChargingSessionScreen(api: widget.api, initial: s)),
        ),
      // Ticket and charging payments are already listed above; show only the rest (top-ups, refunds).
      for (final (i, e) in wallet.history.indexed)
        if (!e.isPurchase && e.at != null)
          _Item(
            kind: _Kind.wallet,
            key: 'activity-wallet-$i',
            at: e.at!,
            title: e.memo,
            subtitle: 'EVGO wallet',
            amount: '${e.amountPaise >= 0 ? '+' : '-'}${rupees(e.amountPaise.abs())}',
            positive: e.amountPaise >= 0,
          ),
    ];
    items.sort((a, b) => b.at.compareTo(a.at));
    return items;
  }

  static String _bookingStatus(String status) => switch (status) {
        'PAID' => 'Confirmed',
        'REFUNDED' => 'Cancelled, refunded',
        'PARTIALLY_REFUNDED' => 'Cancelled, partly refunded',
        _ => status.toLowerCase(),
      };

  Future<void> _open(Widget screen) async {
    await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => screen));
    if (mounted) setState(() => _items = _load());
  }

  static String _day(DateTime t) {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final day = DateTime(t.year, t.month, t.day);
    if (day == today) return 'Today';
    if (day == today.subtract(const Duration(days: 1))) return 'Yesterday';
    return longDate(t);
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(title: const Text('Recent activity')),
      body: FutureBuilder<List<_Item>>(
        future: _items,
        builder: (context, snap) {
          if (snap.connectionState != ConnectionState.done) return const Center(child: CircularProgressIndicator());
          if (snap.hasError) {
            return Center(
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                const Text('Could not load your activity'),
                TextButton(onPressed: () => setState(() => _items = _load()), child: const Text('Try again')),
              ]),
            );
          }
          final all = snap.data!;
          final shown = _filter == null ? all : all.where((i) => i.kind == _filter).toList();
          final rows = <Widget>[];
          String? lastDay;
          for (final item in shown) {
            final day = _day(item.at);
            if (day != lastDay) {
              rows.add(Padding(
                padding: const EdgeInsets.fromLTRB(4, 16, 4, 6),
                child: Text(day, style: text.labelLarge?.copyWith(color: Colors.black54)),
              ));
              lastDay = day;
            }
            rows.add(_tile(item));
          }
          return RefreshIndicator(
            onRefresh: () async {
              setState(() => _items = _load());
              await _items;
            },
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
              children: [
                Wrap(spacing: 8, children: [
                  for (final (k, label) in const [
                    (null, 'All'),
                    (_Kind.trip, 'Bus trips'),
                    (_Kind.charging, 'Charging'),
                    (_Kind.wallet, 'Wallet')
                  ])
                    ChoiceChip(
                      key: Key('activity-filter-${k?.name ?? 'all'}'),
                      label: Text(label),
                      selected: _filter == k,
                      onSelected: (_) => setState(() => _filter = k),
                    ),
                ]),
                if (shown.isEmpty)
                  const Padding(
                    padding: EdgeInsets.only(top: 48),
                    child: Center(child: Text('Nothing here yet. Your tickets, charging and wallet top-ups will show up here.')),
                  ),
                ...rows,
              ],
            ),
          );
        },
      ),
    );
  }

  Widget _tile(_Item i) {
    final (icon, color) = switch (i.kind) {
      _Kind.trip => (Icons.directions_bus, Brand.blue),
      _Kind.charging => (Icons.ev_station, Brand.green),
      _Kind.wallet => (Icons.account_balance_wallet, Brand.teal),
    };
    return Card(
      child: ListTile(
        key: Key(i.key),
        onTap: i.onTap,
        leading: CircleAvatar(backgroundColor: color.withValues(alpha: 0.12), foregroundColor: color, child: Icon(icon)),
        title: Text(i.title),
        subtitle: Text('${clock(i.at)} · ${i.subtitle}'),
        trailing: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text(i.amount, style: TextStyle(fontWeight: FontWeight.w700, color: i.positive ? Colors.green.shade700 : null)),
            if (i.onTap != null) const Icon(Icons.chevron_right, size: 18),
          ],
        ),
      ),
    );
  }
}
