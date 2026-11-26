/** OpenStreetMap view of a spot, so the operator can see the pin is in the right place. */
export function MapPreview({ lat, lng, height = 220 }: { lat: number; lng: number; height?: number }) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) {
    return <div className="map empty" style={{ height }}>The map appears once there is a location.</div>;
  }
  const d = 0.006;
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${lng - d},${lat - d},${lng + d},${lat + d}&layer=mapnik&marker=${lat},${lng}`;
  return (
    <div className="map" style={{ height }}>
      <iframe title="Station location" src={src} loading="lazy" />
      <a className="hint" href={`https://www.google.com/maps?q=${lat},${lng}`} target="_blank" rel="noreferrer">
        Open in Google Maps
      </a>
    </div>
  );
}
