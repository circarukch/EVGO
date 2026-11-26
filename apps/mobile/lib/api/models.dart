String rupees(int paise) => paise % 100 == 0 ? '₹${paise ~/ 100}' : '₹${(paise / 100).toStringAsFixed(2)}';

class TripSummary {
  TripSummary({
    required this.id,
    required this.operator,
    required this.departs,
    required this.arrives,
    required this.busType,
    required this.seatsLeft,
    required this.fareInr,
    required this.chargersAtBoarding,
    this.departsAt,
  });

  factory TripSummary.fromJson(Map<String, dynamic> j) => TripSummary(
        id: j['id'] as String,
        operator: j['operator'] as String,
        departs: j['departs'] as String,
        arrives: j['arrives'] as String,
        busType: j['busType'] as String,
        seatsLeft: j['seatsLeft'] as int,
        fareInr: (j['fareInr'] as num).toInt(),
        chargersAtBoarding: j['chargersAtBoarding'] as int,
        departsAt: j['departsAt'] == null ? null : DateTime.parse(j['departsAt'] as String).toLocal(),
      );

  final String id;
  final String operator;
  final String departs;
  final String arrives;
  final String busType;
  final int seatsLeft;
  final int fareInr;
  final int chargersAtBoarding;
  final DateTime? departsAt;

  String get dateLabel {
    final d = departsAt;
    if (d == null) return '';
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return '${d.day} ${months[d.month - 1]}';
  }
}

class SeatInfo {
  SeatInfo({required this.seatLabel, required this.farePaise, required this.status});

  factory SeatInfo.fromJson(Map<String, dynamic> j) =>
      SeatInfo(seatLabel: j['seatLabel'] as String, farePaise: j['farePaise'] as int, status: j['status'] as String);

  final String seatLabel;
  final int farePaise;
  final String status;

  bool get isFree => status == 'available';
}

class Ticket {
  Ticket({required this.ticketCode, required this.seatLabel, required this.passengerName});

  factory Ticket.fromJson(Map<String, dynamic> j) => Ticket(
        ticketCode: j['ticketCode'] as String,
        seatLabel: j['seatLabel'] as String,
        passengerName: j['passengerName'] as String,
      );

  final String ticketCode;
  final String seatLabel;
  final String passengerName;
}

class BookingSummary {
  BookingSummary({
    required this.orderId,
    required this.status,
    required this.totalPaise,
    required this.route,
    required this.departs,
    required this.departsAt,
    required this.seats,
  });

  factory BookingSummary.fromJson(Map<String, dynamic> j) => BookingSummary(
        orderId: j['orderId'] as String,
        status: j['status'] as String,
        totalPaise: j['totalPaise'] as int,
        route: j['route'] as String? ?? '',
        departs: j['departs'] as String? ?? '',
        departsAt: j['departsAt'] == null ? null : DateTime.parse(j['departsAt'] as String).toLocal(),
        seats: [for (final t in j['tickets'] as List) (t as Map<String, dynamic>)['seatLabel'] as String? ?? ''],
      );

  final String orderId;
  final String status;
  final int totalPaise;
  final String route;
  final String departs;
  final DateTime? departsAt;
  final List<String> seats;
}

class WalletSummary {
  WalletSummary({required this.balancePaise, required this.history});

  factory WalletSummary.fromJson(Map<String, dynamic> j) => WalletSummary(
        balancePaise: j['balancePaise'] as int,
        history: [
          for (final h in j['history'] as List)
            WalletEntry(
              amountPaise: (h as Map<String, dynamic>)['amountPaise'] as int,
              memo: h['memo'] as String? ?? '',
            ),
        ],
      );

  final int balancePaise;
  final List<WalletEntry> history;
}

class WalletEntry {
  WalletEntry({required this.amountPaise, required this.memo});

  final int amountPaise;
  final String memo;
}

class ChargerSummary {
  ChargerSummary({
    required this.id,
    required this.operator,
    required this.place,
    required this.connectors,
    required this.pricePerKwhInr,
    this.segments = const [],
  });

  factory ChargerSummary.fromJson(Map<String, dynamic> j) => ChargerSummary(
        id: j['id'] as String,
        operator: j['operator'] as String,
        place: PlaceInfo.fromJson((j['place'] as Map<String, dynamic>?) ?? const {}),
        connectors: (j['connectors'] as List).map((c) => ConnectorInfo.fromJson(c as Map<String, dynamic>)).toList(),
        pricePerKwhInr: (j['pricePerKwhInr'] as num?)?.toDouble(),
        segments: [for (final s in (j['segments'] as List?) ?? const []) s as String],
      );

  final String id;
  final String operator;
  final PlaceInfo place;
  final List<ConnectorInfo> connectors;
  final double? pricePerKwhInr;
  final List<String> segments;

  String get placeName => place.name;

  /// The same charger showing only some of its plugs (used by the filters).
  ChargerSummary withConnectors(List<ConnectorInfo> only) =>
      ChargerSummary(id: id, operator: operator, place: place, connectors: only, pricePerKwhInr: pricePerKwhInr, segments: segments);

  int get availableCount => connectors.where((c) => c.isAvailable).length;
}

class PlaceInfo {
  PlaceInfo({required this.id, required this.name, required this.city, this.lat, this.lng});

  factory PlaceInfo.fromJson(Map<String, dynamic> j) => PlaceInfo(
        id: j['id'] as String? ?? j['name'] as String? ?? '',
        name: j['name'] as String? ?? '',
        city: j['city'] as String? ?? '',
        lat: (j['lat'] as num?)?.toDouble(),
        lng: (j['lng'] as num?)?.toDouble(),
      );

  final String id;
  final String name;
  final String city;
  final double? lat;
  final double? lng;
}

class ConnectorInfo {
  ConnectorInfo({required this.type, required this.powerKw, required this.status, this.id = 1});

  factory ConnectorInfo.fromJson(Map<String, dynamic> j) => ConnectorInfo(
        id: (j['id'] as num?)?.toInt() ?? 1,
        type: j['type'] as String,
        powerKw: (j['powerKw'] as num).toDouble(),
        status: j['status'] as String,
      );

  final int id;
  final String type;
  final double powerKw;
  final String status;

  bool get isAvailable => status == 'Available';
  bool get isOutOfService => status == 'Faulted' || status == 'Unavailable';

  /// DC (fast) or AC, from the plug: CCS2, GB/T, Bharat DC-001, LECCS and CHAdeMO are DC; Type 2 and LEV AC are AC.
  bool get isDc => isDcPlug(type);
  String get current => isDc ? 'DC' : 'AC';
}

bool isDcPlug(String type) {
  final t = type.toUpperCase().replaceAll(RegExp(r'[^A-Z0-9]'), '');
  return t.contains('DC') || const {'CCS1', 'CCS2', 'GBT', 'LECCS', 'CHADEMO'}.contains(t);
}

/// "60 kW", "3.3 kW".
String kwLabel(double kw) => '${kw.toStringAsFixed(kw % 1 == 0 ? 0 : 1)} kW';

/// Chargers grouped by the place they stand at: one pin on the map.
class Station {
  Station(this.place, this.chargers);

  final PlaceInfo place;
  final List<ChargerSummary> chargers;

  List<ConnectorInfo> get connectors => [for (final c in chargers) ...c.connectors];
  int get available => connectors.where((c) => c.isAvailable).length;
  bool get allOutOfService => connectors.every((c) => c.isOutOfService);
  double get maxPowerKw => connectors.fold(0, (m, c) => c.powerKw > m ? c.powerKw : m);
  bool get hasDc => connectors.any((c) => c.isDc);
  bool get hasAc => connectors.any((c) => !c.isDc);

  /// Short power line for pins: "120 kW DC", "22 kW AC", or "60 kW AC/DC".
  String get powerLabel => '${kwLabel(maxPowerKw)} ${hasDc && hasAc ? 'AC/DC' : hasDc ? 'DC' : 'AC'}';

  /// "DC up to 60 kW · AC up to 22 kW".
  String get powerSummary {
    double top(bool dc) => connectors.where((c) => c.isDc == dc).fold(0, (m, c) => c.powerKw > m ? c.powerKw : m);
    return [if (hasDc) 'DC up to ${kwLabel(top(true))}', if (hasAc) 'AC up to ${kwLabel(top(false))}'].join(' · ');
  }

  double? get fromPricePerKwh {
    final prices = [
      for (final c in chargers)
        if (c.pricePerKwhInr != null) c.pricePerKwhInr!
    ];
    return prices.isEmpty ? null : prices.reduce((a, b) => a < b ? a : b);
  }

  static List<Station> group(List<ChargerSummary> chargers) {
    final byPlace = <String, List<ChargerSummary>>{};
    for (final c in chargers) {
      byPlace.putIfAbsent(c.place.id, () => []).add(c);
    }
    return [for (final list in byPlace.values) Station(list.first.place, list)];
  }
}

/// A charging session as the app shows it, live or finished.
class ChargingSessionView {
  ChargingSessionView({
    required this.id,
    required this.status,
    required this.chargePointId,
    required this.connectorId,
    required this.placeName,
    required this.connectorType,
    required this.perKwhInr,
    required this.startedAt,
    required this.energyKwh,
    required this.powerKw,
    required this.costPaise,
    this.stopReason,
    this.balancePaise,
  });

  factory ChargingSessionView.fromJson(Map<String, dynamic> j) => ChargingSessionView(
        id: j['id'] as String,
        status: j['status'] as String,
        chargePointId: j['chargePointId'] as String,
        connectorId: (j['connectorId'] as num).toInt(),
        placeName: j['placeName'] as String? ?? '',
        connectorType: j['connectorType'] as String? ?? '',
        perKwhInr: (j['perKwhInr'] as num).toDouble(),
        startedAt: DateTime.parse(j['startedAt'] as String),
        energyKwh: (j['energyKwh'] as num).toDouble(),
        powerKw: (j['powerKw'] as num?)?.toDouble() ?? 0,
        costPaise: (j['costPaise'] as num).toInt(),
        stopReason: j['stopReason'] as String?,
        balancePaise: (j['balancePaise'] as num?)?.toInt(),
      );

  final String id;
  final String status;
  final String chargePointId;
  final int connectorId;
  final String placeName;
  final String connectorType;
  final double perKwhInr;
  final DateTime startedAt;
  final double energyKwh;
  final double powerKw;
  final int costPaise;
  final String? stopReason;
  final int? balancePaise;

  bool get isActive => status == 'ACTIVE';
}

class RefundTier {
  RefundTier({required this.minHoursBefore, required this.refundPercent});

  factory RefundTier.fromJson(Map<String, dynamic> j) =>
      RefundTier(minHoursBefore: (j['minHoursBefore'] as num).toDouble(), refundPercent: j['refundPercent'] as int);

  final double minHoursBefore;
  final int refundPercent;
}

class SeatMap {
  SeatMap({required this.seats, required this.refundTiers});

  final List<SeatInfo> seats;
  final List<RefundTier> refundTiers;

  /// "Cancel 24h+ before: 90% back · 6h+: 50% back · closes 6h before"
  String get refundSummary {
    if (refundTiers.isEmpty) return '';
    String h(double v) => v == v.roundToDouble() ? '${v.toInt()}h' : '${v}h';
    final parts = [for (final t in refundTiers) '${h(t.minHoursBefore)}+ before: ${t.refundPercent}% back'];
    return 'Cancel ${parts.join(' · ')}. Closes ${h(refundTiers.last.minHoursBefore)} before departure.';
  }
}
