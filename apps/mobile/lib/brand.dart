import 'package:flutter/material.dart';

/// EVGO brand colours, sampled from the logo's gradient (see docs/brand).
class Brand {
  static const blue = Color(0xFF0474B4);
  static const teal = Color(0xFF04909C);
  static const green = Color(0xFF20A874);
  static const lime = Color(0xFF70C84C);
  static const ink = Color(0xFF0B2A3A);

  static const gradient = LinearGradient(colors: [blue, teal, green, lime], stops: [0, 0.35, 0.65, 1]);

  static ThemeData theme() {
    final scheme = ColorScheme.fromSeed(seedColor: teal).copyWith(
      primary: blue,
      secondary: green,
      tertiary: lime,
    );
    return ThemeData(
      colorScheme: scheme,
      useMaterial3: true,
      scaffoldBackgroundColor: const Color(0xFFF6FAF9),
      navigationBarTheme: NavigationBarThemeData(indicatorColor: teal.withValues(alpha: 0.18)),
    );
  }
}

/// The EVGO wordmark. With [onTap] it acts as the "go to Home" button.
class EvgoLogo extends StatelessWidget {
  const EvgoLogo({super.key, this.height = 36, this.onTap});

  final double height;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final image = Image.asset('assets/brand/evgo-logo.png', height: height, semanticLabel: 'EVGO', filterQuality: FilterQuality.medium);
    if (onTap == null) return image;
    return Tooltip(
      message: 'Home',
      child: InkWell(
        key: const Key('logo-home'),
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        child: Padding(padding: const EdgeInsets.all(4), child: image),
      ),
    );
  }
}

/// Thin brand-gradient rule used under headers.
class BrandRule extends StatelessWidget {
  const BrandRule({super.key, this.height = 3});

  final double height;

  @override
  Widget build(BuildContext context) => Container(height: height, decoration: const BoxDecoration(gradient: Brand.gradient));
}
