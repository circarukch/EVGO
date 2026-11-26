import 'package:flutter/material.dart';

import '../api/evgo_api.dart';
import '../api/models.dart';
import 'seat_screen.dart';

class TravelScreen extends StatefulWidget {
  const TravelScreen({super.key, required this.api, required this.onHome});

  final EvgoApi api;

  /// Logo tap on screens opened from here.
  final VoidCallback onHome;

  @override
  State<TravelScreen> createState() => _TravelScreenState();
}

class _TravelScreenState extends State<TravelScreen> {
  final _from = TextEditingController(text: 'Guntur');
  final _to = TextEditingController(text: 'Hyderabad');
  Future<List<TripSummary>>? _results;

  @override
  void dispose() {
    _from.dispose();
    _to.dispose();
    super.dispose();
  }

  void _search() {
    final results = widget.api.searchTrips(_from.text.trim(), _to.text.trim());
    setState(() {
      _results = results;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextField(controller: _from, decoration: const InputDecoration(labelText: 'From')),
          TextField(controller: _to, decoration: const InputDecoration(labelText: 'To')),
          const SizedBox(height: 12),
          FilledButton(onPressed: _search, child: const Text('Search buses')),
          const SizedBox(height: 12),
          Expanded(
            child: FutureBuilder<List<TripSummary>>(
              future: _results,
              builder: (context, snap) {
                if (_results == null) return const SizedBox.shrink();
                if (snap.connectionState != ConnectionState.done) {
                  return const Center(child: CircularProgressIndicator());
                }
                if (snap.hasError) return Text('Could not load trips: ${snap.error}');
                final trips = snap.data!;
                if (trips.isEmpty) return const Text('No buses found for this route.');
                return ListView(
                  children: [
                    for (final t in trips)
                      Card(
                        child: ListTile(
                          onTap: () => Navigator.of(context).push(
                            MaterialPageRoute<bool>(builder: (_) => SeatScreen(api: widget.api, trip: t, onHome: widget.onHome)),
                          ),
                          title: Text('${t.dateLabel} ${t.departs} to ${t.arrives} · ${t.busType}'),
                          subtitle: Text(
                            '${t.operator} · ${t.seatsLeft} seats left'
                            '${t.chargersAtBoarding > 0 ? ' · ${t.chargersAtBoarding} chargers at boarding' : ''}',
                          ),
                          trailing: Text(inr(t.fareInr)),
                        ),
                      ),
                  ],
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
