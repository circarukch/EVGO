import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart' hide Path;

import '../api/models.dart';
import '../brand.dart';

/// OpenStreetMap tiles. Off in tests and in the hosted demo (which cannot load outside images);
/// then the map draws only the corridor and the pins.
bool mapTilesEnabled = const bool.fromEnvironment('MAP_TILES', defaultValue: true);

/// Pin colour: green = a plug free now, amber = all busy, grey = out of service.
Color stationColor(Station s) => s.available > 0
    ? Brand.green
    : s.allOutOfService
        ? Colors.grey
        : const Color(0xFFE8A317);

/// Rough highway line Guntur – Vijayawada – Suryapet – Hyderabad, drawn when tiles are off.
const _corridor = [
  LatLng(16.3067, 80.4365),
  LatLng(16.4985, 80.6563),
  LatLng(16.75, 80.2),
  LatLng(17.1405, 79.6231),
  LatLng(17.3457, 78.5522),
];

class StationMap extends StatelessWidget {
  const StationMap({super.key, required this.stations, required this.onTap});

  final List<Station> stations;
  final void Function(Station) onTap;

  @override
  Widget build(BuildContext context) {
    final points = [
      for (final s in stations)
        if (s.place.lat != null && s.place.lng != null) LatLng(s.place.lat!, s.place.lng!)
    ];
    final fit = points.length >= 2
        ? CameraFit.coordinates(coordinates: points, padding: const EdgeInsets.fromLTRB(40, 40, 40, 100), maxZoom: 13)
        : null;
    return FlutterMap(
      key: ValueKey(points.length),
      options: MapOptions(
        initialCenter: points.isEmpty ? const LatLng(16.8, 79.6) : points.first,
        initialZoom: 8,
        initialCameraFit: fit,
        backgroundColor: const Color(0xFFE9F2EE),
        interactionOptions: const InteractionOptions(flags: InteractiveFlag.all & ~InteractiveFlag.rotate),
      ),
      children: [
        if (mapTilesEnabled)
          TileLayer(urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', userAgentPackageName: 'in.evgo.app')
        else
          PolylineLayer(polylines: [
            Polyline(points: _corridor, strokeWidth: 5, color: Colors.white),
            Polyline(points: _corridor, strokeWidth: 2, color: const Color(0xFFB8CCC4))
          ]),
        Builder(builder: (context) {
          final camera = MapCamera.of(context);
          final placed = [
            for (final s in stations)
              if (s.place.lat != null && s.place.lng != null) (s, LatLng(s.place.lat!, s.place.lng!))
          ];
          final showLabel = _labelsThatFit([for (final p in placed) camera.latLngToScreenOffset(p.$2)]);
          return MarkerLayer(
            markers: [
              for (var i = 0; i < placed.length; i++)
                Marker(
                  point: placed[i].$2,
                  width: 84,
                  height: 66,
                  alignment: Alignment.topCenter,
                  child: _Pin(station: placed[i].$1, showLabel: showLabel[i], onTap: () => onTap(placed[i].$1)),
                ),
            ],
          );
        }),
        if (mapTilesEnabled) const RichAttributionWidget(attributions: [TextSourceAttribution('OpenStreetMap contributors')]),
      ],
    );
  }
}

/// Which pins can show their power label without covering another pin or label.
/// Stations come busiest-first, so the most useful ones keep their label; zooming in shows the rest.
List<bool> _labelsThatFit(List<Offset> points) {
  Rect circle(Offset p) => Rect.fromLTWH(p.dx - 20, p.dy - 66, 40, 47);
  Rect label(Offset p) => Rect.fromLTWH(p.dx - 40, p.dy - 19, 80, 19);
  final taken = <Rect>[];
  return [
    for (var i = 0; i < points.length; i++)
      () {
        final r = label(points[i]);
        final hit = taken.any(r.overlaps) ||
            [
              for (var j = 0; j < points.length; j++)
                if (j != i) circle(points[j])
            ].any(r.overlaps);
        if (!hit) taken.add(r);
        return !hit;
      }(),
  ];
}

class _Pin extends StatelessWidget {
  const _Pin({required this.station, required this.onTap, this.showLabel = true});

  final Station station;
  final bool showLabel;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final color = stationColor(station);
    return GestureDetector(
      key: Key('pin-${station.place.id}'),
      onTap: onTap,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Tooltip(
            message:
                '${station.place.name}: ${station.allOutOfService ? 'offline' : '${station.available} of ${station.connectors.length} free'} · ${station.powerSummary}',
            child: Container(
              width: 40,
              height: 40,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: color,
                shape: BoxShape.circle,
                border: Border.all(color: Colors.white, width: 2.5),
                boxShadow: const [BoxShadow(color: Colors.black26, blurRadius: 4, offset: Offset(0, 2))],
              ),
              child: station.allOutOfService
                  ? const Icon(Icons.power_off, size: 18, color: Colors.white)
                  : Text('${station.available}', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 15)),
            ),
          ),
          CustomPaint(size: const Size(12, 7), painter: _Tail(color)),
          if (showLabel)
            Container(
              margin: const EdgeInsets.only(top: 2),
              padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(6),
                boxShadow: const [BoxShadow(color: Colors.black12, blurRadius: 2)],
              ),
              child: Text(station.powerLabel,
                  maxLines: 1, style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: Color(0xFF1F2A30))),
            ),
        ],
      ),
    );
  }
}

class _Tail extends CustomPainter {
  _Tail(this.color);
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final path = Path()
      ..moveTo(0, 0)
      ..lineTo(size.width, 0)
      ..lineTo(size.width / 2, size.height)
      ..close();
    canvas.drawPath(path, Paint()..color = color);
  }

  @override
  bool shouldRepaint(_Tail old) => old.color != color;
}
