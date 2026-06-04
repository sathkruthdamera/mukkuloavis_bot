// Avis pickup locations in/around the Dallas–Fort Worth region. The monitor
// filters this list to your configured radius (default 150 mi from Dallas).
// `query` is what we type into Avis's location search; `code` is the airport/IATA
// or a short slug used for display + dedupe.
export const LOCATIONS = [
  { code: 'DFW', name: 'Dallas/Fort Worth Intl Airport', query: 'DFW Airport', lat: 32.8998, lon: -97.0403 },
  { code: 'DAL', name: 'Dallas Love Field Airport',       query: 'Dallas Love Field', lat: 32.8471, lon: -96.8518 },
  { code: 'IRV', name: 'Irving, TX',                       query: 'Irving, TX',        lat: 32.8140, lon: -96.9489 },
  { code: 'PLA', name: 'Plano, TX',                        query: 'Plano, TX',         lat: 33.0198, lon: -96.6989 },
  { code: 'ARL', name: 'Arlington, TX',                    query: 'Arlington, TX',     lat: 32.7357, lon: -97.1081 },
  { code: 'FTW', name: 'Fort Worth, TX',                   query: 'Fort Worth, TX',    lat: 32.7555, lon: -97.3308 },
  { code: 'DEN', name: 'Denton, TX',                       query: 'Denton, TX',        lat: 33.2148, lon: -97.1331 },
  { code: 'GYI', name: 'Sherman/Denison, TX',              query: 'Sherman, TX',       lat: 33.6357, lon: -96.6089 },
  { code: 'CRS', name: 'Corsicana, TX',                    query: 'Corsicana, TX',     lat: 32.0954, lon: -96.4688 },
  { code: 'ACT', name: 'Waco, TX (ACT)',                   query: 'Waco Airport',      lat: 31.6112, lon: -97.2306 },
  { code: 'TYR', name: 'Tyler, TX (TYR)',                  query: 'Tyler Airport',     lat: 32.3513, lon: -95.4011 },
  { code: 'GGG', name: 'Longview, TX (GGG)',               query: 'Longview, TX',      lat: 32.5007, lon: -94.7405 },
  { code: 'SPS', name: 'Wichita Falls, TX (SPS)',          query: 'Wichita Falls, TX', lat: 33.9137, lon: -98.4934 },
  { code: 'TPL', name: 'Temple, TX',                       query: 'Temple, TX',        lat: 31.0982, lon: -97.3428 },
  { code: 'GRK', name: 'Killeen, TX (GRK)',                query: 'Killeen Airport',   lat: 31.0853, lon: -97.6861 },
  // Oklahoma corridor (Dallas → Tulsa)
  { code: 'DUA', name: 'Durant, OK',                       query: 'Durant, OK',        lat: 33.9937, lon: -96.3970 },
  { code: 'ADM', name: 'Ardmore, OK',                      query: 'Ardmore, OK',       lat: 34.1743, lon: -97.1436 },
  { code: 'MLC', name: 'McAlester, OK',                    query: 'McAlester, OK',     lat: 34.9334, lon: -95.7697 },
  { code: 'OKC', name: 'Oklahoma City (OKC)',              query: 'Oklahoma City Airport', lat: 35.3931, lon: -97.6007 },
  { code: 'MKO', name: 'Muskogee, OK',                     query: 'Muskogee, OK',      lat: 35.7479, lon: -95.3697 },
  { code: 'TUL', name: 'Tulsa Intl Airport (TUL)',         query: 'Tulsa Airport',     lat: 36.1984, lon: -95.8881 },
];

// Great-circle distance in miles.
export function milesBetween(a, b) {
  const R = 3958.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function locationsWithinRadius(origin, radiusMiles) {
  return LOCATIONS.map((l) => ({ ...l, distance: Math.round(milesBetween(origin, l)) }))
    .filter((l) => l.distance <= radiusMiles)
    .sort((a, b) => a.distance - b.distance);
}
