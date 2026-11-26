import 'package:flutter/material.dart';

import '../brand.dart';

/// The white filter strip used on Charge and Want a charger?: equal [FilterTile]s in a row.
class FilterBar extends StatelessWidget {
  const FilterBar({super.key, required this.child});

  /// A Row of [FilterTile]s.
  final Widget child;

  @override
  Widget build(BuildContext context) => Container(
        margin: const EdgeInsets.fromLTRB(12, 10, 12, 8),
        padding: const EdgeInsets.all(6),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          boxShadow: const [BoxShadow(color: Color(0x14000000), blurRadius: 10, offset: Offset(0, 2))],
        ),
        child: child,
      );
}

/// One of the equal filters in a [FilterBar]: small caption, current value, opens a menu.
/// Brand blue when it narrows the results.
class FilterTile<T> extends StatelessWidget {
  const FilterTile({
    super.key,
    required this.icon,
    required this.caption,
    required this.value,
    required this.active,
    required this.onSelected,
    required this.items,
  });

  final IconData icon;
  final String caption;
  final String value;
  final bool active;
  final void Function(T) onSelected;
  final List<PopupMenuEntry<T>> items;

  @override
  Widget build(BuildContext context) {
    final fg = active ? Colors.white : const Color(0xFF1F2A30);
    return Expanded(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 3),
        child: PopupMenuButton<T>(
          tooltip: caption,
          onSelected: onSelected,
          itemBuilder: (_) => items,
          position: PopupMenuPosition.under,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 150),
            height: 54,
            padding: const EdgeInsets.symmetric(horizontal: 8),
            decoration: BoxDecoration(
              color: active ? Brand.blue : const Color(0xFFF1F6F4),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(children: [
                  Icon(icon, size: 14, color: active ? Colors.white70 : Brand.green),
                  const SizedBox(width: 4),
                  Expanded(
                    child: Text(caption,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(fontSize: 11, color: active ? Colors.white70 : Colors.black54)),
                  ),
                ]),
                const SizedBox(height: 2),
                Row(children: [
                  Expanded(
                    child: FittedBox(
                      fit: BoxFit.scaleDown,
                      alignment: Alignment.centerLeft,
                      child: Text(value, maxLines: 1, style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: fg)),
                    ),
                  ),
                  Icon(Icons.expand_more, size: 16, color: fg),
                ]),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
