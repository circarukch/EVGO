import 'package:flutter/material.dart';

import '../api/evgo_api.dart';
import '../api/models.dart';
import '../brand.dart';

/// One wallet for bus fares and charging.
class WalletScreen extends StatefulWidget {
  const WalletScreen({super.key, required this.api});

  final EvgoApi api;

  @override
  State<WalletScreen> createState() => _WalletScreenState();
}

class _WalletScreenState extends State<WalletScreen> {
  late Future<WalletSummary> _wallet = widget.api.wallet();
  bool _busy = false;

  Future<void> _add(int paise) async {
    setState(() => _busy = true);
    try {
      await widget.api.addMoney(paise);
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
          _wallet = widget.api.wallet();
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return FutureBuilder<WalletSummary>(
      future: _wallet,
      builder: (context, snap) {
        final w = snap.data;
        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(gradient: Brand.gradient, borderRadius: BorderRadius.circular(16)),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('EVGO Wallet', style: text.titleMedium?.copyWith(color: Colors.white)),
                  const SizedBox(height: 8),
                  Text(
                    w == null ? '…' : rupees(w.balancePaise),
                    style: text.displaySmall?.copyWith(color: Colors.white, fontWeight: FontWeight.w600),
                  ),
                  Text('For bus tickets and charging', style: text.bodySmall?.copyWith(color: Colors.white70)),
                ],
              ),
            ),
            const SizedBox(height: 16),
            Wrap(
              spacing: 8,
              children: [
                for (final amount in const [50000, 100000, 200000])
                  OutlinedButton(onPressed: _busy ? null : () => _add(amount), child: Text('+ ${rupees(amount)}')),
              ],
            ),
            const SizedBox(height: 24),
            Text('History', style: text.titleMedium),
            if (w != null && w.history.isEmpty)
              const ListTile(title: Text('No transactions yet'), subtitle: Text('Bus fares and charging will appear here together.')),
            if (w != null)
              for (final e in w.history)
                ListTile(
                  title: Text(e.memo),
                  trailing: Text(
                    '${e.amountPaise >= 0 ? '+' : '-'}${rupees(e.amountPaise.abs())}',
                    style: TextStyle(color: e.amountPaise >= 0 ? Colors.green.shade700 : null),
                  ),
                ),
          ],
        );
      },
    );
  }
}
