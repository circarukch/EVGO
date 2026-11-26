import 'package:flutter/material.dart';

import '../api/evgo_api.dart';
import '../brand.dart';
import 'activity_screen.dart';

/// Account menu: who is logged in, their recent activity, and log out.
Future<void> showAccountSheet(BuildContext context, EvgoApi api) {
  return showModalBottomSheet<void>(
    context: context,
    showDragHandle: true,
    builder: (sheetContext) => SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          ListTile(
            leading: const CircleAvatar(backgroundColor: Brand.blue, foregroundColor: Colors.white, child: Icon(Icons.person)),
            title: const Text('Logged in as'),
            subtitle: Text(api.phone ?? 'Your mobile number'),
          ),
          const Divider(),
          ListTile(
            key: const Key('account-activity'),
            leading: const Icon(Icons.history, color: Brand.blue),
            title: const Text('Recent activity'),
            subtitle: const Text('Bus tickets, charging and wallet, newest first'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () {
              Navigator.pop(sheetContext);
              Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => ActivityScreen(api: api)));
            },
          ),
          ListTile(
            leading: const Icon(Icons.logout, color: Colors.red),
            title: const Text('Log out', style: TextStyle(color: Colors.red)),
            subtitle: const Text('You can log back in any time with your mobile number'),
            onTap: () async {
              final yes = await showDialog<bool>(
                context: sheetContext,
                builder: (d) => AlertDialog(
                  title: const Text('Log out of EVGO?'),
                  content: const Text('Your tickets and wallet stay safe. Log in again with your mobile number and a new code.'),
                  actions: [
                    TextButton(onPressed: () => Navigator.pop(d, false), child: const Text('Stay logged in')),
                    FilledButton(onPressed: () => Navigator.pop(d, true), child: const Text('Log out')),
                  ],
                ),
              );
              if (yes != true || !sheetContext.mounted) return;
              Navigator.pop(sheetContext);
              api.logOut();
            },
          ),
          const SizedBox(height: 8),
        ],
      ),
    ),
  );
}
