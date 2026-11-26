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
    required this.placeName,
    required this.connectors,
    required this.pricePerKwhInr,
  });

  factory ChargerSummary.fromJson(Map<String, dynamic> j) => ChargerSummary(
        id: j['id'] as String,
        operator: j['operator'] as String,
        placeName: (j['place'] as Map<String, dynamic>?)?['name'] as String? ?? '',
        connectors: (j['connectors'] as List).map((c) => ConnectorInfo.fromJson(c as Map<String, dynamic>)).toList(),
        pricePerKwhInr: (j['pricePerKwhInr'] as num?)?.toDouble(),
      );

  final String id;
  final String operator;
  final String placeName;
  final List<ConnectorInfo> connectors;
  final double? pricePerKwhInr;

  int get availableCount => connectors.where((c) => c.status == 'Available').length;
}

class ConnectorInfo {
  ConnectorInfo({required this.type, required this.powerKw, required this.status});

  factory ConnectorInfo.fromJson(Map<String, dynamic> j) => ConnectorInfo(
        type: j['type'] as String,
        powerKw: (j['powerKw'] as num).toDouble(),
        status: j['status'] as String,
      );

  final String type;
  final double powerKw;
  final String status;
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
