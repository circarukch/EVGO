import 'dart:async';

import 'package:flutter/material.dart';

import '../api/evgo_api.dart';
import '../api/models.dart';
import '../brand.dart';
import 'charging_session_screen.dart';
import 'trip_details_screen.dart';

/// Landing page after login: three big choices (a bus ticket, a charge, or buying a charger),
/// then the user's trips: a running charge (live), upcoming bus tickets, recent charging.
class HomeScreen extends StatefulWidget {
  const HomeScreen({
    super.key,
    required this.api,
    required this.onBookTicket,
    required this.onCharge,
    required this.onShop,
    required this.onWallet,
    this.liveEvery = const Duration(seconds: 5),
  });

  final EvgoApi api;
  final VoidCallback onBookTicket;

  final VoidCallback onCharge;
  final VoidCallback onShop;
  final VoidCallback onWallet;
  final Duration liveEvery;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  late Future<List<BookingSummary>> _bookings = widget.api.myBookings();
  late final Future<WalletSummary> _wallet = widget.api.wallet();
  List<ChargingSessionView> _sessions = const [];
  Timer? _live;

  @override
  void initState() {
    super.initState();
    _loadCharging();
  }

  @override
  void dispose() {
    _live?.cancel();
    super.dispose();
  }

  /// Charging sessions for "Your trips"; while one is running, refresh it every few seconds.
  Future<void> _loadCharging() async {
    try {
      final list = await widget.api.recentCharging();
      if (!mounted) return;
      setState(() {
        _sessions = list;
      });
      final running = list.any((s) => s.isActive);
      if (running && _live == null) {
        _live = Timer.periodic(widget.liveEvery, (_) => _loadCharging());
      } else if (!running) {
        _live?.cancel();
        _live = null;
      }
    } on ApiException {
      // Bookings still show; charging can come back on the next visit.
    }
  }

  Future<void> _openSession(ChargingSessionView s) async {
    await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => ChargingSessionScreen(api: widget.api, initial: s)));
    _loadCharging();
  }

  Future<void> _openTrip(BookingSummary b) async {
    await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => TripDetailsScreen(api: widget.api, booking: b)));
    if (!mounted) return;
    setState(() {
      _bookings = widget.api.myBookings();
    });
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
      children: [
        Row(
          children: [
            Expanded(
              child: Text('What would you like to do?', style: text.headlineSmall?.copyWith(fontWeight: FontWeight.w700, color: Brand.ink)),
            ),
            _WalletChip(wallet: _wallet, onTap: widget.onWallet),
          ],
        ),
        const SizedBox(height: 16),
        _ChoiceCard(
          key: const Key('choice-ticket'),
          title: 'Want a ticket?',
          subtitle: 'Book an electric bus seat in under a minute. Guntur to Hyderabad is live.',
          action: 'Book a bus',
          icon: Icons.directions_bus_filled,
          colors: const [Brand.blue, Brand.teal],
          onTap: widget.onBookTicket,
        ),
        const SizedBox(height: 12),
        _ChoiceCard(
          key: const Key('choice-charge'),
          title: 'Want to charge your EV?',
          subtitle: 'Find an available charger near you for your scooter, auto, car, bus or truck.',
          action: 'Find a charger',
          icon: Icons.bolt,
          colors: const [Brand.green, Brand.lime],
          onTap: widget.onCharge,
        ),
        const SizedBox(height: 12),
        _ChoiceCard(
          key: const Key('choice-shop'),
          title: 'Want a charger?',
          subtitle: 'Buy an AC or DC charger for your home, building, business or fleet. Installation available.',
          action: 'Shop chargers',
          icon: Icons.ev_station,
          colors: const [Brand.ink, Brand.blue],
          onTap: widget.onShop,
        ),
        const SizedBox(height: 20),
        Text('Your trips', style: text.titleMedium),
        const SizedBox(height: 8),
        FutureBuilder<List<BookingSummary>>(
          future: _bookings,
          builder: (context, snap) {
            if (snap.connectionState != ConnectionState.done) return const LinearProgressIndicator();
            final bookings = (snap.data ?? []).where((b) => b.status == 'PAID').toList();
            final running = _sessions.where((s) => s.isActive).toList();
            final done = _sessions.where((s) => !s.isActive).take(3).toList();
            if (bookings.isEmpty && _sessions.isEmpty) {
              return const Card(
                child: ListTile(
                  leading: Icon(Icons.event_seat_outlined),
                  title: Text('No trips or charging yet'),
                  subtitle: Text('Your bus tickets and charging sessions will show here.'),
                ),
              );
            }
            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (final s in running) _LiveChargingCard(session: s, onTap: () => _openSession(s)),
                for (final b in bookings)
                  Card(
                    child: ListTile(
                      key: Key('trip-${b.orderId}'),
                      onTap: () => _openTrip(b),
                      leading: const CircleAvatar(
                        backgroundColor: Color(0x1A0A6EBD),
                        foregroundColor: Brand.blue,
                        child: Icon(Icons.directions_bus),
                      ),
                      title: Text(b.route),
                      subtitle: Text(
                        '${b.departsAt == null ? '' : '${shortDate(b.departsAt!)} · '}${b.departs} · '
                        'Seat${b.seats.length == 1 ? '' : 's'} ${b.seats.join(', ')}',
                      ),
                      trailing: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          Text(rupees(b.totalPaise), style: const TextStyle(fontWeight: FontWeight.w700)),
                          const Icon(Icons.chevron_right, size: 18),
                        ],
                      ),
                    ),
                  ),
                if (done.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  Text('Recent charging', style: text.titleSmall?.copyWith(color: Colors.black54)),
                  const SizedBox(height: 4),
                  for (final s in done)
                    Card(
                      child: ListTile(
                        key: Key('recent-${s.id}'),
                        onTap: () => _openSession(s),
                        leading: const CircleAvatar(
                          backgroundColor: Color(0x1A1FAA6E),
                          foregroundColor: Brand.green,
                          child: Icon(Icons.ev_station),
                        ),
                        title: Text(s.placeName),
                        subtitle: Text('${_when(s.startedAt)} · ${s.energyKwh.toStringAsFixed(1)} kWh'
                            '${s.paidByUpi ? ' · Paid by UPI' : ' · Wallet'}'),
                        trailing: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            Text(rupees(s.costPaise), style: const TextStyle(fontWeight: FontWeight.w700)),
                            const Icon(Icons.chevron_right, size: 18),
                          ],
                        ),
                      ),
                    ),
                ],
              ],
            );
          },
        ),
      ],
    );
  }
}

String _when(DateTime t) {
  final l = t.toLocal();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return '${l.day} ${months[l.month - 1]}, ${l.hour.toString().padLeft(2, '0')}:${l.minute.toString().padLeft(2, '0')}';
}

/// The running charging session, live on Home: energy, cost, power. Tap for the full screen with Stop.
class _LiveChargingCard extends StatelessWidget {
  const _LiveChargingCard({required this.session, required this.onTap});
  final ChargingSessionView session;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final s = session;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Material(
        borderRadius: BorderRadius.circular(18),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          key: const Key('home-live-charging'),
          onTap: onTap,
          child: Ink(
            padding: const EdgeInsets.all(16),
            decoration: const BoxDecoration(gradient: LinearGradient(colors: [Brand.green, Brand.lime])),
            child: Row(
              children: [
                const CircleAvatar(backgroundColor: Colors.white24, foregroundColor: Colors.white, child: Icon(Icons.bolt)),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Charging now · ${s.placeName}',
                          style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis),
                      const SizedBox(height: 2),
                      Text(
                        '${s.energyKwh.toStringAsFixed(2)} kWh · ${rupees(s.costPaise)} · ${s.powerKw.toStringAsFixed(0)} kW',
                        style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w800),
                      ),
                      if (s.paidByUpi && s.blockedPaise != null)
                        Text('${rupees(s.blockedPaise!)} held by UPI · tap to stop',
                            style: const TextStyle(color: Colors.white70, fontSize: 12))
                      else
                        const Text('Tap to see it live or stop', style: TextStyle(color: Colors.white70, fontSize: 12)),
                    ],
                  ),
                ),
                const Icon(Icons.chevron_right, color: Colors.white),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ChoiceCard extends StatelessWidget {
  const _ChoiceCard({
    super.key,
    required this.title,
    required this.subtitle,
    required this.action,
    required this.icon,
    required this.colors,
    required this.onTap,
  });

  final String title;
  final String subtitle;
  final String action;
  final IconData icon;
  final List<Color> colors;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Material(
      borderRadius: BorderRadius.circular(20),
      clipBehavior: Clip.antiAlias,
      elevation: 2,
      child: Ink(
        decoration: BoxDecoration(gradient: LinearGradient(colors: colors, begin: Alignment.topLeft, end: Alignment.bottomRight)),
        child: InkWell(
          onTap: onTap,
          child: Stack(
            children: [
              Positioned(
                right: -18,
                bottom: -22,
                child: Icon(icon, size: 140, color: Colors.white.withValues(alpha: 0.16)),
              ),
              Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    CircleAvatar(
                      radius: 22,
                      backgroundColor: Colors.white.withValues(alpha: 0.22),
                      foregroundColor: Colors.white,
                      child: Icon(icon),
                    ),
                    const SizedBox(height: 14),
                    Text(title, style: text.headlineSmall?.copyWith(color: Colors.white, fontWeight: FontWeight.w800)),
                    const SizedBox(height: 6),
                    Padding(
                      padding: const EdgeInsets.only(right: 60),
                      child: Text(subtitle, style: text.bodyMedium?.copyWith(color: Colors.white.withValues(alpha: 0.92))),
                    ),
                    const SizedBox(height: 14),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(24)),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(action, style: text.labelLarge?.copyWith(color: colors.first, fontWeight: FontWeight.w700)),
                          const SizedBox(width: 6),
                          Icon(Icons.arrow_forward, size: 18, color: colors.first),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _WalletChip extends StatelessWidget {
  const _WalletChip({required this.wallet, required this.onTap});

  final Future<WalletSummary> wallet;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<WalletSummary>(
      future: wallet,
      builder: (context, snap) => ActionChip(
        key: const Key('wallet-chip'),
        avatar: const Icon(Icons.account_balance_wallet, size: 18, color: Brand.blue),
        label: Text(snap.hasData ? rupees(snap.data!.balancePaise) : '₹ —'),
        onPressed: onTap,
      ),
    );
  }
}
