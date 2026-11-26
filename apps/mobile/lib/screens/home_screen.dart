import 'package:flutter/material.dart';

import '../api/evgo_api.dart';
import '../api/models.dart';
import '../brand.dart';

/// Landing page after login: two big choices (a bus ticket or a charge),
/// quick shortcuts for each, then the user's upcoming trips.
class HomeScreen extends StatefulWidget {
  const HomeScreen({
    super.key,
    required this.api,
    required this.onBookTicket,
    required this.onCharge,
    required this.onWallet,
  });

  final EvgoApi api;
  final VoidCallback onBookTicket;

  /// Opens the Charge tab, optionally pre-filtered to a vehicle type.
  final void Function(String? segment) onCharge;
  final VoidCallback onWallet;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  late Future<List<BookingSummary>> _bookings = widget.api.myBookings();
  late final Future<WalletSummary> _wallet = widget.api.wallet();

  static const vehicles = [
    ('2W', Icons.two_wheeler, 'Scooter'),
    ('3W', Icons.electric_rickshaw, 'Auto'),
    ('4W', Icons.directions_car, 'Car'),
    ('BUS', Icons.directions_bus, 'Bus'),
    ('TRUCK', Icons.local_shipping, 'Truck'),
  ];

  Future<void> _cancel(BookingSummary b) async {
    try {
      final refund = await widget.api.cancelBooking(b.orderId);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Cancelled. ${rupees(refund)} refunded to your wallet')));
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
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
          onTap: () => widget.onCharge(null),
        ),
        const SizedBox(height: 20),
        Text('Popular route', style: text.titleMedium),
        const SizedBox(height: 8),
        Card(
          child: ListTile(
            leading: const CircleAvatar(backgroundColor: Brand.blue, foregroundColor: Colors.white, child: Icon(Icons.route)),
            title: const Text('Guntur ⇄ Hyderabad'),
            subtitle: const Text('Electric AC buses · from ₹549 · chargers at boarding'),
            trailing: const Icon(Icons.chevron_right),
            onTap: widget.onBookTicket,
          ),
        ),
        const SizedBox(height: 16),
        Text('Charge by vehicle', style: text.titleMedium),
        const SizedBox(height: 8),
        SizedBox(
          height: 84,
          child: ListView(
            scrollDirection: Axis.horizontal,
            children: [
              for (final (segment, icon, label) in vehicles)
                Padding(
                  padding: const EdgeInsets.only(right: 10),
                  child: _VehicleTile(icon: icon, label: label, onTap: () => widget.onCharge(segment)),
                ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        Text('Your trips', style: text.titleMedium),
        const SizedBox(height: 8),
        FutureBuilder<List<BookingSummary>>(
          future: _bookings,
          builder: (context, snap) {
            if (snap.connectionState != ConnectionState.done) return const LinearProgressIndicator();
            final bookings = (snap.data ?? []).where((b) => b.status == 'PAID').toList();
            if (bookings.isEmpty) {
              return const Card(
                child: ListTile(
                  leading: Icon(Icons.event_seat_outlined),
                  title: Text('No upcoming trips yet'),
                  subtitle: Text('Your bus tickets and charging sessions will show here.'),
                ),
              );
            }
            return Column(
              children: [
                for (final b in bookings)
                  Card(
                    child: ListTile(
                      leading: const Icon(Icons.directions_bus, color: Brand.blue),
                      title: Text(b.route),
                      subtitle: Text('${b.departs} · Seats ${b.seats.join(', ')} · ${rupees(b.totalPaise)}'),
                      trailing: TextButton(onPressed: () => _cancel(b), child: const Text('Cancel')),
                    ),
                  ),
              ],
            );
          },
        ),
      ],
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

class _VehicleTile extends StatelessWidget {
  const _VehicleTile({required this.icon, required this.label, required this.onTap});

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(16),
      child: Container(
        width: 76,
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: Brand.green.withValues(alpha: 0.35)),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, color: Brand.green, size: 28),
            const SizedBox(height: 6),
            Text(label, style: const TextStyle(fontWeight: FontWeight.w600, color: Brand.ink)),
          ],
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
