import * as THREE from "three";

export function createTrailSystem(scene, { count = 50, length = 12, color = "#00ff88" } = {}) {
  const trails = [];
  for (let i = 0; i < count; i += 1) {
    const positions = Array.from(
      { length },
      () =>
        new THREE.Vector3(
          (Math.random() - 0.5) * 80,
          (Math.random() - 0.5) * 80,
          (Math.random() - 0.5) * 80
        )
    );
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(length * 3), 3));
    const material = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.24,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const line = new THREE.Line(geometry, material);
    scene.add(line);
    trails.push({
      positions,
      line,
      phase: Math.random() * Math.PI * 2,
      speed: 0.3 + Math.random() * 0.7
    });
  }

  return {
    update(time, audio, enabled = true, opacity = 1) {
      for (const trail of trails) {
        trail.line.visible = enabled;
        if (!enabled) continue;
        const angle = time * 0.5 * trail.speed + trail.phase;
        const radius = 30 + audio.bass * 20;
        const head = new THREE.Vector3(
          Math.cos(angle) * radius +
            Math.sin(time * trail.speed + trail.phase) * (10 + audio.bass * 15),
          Math.sin(time * 0.3 + trail.phase) * 20 +
            Math.cos(time * trail.speed * 0.7 + trail.phase) * (8 + audio.mid * 12),
          Math.sin(angle) * radius +
            Math.sin(time * trail.speed * 0.5 + trail.phase * 2) * (10 + audio.high * 10)
        );
        for (let j = trail.positions.length - 1; j > 0; j -= 1)
          trail.positions[j].copy(trail.positions[j - 1]);
        trail.positions[0].copy(head);
        const attr = trail.line.geometry.getAttribute("position");
        for (let j = 0; j < trail.positions.length; j += 1)
          attr.setXYZ(j, trail.positions[j].x, trail.positions[j].y, trail.positions[j].z);
        attr.needsUpdate = true;
        trail.line.material.opacity = (0.18 + audio.beat * 0.12 + audio.mid * 0.08) * opacity;
      }
    },
    setColor(color) {
      for (const { line } of trails) line.material.color.set(color);
    },
    dispose() {
      for (const { line } of trails) {
        scene.remove(line);
        line.geometry.dispose();
        line.material.dispose();
      }
    }
  };
}

// Buckets pts into a uniform grid sized to the current connection distance
// and calls visit(i, j) for every unordered pair (i < j) whose points share
// or neighbor a grid cell -- i.e. every pair that COULD be within range,
// without the brute-force O(N^2) all-pairs scan that used to run here every
// frame (~125k distance checks/frame for the default 500 tracked points).
// Stops early once visit has accepted `limit` pairs.
export function forEachNearbyPair(pts, cellSize, limit, visit) {
  const cellOf = (value) => Math.floor(value / cellSize);
  const grid = new Map();
  pts.forEach((point, index) => {
    const key = `${cellOf(point.x)},${cellOf(point.y)},${cellOf(point.z)}`;
    const bucket = grid.get(key);
    if (bucket) bucket.push(index);
    else grid.set(key, [index]);
  });
  let count = 0;
  for (let i = 0; i < pts.length && count < limit; i += 1) {
    const cx = cellOf(pts[i].x);
    const cy = cellOf(pts[i].y);
    const cz = cellOf(pts[i].z);
    for (let dx = -1; dx <= 1 && count < limit; dx += 1) {
      for (let dy = -1; dy <= 1 && count < limit; dy += 1) {
        for (let dz = -1; dz <= 1 && count < limit; dz += 1) {
          const bucket = grid.get(`${cx + dx},${cy + dy},${cz + dz}`);
          if (!bucket) continue;
          for (const j of bucket) {
            if (j <= i || count >= limit) continue;
            if (visit(i, j)) count += 1;
          }
        }
      }
    }
  }
}

export function createForceNetwork(
  scene,
  sourceGeometry,
  {
    fieldRadius = 90,
    connectionCount = 500,
    maxConnections = 800,
    color1 = "#00ffcc",
    color2 = "#00ff88"
  } = {}
) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(maxConnections * 6);
  const alphas = new Float32Array(maxConnections * 2);
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("alpha", new THREE.BufferAttribute(alphas, 1));
  geometry.setDrawRange(0, 0);

  const material = new THREE.ShaderMaterial({
    vertexShader: `attribute float alpha; varying float vAlpha; varying float vDist; void main(){vAlpha=alpha; vec4 mvPos=modelViewMatrix*vec4(position,1.0); vDist=length(position)/90.0; gl_Position=projectionMatrix*mvPos;}`,
    fragmentShader: `uniform vec3 uColor; uniform vec3 uColor2; uniform float uOpacity; uniform float uBeatEnergy; uniform float uKickEnergy; uniform float uBassEnvelope; uniform float uHighMid; uniform float uSpectralCentroid; varying float vAlpha; varying float vDist; void main(){vec3 color=mix(uColor,uColor2,clamp(uSpectralCentroid*2.0,0.0,1.0)); color*=1.0+(1.0-vDist)*0.45; color*=1.0+uBeatEnergy*0.12+uBassEnvelope*1.25+uKickEnergy*1.65; float a=vAlpha*uOpacity*(0.12+uHighMid*0.16+uBeatEnergy*0.08+uBassEnvelope*0.7+uKickEnergy*0.62); gl_FragColor=vec4(color,clamp(a,0.0,1.0));}`,
    uniforms: {
      uColor: { value: new THREE.Color(color1) },
      uColor2: { value: new THREE.Color(color2) },
      uOpacity: { value: 1 },
      uBeatEnergy: { value: 0 },
      uKickEnergy: { value: 0 },
      uBassEnvelope: { value: 0 },
      uHighMid: { value: 0 },
      uSpectralCentroid: { value: 0 }
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const mesh = new THREE.LineSegments(geometry, material);
  scene.add(mesh);

  const tracked = [];
  const refresh = () => {
    tracked.length = 0;
    const max = sourceGeometry.getAttribute("position").count;
    for (let i = 0; i < connectionCount; i += 1) tracked.push(Math.floor(Math.random() * max));
  };
  refresh();
  let refreshCounter = 0;

  return {
    tracked,
    update({
      threshold = 14,
      highMid = 0,
      mid = 0,
      beat = 0,
      kick = 0,
      bassEnvelope = 0,
      centroid = 0,
      opacity = 1,
      enabled = true
    } = {}) {
      mesh.visible = enabled;
      if (!enabled) return;
      refreshCounter += 1;
      if (refreshCounter >= 120) {
        refresh();
        refreshCounter = 0;
      }
      const attr = sourceGeometry.getAttribute("position");
      const pts = tracked.map(
        (idx) => new THREE.Vector3(attr.getX(idx), attr.getY(idx), attr.getZ(idx))
      );
      const effective =
        threshold * (0.86 + bassEnvelope * 0.38 + kick * 0.12) * (1 - highMid * 0.05);
      const thresholdSq = effective * effective;
      const dynamicMax = Math.floor(
        maxConnections *
          (0.1 + Math.min(1, bassEnvelope * 0.38 + kick * 0.12 + mid * 0.06 + highMid * 0.04))
      );
      let n = 0;
      forEachNearbyPair(pts, Math.max(effective, 0.001), dynamicMax, (i, j) => {
        const d2 = pts[i].distanceToSquared(pts[j]);
        if (d2 >= thresholdSq || d2 <= 0.1) return false;
        const d = Math.sqrt(d2);
        const centre = 1 - Math.min(((pts[i].length() + pts[j].length()) * 0.5) / fieldRadius, 1);
        const alpha = (1 - d / effective) * (0.6 + centre * 0.4);
        const o = n * 6;
        positions.set([pts[i].x, pts[i].y, pts[i].z, pts[j].x, pts[j].y, pts[j].z], o);
        alphas[n * 2] = alpha;
        alphas[n * 2 + 1] = alpha;
        n += 1;
        return true;
      });
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.alpha.needsUpdate = true;
      geometry.setDrawRange(0, n * 2);
      material.uniforms.uBeatEnergy.value = beat;
      material.uniforms.uKickEnergy.value = kick;
      material.uniforms.uBassEnvelope.value = bassEnvelope;
      material.uniforms.uHighMid.value = highMid;
      material.uniforms.uSpectralCentroid.value = centroid;
      material.uniforms.uOpacity.value = opacity;
    },
    setColors(color1, color2) {
      material.uniforms.uColor.value.set(color1);
      material.uniforms.uColor2.value.set(color2);
    },
    dispose() {
      scene.remove(mesh);
      geometry.dispose();
      material.dispose();
    }
  };
}
