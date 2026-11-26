import 'package:flutter/material.dart';

/// One wallet for bus fares and charging. Placeholder until Wallet module is live.
class WalletScreen extends StatelessWidget {
  const WalletScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text('EVGO Wallet', style: text.headlineSmall),
        const SizedBox(height: 8),
        Text('₹0.00', style: text.displaySmall),
        const SizedBox(height: 16),
        FilledButton.icon(onPressed: null, icon: const Icon(Icons.add), label: const Text('Add money with UPI')),
        const SizedBox(height: 24),
        Text('History', style: text.titleMedium),
        const ListTile(title: Text('No transactions yet'), subtitle: Text('Bus fares and charging sessions will appear here together.')),
      ],
    );
  }
}
