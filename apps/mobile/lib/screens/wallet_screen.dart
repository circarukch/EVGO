import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../api/evgo_api.dart';
import '../api/models.dart';
import '../brand.dart';
import 'checkout.dart';

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
    await addMoneyWithCheckout(context, widget.api, paise);
    if (mounted) {
      setState(() {
        _busy = false;
        _wallet = widget.api.wallet();
      });
    }
  }

  /// "Other amount": the customer types any whole-rupee amount, then pays through the same checkout.
  Future<void> _addOther() async {
    final rupees = await showModalBottomSheet<int>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => const _CustomAmountSheet(),
    );
    if (rupees != null && mounted) await _add(rupees * 100);
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
            Text('Add money', style: text.titleMedium),
            const SizedBox(height: 8),
            // Four equal tiles in one white strip, same look as the filter bars on Charge and Shop.
            Container(
              padding: const EdgeInsets.all(6),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(16),
                boxShadow: const [BoxShadow(color: Color(0x14000000), blurRadius: 10, offset: Offset(0, 2))],
              ),
              child: Row(
                children: [
                  for (final amount in const [50000, 100000, 200000])
                    _AmountTile(
                      key: Key('topup-$amount'),
                      icon: Icons.add,
                      label: rupees(amount),
                      onTap: _busy ? null : () => _add(amount),
                    ),
                  _AmountTile(key: const Key('topup-custom'), icon: Icons.edit_outlined, label: 'Other', onTap: _busy ? null : _addOther),
                ],
              ),
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

/// One quick top-up choice: small icon over the amount, all four the same width.
class _AmountTile extends StatelessWidget {
  const _AmountTile({super.key, required this.icon, required this.label, required this.onTap});

  final IconData icon;
  final String label;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 3),
        child: Material(
          color: const Color(0xFFF1F6F4),
          borderRadius: BorderRadius.circular(12),
          child: InkWell(
            borderRadius: BorderRadius.circular(12),
            onTap: onTap,
            child: SizedBox(
              height: 58,
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(icon, size: 16, color: Brand.green),
                  const SizedBox(height: 2),
                  FittedBox(
                    fit: BoxFit.scaleDown,
                    child: Text(label, maxLines: 1, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: Brand.blue)),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Limits for a typed top-up, in whole rupees. The server allows ₹1 to ₹1,00,000 (full-KYC wallet limit).
const customTopUpMinInr = 10;
const customTopUpMaxInr = 100000;

class _CustomAmountSheet extends StatefulWidget {
  const _CustomAmountSheet();

  @override
  State<_CustomAmountSheet> createState() => _CustomAmountSheetState();
}

class _CustomAmountSheetState extends State<_CustomAmountSheet> {
  final _form = GlobalKey<FormState>();
  final _amount = TextEditingController();

  @override
  void dispose() {
    _amount.dispose();
    super.dispose();
  }

  void _submit() {
    if (_form.currentState!.validate()) Navigator.of(context).pop(int.parse(_amount.text));
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 0, 20, 20 + MediaQuery.of(context).viewInsets.bottom),
      child: Form(
        key: _form,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Add money', style: text.titleLarge?.copyWith(fontWeight: FontWeight.w700)),
            const SizedBox(height: 4),
            Text('Enter any amount from ${inr(customTopUpMinInr)} to ${inr(customTopUpMaxInr)}.',
                style: text.bodyMedium?.copyWith(color: Colors.black54)),
            const SizedBox(height: 16),
            TextFormField(
              key: const Key('topup-amount'),
              controller: _amount,
              autofocus: true,
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(6)],
              style: text.headlineSmall,
              decoration: const InputDecoration(labelText: 'Amount', prefixText: '₹ ', border: OutlineInputBorder()),
              validator: (v) {
                final n = int.tryParse(v ?? '');
                if (n == null) return 'Enter an amount';
                if (n < customTopUpMinInr) return 'Minimum is ${inr(customTopUpMinInr)}';
                if (n > customTopUpMaxInr) return 'Maximum is ${inr(customTopUpMaxInr)} at a time';
                return null;
              },
              onFieldSubmitted: (_) => _submit(),
            ),
            const SizedBox(height: 16),
            FilledButton(
              key: const Key('topup-amount-continue'),
              onPressed: _submit,
              style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
              child: const Text('Continue to pay'),
            ),
          ],
        ),
      ),
    );
  }
}
