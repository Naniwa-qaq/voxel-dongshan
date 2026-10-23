/* Dongshan voxel architecture. Vertices lie on a 0.2 m construction grid.
   This module emits only axis-aligned boxes; it has no renderer dependency. */
(function (global) {
  'use strict';
  const Q = 0.2;
  const P = Object.freeze({
    wall: 0xe2dfcf, wallShade: 0xd6d4c6, wallLight: 0xe9e5d7,
    base: 0x9a9d91, stone: 0xb6b8a8, stoneDark: 0x7c827b,
    roof: 0x45585a, roofLight: 0x56696a, roofDark: 0x3b4c50,
    ridge: 0x647371, wood: 0x665444, woodLight: 0x85705a,
    woodDark: 0x443d34, recess: 0x333c39, glass: 0x6c817b,
    modernWall: 0xd9d8c8, modernFrame: 0x8b9b96
  });
  const q = v => Math.round(v / Q) * Q;
  const extent = v => Math.round(v / (Q * 2)) * Q * 2;
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const seedRandom = seed => {
    let n = (seed || 1) >>> 0;
    return () => { n += 0x6d2b79f5; let t = n; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  };
  function emitter(builder) {
    let count = 0;
    const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
    function box(x0, y0, z0, x1, y1, z1, color) {
      x0 = q(x0); y0 = q(y0); z0 = q(z0); x1 = q(x1); y1 = q(y1); z1 = q(z1);
      if (x1 - x0 < .19 || y1 - y0 < .19 || z1 - z0 < .19) return;
      builder.box((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, color);
      bounds.minX = Math.min(bounds.minX, x0); bounds.maxX = Math.max(bounds.maxX, x1);
      bounds.minY = Math.min(bounds.minY, y0); bounds.maxY = Math.max(bounds.maxY, y1);
      bounds.minZ = Math.min(bounds.minZ, z0); bounds.maxZ = Math.max(bounds.maxZ, z1);
      count++;
    }
    function sub(tx, ty, tz, quarter) {
      const r = ((quarter || 0) % 4 + 4) % 4;
      return function (x0, y0, z0, x1, y1, z1, c) {
        const pts = [[x0, z0], [x1, z0], [x0, z1], [x1, z1]].map(([x, z]) => r === 0 ? [x, z] : r === 1 ? [z, -x] : r === 2 ? [-x, -z] : [-z, x]);
        box(tx + Math.min(...pts.map(p => p[0])), ty + y0, tz + Math.min(...pts.map(p => p[1])), tx + Math.max(...pts.map(p => p[0])), ty + y1, tz + Math.max(...pts.map(p => p[1])), c);
      };
    }
    return { box, sub, bounds, count: () => count };
  }
  /* Each facade is cut into horizontal bands and sorted solid spans. There is
     no wall box behind a door/window; the recessed panel is a separate solid. */
  function facade(B, length, face, axis, sign, y0, y1, openings, color, modern) {
    const half = length / 2, thick = .4;
    const emit = (u0, b, v0, u1, t, v1, c) => {
      if (axis === 'z') B(u0, b, sign > 0 ? face + v0 : -face - v1, u1, t, sign > 0 ? face + v1 : -face - v0, c);
      else B(sign > 0 ? face + v0 : -face - v1, b, u0, sign > 0 ? face + v1 : -face - v0, t, u1, c);
    };
    const ys = [...new Set([y0, y1, ...openings.flatMap(o => [o.y, o.y + o.h])].map(q))].sort((a, b) => a - b);
    for (let j = 0; j < ys.length - 1; j++) {
      const bottom = ys[j], top = ys[j + 1];
      if (top <= y0 || bottom >= y1) continue;
      let cursor = -half;
      const active = openings.filter(o => o.y < top - .01 && o.y + o.h > bottom + .01).sort((a, b) => a.x - b.x);
      for (const o of active) {
        const left = q(o.x - o.w / 2), right = q(o.x + o.w / 2);
        if (left > cursor + .01) emit(cursor, bottom, -thick, left, top, 0, color);
        cursor = Math.max(cursor, right);
      }
      if (cursor < half - .01) emit(cursor, bottom, -thick, half, top, 0, color);
    }
    for (const o of openings) {
      const l = q(o.x - o.w / 2), r = q(o.x + o.w / 2), b = o.y, t = q(o.y + o.h);
      const frame = modern ? P.modernFrame : P.wood;
      // Board/pane sits at the inner half of the 0.4 m wall, leaving real reveals.
      emit(l, b, -.4, r, t, -.2, o.door ? P.woodDark : (modern ? P.glass : P.recess));
      emit(l, b, -.2, l + .2, t, 0, frame);
      emit(r - .2, b, -.2, r, t, 0, frame);
      emit(l + .2, t - .2, -.2, r - .2, t, 0, frame);
      emit(l, b, -.2, r, b + .2, 0, o.door ? P.stone : frame);
      if (o.door) {
        const mid = q(o.x);
        emit(mid - .2, b + .2, -.2, mid, t - .2, 0, P.woodLight);
        for (const yy of [b + .8, b + 1.8]) if (yy < t - .2) emit(l + .2, yy, -.2, r - .2, yy + .2, 0, P.wood);
        emit(mid + .2, b + 1.2, 0, mid + .4, b + 1.4, .2, P.woodDark);
        // A quiet stone surround, not a decorative palace portal.
        emit(l - .2, b, 0, l, t + .2, .2, P.stone);
        emit(r, b, 0, r + .2, t + .2, .2, P.stone);
        emit(l - .2, t, 0, r + .2, t + .2, .2, P.stone);
      } else {
        const spacing = modern ? .8 : .4;
        for (let xx = l + .4; xx < r - .19; xx += spacing) emit(q(xx), b + .2, -.2, q(xx) + .2, t - .2, 0, frame);
        const midY = q(b + o.h / 2);
        emit(l + .2, midY, -.2, r - .2, midY + .2, 0, modern ? P.modernFrame : P.woodLight);
        emit(l - .2, b - .2, 0, r + .2, b, .2, P.stone);
        // A second inset rail behind the outer lattice adds a visible depth tier.
        if (!modern && o.w >= 1.4) emit(l + .2, b + .4, -.4, r - .2, b + .6, -.2, P.woodLight);
      }
    }
  }
  function roof(B, w, d, y, seed, options) {
    const opt = options || {}, rng = seedRandom(seed + 441);
    const hw = w / 2 + .4, hd = d / 2 + .6;
    const rise = q(clamp(hd * .52, 1.2, 3.0));
    const layers = Math.round(rise / Q);
    // Thin eave boards on all four sides, leaving the roof interior unfilled.
    B(-hw, y - .2, hd - .4, hw, y, hd, P.woodDark);
    B(-hw, y - .2, -hd, hw, y, -hd + .4, P.woodDark);
    B(-hw, y - .2, -hd, -hw + .2, y, hd, P.woodDark);
    B(hw - .2, y - .2, -hd, hw, y, hd, P.woodDark);
    // Rafters are short voxel bars projecting from the wall to the eave.
    for (let x = -w / 2 + .2; x <= w / 2 + .01; x += .8) {
      B(q(x), y - .4, d / 2 - .4, q(x) + .2, y - .2, hd, P.wood);
      B(q(x), y - .4, -hd, q(x) + .2, y - .2, -d / 2 + .4, P.wood);
    }
    const hipBreak = opt.hipGable ? q(hd * .42) : 0;
    let ridgeHW = hw;
    for (let i = 0; i < layers; i++) {
      const outer = q(hd * (1 - i / layers));
      const inner = i === layers - 1 ? 0 : q(hd * (1 - (i + 1) / layers));
      const yi = q(y + i * Q);
      const ux = Math.min(hipBreak, q(hd - outer));
      const nextUX = Math.min(hipBreak, q(hd - inner));
      const layerHW = q(hw - ux);
      ridgeHW = layerHW;
      // Each horizontal tile course is made of two narrow slope strips. The
      // white stair-stepped gable is exposed between them at the house ends.
      for (let x = -layerHW; x < layerHW - .01; x += .8) {
        const xa = q(x), xb = Math.min(layerHW, q(x + .8));
        const col = rng() < .16 ? P.roofLight : rng() < .2 ? P.roofDark : P.roof;
        B(xa, yi, Math.max(0, inner - .2), xb, yi + .2, outer, col);
        B(xa, yi, -outer, xb, yi + .2, -Math.max(0, inner - .2), col);
        // Selected cap-tile ribs: an actual step, not a painted roof stripe.
        if (outer - inner >= .2) {
          B(xa, yi + .2, Math.max(0, outer - .4), Math.min(xb, xa + .2), yi + .4, outer, P.roofLight);
          B(xa, yi + .2, -outer, Math.min(xb, xa + .2), yi + .4, -Math.max(0, outer - .4), P.roofLight);
        }
      }
      if (nextUX > ux + .01) {
        const endW = q(nextUX - ux + .2);
        for (let z = -outer; z < outer - .01; z += .8) {
          const zb = Math.min(outer, q(z + .8)), c = Math.round(z * 5) % 4 ? P.roof : P.roofLight;
          B(-layerHW, yi, q(z), -layerHW + endW, yi + .2, zb, c);
          B(layerHW - endW, yi, q(z), layerHW, yi + .2, zb, c);
        }
      }
      if (!opt.noGable) {
        const whiteDepth = Math.min(d / 2, Math.max(.2, inner));
        B(-w / 2, yi, -whiteDepth, -w / 2 + .4, yi + .2, whiteDepth, P.wallShade);
        B(w / 2 - .4, yi, -whiteDepth, w / 2, yi + .2, whiteDepth, P.wallLight);
      }
    }
    const top = q(y + rise);
    B(-ridgeHW, top, -.2, ridgeHW, top + .4, .2, P.ridge);
    // Low capped ends, deliberately no ubiquitous horsehead walls or ornaments.
    if (!opt.simpleRidge) {
      B(-ridgeHW, top, -.4, -ridgeHW + .4, top + .6, .4, P.roofLight);
      B(ridgeHW - .4, top, -.4, ridgeHW, top + .6, .4, P.roofLight);
    }
    return top + (opt.simpleRidge ? .4 : .6);
  }
  function windowRow(length, floorBottom, isFront, first, seed, modern) {
    const openings = [], count = Math.max(1, Math.floor((length - 1.2) / 3.0));
    const span = length - 1.2;
    for (let i = 0; i < count; i++) {
      const x = q(-span / 2 + span * (i + .5) / count);
      if (isFront && first && Math.abs(x) < 1.8) continue;
      openings.push({ x, y: q(floorBottom + (modern ? .8 : 1.0)), w: modern ? 1.8 : 1.6, h: modern ? 1.6 : 1.4 });
    }
    return openings;
  }
  function ordinary(B, spec) {
    const type = spec.type || 'house';
    const w = extent(clamp(spec.width || 10.4, 4.8, 24));
    const d = extent(clamp(spec.depth || 7.2, 3.6, 16));
    const floors = clamp(Math.round(spec.floors || (type === 'shop' ? 2 : 1)), 1, 3);
    const floorH = 3.2, base = .4, H = q(base + floors * floorH + .2);
    const hw = w / 2, hd = d / 2, seed = spec.seed || 1;
    B(-hw - .2, 0, -hd - .2, hw + .2, .2, hd + .2, P.base);
    B(-hw, .2, -hd, hw, .4, hd, P.stone);
    // Sparse coursed stone accents around the four wall feet.
    for (let x = -hw; x < hw - .01; x += 1.6) {
      B(q(x), .2, hd - .2, Math.min(hw, q(x + 1.2)), .4, hd, P.base);
      B(q(x + .2), .2, -hd, Math.min(hw, q(x + 1.4)), .4, -hd + .2, P.base);
    }
    for (const sign of [-1, 1]) {
      const openings = [];
      for (let f = 0; f < floors; f++) openings.push(...windowRow(w, base + f * floorH, sign === 1, f === 0, seed, false));
      if (sign === 1) openings.push({ x: 0, y: base, w: type === 'shop' ? 2.4 : 1.6, h: 2.4, door: true });
      else if (w > 10.5) {
        for (let k = openings.length - 1; k >= 0; k--) if (openings[k].y < 3.2 && Math.abs(openings[k].x) < 1.6) openings.splice(k, 1);
        openings.push({ x: 0, y: base, w: 1.2, h: 2.2, door: true });
      }
      facade(B, w, hd, 'z', sign, base, H, openings, sign > 0 ? P.wallLight : P.wallShade, false);
    }
    for (const sign of [-1, 1]) {
      const openings = [];
      for (let f = 0; f < floors; f++) openings.push(...windowRow(d - .8, base + f * floorH, false, false, seed, false));
      facade(B, d, hw, 'x', sign, base, H, openings, sign > 0 ? P.wallLight : P.wallShade, false);
    }
    // Floor/ceiling slabs are inside the perimeter and never fill the openings.
    for (let f = 1; f <= floors; f++) B(-hw + .4, base + f * floorH - .2, -hd + .4, hw - .4, base + f * floorH, hd - .4, P.woodDark);
    for (const sign of [-1, 1]) {
      B(-hw, H - .4, sign > 0 ? hd : -hd - .2, hw, H - .2, sign > 0 ? hd + .2 : -hd, P.woodDark);
      if (floors > 1) B(-hw, 3.4, sign > 0 ? hd : -hd - .2, hw, 3.6, sign > 0 ? hd + .2 : -hd, P.woodDark);
    }
    // Modest doorway hood in stepped stone-and-tile construction.
    const doorW = type === 'shop' ? 2.4 : 1.6;
    B(-doorW / 2 - .4, 3.0, hd, doorW / 2 + .4, 3.2, hd + .6, P.roofDark);
    B(-doorW / 2 - .2, 3.2, hd, doorW / 2 + .2, 3.4, hd + .4, P.roof);
    B(-doorW / 2 - .4, 0, hd + .2, doorW / 2 + .4, .2, hd + 1.2, P.stone);
    B(-doorW / 2 - .2, .2, hd, doorW / 2 + .2, .4, hd + .8, P.base);
    const top = roof(B, w, d, H, seed);
    if (type === 'shop') {
      // An open timber eave arcade stands in front of the recessed shop door.
      const front = hd + 1.4;
      for (const x of [-hw + .4, 0, hw - .4]) {
        B(x - .2, .2, front - .2, x + .2, .6, front + .2, P.stone);
        B(x - .2, .6, front - .2, x + .2, 3.0, front + .2, P.woodDark);
        B(x - .4, 2.8, front - .2, x + .4, 3.0, front + .2, P.wood);
      }
      B(-hw - .4, 3.0, hd, hw + .4, 3.2, front + .4, P.woodDark);
      for (let i = 0; i < 4; i++) B(-hw - .4, 3.2 + i * .2, hd, hw + .4, 3.4 + i * .2, front + .4 - i * .4, i % 2 ? P.roofLight : P.roof);
      for (let x = -hw + .2; x <= hw; x += 1.0) B(q(x), 2.8, hd, q(x) + .2, 3.0, front + .2, P.wood);
    }
    return { width: w, depth: d, height: top, floors, eaveHeight: H, door: { x: 0, y: base, z: hd + .8, width: doorW, facing: [0, 0, 1] }, grid: Q, type, openings: 'true recessed, four facades' };
  }
  function modern(B, spec) {
    const w = extent(clamp(spec.width || 12, 6.4, 28));
    const d = extent(clamp(spec.depth || 8.4, 5.2, 20));
    const floors = clamp(Math.round(spec.floors || 2), 1, 3), base = .4, fh = 3.2, H = q(base + fh * floors);
    const hw = w / 2, hd = d / 2;
    B(-hw - .2, 0, -hd - .2, hw + .2, .4, hd + .2, P.base);
    for (const axis of ['z', 'x']) for (const sign of [-1, 1]) {
      const length = axis === 'z' ? w : d, face = axis === 'z' ? hd : hw, openings = [];
      for (let f = 0; f < floors; f++) openings.push(...windowRow(length - .8, base + fh * f, axis === 'z' && sign > 0, f === 0, 1, true));
      if (axis === 'z' && sign > 0) openings.push({ x: 0, y: base, w: 1.6, h: 2.4, door: true });
      facade(B, length, face, axis, sign, base, H, openings, sign > 0 ? P.modernWall : P.wallShade, true);
    }
    for (let f = 1; f <= floors; f++) {
      const y = base + f * fh;
      B(-hw - .2, y - .2, -hd - .2, hw + .2, y, hd + .2, P.stone);
      if (f < floors) {
        B(-hw, y, hd, hw, y + .2, hd + .2, P.wallLight);
        B(-hw, y, -hd - .2, hw, y + .2, -hd, P.wallLight);
      }
    }
    // Flat accessible roof and four continuous parapets, with a stepped cap.
    B(-hw, H, -hd, hw, H + .2, hd, P.stoneDark);
    B(-hw, H + .2, -hd, hw, H + .8, -hd + .4, P.modernWall);
    B(-hw, H + .2, hd - .4, hw, H + .8, hd, P.modernWall);
    B(-hw, H + .2, -hd, -hw + .4, H + .8, hd, P.modernWall);
    B(hw - .4, H + .2, -hd, hw, H + .8, hd, P.modernWall);
    B(-hw - .2, H + .8, -hd - .2, hw + .2, H + 1.0, -hd + .4, P.stone);
    B(-hw - .2, H + .8, hd - .4, hw + .2, H + 1.0, hd + .2, P.stone);
    B(-hw - .2, H + .8, -hd, -hw + .4, H + 1.0, hd, P.stone);
    B(hw - .4, H + .8, -hd, hw + .2, H + 1.0, hd, P.stone);
    B(-1.4, 2.8, hd, 1.4, 3.0, hd + 1.0, P.stoneDark);
    B(-1.4, 0, hd, 1.4, .2, hd + 1.2, P.stone);
    B(-1.2, .2, hd, 1.2, .4, hd + .8, P.base);
    return { width: w, depth: d, height: H + 1, floors, eaveHeight: H, type: 'modern', grid: Q, door: { x: 0, y: base, z: hd + .8, width: 1.6, facing: [0, 0, 1] } };
  }
  function courtyard(E, spec) {
    // width/depth denote the whole envelope for this composite type.
    const w = extent(clamp(spec.width || 28, 12, 44)), d = extent(clamp(spec.depth || 24, 14, 40));
    const hw = w / 2, hd = d / 2, B = E.box;
    const mainD = extent(Math.min(7.2, d * .29)), gateD = extent(Math.min(4.8, d * .24));
    const mainW = extent(w - 2.4), gateW = extent(Math.min(9.6, w - 6.4));
    const backZ = q(-hd + mainD / 2 + .8), gateZ = q(hd - gateD / 2 - 1.4);
    const seed = spec.seed || 1;
    const main = ordinary(E.sub(0, 0, backZ, 0), { type: 'house', width: mainW, depth: mainD, floors: spec.floors || 1, seed });
    const gate = ordinary(E.sub(0, 0, gateZ, 2), { type: 'house', width: gateW, depth: gateD, floors: 1, seed: seed + 33 });
    // Front gate hall faces the street as well as the open inner court.
    // Its original back gets a second real opening when large enough; a gap in
    // the perimeter walls always provides a walkable open route at the side.
    const openBack = q(backZ + mainD / 2 + .6), openFront = q(gateZ - gateD / 2 - .6);
    const openLength = q(openFront - openBack);
    const sideD = extent(Math.min(5.2, w * .24)), sideW = extent(Math.min(openLength - .8, 10.4));
    let wing = null;
    if (sideW >= 4.8 && w >= 16) {
      const z = q((openFront + openBack) / 2), x = q(hw - sideD / 2 - .8);
      wing = ordinary(E.sub(-x, 0, z, 1), { type: 'house', width: sideW, depth: sideD, floors: 1, seed: seed + 75 });
      ordinary(E.sub(x, 0, z, 3), { type: 'house', width: sideW, depth: sideD, floors: 1, seed: seed + 89 });
    }
    // Courtyard paving is broken into quiet large slabs, leaving a planted bed.
    const innerHW = q(wing ? hw - sideD - 1.2 : hw - 1.2);
    for (let z = openBack; z < openFront - .01; z += 1.2) for (let x = -innerHW; x < innerHW - .01; x += 1.2) {
      if (x > innerHW - 3.8 && x < innerHW - 1.0 && z > openBack + 1 && z < openBack + 3.4) continue;
      B(q(x), 0, q(z), Math.min(innerHW, q(x + 1.2)), .2, Math.min(openFront, q(z + 1.2)), ((Math.round(x / 1.2) + Math.round(z / 1.2)) & 3) === 0 ? P.stone : P.base);
    }
    for (const sign of [-1, 1]) {
      const x = sign * (hw - .6);
      B(x - .2, 0, -hd + .6, x + .2, 2.8, hd - .8, P.wallShade);
      B(x - .4, 2.8, -hd + .4, x + .4, 3.0, hd - .6, P.roof);
      B(x - .2, 3.0, -hd + .4, x + .2, 3.2, hd - .6, P.roofLight);
    }
    // A boundary gate left of the front hall makes the empty court accessible.
    const frontZ = hd - .6, gap0 = q(-gateW / 2 - 1.8), gap1 = q(-gateW / 2 - .2);
    if (gap0 > -hw + .8) B(-hw + .8, 0, frontZ - .2, gap0, 2.8, frontZ + .2, P.wall);
    if (gap1 < hw - .8) B(gap1, 0, frontZ - .2, hw - .8, 2.8, frontZ + .2, P.wall);
    B(gap0, 2.4, frontZ - .2, gap1, 2.8, frontZ + .2, P.stone);
    B(gap0 - .2, 2.8, frontZ - .4, gap1 + .2, 3.0, frontZ + .4, P.roof);
    B(gap0, 0, frontZ - .4, gap1, .2, frontZ + .6, P.stone);
    return { width: w, depth: d, height: Math.max(main.height, gate.height), floors: spec.floors || 1, type: 'courtyard', grid: Q, envelope: true, court: { minX: -innerHW, maxX: innerHW, minZ: openBack, maxZ: openFront }, door: { x: (gap0 + gap1) / 2, y: .2, z: frontZ + .6, width: gap1 - gap0, facing: [0, 0, 1] }, parts: wing ? 4 : 2 };
  }
  function pavilion(B, spec) {
    const w = extent(clamp(spec.width || 6.4, 4.4, 10.4)), d = extent(clamp(spec.depth || 6.4, 4.4, 10.4));
    const hw = w / 2 - .8, hd = d / 2 - .8, H = 3.6;
    B(-w / 2, 0, -d / 2, w / 2, .2, d / 2, P.base);
    B(-w / 2 + .2, .2, -d / 2 + .2, w / 2 - .2, .4, d / 2 - .2, P.stone);
    for (const x of [-hw, hw]) for (const z of [-hd, hd]) {
      B(x - .4, .4, z - .4, x + .4, .6, z + .4, P.stoneDark);
      B(x - .2, .6, z - .2, x + .2, H, z + .2, P.woodDark);
      B(x - .4, H - .4, z - .4, x + .4, H - .2, z + .4, P.wood);
    }
    B(-hw - .2, H - .4, -hd - .2, hw + .2, H - .2, -hd + .2, P.wood);
    B(-hw - .2, H - .4, hd - .2, hw + .2, H - .2, hd + .2, P.wood);
    B(-hw - .2, H - .4, -hd, -hw + .2, H - .2, hd, P.wood);
    B(hw - .2, H - .4, -hd, hw + .2, H - .2, hd, P.wood);
    const top = roof(B, w - .8, d - 1.2, H, spec.seed || 1, { noGable: true, hipGable: true });
    return { width: w, depth: d, height: top, eaveHeight: H, type: 'pavilion', grid: Q, door: { x: 0, y: .4, z: d / 2, width: 2, facing: [0, 0, 1] } };
  }
  // A translated/quarter-turned emitter keeps every constituent on the same
  // 0.2 m construction grid. Dimensions regenerate parts rather than scaling.
  function offsetBox(B, tx, ty, tz, quarter) {
    const r = ((quarter || 0) % 4 + 4) % 4;
    return (x0, y0, z0, x1, y1, z1, c) => {
      const points = [[x0,z0],[x1,z0],[x0,z1],[x1,z1]].map(([x,z]) => r === 1 ? [z,-x] : r === 2 ? [-x,-z] : r === 3 ? [-z,x] : [x,z]);
      B(tx+Math.min(...points.map(p=>p[0])),ty+y0,tz+Math.min(...points.map(p=>p[1])),tx+Math.max(...points.map(p=>p[0])),ty+y1,tz+Math.max(...points.map(p=>p[1])),c);
    };
  }
  const wallTones = [0xe4e0d2, 0xd8d9d0, 0xd4cebc];
  function safeOpenings(list, length, H) {
    return list.filter(o => o.x-o.w/2 >= -length/2+.4 && o.x+o.w/2 <= length/2-.4 && o.y+o.h <= H+.01)
      .sort((a,b)=>a.x-b.x).filter((o,i,all)=>!all.slice(0,i).some(p=>Math.abs(p.x-o.x)<(p.w+o.w)/2+.19&&p.y<o.y+o.h&&o.y<p.y+p.h));
  }
  /* A residential volume supplies deliberately different facade rhythms.
     Side walls can be mostly closed; these are inhabited rural houses, not
     four identical display facades. Opening panels remain behind true reveals. */
  function residence(B, opt) {
    const w=extent(opt.width), d=extent(opt.depth), hw=w/2,hd=d/2,base=.4;
    const floors=clamp(opt.floors||1,1,3),fh=opt.floorH||3.2,H=q(base+floors*fh),seed=opt.seed||1;
    const tone=wallTones[Math.abs(seed)%wallTones.length],modern=!!opt.current;
    B(-hw,0,-hd,hw,.2,hd,P.base); B(-hw,.2,-hd,hw,.4,hd,P.stone);
    const doorX=q(opt.doorX||0),doorW=opt.doorWidth||1.4;
    for(const sign of [-1,1]) {
      const openings=[];
      for(let f=0;f<floors;f++) {
        const bottom=base+f*fh;
        if(sign===1) {
          if(opt.shopfront&&f===0) {
            const bays=Math.max(2,Math.floor(w/2.6));
            for(let i=0;i<bays;i++)openings.push({x:q(-w/2+(i+.5)*w/bays),y:base,w:q(Math.min(2.0,w/bays-.6)),h:2.4,door:true});
          } else {
            const positions = w<6.2 ? [-w*.25,w*.25] : opt.sparse ? [-w*.29,w*.22] : [-w*.31,0,w*.31];
            for(let i=0;i<positions.length;i++) {
              const x=q(positions[i]),ww=modern?1.4:1.2;
              if(f===0&&Math.abs(x-doorX)<(doorW+ww)/2+.2)continue;
              if(f>0&&opt.sparse&&i===1&&seed%2===0)continue;
              openings.push({x,y:q(bottom+(modern?1:1.2)),w:ww,h:modern?1.4:1.2});
            }
          }
        } else {
          // Smaller high windows and a rear service door break the front/back symmetry.
          for(const x of (w<7?[-w*.24]:[-w*.3,w*.26])) openings.push({x:q(x),y:q(bottom+1.4),w:1.0,h:1.0});
        }
      }
      if(sign===1&&!opt.shopfront)openings.push({x:doorX,y:base,w:doorW,h:2.4,door:true});
      if(sign===-1&&opt.backDoor)openings.push({x:q(w*.18),y:base,w:1.2,h:2.2,door:true});
      facade(B,w,hd,'z',sign,base,H,safeOpenings(openings,w,H),sign>0?tone:P.wallShade,modern);
    }
    for(const sign of [-1,1]) {
      const openings=[];
      // One side often stands close to a neighbour: do not manufacture a
      // regular window wall along every narrow lane or side court boundary.
      if(!(opt.closedSide===sign))for(let f=0;f<floors;f++) {
        const xx=q((f+seed)%2 ? -d*.18 : d*.16);
        openings.push({x:xx,y:q(base+f*fh+1.6),w:1.0,h:1.0});
      }
      facade(B,d,hw,'x',sign,base,H,safeOpenings(openings,d,H),sign>0?tone:P.wallShade,modern);
    }
    for(let f=1;f<=floors;f++)B(-hw+.4,base+f*fh-.2,-hd+.4,hw-.4,base+f*fh,hd-.4,modern?P.stone:P.woodDark);
    if(floors>1&&modern)for(const sign of [-1,1])B(-hw,3.4,sign>0?hd:-hd-.2,hw,3.6,sign>0?hd+.2:-hd,P.stone);
    if(!opt.shopfront) {
      B(doorX-doorW/2-.2,0,hd,doorX+doorW/2+.2,.2,hd+.6,P.stone);
      B(doorX-doorW/2,.2,hd,doorX+doorW/2,.4,hd+.4,P.base);
    }
    const top=opt.ridgeAlongDepth?roof(offsetBox(B,0,0,0,1),d,w,H,seed,{simpleRidge:true}):roof(B,w,d,H,seed,{simpleRidge:true});
    return{width:w,depth:d,height:top,eaveHeight:H,floors,grid:Q,door:{x:doorX,y:base,z:hd+.6,width:doorW,facing:[0,0,1]}};
  }
  function leanRoof(B,w,depth,y,z,seed) {
    const layers=Math.max(3,Math.round(depth/.6));
    for(let j=0;j<layers;j++) {
      const z0=q(z+j*depth/layers),z1=q(z+(j+1)*depth/layers+.2),yy=q(y-j*.2);
      for(let x=-w/2-.2;x<w/2+.19;x+=.8)B(q(x),yy,z0,Math.min(w/2+.2,q(x+.8)),yy+.2,z1,(j+Math.round(x*5)+seed)%4?P.roof:P.roofLight);
    }
  }
  function narrowHouse(E,spec) {
    const w=extent(clamp(spec.width||7.2,6.0,10.0)),d=extent(clamp(spec.depth||11.2,8.4,14.0)),B=E.box;
    const frontD=extent(d*.60),rearD=extent(d-frontD),frontZ=q((d-frontD)/2),rearZ=q(-d/2+rearD/2),seed=spec.seed||1;
    const main=residence(E.sub(0,0,frontZ),{width:w,depth:frontD,floors:spec.floors===1?1:2,seed,sparse:true,closedSide:-1,ridgeAlongDepth:true,backDoor:false,doorX:q(-w*.15)});
    const rear=residence(E.sub(.4,0,rearZ),{width:w-.8,depth:rearD,floors:1,floorH:2.8,seed:seed+1,closedSide:1,backDoor:true,sparse:true});
    return{...main,width:w,depth:d,height:Math.max(main.height,rear.height),type:'narrowHouse',tags:['narrow-deep','front-gable','stepped-rear-kitchen','sparse-side-wall'],parts:2};
  }
  function rowHouse(E,spec) {
    const w=extent(clamp(spec.width||13.2,8.0,18.0)),d=extent(clamp(spec.depth||7.6,5.6,10.0)),n=w>=11.6?3:2,bayW=extent(w/n),seed=spec.seed||1;
    let top=0;
    for(let i=0;i<n;i++) {
      const x=q((i-(n-1)/2)*bayW),backStep=i===n-1?.4:0;
      const m=residence(E.sub(x,0,-backStep/2),{width:bayW,depth:d-backStep,floors:1,floorH:i===1?3.2:3.0,seed:seed+i,sparse:true,closedSide:i===0?1:-1,backDoor:true,doorX:q(-bayW*.18),doorWidth:1.2,ridgeAlongDepth:true});
      top=Math.max(top,m.height);
    }
    return{width:q(n*bayW),depth:d,height:top,eaveHeight:3.6,floors:1,type:'rowHouse',grid:Q,parts:n,tags:['attached-bays','multiple-parallel-ridges','rear-service-doors','low-street-wall'],door:{x:0,y:.4,z:d/2+.6,width:1.2,facing:[0,0,1]}};
  }
  function sideCourt(E,spec) {
    const w=extent(clamp(spec.width||12.8,10.4,18.0)),d=extent(clamp(spec.depth||11.2,9.6,16.0)),hw=w/2,hd=d/2,B=E.box,seed=spec.seed||1;
    const rearD=4.4,wingW=4.0,wingD=extent(d-rearD),rearZ=q(-hd+rearD/2),wingZ=q(-hd+rearD+wingD/2);
    const rear=residence(E.sub(0,0,rearZ),{width:w,depth:rearD,floors:spec.floors===2?2:1,seed,sparse:true,backDoor:true,closedSide:-1});
    const wing=residence(E.sub(-hw+wingW/2,0,wingZ,1),{width:wingD,depth:wingW,floors:1,floorH:2.8,seed:seed+5,sparse:true,backDoor:false,closedSide:1});
    const left=q(-hw+wingW+.4),right=q(hw-.4),back=q(-hd+rearD+.4),front=q(hd-.4);
    // Genuine air above the court, with a small paved route instead of an
    // opaque building-sized support slab. Planting soil stays uncovered.
    B(left,0,back,left+1.2,.2,front,P.base);
    B(left,.0,back,right,.2,back+1.0,P.stone);
    const gapX=q(hw-2.2),gap0=gapX-.8,gap1=gapX+.8;
    for(const pair of[[left,gap0],[gap1,hw]])if(pair[1]>pair[0]) {
      B(pair[0],0,hd-.4,pair[1],2.0,hd,P.wallShade);
      B(pair[0]-.2,2.0,hd-.6,pair[1]+.2,2.2,hd+.2,P.roof);
    }
    B(hw-.4,0,back,hw,2.0,hd,P.wallShade);B(hw-.6,2.0,back,hw+.2,2.2,hd,P.roof);
    B(gap0-.2,2.0,hd-.6,gap1+.2,2.4,hd+.2,P.stone);B(gap0-.4,2.4,hd-.8,gap1+.4,2.6,hd+.4,P.roof);
    B(gap0,0,hd-.8,gap1,.2,hd+.4,P.stone);
    return{width:w,depth:d,height:Math.max(rear.height,wing.height),floors:rear.floors,eaveHeight:rear.eaveHeight,type:'sideCourt',grid:Q,parts:2,tags:['L-plan','empty-side-court','street-court-gate','unequal-roof-heights'],court:{minX:left,maxX:right,minZ:back,maxZ:front},door:{x:gapX,y:.2,z:hd+.4,width:1.6,facing:[0,0,1]}};
  }
  function workshop(E,spec) {
    const w=extent(clamp(spec.width||14.0,8.4,20.0)),d=extent(clamp(spec.depth||7.2,5.2,10.4)),B=E.box,seed=spec.seed||1;
    const body=residence(B,{width:w,depth:d-1.2,floors:1,floorH:3.0,seed,shopfront:true,backDoor:true,sparse:true,closedSide:-1});
    // A shallow open timber awning differs from a residential door hood.
    const front=q((d-1.2)/2),outer=q(d/2+1.0);
    for(let x=-w/2+.4;x<=w/2-.39;x+=2.8) {
      const xx=q(x);B(xx-.2,.2,outer-.2,xx+.2,2.8,outer+.2,P.woodDark);B(xx-.4,2.6,outer-.2,xx+.4,2.8,outer+.2,P.wood);
    }
    B(-w/2-.2,2.8,outer-.2,w/2+.2,3.0,outer+.2,P.woodDark);
    leanRoof(B,w,outer-front+.2,3.8,front,seed);
    // Folded wooden shutters stand at one outer edge; no fabricated shop sign.
    for(let x=-w/2+.4;x<-w/2+1.19;x+=.2)B(q(x),.4,front+.2,q(x)+.2,2.6,front+.4,P.woodLight);
    return{...body,width:w,depth:d+1.0,type:'workshop',tags:['low-long','multi-door-wood-front','open-timber-awning','service-rear'],parts:2};
  }
  function villageHouse(E,spec) {
    const w=extent(clamp(spec.width||11.2,8.0,16.0)),d=extent(clamp(spec.depth||9.6,7.2,13.2)),B=E.box,seed=spec.seed||1;
    const porchD=2.0,bodyD=extent(d-porchD),bodyZ=-porchD/2;
    const main=residence(E.sub(0,0,bodyZ),{width:w-.8,depth:bodyD,floors:spec.floors||2,floorH:3.0,seed,current:true,sparse:true,backDoor:true,closedSide:seed%2?1:-1,doorX:q(-w*.18)});
    const front=q(d/2),back=q(bodyZ+bodyD/2),porchRoof=3.4;
    for(const x of[-w/2+.6,w*.10,w/2-.6]) {
      B(q(x)-.2,0,front-.4,q(x)+.2,.4,front,P.stone);B(q(x)-.2,.4,front-.4,q(x)+.2,3.0,front,P.wallShade);
    }
    B(-w/2+.4,3.0,front-.4,w/2-.4,3.2,front,P.stone);
    leanRoof(B,w-.4,front-back+.2,porchRoof,back,seed);
    B(-w/2+.4,0,front-.8,w/2-.4,.2,front,P.stone);
    // A low flat utility volume attaches to one side, producing an asymmetric
    // skyline typical of altered rural dwellings rather than another temple.
    if(w>=10.8) {
      const bw=2.4,bx=w/2-1.2,z=q(-d/2+2.0);
      B(bx-bw/2,0,z-1.6,bx+bw/2,2.8,z+1.6,P.wallShade);
      B(bx-bw/2-.2,2.8,z-1.8,bx+bw/2+.2,3.0,z+1.8,P.stoneDark);
    }
    return{...main,width:w,depth:d,height:main.height,type:'villageHouse',tags:['present-day-rural','asymmetric-open-porch','mixed-window-rhythm','low-utility-roof'],parts:w>=10.8?3:2,door:{x:q(-w*.18),y:.4,z:front,width:1.4,facing:[0,0,1]}};
  }
  function corridor(E,spec) {
    const w=extent(clamp(spec.width||12.0,4.0,40)),d=extent(clamp(spec.depth||2.8,2.0,4.8)),B=E.box,H=q(spec.height||3.2),modern=spec.roof==='flat';
    B(-w/2,0,-d/2,w/2,.2,d/2,P.base);
    const n=Math.max(2,Math.round((w-.8)/3.2));
    for(let i=0;i<=n;i++)for(const sign of [-1,1]) {
      const x=q(-w/2+.4+(w-.8)*i/n),z=q(sign*(d/2-.4));
      B(x-.2,.2,z-.2,x+.2,H,z+.2,modern?P.modernWall:P.woodDark);
      B(x-.4,H-.4,z-.2,x+.4,H-.2,z+.2,modern?P.stone:P.wood);
    }
    for(const sign of [-1,1])B(-w/2,H-.2,sign*d/2-.2,w/2,H,sign*d/2+.2,modern?P.stone:P.woodDark);
    let top;
    if(modern){B(-w/2-.2,H,-d/2-.2,w/2+.2,H+.2,d/2+.2,P.stone);top=H+.2;}
    else top=roof(B,w-.8,d-.8,H,spec.seed||1,{simpleRidge:true,noGable:true});
    return{width:w,depth:d,height:top,eaveHeight:H,floors:1,type:'corridor',grid:Q,tags:['open-walkway','column-beam-frame',modern?'flat-canopy':'tile-roof'],door:{x:w/2,y:.2,z:0,width:d,facing:[1,0,0]}};
  }
  function schoolBlock(E,spec) {
    const w=extent(clamp(spec.width||28,16,44)),d=extent(clamp(spec.depth||10.4,8.8,14.0)),B=E.box,floors=clamp(Math.round(spec.floors||3),2,4),fh=3.2,base=.4,H=q(base+floors*fh),stairW=3.6;
    const roomW=extent(w-stairW),roomD=extent(d-2.4),cx=-stairW/2,cz=-1.2,hw=roomW/2,hd=roomD/2;
    const R=E.sub(cx,0,cz),bayCount=Math.max(3,Math.round(roomW/4.8));
    B(-w/2,0,-d/2,w/2,.4,d/2,P.base);
    for(const sign of [-1,1]) {
      const openings=[];
      for(let f=0;f<floors;f++)for(let i=0;i<bayCount;i++) {
        const x=q(-roomW/2+(i+.5)*roomW/bayCount);
        openings.push(sign===1?{x:q(x-.8),y:q(base+f*fh),w:1.2,h:2.4,door:true}:{x,y:q(base+f*fh+1),w:2.8,h:1.6});
        if(sign===1)openings.push({x:q(x+1.0),y:q(base+f*fh+1.2),w:1.4,h:1.2});
      }
      facade(R,roomW,hd,'z',sign,base,H,safeOpenings(openings,roomW,H),P.modernWall,true);
    }
    for(const sign of[-1,1]) {
      const openings=[];for(let f=0;f<floors;f++)openings.push({x:0,y:q(base+f*fh+1.4),w:1.6,h:1.2});
      facade(R,roomD,hw,'x',sign,base,H,openings,P.wallShade,true);
    }
    for(let f=0;f<=floors;f++) {
      const y=q(base+f*fh),outerZ=d/2-.2;
      if(f===0||f===floors)B(-w/2,y-.2,-d/2,w/2,y,d/2,P.stone);
      else {
        // The floor slab is cut around the stair flights, so their upper
        // ends reach an actual landing rather than a sealed solid ceiling.
        B(-w/2,y-.2,-d/2,w/2-stairW,y,d/2,P.stone);
        B(w/2-stairW,y-.2,d/2-2.4,w/2,y,d/2,P.stone);
        B(w/2-stairW,y-.2,-d/2,w/2,y,-d/2+1.0,P.stone);
      }
      if(f<floors) {
        // Open circulation gallery: actual air between the railing and beam.
        B(-w/2,y+.8,outerZ-.2,w/2,y+1.0,outerZ+.2,P.modernFrame);
        B(-w/2,y+.2,outerZ-.2,w/2,y+.4,outerZ+.2,P.modernWall);
        for(let x=-w/2+.4;x<w/2-.2;x+=1.2)B(q(x),y+.4,outerZ-.2,q(x)+.2,y+.8,outerZ+.2,P.modernFrame);
        for(let i=0;i<=bayCount;i++) {
          const x=q(-w/2+i*roomW/bayCount);
          B(x-.2,y,outerZ-.2,x+.2,y+fh,outerZ+.2,P.wallLight);
        }
      }
    }
    // End stairwell uses two reversing flights per storey and clear landings.
    const sx=q(w/2-stairW/2),back=-d/2+.6,run=3.2,stepN=8;
    for(let f=0;f<floors-1;f++) {
      const y=q(base+f*fh);
      for(let i=0;i<stepN;i++) {
        const zz=q(back+i*.4),hh=q((i+1)*.2);
        B(sx-1.4,y,zz,sx-.2,y+hh,zz+.4,P.stone);
        const zz2=q(back+(stepN-1-i)*.4);
        B(sx+.2,y+1.6,zz2,sx+1.4,y+1.6+hh,zz2+.4,P.stone);
      }
      B(sx-1.4,y+1.4,back+run,sx+1.4,y+1.6,back+run+1.2,P.stone);
      for(const xx of[sx-1.4,sx+1.4])B(xx-.1,y+2.2,back+run,xx+.1,y+2.4,back+run+1.2,P.modernFrame);
    }
    for(const xx of[sx-1.6,sx+1.6])for(const zz of[-d/2+.4,d/2-.4])B(xx-.2,base,zz-.2,xx+.2,H,zz+.2,P.wallShade);
    // Modest flat roof with a continuous parapet, no domestic gable grafted on.
    B(-w/2-.2,H,-d/2-.2,w/2+.2,H+.2,d/2+.2,P.stoneDark);
    for(const sign of[-1,1]) {
      B(-w/2,H+.2,sign>0?d/2-.4:-d/2,w/2,H+.8,sign>0?d/2:-d/2+.4,P.modernWall);
      B(sign>0?w/2-.4:-w/2,H+.2,-d/2,sign>0?w/2:-w/2+.4,H+.8,d/2,P.modernWall);
    }
    return{width:w,depth:d,height:H+.8,eaveHeight:H,floors,type:'schoolBlock',grid:Q,tags:['school-classroom-wing','open-gallery','reversing-staircase','flat-parapet','modern-large-windows'],parts:2,door:{x:cx,y:base,z:d/2,width:roomW,facing:[0,0,1]}};
  }
  function build(builder, specification) {
    if (!builder || typeof builder.box !== 'function') throw new TypeError('DSArchitecture.build requires builder.box(x,y,z,w,h,d,color)');
    const spec = Object.assign({ type: 'house', seed: 1 }, specification || {}), E = emitter(builder);
    const constructors={courtyard, narrowHouse, rowHouse, sideCourt, workshop, villageHouse, schoolBlock, corridor};
    const info = constructors[spec.type] ? constructors[spec.type](E,spec) : spec.type === 'modern' ? modern(E.box, spec) : spec.type === 'pavilion' ? pavilion(E.box, spec) : ordinary(E.box, spec);
    info.bounds = Object.assign({}, E.bounds); info.boxCount = E.count();
    if(!info.tags)info.tags=spec.type==='courtyard'?['multi-wing','open-courtyard']:spec.type==='modern'?['flat-roof','parapet','metal-frame-windows']:['traditional-gable','recessed-openings'];
    info.source = 'Dongshan local reference forms and Yunshan voxel construction; typological dimensions, not surveyed reconstruction';
    return info;
  }
  global.DSArchitecture = Object.freeze({ build, palette: P, grid: Q, types:['house','shop','modern','courtyard','pavilion','narrowHouse','rowHouse','sideCourt','workshop','villageHouse','schoolBlock','corridor'], version: '2.1.0' });
})(typeof window === 'undefined' ? globalThis : window);
