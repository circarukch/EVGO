import 'package:flutter/material.dart';

import '../api/evgo_api.dart';
import '../api/models.dart';

/// Pick seats, hold them, pay from the wallet, show tickets.
class SeatScreen extends StatefulWidget {
  const SeatScreen({super.key, required this.api, required this.trip});

  final EvgoApi api;
  final TripSummary trip;

  @override
  State<SeatScreen> createState() => _SeatScreenState();
}

class _SeatScreenState extends State<SeatScreen> {
  static const maxSeats = 6;
  late Future<List<SeatInfo>> _seats = widget.api.seats(widget.trip.id);
  final _selected = <String>{};
  final _name = TextEditingController();
  bool _busy = false;
  String? _error;
  String? _orderId;
  int? _shortfallPaise;
  List<Ticket>? _tickets;

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Future<void> _book(int totalPaise) async {
    if (_name.text.trim().isEmpty) {
      setState(() => _error = 'Enter the passenger name');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      _orderId ??= await widget.api.holdSeats(widget.trip.id, _selected.toList(), _name.text.trim());
      final tickets = await widget.api.payWithWallet(_orderId!);
      setState(() {
        _tickets = tickets;
        _shortfallPaise = null;
      });
    } on ApiException catch (e) {
      setState(() {
        _error = e.message;
        _shortfallPaise = e.statusCode == 402 ? e.body['shortfallPaise'] as int? : null;
        if (e.statusCode == 409 || e.statusCode == 410) {
          // Seats were taken or the hold ran out: start again with fresh availability.
          _orderId = null;
          _selected.clear();
          _seats = widget.api.seats(widget.trip.id);
        }
      });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _addShortfallAndPay(int totalPaise) async {
    setState(() => _busy = true);
    try {
      await widget.api.addMoney(_shortfallPaise!);
    } on ApiException catch (e) {
      setState(() => _error = e.message);
      return;
    } finally {
      if (mounted) setState(() => _busy = false);
    }
    await _book(totalPaise);
  }

  @override
  Widget build(BuildContext context) {
    final trip = widget.trip;
    return Scaffold(
      appBar: AppBar(title: Text('${trip.dateLabel} ${trip.departs} · ${trip.operator}')),
      body: _tickets != null ? _ticketsView(context) : _picker(context),
    );
  }

  Widget _ticketsView(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text('Booked', style: Theme.of(context).textTheme.headlineSmall),
        for (final t in _tickets!)
          Card(
            child: ListTile(
              leading: const Icon(Icons.confirmation_number_outlined),
              title: Text('Seat ${t.seatLabel} · ${t.passengerName}'),
              subtitle: Text('Ticket ${t.ticketCode}'),
            ),
          ),
        const SizedBox(height: 12),
        FilledButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Done')),
      ],
    );
  }

  Widget _picker(BuildContext context) {
    return FutureBuilder<List<SeatInfo>>(
      future: _seats,
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) return const Center(child: CircularProgressIndicator());
        if (snap.hasError) return Center(child: Text('Could not load seats: ${snap.error}'));
        final seats = snap.data!;
        final fare = {for (final s in seats) s.seatLabel: s.farePaise};
        final total = _selected.fold<int>(0, (sum, s) => sum + (fare[s] ?? 0));
        return Column(
          children: [
            Expanded(
              child: GridView.count(
                crossAxisCount: 4,
                padding: const EdgeInsets.all(16),
                mainAxisSpacing: 8,
                crossAxisSpacing: 8,
                children: [
                  for (final s in seats)
                    FilterChip(
                      label: Text(s.seatLabel),
                      selected: _selected.contains(s.seatLabel),
                      onSelected: !s.isFree || _orderId != null
                          ? null
                          : (on) => setState(() {
                                if (on && _selected.length < maxSeats) {
                                  _selected.add(s.seatLabel);
                                } else {
                                  _selected.remove(s.seatLabel);
                                }
                              }),
                    ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  TextField(controller: _name, decoration: const InputDecoration(labelText: 'Passenger name')),
                  if (_error != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                    ),
                  const SizedBox(height: 12),
                  if (_shortfallPaise != null)
                    FilledButton(
                      onPressed: _busy ? null : () => _addShortfallAndPay(total),
                      child: Text('Add ${rupees(_shortfallPaise!)} to wallet and pay'),
                    )
                  else
                    FilledButton(
                      onPressed: _busy || _selected.isEmpty ? null : () => _book(total),
                      child: Text(_selected.isEmpty ? 'Choose seats' : 'Pay ${rupees(total)} from wallet'),
                    ),
                ],
              ),
            ),
          ],
        );
      },
    );
  }
}
