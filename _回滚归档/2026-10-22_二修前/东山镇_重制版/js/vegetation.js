/* Dongshan study assets: axis-aligned, opaque box geometry only. */
(function (global) {
  'use strict';

  const GRID = 0.2;
  const TAU = Math.PI * 2;
  const PALETTES = {
    broadleaf: [0x526b3c, 0x607b43, 0x6c884c, 0x7a9656, 0x8ba465],
    willow: [0x667b40, 0x758b49, 0x829953, 0x92a762, 0xa0b271],
    orchard: [0x48643c, 0x557346, 0x62814b, 0x738e53, 0x829b62],
    bamboo: [0x5f783e, 0x6b8747, 0x7a9652, 0x8ba55e, 0x9bb46e],
    pine: [0x3e5940, 0x4a6849, 0x587650, 0x66865a, 0x78966a]
  };
  const WOOD = [0x64513e, 0x746049, 0x827052, 0x918064];

  function random(seed) {
    let a = (Number(seed) || 1) >>> 0;
    return function () {
      a += 0x6D2B79F5;
      let n = Math.imul(a ^ a >>> 15, 1 | a);
      n ^= n + Math.imul(n ^ n >>> 7, 61 | n);
      return ((n ^ n >>> 14) >>> 0) / 4294967296;
    };
  }
  const point = (x, y, z) => [x, y, z];
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  const add = (a, b) => a.map((v, i) => v + b[i]);

  function build(builder, spec) {
    if (!builder || typeof builder.box !== 'function') {
      throw new TypeError('DSVegetation.build needs a builder.box(centerX,centerY,centerZ,width,height,depth,color).');
    }
    spec = spec || {};
    const type = Object.prototype.hasOwnProperty.call(PALETTES, spec.type) ? spec.type : 'broadleaf';
    const rng = random(spec.seed);
    const scale = Math.max(0.5, Math.min(1.6, Number(spec.scale) || 1));
    const colors = PALETTES[type];
    const bounds = {min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity]};
    let boxes = 0;
    let woodBoxes = 0;
    let leafBoxes = 0;
    const range = (a, b) => a + rng() * (b - a);
    const leafColor = (tier) => colors[Math.max(0, Math.min(colors.length - 1, tier | 0))];

    // Quantise *faces* instead of merely rounding centres. Shared ends remain
    // joined after scaling; the smallest leaf/branch edge is one 0.2 m cell.
    function emit(x, y, z, w, h, d, color, wood) {
      const c = [x, y, z], size = [w, h, d];
      const lo = c.map((v, i) => Math.round((v - size[i] / 2) * scale / GRID) * GRID);
      const hi = c.map((v, i) => Math.max(lo[i] + GRID, Math.round((v + size[i] / 2) * scale / GRID) * GRID));
      builder.box((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2,
        hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2], color);
      for (let i = 0; i < 3; i++) {
        bounds.min[i] = Math.min(bounds.min[i], lo[i]);
        bounds.max[i] = Math.max(bounds.max[i], hi[i]);
      }
      boxes++;
      if (wood) woodBoxes++; else leafBoxes++;
    }

    function segment(a, b, width, color) {
      // A digital staircase of short overlapping cuboids, never a diagonal rod.
      // Each cuboid encloses both endpoints of its interval; every turn has a
      // real volume connection, including when adjacent pieces are quantised.
      const delta = b.map((v, i) => v - a[i]);
      const steps = Math.max(1, Math.ceil(Math.max(...delta.map(Math.abs)) / 0.3));
      for (let i = 0; i < steps; i++) {
        const p = mix(a, b, i / steps), q = mix(a, b, (i + 1) / steps);
        emit((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2,
          Math.abs(q[0] - p[0]) + width, Math.abs(q[1] - p[1]) + width,
          Math.abs(q[2] - p[2]) + width, color, true);
      }
    }
    function branch(points, width) {
      for (let i = 1; i < points.length; i++) {
        segment(points[i - 1], points[i], Math.max(0.2, width - (i - 1) * 0.1), WOOD[Math.min(2, i - 1)]);
      }
    }

    function roots() {
      emit(0, 0.3, 0, 0.8, 0.6, 0.8, WOOD[0], true);
      for (let i = 0; i < 5; i++) {
        const a = i * TAU / 5 + range(-0.1, 0.1);
        segment([0, 0.3, 0], [Math.cos(a) * 0.9, 0.1, Math.sin(a) * 0.9], 0.3, WOOD[0]);
      }
    }

    // A connected, asymmetric little crown, made of broad inner pads, smaller
    // side lobes and a few 0.2–0.4 m tips. Adjacent crowns leave air between
    // branch fans; tiny cubes are only used at a crown's connected rim.
    function crown(cx, cy, cz, radius, tier, flatter) {
      const h = (flatter ? 0.5 : 0.8) * radius;
      emit(cx, cy, cz, radius * 1.25, h, radius * 1.15, leafColor(tier));
      emit(cx + radius * 0.14, cy + h * 0.5, cz - radius * 0.08,
        radius * 0.85, h * 0.6, radius * 0.8, leafColor(tier + 1));
      const lobes = 5 + (rng() > 0.55 ? 1 : 0);
      for (let j = 0; j < lobes; j++) {
        const a = j * TAU / lobes + range(-0.2, 0.2);
        const side = radius * range(0.38, 0.56);
        const x = cx + Math.cos(a) * side, z = cz + Math.sin(a) * side;
        const yy = cy + range(-0.15, 0.24) * radius;
        const w = radius * range(0.5, 0.75), d = radius * range(0.45, 0.7);
        emit(x, yy, z, w, h * range(0.55, 0.85), d, leafColor(tier + (j % 3 === 0 ? 1 : 0)));
        const ext = radius * 0.3;
        const tipX = x + Math.cos(a) * ext, tipZ = z + Math.sin(a) * ext;
        emit(tipX, yy + h * 0.1, tipZ, 0.4, 0.4, 0.4, leafColor(tier + 1));
        if (j % 2 === 0) {
          emit(tipX + Math.cos(a) * 0.2, yy + h * 0.16, tipZ + Math.sin(a) * 0.2,
            0.2, 0.2, 0.4, leafColor(tier + 1));
        }
      }
    }

    function broadleaf() {
      roots();
      const leanX = range(-0.3, 0.3), leanZ = range(-0.2, 0.2);
      branch([[0, 0.3, 0], [0.1, 2.4, 0], [leanX, 4.5, leanZ], [leanX + 0.1, 7.0, leanZ]], 0.6);
      const phase = range(0, TAU);
      // The crown occupies about five vertical metres. A low, broad shoulder,
      // offset middle volumes and a narrower, uneven top prevent the flat
      // bouquet silhouette produced by placing every branch in a single ring.
      for (let i = 0; i < 7; i++) {
        const a = i * TAU / 7 + phase + range(-0.13, 0.13);
        const r = range(2.65, 3.35);
        const base = [leanX * 0.5, 2.9 + (i % 3) * 0.45, leanZ * 0.5];
        const elbow = [Math.cos(a) * r * 0.48, base[1] + 1.0, Math.sin(a) * r * 0.48];
        const tip = [Math.cos(a) * r, 5.05 + (i % 3) * 0.48 + range(-0.15, 0.25), Math.sin(a) * r];
        branch([base, elbow, tip], 0.2);
        crown(...tip, range(1.0, 1.28), 1 + i % 2, false);
        const sideA = a + (i % 2 ? 0.5 : -0.5);
        const fork = [Math.cos(sideA) * r * 0.83, tip[1] + range(0.35, 0.8), Math.sin(sideA) * r * 0.83];
        branch([elbow, fork], 0.2);
        crown(...fork, range(0.88, 1.12), 2, false);
        // Partly cover the shoulder from above while keeping gaps between fans.
        const inner = mix(elbow, fork, 0.58);
        inner[1] += 0.25;
        branch([elbow, inner], 0.2);
        crown(...inner, 0.78, 1, false);
      }
      for (let i = 0; i < 6; i++) {
        const a = i * TAU / 6 + phase + 0.47;
        const r = range(1.8, 2.65);
        const base = [leanX, 4.9 + (i % 2) * 0.5, leanZ];
        const elbow = [Math.cos(a) * r * 0.58, 6.3 + (i % 3) * 0.36, Math.sin(a) * r * 0.58];
        const tip = [Math.cos(a) * r, 6.9 + (i % 3) * 0.36, Math.sin(a) * r];
        branch([base, elbow, tip], 0.2);
        crown(...tip, range(1.02, 1.27), 2 + i % 2, false);
        const fork = [Math.cos(a - 0.48) * r * 0.75, tip[1] + range(0.2, 0.6), Math.sin(a - 0.48) * r * 0.75];
        branch([elbow, fork], 0.2);
        crown(...fork, 0.92, 2, false);
      }
      const topBase = [leanX + 0.1, 7.0, leanZ];
      for (let i = 0; i < 4; i++) {
        const a = i * TAU / 4 + phase + 0.2;
        const p = [Math.cos(a) * range(0.7, 1.3) + leanX, 8.05 + (i % 3) * 0.28, Math.sin(a) * 0.95 + leanZ];
        branch([topBase, p], 0.2);
        crown(...p, range(0.92, 1.15), 3, false);
      }
    }

    function orchard() {
      // Lower fork and a wide, joined crown: an unnamed orchard type asset,
      // not an assertion of loquat / waxberry species or a mapped tree.
      roots();
      branch([[0, 0.3, 0], [0.1, 1.4, 0.1], [-0.1, 2.6, 0]], 0.6);
      const pivot = [-0.1, 2.4, 0];
      for (let i = 0; i < 7; i++) {
        const a = i * TAU / 7 + 0.2;
        const r = range(1.65, 2.35);
        const elbow = [Math.cos(a) * r * 0.5, 3.15 + (i % 2) * 0.2, Math.sin(a) * r * 0.5];
        const tip = [Math.cos(a) * r, 4.1 + (i % 3) * 0.3, Math.sin(a) * r];
        branch([pivot, elbow, tip], 0.4);
        crown(...tip, range(0.95, 1.15), 1 + i % 2, false);
        const fork = [Math.cos(a + 0.4) * r * 0.72, 4.75 + (i % 2) * 0.2, Math.sin(a + 0.4) * r * 0.72];
        branch([elbow, fork], 0.2);
        crown(...fork, 0.84, 2, false);
      }
      branch([pivot, [0.2, 4.8, 0]], 0.4);
      crown(0.2, 5.1, 0, 1.15, 3, false);
    }

    function willow() {
      roots();
      branch([[0, 0.3, 0], [-0.1, 2.2, 0.1], [0.2, 4.6, 0], [0, 7.1, 0.2]], 0.5);
      const phase = range(0, TAU);
      for (let i = 0; i < 9; i++) {
        const a = i * TAU / 9 + phase + range(-0.1, 0.1);
        const r = range(3.1, 3.9);
        const base = [0.1, 3.6 + (i % 3) * 0.55, 0];
        const elbow = [Math.cos(a) * r * 0.57, 6.65 + (i % 3) * 0.5, Math.sin(a) * r * 0.57];
        const end = [Math.cos(a) * r, 6.3 + (i % 3) * 0.35, Math.sin(a) * r];
        branch([base, elbow, end], 0.2);
        crown(...elbow, 1.1, 2, false);
        crown(...end, 0.95, 2 + i % 2, true);
        // Slender leafy sprays descend from different points of each arch.
        // Fine 0.2 m strands replace the old 0.4 m square hanging tentacles.
        for (let j = 0; j < 6; j++) {
          const ba = a + (j - 2.5) * 0.095;
          const rr = r * range(0.73, 1.04);
          const sy = end[1] + range(-0.1, 0.5);
          const top = [Math.cos(ba) * rr, sy, Math.sin(ba) * rr];
          segment(mix(elbow, end, 0.65), top, 0.2, WOOD[2]);
          const length = range(3.35, 4.95), steps = Math.ceil(length / 0.4);
          let old = top;
          for (let k = 0; k < steps; k++) {
            const t = k / steps;
            const outward = 0.25 * Math.sin(t * Math.PI) + 0.12 * t;
            const now = [top[0] + Math.cos(ba) * outward, sy - k * 0.4, top[2] + Math.sin(ba) * outward];
            emit((old[0] + now[0]) / 2, (old[1] + now[1]) / 2, (old[2] + now[2]) / 2,
              Math.abs(old[0] - now[0]) + 0.2, Math.abs(old[1] - now[1]) + 0.25,
              Math.abs(old[2] - now[2]) + 0.2, leafColor(k < 2 ? 3 : 1 + (j % 2)));
            if (k > 0 && k < steps - 2 && k % 4 === j % 4) {
              emit(now[0] + Math.cos(ba + 1.4) * 0.15, now[1] - 0.05,
                now[2] + Math.sin(ba + 1.4) * 0.15, 0.4, 0.2, 0.2, leafColor(2));
            }
            old = now;
          }
        }
      }
      for (let i = 0; i < 4; i++) {
        const a = i * TAU / 4 + phase + 0.4;
        const p = [Math.cos(a) * 1.05, 8.0 + (i % 2) * 0.35, Math.sin(a) * 1.05];
        branch([[0, 6.8, 0.2], p], 0.2);
        crown(...p, 1.1, 3, false);
      }
    }

    function pine() {
      roots();
      const trunk = [[0, 0.3, 0], [0.2, 2.0, 0], [0.2, 4.4, 0.2], [-0.2, 6.2, 0.2], [0, 8.6, 0]];
      branch(trunk, 0.6);
      // Plate-like branched fans in uneven tiers. Each fan is broken into
      // several connected needle masses rather than one giant cross-shaped slab.
      for (let level = 0; level < 4; level++) {
        const y = 3.6 + level * 1.25;
        const r = 3.15 - level * 0.46;
        const count = level < 2 ? 4 : 3;
        for (let i = 0; i < count; i++) {
          const a = i * TAU / count + level * 0.83 + range(-0.1, 0.1);
          const elbow = [Math.cos(a) * r * 0.6, y + 0.15, Math.sin(a) * r * 0.6];
          const tip = [Math.cos(a) * r, y + range(0.3, 0.6), Math.sin(a) * r];
          branch([[0, y - 0.35, 0.1], elbow, tip], 0.4);
          crown(...tip, 1.0 - level * 0.08, 1 + level % 3, true);
          const fork = [Math.cos(a + 0.38) * r * 0.84, y + 0.5, Math.sin(a + 0.38) * r * 0.84];
          branch([elbow, fork], 0.2);
          crown(...fork, 0.72, 2 + level % 2, true);
        }
      }
      crown(0, 8.7, 0, 0.85, 3, false);
    }

    function bamboo() {
      // A clump is one asset. Slender jointed culms remain visible through
      // asymmetric leaf fans at staggered nodes; there is no solid crown cube.
      const count = 7;
      for (let i = 0; i < count; i++) {
        const a = i * TAU / count + 0.23;
        const r = i === 0 ? 0 : range(0.6, 1.35);
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        const h = range(6.4, 8.6);
        for (let y = 0; y < h; y += 0.8) {
          const upper = Math.min(y + 0.8, h);
          emit(x, (y + upper) / 2, z, 0.2, upper - y, 0.2, 0x7e8853, true);
          if (upper < h) emit(x, upper - 0.05, z, 0.4, 0.2, 0.2, 0x8f9661, true);
        }
        for (let tier = 0; tier < 3; tier++) {
          const y = h - 0.7 - tier * 1.05;
          const angle = a + tier * 2.05;
          const left = [x + Math.cos(angle) * 1.05, y + 0.35, z + Math.sin(angle) * 1.05];
          const right = [x + Math.cos(angle + 2.6) * 0.8, y + 0.25, z + Math.sin(angle + 2.6) * 0.8];
          segment([x, y, z], left, 0.2, 0x7b8150);
          segment([x, y, z], right, 0.2, 0x7b8150);
          for (const end of [left, right]) {
            const v = [end[0] - x, 0, end[2] - z];
            // Flat crossed strips progressively shorten toward each tip.
            for (let k = 0; k < 4; k++) {
              const t = 0.25 + k * 0.22;
              const px = x + v[0] * t, pz = z + v[2] * t;
              const w = 0.8 - k * 0.1;
              emit(px, y + 0.3 + k * 0.06, pz, w, 0.2, 0.4, leafColor(2 + (k % 2)));
              emit(px + v[2] * 0.2, y + 0.45, pz - v[0] * 0.2,
                0.4, 0.2, w, leafColor(2));
            }
          }
        }
      }
    }

    ({broadleaf, willow, orchard, bamboo, pine})[type]();
    const radius = Math.max(
      Math.abs(bounds.min[0]), Math.abs(bounds.max[0]),
      Math.abs(bounds.min[2]), Math.abs(bounds.max[2])
    );
    return {
      type, seed: Number(spec.seed) || 1, scale, grid: GRID,
      height: bounds.max[1] - Math.min(0, bounds.min[1]), radius,
      boxes, woodBoxes, leafBoxes, bounds,
      source: '江南植被的类型化体素资产，非逐株测绘或树种调查'
    };
  }

  global.DSVegetation = Object.freeze({build, GRID, palettes: PALETTES});
})(typeof window !== 'undefined' ? window : globalThis);
