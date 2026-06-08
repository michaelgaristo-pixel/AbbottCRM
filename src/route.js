// Nearest-neighbor TSP heuristic + 2-opt improvement.
// Uses haversine distance (straight-line km) as the cost function.

function haversineKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      sinLng * sinLng;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function totalDistance(route) {
  let d = 0;
  for (let i = 0; i < route.length - 1; i++) {
    d += haversineKm(route[i].coords, route[i + 1].coords);
  }
  return d;
}

function nearestNeighbor(start, stops) {
  const unvisited = [...stops];
  const route = [];
  let current = start;

  while (unvisited.length) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < unvisited.length; i++) {
      const d = haversineKm(current.coords, unvisited[i].coords);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const next = unvisited.splice(bestIdx, 1)[0];
    route.push(next);
    current = next;
  }
  return route;
}

function twoOpt(route) {
  let improved = true;
  let best = route;
  while (improved) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let j = i + 2; j < best.length; j++) {
        const newRoute = [
          ...best.slice(0, i + 1),
          ...best.slice(i + 1, j + 1).reverse(),
          ...best.slice(j + 1),
        ];
        if (totalDistance(newRoute) < totalDistance(best)) {
          best = newRoute;
          improved = true;
        }
      }
    }
  }
  return best;
}

export function optimizeRoute(startCoords, stops) {
  const startNode = { name: 'Start', coords: startCoords };
  const nn = nearestNeighbor(startNode, stops);
  return twoOpt(nn);
}

export function buildGoogleMapsUrl(startAddress, orderedStops) {
  const encode = s => encodeURIComponent(s);
  const waypoints = orderedStops.slice(0, -1).map(s => encode(s.address)).join('/');
  const destination = encode(orderedStops[orderedStops.length - 1].address);
  const origin = encode(startAddress);
  if (orderedStops.length === 1) {
    return `https://www.google.com/maps/dir/${origin}/${destination}`;
  }
  return `https://www.google.com/maps/dir/${origin}/${waypoints}/${destination}`;
}
