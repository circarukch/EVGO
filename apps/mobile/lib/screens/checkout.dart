import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_cashfree_pg_sdk/api/cferrorresponse/cferrorresponse.dart';
import 'package:flutter_cashfree_pg_sdk/api/cfpayment/cfwebcheckoutpayment.dart';
import 'package:flutter_cashfree_pg_sdk/api/cfpaymentgateway/cfpaymentgatewayservice.dart';
import 'package:flutter_cashfree_pg_sdk/api/cfsession/cfsession.dart';
import 'package:flutter_cashfree_pg_sdk/utils/cfenums.dart';

import '../api/evgo_api.dart';
import '../api/models.dart';
import '../brand.dart';

/// Opens the payment gateway's checkout, where the customer pays by UPI, card or netbanking.
/// Returns when the checkout closes. Whether money actually moved is always asked of the API
/// afterwards (Cashfree's answer to the app is only a hint).
///
/// With the mock gateway (development, demo) a test-mode sheet stands in for Cashfree's page.
Future<void> openCheckout(
  BuildContext context,
  CheckoutSession session, {
  required String title,
  required Future<void> Function(String method) mockPay,
}) async {
  if (session.isMock) {
    final method = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (sheet) => SafeArea(
        child: SingleChildScrollView(
            child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            ListTile(
              title: Text('Pay ${rupees(session.amountPaise)}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 18)),
              subtitle: Text('$title\nCashfree checkout · test mode, no real money'),
              isThreeLine: true,
            ),
            for (final (m, label, icon) in const [
              ('upi', 'UPI', Icons.account_balance),
              ('card', 'Card', Icons.credit_card),
              ('netbanking', 'Netbanking', Icons.language),
            ])
              ListTile(
                key: Key('checkout-$m'),
                leading: Icon(icon, color: Brand.blue),
                title: Text(label),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => Navigator.pop(sheet, m),
              ),
            TextButton(onPressed: () => Navigator.pop(sheet), child: const Text('Cancel')),
            const SizedBox(height: 8),
          ],
        )),
      ),
    );
    if (method != null) await mockPay(method);
    return;
  }

  final closed = Completer<void>();
  final service = CFPaymentGatewayService();
  service.setCallback((_) {
    if (!closed.isCompleted) closed.complete();
  }, (CFErrorResponse _, String __) {
    if (!closed.isCompleted) closed.complete();
  });
  final cfSession = CFSessionBuilder()
      .setEnvironment(session.environment == 'PRODUCTION' ? CFEnvironment.PRODUCTION : CFEnvironment.SANDBOX)
      .setOrderId(session.gatewayOrderId)
      .setPaymentSessionId(session.paymentSessionId)
      .build();
  service.doPayment(CFWebCheckoutPaymentBuilder().setSession(cfSession).build());
  await closed.future;
}

/// Adds money to the wallet through the checkout. Returns true once the money is in.
Future<bool> addMoneyWithCheckout(BuildContext context, EvgoApi api, int amountPaise) async {
  final messenger = ScaffoldMessenger.of(context);
  try {
    final (topUpId, session) = await api.startTopUp(amountPaise);
    if (!context.mounted) return false;
    await openCheckout(context, session, title: 'Add money to EVGO wallet', mockPay: (m) => api.mockPayTopUp(topUpId, m));
    var status = await api.checkTopUp(topUpId);
    // A bank can take a few seconds to confirm a UPI payment.
    for (var i = 0; status == 'PENDING' && i < 3; i++) {
      await Future<void>.delayed(const Duration(seconds: 2));
      status = await api.checkTopUp(topUpId);
    }
    if (status == 'SUCCEEDED') return true;
    messenger.showSnackBar(SnackBar(
      content: Text(status == 'PENDING'
          ? 'Payment not confirmed yet. If money left your account, it will show in your wallet within minutes.'
          : 'Payment did not go through. No money was taken.'),
    ));
    return false;
  } on ApiException catch (e) {
    messenger.showSnackBar(SnackBar(content: Text(e.message)));
    return false;
  }
}
