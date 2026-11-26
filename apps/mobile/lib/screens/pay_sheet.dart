import 'dart:async';

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/evgo_api.dart';
import '../api/models.dart';
import '../brand.dart';

/// How the customer wants to pay for this charge.
sealed class PayChoice {}

class PayByUpi extends PayChoice {
  PayByUpi(this.amountPaise);
  final int amountPaise;
}

class PayByWallet extends PayChoice {}

/// Bottom sheet before charging starts. UPI is first: no wallet, no top-up.
Future<PayChoice?> showPaySheet(BuildContext context, {required String title, double? powerKw}) {
  final options = suggestedBlocksPaise(powerKw);
  var amount = options[1];
  return showModalBottomSheet<PayChoice>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (sheet) => StatefulBuilder(
      builder: (sheet, setState) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Pay for this charge', style: Theme.of(sheet).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700)),
              Text(title, style: Theme.of(sheet).textTheme.bodyMedium),
              const SizedBox(height: 16),
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: Brand.green.withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: Brand.green.withValues(alpha: 0.4)),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Row(children: [
                      Icon(Icons.account_balance, color: Brand.green),
                      SizedBox(width: 8),
                      Expanded(child: Text('Pay by UPI', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16))),
                      Chip(label: Text('No wallet needed'), visualDensity: VisualDensity.compact),
                    ]),
                    const SizedBox(height: 8),
                    Wrap(spacing: 8, children: [
                      for (final o in options)
                        ChoiceChip(
                          key: Key('block-$o'),
                          label: Text(rupees(o)),
                          selected: amount == o,
                          onSelected: (_) => setState(() => amount = o),
                        ),
                    ]),
                    const SizedBox(height: 8),
                    Text(
                      '${rupees(amount)} is held in your bank account through your UPI app. '
                      'You pay only for the energy you use, and the rest is released as soon as you stop. '
                      'Charging stops by itself at ${rupees(amount)}.',
                    ),
                    const SizedBox(height: 12),
                    FilledButton.icon(
                      key: const Key('pay-upi'),
                      style: FilledButton.styleFrom(backgroundColor: Brand.green, minimumSize: const Size.fromHeight(48)),
                      onPressed: () => Navigator.pop(sheet, PayByUpi(amount)),
                      icon: const Icon(Icons.lock_outline),
                      label: Text('Hold ${rupees(amount)} by UPI and start'),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 8),
              Center(
                child: TextButton.icon(
                  key: const Key('pay-wallet'),
                  onPressed: () => Navigator.pop(sheet, PayByWallet()),
                  icon: const Icon(Icons.account_balance_wallet_outlined),
                  label: const Text('Pay from EVGO wallet instead'),
                ),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}

/// After a UPI block is requested: open the UPI app (or, with the test gateway, a stand-in for it),
/// then wait until the bank confirms and charging starts. Returns the session, or null if cancelled.
Future<ChargingSessionView?> approveAndStart(BuildContext context, EvgoApi api, UpiBlockView block,
    {Duration pollEvery = const Duration(seconds: 2)}) async {
  if (block.isMock) {
    final approve = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (d) => _MockUpiApp(amountPaise: block.amountPaise),
    );
    await api.mockUpiDecision(block.id, approve: approve == true);
  } else if (block.upiIntentUrl != null) {
    await launchUrl(Uri.parse(block.upiIntentUrl!), mode: LaunchMode.externalApplication);
  }
  if (!context.mounted) return null;
  return showDialog<ChargingSessionView>(
    context: context,
    barrierDismissible: false,
    builder: (d) => _WaitForApproval(api: api, block: block, pollEvery: pollEvery),
  );
}

class _WaitForApproval extends StatefulWidget {
  const _WaitForApproval({required this.api, required this.block, required this.pollEvery});
  final EvgoApi api;
  final UpiBlockView block;
  final Duration pollEvery;

  @override
  State<_WaitForApproval> createState() => _WaitForApprovalState();
}

class _WaitForApprovalState extends State<_WaitForApproval> {
  Timer? _timer;
  String? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _check();
    _timer = Timer.periodic(widget.pollEvery, (_) => _check());
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _check() async {
    if (_busy || _error != null) return;
    _busy = true;
    try {
      final (_, session) = await widget.api.startWithUpiBlock(widget.block.id);
      if (session != null && mounted) {
        _timer?.cancel();
        Navigator.pop(context, session);
      }
    } on ApiException catch (e) {
      _timer?.cancel();
      if (mounted) setState(() => _error = e.message);
    } finally {
      _busy = false;
    }
  }

  Future<void> _cancel() async {
    _timer?.cancel();
    try {
      await widget.api.cancelUpiBlock(widget.block.id);
    } on ApiException {
      // Nothing to release, or the bank releases it by itself.
    }
    if (mounted) Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    final failed = _error != null;
    return AlertDialog(
      title: Text(failed ? 'Charging did not start' : 'Approve in your UPI app'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (!failed) ...[
            const LinearProgressIndicator(),
            const SizedBox(height: 16),
            Text('Waiting for your bank to hold ${rupees(widget.block.amountPaise)}. Charging starts as soon as it does.'),
          ] else ...[
            Text(_error!, key: const Key('upi-error')),
            const SizedBox(height: 8),
            const Text('No money was taken.'),
          ],
        ],
      ),
      actions: [
        if (failed)
          FilledButton(onPressed: () => Navigator.pop(context), child: const Text('OK'))
        else
          TextButton(onPressed: _cancel, child: const Text('Cancel')),
      ],
    );
  }
}

/// Test gateway only: looks like the approval screen of a UPI app.
class _MockUpiApp extends StatelessWidget {
  const _MockUpiApp({required this.amountPaise});
  final int amountPaise;

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      icon: const Icon(Icons.verified_user_outlined, color: Brand.blue, size: 36),
      title: const Text('UPI app (test)'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Text('EVGO requests a one-time hold'),
          const SizedBox(height: 8),
          Text(rupees(amountPaise), style: Theme.of(context).textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w800)),
          const SizedBox(height: 8),
          const Text('Only the amount you use is debited. The rest is released.', textAlign: TextAlign.center),
          const SizedBox(height: 8),
          Text('In the real app you enter your UPI PIN here.', style: Theme.of(context).textTheme.bodySmall),
        ],
      ),
      actions: [
        TextButton(key: const Key('mock-upi-decline'), onPressed: () => Navigator.pop(context, false), child: const Text('Decline')),
        FilledButton(key: const Key('mock-upi-approve'), onPressed: () => Navigator.pop(context, true), child: const Text('Approve')),
      ],
    );
  }
}
