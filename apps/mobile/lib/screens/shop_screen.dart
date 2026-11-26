import 'package:flutter/material.dart';

import '../api/evgo_api.dart';
import '../api/models.dart';
import '../brand.dart';

/// A power band the customer can filter by. Null bounds are open.
class _Band {
  const _Band(this.key, this.label, this.minKw, this.maxKw);
  final String key;
  final String label;
  final double? minKw;
  final double? maxKw;
}

const _bands = [
  _Band('any', 'Any power', null, null),
  _Band('home', 'Up to 7.4 kW', null, 7.4),
  _Band('mid', '11 to 30 kW', 11, 30),
  _Band('fast', '60 to 120 kW', 60, 120),
  _Band('ultra', '180 kW and above', 180, null),
];

/// "Need a charger?": AC and DC chargers for sale. Enquiry only: customers ask for a quote and the team calls back.
class ShopScreen extends StatefulWidget {
  const ShopScreen({super.key, required this.api});

  final EvgoApi api;

  @override
  State<ShopScreen> createState() => _ShopScreenState();
}

class _ShopScreenState extends State<ShopScreen> {
  String? _current; // null = AC and DC
  _Band _band = _bands.first;
  late Future<List<ChargerProduct>> _products = _load();
  late Future<List<ChargerLead>> _quotes = widget.api.myChargerQuotes();

  Future<List<ChargerProduct>> _load() => widget.api.shopChargers(current: _current, minKw: _band.minKw, maxKw: _band.maxKw);

  void _filter({String? current, bool setCurrent = false, _Band? band}) {
    setState(() {
      if (setCurrent) _current = current;
      if (band != null) _band = band;
      _products = _load();
    });
  }

  Future<void> _openQuote([ChargerProduct? p]) async {
    final sent = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => QuoteRequestScreen(api: widget.api, product: p)));
    if (sent == true && mounted) {
      setState(() {
        _quotes = widget.api.myChargerQuotes();
      });
    }
  }

  Future<void> _open(ChargerProduct p) async {
    await Navigator.of(context)
        .push<void>(MaterialPageRoute(builder: (_) => ChargerProductScreen(api: widget.api, product: p, onQuote: () => _openQuote(p))));
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(title: const Text('Need a charger?')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
        children: [
          Text('Buy an AC or DC charger for your home, building, business or fleet. Ask for a quote and our team will call you back.',
              style: text.bodyMedium?.copyWith(color: Colors.black54)),
          const SizedBox(height: 12),
          SegmentedButton<String>(
            key: const Key('shop-current'),
            segments: const [
              ButtonSegment(value: 'ALL', label: Text('All')),
              ButtonSegment(value: 'AC', label: Text('AC'), icon: Icon(Icons.home_outlined)),
              ButtonSegment(value: 'DC', label: Text('DC fast'), icon: Icon(Icons.bolt)),
            ],
            selected: {_current ?? 'ALL'},
            onSelectionChanged: (s) => _filter(current: s.first == 'ALL' ? null : s.first, setCurrent: true),
          ),
          const SizedBox(height: 8),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                for (final b in _bands)
                  Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: ChoiceChip(
                      key: Key('shop-kw-${b.key}'),
                      label: Text(b.label),
                      selected: _band.key == b.key,
                      onSelected: (_) => _filter(band: b),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 8),
          FutureBuilder<List<ChargerProduct>>(
            future: _products,
            builder: (context, snap) {
              if (snap.connectionState != ConnectionState.done) return const LinearProgressIndicator();
              if (snap.hasError) return Text('Could not load chargers: ${snap.error}');
              final list = snap.data!;
              if (list.isEmpty) {
                return const Card(child: ListTile(leading: Icon(Icons.search_off), title: Text('No chargers match these filters')));
              }
              return Column(children: [for (final p in list) _ProductCard(product: p, onTap: () => _open(p))]);
            },
          ),
          const SizedBox(height: 8),
          Card(
            color: Brand.teal.withValues(alpha: 0.08),
            child: ListTile(
              key: const Key('shop-help'),
              leading: const Icon(Icons.support_agent, color: Brand.teal),
              title: const Text('Not sure which one you need?'),
              subtitle: const Text('Tell us about your site and we will suggest the right charger.'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => _openQuote(),
            ),
          ),
          FutureBuilder<List<ChargerLead>>(
            future: _quotes,
            builder: (context, snap) {
              final list = snap.data ?? const [];
              if (list.isEmpty) return const SizedBox.shrink();
              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const SizedBox(height: 16),
                  Text('Your quote requests', style: text.titleMedium),
                  const SizedBox(height: 4),
                  for (final q in list)
                    Card(
                      child: ListTile(
                        key: Key('my-quote-${q.id}'),
                        leading: const Icon(Icons.request_quote_outlined),
                        title: Text(q.productName ?? 'Help choosing a charger'),
                        subtitle: Text('${q.siteType} · ${q.city}${q.quantity > 1 ? ' · ${q.quantity} units' : ''}'),
                        trailing: Chip(label: Text(q.statusLabel), visualDensity: VisualDensity.compact),
                      ),
                    ),
                ],
              );
            },
          ),
        ],
      ),
    );
  }
}

class _CurrentBadge extends StatelessWidget {
  const _CurrentBadge({required this.dc});
  final bool dc;

  @override
  Widget build(BuildContext context) {
    final c = dc ? Brand.blue : Brand.green;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(color: c.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(8)),
      child: Text(dc ? 'DC fast' : 'AC', style: TextStyle(color: c, fontWeight: FontWeight.w700, fontSize: 12)),
    );
  }
}

class _SampleBadge extends StatelessWidget {
  const _SampleBadge();

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
        decoration: BoxDecoration(color: Colors.orange.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(8)),
        child: const Text('Sample', style: TextStyle(color: Color(0xFFB45309), fontWeight: FontWeight.w700, fontSize: 12)),
      );
}

class _ProductCard extends StatelessWidget {
  const _ProductCard({required this.product, required this.onTap});
  final ChargerProduct product;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final p = product;
    final text = Theme.of(context).textTheme;
    return Card(
      child: InkWell(
        key: Key('shop-product-${p.id}'),
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            children: [
              Container(
                width: 64,
                height: 64,
                decoration: BoxDecoration(
                  gradient: LinearGradient(colors: p.isDc ? const [Brand.blue, Brand.teal] : const [Brand.green, Brand.lime]),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(p.isDc ? Icons.ev_station : Icons.electrical_services, color: Colors.white),
                    Text(p.powerLabel, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 12)),
                  ],
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Wrap(spacing: 6, runSpacing: 4, children: [_CurrentBadge(dc: p.isDc), if (p.isSample) const _SampleBadge()]),
                    const SizedBox(height: 4),
                    Text(p.name, style: text.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
                    Text(p.connectors.join(' + '), style: text.bodySmall?.copyWith(color: Colors.black54)),
                    const SizedBox(height: 4),
                    Text(p.priceLabel, style: text.titleSmall?.copyWith(color: Brand.ink, fontWeight: FontWeight.w700)),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right),
            ],
          ),
        ),
      ),
    );
  }
}

/// One charger: what it is, specs, warranty and installation, and "Request a quote".
class ChargerProductScreen extends StatelessWidget {
  const ChargerProductScreen({super.key, required this.api, required this.product, required this.onQuote});

  final EvgoApi api;
  final ChargerProduct product;
  final VoidCallback onQuote;

  @override
  Widget build(BuildContext context) {
    final p = product;
    final text = Theme.of(context).textTheme;
    Widget row(String k, String v) => Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(width: 130, child: Text(k, style: text.bodyMedium?.copyWith(color: Colors.black54))),
              Expanded(child: Text(v, style: text.bodyMedium?.copyWith(fontWeight: FontWeight.w600))),
            ],
          ),
        );
    return Scaffold(
      appBar: AppBar(title: Text(p.name)),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
          child: FilledButton.icon(
            key: const Key('shop-request-quote'),
            onPressed: onQuote,
            icon: const Icon(Icons.request_quote_outlined),
            label: const Text('Request a quote'),
            style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
          ),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              gradient: LinearGradient(colors: p.isDc ? const [Brand.blue, Brand.teal] : const [Brand.green, Brand.lime]),
              borderRadius: BorderRadius.circular(20),
            ),
            child: Row(
              children: [
                Icon(p.isDc ? Icons.ev_station : Icons.electrical_services, color: Colors.white, size: 48),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('${p.powerLabel} ${p.isDc ? 'DC' : 'AC'}',
                          style: text.headlineSmall?.copyWith(color: Colors.white, fontWeight: FontWeight.w800)),
                      Text(p.brand, style: text.bodyMedium?.copyWith(color: Colors.white70)),
                    ],
                  ),
                ),
              ],
            ),
          ),
          if (p.isSample) ...[
            const SizedBox(height: 12),
            Card(
              color: Colors.orange.withValues(alpha: 0.1),
              child: const ListTile(
                key: Key('shop-sample-note'),
                leading: Icon(Icons.info_outline, color: Color(0xFFB45309)),
                title: Text('Sample listing'),
                subtitle: Text('Name, price and specs are placeholders. Ask for a quote for real models and prices.'),
              ),
            ),
          ],
          const SizedBox(height: 12),
          Text(p.priceLabel,
              key: const Key('shop-price'), style: text.headlineSmall?.copyWith(fontWeight: FontWeight.w800, color: Brand.ink)),
          if (p.priceInr != null)
            Text('Indicative price incl. GST. Final price in your quote.', style: text.bodySmall?.copyWith(color: Colors.black54)),
          const SizedBox(height: 8),
          Text(p.summary, style: text.bodyLarge),
          const SizedBox(height: 8),
          Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [for (final s in p.suitedFor) Chip(label: Text(s), visualDensity: VisualDensity.compact)]),
          const SizedBox(height: 8),
          Card(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Column(
                children: [
                  row('Power', '${p.powerLabel} ${p.isDc ? 'DC' : 'AC'}'),
                  row('Connectors', p.connectors.join(', ')),
                  row('Warranty', p.warrantyYears == 0 ? 'Ask us' : '${p.warrantyYears} year${p.warrantyYears == 1 ? '' : 's'}'),
                  row('Installation', p.installationIncluded ? 'Included (standard install)' : 'Site survey and quote'),
                ],
              ),
            ),
          ),
          if (p.specs.isNotEmpty) ...[
            const SizedBox(height: 12),
            Text('Specifications', style: text.titleMedium),
            Card(
              key: const Key('shop-specs'),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                child: Column(children: [for (final e in p.specs.entries) row(e.key, e.value)]),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// The enquiry form. Pops with true once sent.
class QuoteRequestScreen extends StatefulWidget {
  const QuoteRequestScreen({super.key, required this.api, this.product});

  final EvgoApi api;

  /// Null for "help me choose".
  final ChargerProduct? product;

  @override
  State<QuoteRequestScreen> createState() => _QuoteRequestScreenState();
}

class _QuoteRequestScreenState extends State<QuoteRequestScreen> {
  final _form = GlobalKey<FormState>();
  final _name = TextEditingController();
  late final _phone = TextEditingController(text: (widget.api.phone ?? '').replaceFirst(RegExp(r'^\+91'), ''));
  final _city = TextEditingController();
  final _notes = TextEditingController();
  String? _site;
  int _qty = 1;
  bool _sending = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final suited = widget.product?.suitedFor ?? const [];
    _site = suited.firstWhere(chargerSiteTypes.contains, orElse: () => '');
    if (_site!.isEmpty) _site = null;
  }

  @override
  void dispose() {
    for (final c in [_name, _phone, _city, _notes]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _send() async {
    if (!_form.currentState!.validate()) return;
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      await widget.api.requestChargerQuote(
        productId: widget.product?.id,
        name: _name.text.trim(),
        phone: _phone.text.trim(),
        city: _city.text.trim(),
        siteType: _site!,
        quantity: _qty,
        notes: _notes.text.trim(),
      );
      if (!mounted) return;
      setState(() => _sending = false);
      await showDialog<void>(
        barrierDismissible: false,
        context: context,
        builder: (ctx) => AlertDialog(
          key: const Key('quote-sent'),
          icon: const Icon(Icons.check_circle, color: Brand.green, size: 48),
          title: const Text('Quote request sent'),
          content: Text('Thanks ${_name.text.trim()}. Our team will call you on ${_phone.text.trim()} within one working day.'),
          actions: [FilledButton(key: const Key('quote-sent-ok'), onPressed: () => Navigator.of(ctx).pop(), child: const Text('OK'))],
        ),
      );
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      setState(() {
        _error = e.message;
        _sending = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = widget.product;
    final text = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(title: const Text('Request a quote')),
      body: Form(
        key: _form,
        // A Column, not a lazy ListView, so every field is built and checked on Send.
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Card(
                child: ListTile(
                  leading:
                      Icon(p == null ? Icons.support_agent : (p.isDc ? Icons.ev_station : Icons.electrical_services), color: Brand.teal),
                  title: Text(p?.name ?? 'Help me choose a charger'),
                  subtitle:
                      Text(p == null ? 'We will suggest the right AC or DC charger' : '${p.powerLabel} ${p.current} · ${p.priceLabel}'),
                ),
              ),
              const SizedBox(height: 12),
              TextFormField(
                key: const Key('quote-name'),
                controller: _name,
                decoration: const InputDecoration(labelText: 'Your name', border: OutlineInputBorder()),
                textCapitalization: TextCapitalization.words,
                validator: (v) => (v ?? '').trim().length < 2 ? 'Enter your name' : null,
              ),
              const SizedBox(height: 12),
              TextFormField(
                key: const Key('quote-phone'),
                controller: _phone,
                decoration: const InputDecoration(labelText: 'Mobile number', prefixText: '+91 ', border: OutlineInputBorder()),
                keyboardType: TextInputType.phone,
                validator: (v) =>
                    RegExp(r'^[6-9]\d{9}$').hasMatch((v ?? '').replaceAll(RegExp(r'[\s-]'), '')) ? null : 'Enter a 10-digit mobile number',
              ),
              const SizedBox(height: 12),
              TextFormField(
                key: const Key('quote-city'),
                controller: _city,
                decoration: const InputDecoration(labelText: 'City or town', border: OutlineInputBorder()),
                textCapitalization: TextCapitalization.words,
                validator: (v) => (v ?? '').trim().length < 2 ? 'Enter your city or town' : null,
              ),
              const SizedBox(height: 16),
              Text('Where will it go?', style: text.titleSmall),
              const SizedBox(height: 6),
              FormField<String>(
                initialValue: _site,
                validator: (_) => _site == null ? 'Pick a site type' : null,
                builder: (field) => Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Wrap(
                      spacing: 8,
                      runSpacing: 4,
                      children: [
                        for (final s in chargerSiteTypes)
                          ChoiceChip(
                            key: Key('quote-site-$s'),
                            label: Text(s),
                            selected: _site == s,
                            onSelected: (_) {
                              setState(() => _site = s);
                              field.didChange(s);
                            },
                          ),
                      ],
                    ),
                    if (field.hasError)
                      Padding(
                          padding: const EdgeInsets.only(top: 4),
                          child: Text(field.errorText!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              Row(
                children: [
                  Expanded(child: Text('How many chargers?', style: text.titleSmall)),
                  IconButton.outlined(
                      key: const Key('quote-qty-minus'),
                      onPressed: _qty > 1 ? () => setState(() => _qty--) : null,
                      icon: const Icon(Icons.remove)),
                  SizedBox(
                      width: 40, child: Text('$_qty', key: const Key('quote-qty'), textAlign: TextAlign.center, style: text.titleMedium)),
                  IconButton.outlined(
                      key: const Key('quote-qty-plus'),
                      onPressed: _qty < 500 ? () => setState(() => _qty++) : null,
                      icon: const Icon(Icons.add)),
                ],
              ),
              const SizedBox(height: 12),
              TextFormField(
                key: const Key('quote-notes'),
                controller: _notes,
                decoration: const InputDecoration(
                    labelText: 'Anything else? (optional)',
                    hintText: 'Parking spots, power supply, vehicles…',
                    border: OutlineInputBorder()),
                maxLines: 3,
              ),
              if (_error != null)
                Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
              const SizedBox(height: 16),
              FilledButton(
                key: const Key('quote-send'),
                onPressed: _sending ? null : _send,
                style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
                child: _sending
                    ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Text('Send quote request'),
              ),
              const SizedBox(height: 8),
              Text('No payment now. We will confirm the model, price and installation on the call.',
                  textAlign: TextAlign.center, style: text.bodySmall?.copyWith(color: Colors.black54)),
            ],
          ),
        ),
      ),
    );
  }
}
