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
  });

  factory TripSummary.fromJson(Map<String, dynamic> j) => TripSummary(
        id: j['id'] as String,
        operator: j['operator'] as String,
        departs: j['departs'] as String,
        arrives: j['arrives'] as String,
        busType: j['busType'] as String,
        seatsLeft: j['seatsLeft'] as int,
        fareInr: j['fareInr'] as int,
        chargersAtBoarding: j['chargersAtBoarding'] as int,
      );

  final String id;
  final String operator;
  final String departs;
  final String arrives;
  final String busType;
  final int seatsLeft;
  final int fareInr;
  final int chargersAtBoarding;
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
        connectors: (j['connectors'] as List)
            .map((c) => ConnectorInfo.fromJson(c as Map<String, dynamic>))
            .toList(),
        pricePerKwhInr: (j['pricePerKwhInr'] as num).toDouble(),
      );

  final String id;
  final String operator;
  final String placeName;
  final List<ConnectorInfo> connectors;
  final double pricePerKwhInr;

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
