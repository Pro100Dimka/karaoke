const finite = (value) => Number.isFinite(Number(value));

function normalizeBounds(bounds) {
  if (![bounds?.x, bounds?.y, bounds?.width, bounds?.height].every(finite)) return null;
  if (Number(bounds.width) <= 0 || Number(bounds.height) <= 0) return null;
  return Object.fromEntries(
    ["x", "y", "width", "height"].map((key) => [key, Math.round(Number(bounds[key]))])
  );
}

function overlap(first, second) {
  const width = Math.max(
    0,
    Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x)
  );
  const height = Math.max(
    0,
    Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y)
  );
  return width * height;
}

function distanceToArea(bounds, area) {
  const x = bounds.x + bounds.width / 2 - (area.x + area.width / 2);
  const y = bounds.y + bounds.height / 2 - (area.y + area.height / 2);
  return x * x + y * y;
}

function clampWindowBounds(bounds, workAreas, minimum = {}) {
  const areas = workAreas.map(normalizeBounds).filter(Boolean);
  if (!areas.length) return normalizeBounds(bounds);

  const source = normalizeBounds(bounds) || {
    x: areas[0].x,
    y: areas[0].y,
    width: minimum.width || 1440,
    height: minimum.height || 900
  };
  const area = areas.reduce((best, candidate) => {
    const candidateOverlap = overlap(source, candidate);
    const bestOverlap = overlap(source, best);
    if (candidateOverlap !== bestOverlap) return candidateOverlap > bestOverlap ? candidate : best;
    return distanceToArea(source, candidate) < distanceToArea(source, best) ? candidate : best;
  });
  const width = Math.min(area.width, Math.max(Number(minimum.width) || 1, source.width));
  const height = Math.min(area.height, Math.max(Number(minimum.height) || 1, source.height));
  return {
    x: Math.min(Math.max(source.x, area.x), area.x + area.width - width),
    y: Math.min(Math.max(source.y, area.y), area.y + area.height - height),
    width,
    height
  };
}

function readWindowState(fs, filePath) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return {
      bounds: normalizeBounds(value?.bounds),
      fullscreen: value?.fullscreen !== false,
      maximized: value?.maximized === true
    };
  } catch {
    return { bounds: null, fullscreen: true, maximized: false };
  }
}

function writeWindowState(fs, filePath, state) {
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(state)}\n`, "utf8");
  fs.renameSync(temporaryPath, filePath);
}

module.exports = { clampWindowBounds, normalizeBounds, readWindowState, writeWindowState };
