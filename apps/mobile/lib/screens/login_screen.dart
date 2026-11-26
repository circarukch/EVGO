import 'package:flutter/material.dart';

import '../api/evgo_api.dart';
import '../brand.dart';

/// Phone number and one-time code. One login for bus tickets and charging.
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, required this.api, required this.onLoggedIn});

  final EvgoApi api;
  final VoidCallback onLoggedIn;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _phone = TextEditingController();
  final _code = TextEditingController();
  bool _codeSent = false;
  bool _busy = false;
  String? _error;
  String? _devCode;

  @override
  void dispose() {
    _phone.dispose();
    _code.dispose();
    super.dispose();
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } catch (_) {
      setState(() => _error = 'Could not reach EVGO. Check your connection.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _sendCode() => _run(() async {
        final dev = await widget.api.requestOtp(_phone.text.trim());
        setState(() {
          _codeSent = true;
          _devCode = dev;
        });
      });

  Future<void> _verify() => _run(() async {
        await widget.api.verifyOtp(_phone.text.trim(), _code.text.trim());
        widget.onLoggedIn();
      });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(24),
          children: [
            const SizedBox(height: 48),
            const Align(alignment: Alignment.centerLeft, child: EvgoLogo(height: 56)),
            const SizedBox(height: 8),
            const Text('Electric buses and EV charging, one app.'),
            const SizedBox(height: 32),
            TextField(
              controller: _phone,
              enabled: !_codeSent,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(labelText: 'Mobile number', prefixText: '+91 '),
            ),
            if (_codeSent) ...[
              const SizedBox(height: 12),
              TextField(
                controller: _code,
                keyboardType: TextInputType.number,
                maxLength: 6,
                decoration: InputDecoration(
                  labelText: '6-digit code',
                  helperText: _devCode == null ? null : 'Test server code: $_devCode',
                ),
              ),
            ],
            if (_error != null) Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
            ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: _busy ? null : (_codeSent ? _verify : _sendCode),
              child: Text(_codeSent ? 'Log in' : 'Send code'),
            ),
            if (_codeSent)
              TextButton(
                onPressed: _busy ? null : () => setState(() => _codeSent = false),
                child: const Text('Change number'),
              ),
          ],
        ),
      ),
    );
  }
}
