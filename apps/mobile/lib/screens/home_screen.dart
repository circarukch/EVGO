import 'package:flutter/material.dart';

import '../api/evgo_api.dart';
import '../api/models.dart';

/// Trips timeline: bus bookings now, charging sessions once the Charging module is live.
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.api});

  final EvgoApi api;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  late Future<List<BookingSummary>> _bookings = widget.api.myBookings();

  Future<void> _cancel(BookingSummary b) async {
    try {
      final refund = await widget.api.cancelBooking(b.orderId);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Cancelled. ${rupees(refund)} refunded to your wallet')));
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
    setState(() => _bookings = widget.api.myBookings());
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return FutureBuilder<List<BookingSummary>>(
      future: _bookings,
      builder: (context, snap) {
        final bookings = (snap.data ?? []).where((b) => b.status == 'PAID').toList();
        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text('Your trips', style: text.headlineSmall),
            const SizedBox(height: 12),
            if (snap.connectionState != ConnectionState.done)
              const LinearProgressIndicator()
            else if (bookings.isEmpty)
              const Text('No upcoming trips. Book a bus from the Travel tab.'),
            for (final b in bookings)
              Card(
                child: ListTile(
                  leading: const Icon(Icons.directions_bus),
                  title: Text(b.route),
                  subtitle: Text('${b.departs} · Seats ${b.seats.join(', ')} · ${rupees(b.totalPaise)}'),
                  trailing: TextButton(onPressed: () => _cancel(b), child: const Text('Cancel')),
                ),
              ),
            const Card(
              child: ListTile(
                leading: Icon(Icons.ev_station),
                title: Text('Charging sessions'),
                subtitle: Text('Your charging sessions will show here next to your bus trips.'),
              ),
            ),
          ],
        );
      },
    );
  }
}
