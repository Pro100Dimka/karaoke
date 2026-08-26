// Compatibility helper retained for the repository's existing focused tests.
// The live force network is the original upstream implementation in qftvisualizer.html.
export function forEachNearbyPair(points, cellSize, limit, visit) {
  let accepted = 0;
  for (let first = 0; first < points.length && accepted < limit; first += 1) {
    for (let second = first + 1; second < points.length && accepted < limit; second += 1) {
      const dx = points[first].x - points[second].x;
      const dy = points[first].y - points[second].y;
      const dz = points[first].z - points[second].z;
      if (Math.sqrt(dx * dx + dy * dy + dz * dz) > cellSize) continue;
      if (visit(first, second)) accepted += 1;
    }
  }
}
