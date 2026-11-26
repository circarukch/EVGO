import 'dart:async';

import 'package:flutter/material.dart';

import '../api/evgo_api.dart';
import '../api/models.dart';
import '../brand.dart';

/// Live charging: energy, cost and power refresh every few seconds; Stop takes payment (UPI hold or wallet).
class ChargingSessionScreen extends StatefulWidget {
  const ChargingSessionScreen({super.key, required this.api, required this.initial, this.refreshEvery = const Duration(seconds: 3)});

  final EvgoApi api;
  final ChargingSessionView initial;
  final Duration refreshEvery;

  @override
  State<ChargingSessionScreen> createState() => _ChargingSessionScreenState();
}

class _ChargingSessionScreenState extends State<ChargingSessionScreen> {
  late ChargingSessionView _s = widget.initial;
  Timer? _timer;
  bool _stopping = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    if (_s.isActive) _timer = Timer.periodic(widget.refreshEvery, (_) => _refresh());
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _refresh() async {
    try {
      final s = await widget.api.chargingSession(_s.id);
      if (!mounted) return;
      setState(() {
        _s = s;
        _error = null;
      });
      if (!s.isActive) _timer?.cancel();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Future<void> _stop() async {
    final yes = await showDialog<bool>(
      context: context,
      builder: (d) => AlertDialog(
        title: const Text('Stop charging?'),
        content: Text('You will pay ${rupees(_s.costPaise)} for ${_s.energyKwh.toStringAsFixed(2)} kWh so far.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(d, false), child: const Text('Keep charging')),
          FilledButton(onPressed: () => Navigator.pop(d, true), child: const Text('Stop')),
        ],
      ),
    );
    if (yes != true) return;
    setState(() => _stopping = true);
    try {
      final s = await widget.api.stopCharging(_s.id);
      _timer?.cancel();
      if (mounted) setState(() => _s = s);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _stopping = false);
    }
  }

  String _elapsed() {
    final d = DateTime.now().difference(_s.startedAt);
    final m = d.inMinutes;
    return m < 60 ? '$m min' : '${m ~/ 60} h ${m % 60} min';
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final active = _s.isActive;
    return Scaffold(
      appBar: AppBar(title: Text(active ? 'Charging' : 'Charging done')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Container(
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              gradient: LinearGradient(colors: active ? const [Brand.green, Brand.lime] : const [Brand.blue, Brand.teal]),
              borderRadius: BorderRadius.circular(24),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(active ? Icons.bolt : Icons.check_circle, color: Colors.white),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        '${_s.placeName} · ${_s.chargePointId} #${_s.connectorId}',
                        style: text.titleSmall?.copyWith(color: Colors.white),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                Text(
                  '${_s.energyKwh.toStringAsFixed(2)} kWh',
                  key: const Key('session-energy'),
                  style: text.displaySmall?.copyWith(color: Colors.white, fontWeight: FontWeight.w800),
                ),
                Text(rupees(_s.costPaise), key: const Key('session-cost'), style: text.headlineSmall?.copyWith(color: Colors.white)),
                if (active) ...[
                  const SizedBox(height: 12),
                  const LinearProgressIndicator(color: Colors.white, backgroundColor: Colors.white24),
                ],
              ],
            ),
          ),
          const SizedBox(height: 16),
          _Row('Price', '₹${_s.perKwhInr.toStringAsFixed(0)} per kWh'),
          if (active) _Row('Power now', '${_s.powerKw.toStringAsFixed(1)} kW'),
          _Row('Started', _elapsed() == '0 min' ? 'Just now' : '${_elapsed()} ago'),
          if (_s.paidByUpi && active) _Row('Held by UPI', '${rupees(_s.blockedPaise ?? 0)}, stops by itself at this'),
          if (_s.paidByUpi && !active && _s.paymentStatus == 'CAPTURE_FAILED')
            const Padding(
              padding: EdgeInsets.only(top: 8),
              child: Text('We could not collect the payment yet. We will retry; nothing more is needed from you.'),
            )
          else if (_s.paidByUpi && !active) ...[
            _Row('Paid by UPI', rupees(_s.capturedPaise ?? _s.costPaise)),
            _Row('Released to your bank', rupees(_s.releasedPaise ?? 0)),
          ],
          if (!active && _s.stopReason == 'AmountLimit')
            const Padding(
              padding: EdgeInsets.only(top: 8),
              child: Text('Stopped because the session used the amount you held. Start again to charge more.'),
            ),
          if (!active && _s.stopReason == 'WalletLimit')
            const Padding(
              padding: EdgeInsets.only(top: 8),
              child: Text('Stopped because the session used your wallet balance. Add money to charge more.'),
            ),
          if (!active && _s.balancePaise != null) _Row('Wallet balance', rupees(_s.balancePaise!)),
          if (_error != null)
            Padding(padding: const EdgeInsets.only(top: 8), child: Text(_error!, style: const TextStyle(color: Colors.red))),
          const SizedBox(height: 24),
          if (active)
            FilledButton.icon(
              style: FilledButton.styleFrom(backgroundColor: Colors.red.shade700, minimumSize: const Size.fromHeight(52)),
              onPressed: _stopping ? null : _stop,
              icon: const Icon(Icons.stop_circle_outlined),
              label: Text(_stopping ? 'Stopping…' : 'Stop charging'),
            )
          else
            FilledButton(
              style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
              onPressed: () => Navigator.pop(context),
              child: const Text('Done'),
            ),
        ],
      ),
    );
  }
}

class _Row extends StatelessWidget {
  const _Row(this.label, this.value);
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Row(children: [Expanded(child: Text(label)), Text(value, style: const TextStyle(fontWeight: FontWeight.w600))]),
      );
}
