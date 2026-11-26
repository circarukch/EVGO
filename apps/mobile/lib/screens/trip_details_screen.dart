import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../api/evgo_api.dart';
import '../api/models.dart';
import '../brand.dart';

/// Rate printed on bus receipts (AC electric bus, GST-inclusive fares). Confirm with the accountant.
const busGstPercent = 5.0;

/// Everything about one bus booking: date and times, boarding and drop, bus, seats, fare, payment, refund rules.
class TripDetailsScreen extends StatefulWidget {
  const TripDetailsScreen({super.key, required this.api, required this.booking});

  final EvgoApi api;
  final BookingSummary booking;

  @override
  State<TripDetailsScreen> createState() => _TripDetailsScreenState();
}

class _TripDetailsScreenState extends State<TripDetailsScreen> {
  late BookingSummary b = widget.booking;
  bool _cancelling = false;

  String get _statusLabel => switch (b.status) {
        'PAID' => b.isUpcoming ? 'Confirmed' : 'Completed',
        'REFUNDED' => 'Cancelled, refunded',
        'PARTIALLY_REFUNDED' => 'Cancelled, partly refunded',
        _ => b.status,
      };

  Future<void> _cancel() async {
    final yes = await showDialog<bool>(
      context: context,
      builder: (d) => AlertDialog(
        title: const Text('Cancel this ticket?'),
        content: Text(b.refundSummary.isEmpty
            ? 'The refund goes to your EVGO wallet.'
            : '${b.refundSummary}\n\nThe refund goes to your EVGO wallet.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(d, false), child: const Text('Keep ticket')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Colors.red.shade700),
            onPressed: () => Navigator.pop(d, true),
            child: const Text('Cancel ticket'),
          ),
        ],
      ),
    );
    if (yes != true || !mounted) return;
    setState(() => _cancelling = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      final result = await widget.api.cancelBooking(b.orderId);
      messenger.showSnackBar(SnackBar(content: Text(result.message)));
      final fresh = (await widget.api.myBookings()).where((x) => x.orderId == b.orderId);
      if (mounted && fresh.isNotEmpty) setState(() => b = fresh.first);
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _cancelling = false);
    }
  }

  String _shareText() {
    final lines = [
      'EVGO bus ticket',
      b.route,
      if (b.departsAt != null) '${longDate(b.departsAt!)}, departs ${b.departs}',
      if (b.boarding != null) 'Board: ${b.boarding!.name}, ${b.boarding!.city} at ${b.boarding!.time}',
      if (b.dropping != null) 'Drop: ${b.dropping!.name}, ${b.dropping!.city} at ${b.dropping!.time}',
      for (final t in b.tickets)
        'Seat ${t.seatLabel}${t.passengerName.isEmpty ? '' : ', ${t.passengerName}'}${t.ticketCode.isEmpty ? '' : ', ticket ${t.ticketCode}'}',
      if (b.busRegistration != null) 'Bus ${b.busRegistration}',
      'Paid ${rupees(b.totalPaise)} · Booking ${b.orderId.substring(0, 8).toUpperCase()}',
    ];
    return lines.join('\n');
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final gst = gstIncluded(b.totalPaise, busGstPercent);
    return Scaffold(
      appBar: AppBar(title: const Text('Trip details')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
        children: [
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              gradient: LinearGradient(colors: b.isActive ? const [Brand.blue, Brand.teal] : [Colors.grey.shade600, Colors.grey.shade500]),
              borderRadius: BorderRadius.circular(20),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(children: [
                  const Icon(Icons.directions_bus, color: Colors.white),
                  const SizedBox(width: 8),
                  Expanded(child: Text(b.route, style: text.titleMedium?.copyWith(color: Colors.white, fontWeight: FontWeight.w700))),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(color: Colors.white24, borderRadius: BorderRadius.circular(12)),
                    child: Text(_statusLabel, key: const Key('trip-status'), style: const TextStyle(color: Colors.white, fontSize: 12)),
                  ),
                ]),
                const SizedBox(height: 12),
                if (b.departsAt != null)
                  Text(longDate(b.departsAt!),
                      key: const Key('trip-date'), style: text.headlineSmall?.copyWith(color: Colors.white, fontWeight: FontWeight.w800)),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(child: _Stop(label: 'Departs', stop: b.boarding, fallbackTime: b.departs)),
                    const Icon(Icons.arrow_forward, color: Colors.white70),
                    Expanded(child: _Stop(label: 'Arrives', stop: b.dropping, alignEnd: true)),
                  ],
                ),
                if (b.boarding?.at != null && b.dropping?.at != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text('Journey ${duration(b.dropping!.at!.difference(b.boarding!.at!))}',
                        style: const TextStyle(color: Colors.white70)),
                  ),
              ],
            ),
          ),
          _Section('Passengers and seats', [
            for (final t in b.tickets)
              _Line(
                t.passengerName.isEmpty ? 'Seat ${t.seatLabel}' : '${t.passengerName} · Seat ${t.seatLabel}',
                t.farePaise == null ? '' : rupees(t.farePaise!),
                sub: t.ticketCode.isEmpty ? null : 'Ticket ${t.ticketCode}${t.status == 'CANCELLED' ? ' · cancelled' : ''}',
              ),
          ]),
          _Section('Bus', [
            if (b.operator.isNotEmpty) _Line('Operator', b.operator),
            _Line('Bus number', b.busRegistration ?? 'Shared a few hours before departure'),
            const _Line('Type', 'Electric, AC'),
          ]),
          _Section('Payment', [
            _Line('Fare', rupees(b.totalPaise - gst)),
            _Line('GST (${busGstPercent.toStringAsFixed(0)}%)', rupees(gst)),
            _Line('Total paid', rupees(b.totalPaise), bold: true),
            _Line('Paid by', b.paymentMethod == 'wallet' ? 'EVGO wallet' : (b.paymentMethod ?? '-').toUpperCase()),
            if (b.bookedAt != null) _Line('Booked on', '${longDate(b.bookedAt!)}, ${clock(b.bookedAt!)}'),
            _Line('Booking ID', b.orderId.substring(0, 8).toUpperCase()),
            if (b.refundPaise > 0) _Line('Refunded to wallet', rupees(b.refundPaise), bold: true),
          ]),
          if (b.refundSummary.isNotEmpty)
            _Section('Cancellation policy', [Padding(padding: const EdgeInsets.symmetric(vertical: 6), child: Text(b.refundSummary))]),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  key: const Key('share-ticket'),
                  style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
                  onPressed: () async {
                    await Clipboard.setData(ClipboardData(text: _shareText()));
                    if (context.mounted) {
                      ScaffoldMessenger.of(context)
                          .showSnackBar(const SnackBar(content: Text('Ticket details copied. Paste them in WhatsApp or SMS.')));
                    }
                  },
                  icon: const Icon(Icons.share_outlined),
                  label: const Text('Share ticket'),
                ),
              ),
              if (b.isUpcoming) ...[
                const SizedBox(width: 12),
                Expanded(
                  child: FilledButton.icon(
                    key: const Key('cancel-ticket'),
                    style: FilledButton.styleFrom(backgroundColor: Colors.red.shade700, minimumSize: const Size.fromHeight(48)),
                    onPressed: _cancelling ? null : _cancel,
                    icon: const Icon(Icons.cancel_outlined),
                    label: Text(_cancelling ? 'Cancelling…' : 'Cancel ticket'),
                  ),
                ),
              ],
            ],
          ),
        ],
      ),
    );
  }
}

class _Stop extends StatelessWidget {
  const _Stop({required this.label, required this.stop, this.fallbackTime, this.alignEnd = false});
  final String label;
  final StopTime? stop;
  final String? fallbackTime;
  final bool alignEnd;

  @override
  Widget build(BuildContext context) {
    final align = alignEnd ? CrossAxisAlignment.end : CrossAxisAlignment.start;
    return Column(
      crossAxisAlignment: align,
      children: [
        Text(label, style: const TextStyle(color: Colors.white70, fontSize: 12)),
        Text(stop?.time ?? fallbackTime ?? '--:--', style: const TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.w800)),
        if (stop != null)
          Text('${stop!.name}\n${stop!.city}',
              textAlign: alignEnd ? TextAlign.end : TextAlign.start, style: const TextStyle(color: Colors.white, fontSize: 13)),
      ],
    );
  }
}

/// A titled card of label/value lines, shared by the trip and charging receipts.
class _Section extends StatelessWidget {
  const _Section(this.title, this.children);
  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => DetailSection(title: title, children: children);
}

class _Line extends DetailLine {
  const _Line(super.label, super.value, {super.sub, super.bold});
}

class DetailSection extends StatelessWidget {
  const DetailSection({super.key, required this.title, required this.children});
  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: Theme.of(context).textTheme.titleSmall?.copyWith(color: Colors.black54, fontWeight: FontWeight.w600)),
            const SizedBox(height: 6),
            Card(
              margin: EdgeInsets.zero,
              child: Padding(padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8), child: Column(children: children)),
            ),
          ],
        ),
      );
}

class DetailLine extends StatelessWidget {
  const DetailLine(this.label, this.value, {super.key, this.sub, this.bold = false});
  final String label;
  final String value;
  final String? sub;
  final bool bold;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(label),
                  if (sub != null) Text(sub!, style: Theme.of(context).textTheme.bodySmall),
                ],
              ),
            ),
            const SizedBox(width: 12),
            Flexible(
              child: Text(value, textAlign: TextAlign.end, style: TextStyle(fontWeight: bold ? FontWeight.w800 : FontWeight.w600)),
            ),
          ],
        ),
      );
}
