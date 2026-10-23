async function buildTerrain() {
  groundMinX = Math.floor(bounds.minX);
  groundMinZ = Math.floor(bounds.minZ);
  gw = Math.ceil(bounds.maxX - groundMinX);
  gh = Math.ceil(bounds.maxZ - groundMinZ);
  gridH = new Float32Array(gw * gh);
  waterCells = 0;

  // Keep the existing 1 m local / 2 m background sampling exactly as it was.
  for (let z = 0; z < gh; z += 2) {
    for (let x = 0; x < gw; x += 2) {
      const xx = groundMinX + x, zz = groundMinZ + z;
      const near = (D.zones || [{ bounds }]).some(s => xx > s.bounds.minX - 25 && xx < s.bounds.maxX + 25 && zz > s.bounds.minZ - 25 && zz < s.bounds.maxZ + 25);
      const coarse = near ? null : heightAt(xx + 1, zz + 1);
      for (let dz = 0; dz < 2 && z + dz < gh; dz++) {
        for (let dx = 0; dx < 2 && x + dx < gw; dx++) {
          const h = near ? heightAt(xx + dx + .5, zz + dz + .5) : coarse;
          gridH[(z + dz) * gw + x + dx] = h;
          if (h < 0) waterCells++;
        }
      }
    }
    if (z % 32 === 0) {
      setLoading(`铺设连续方阶地表 · ${Math.round(z / gh * 100)}%`);
      await tick();
    }
  }

  // Color is constant on a sampled column: evaluate it once, not each time
  // a horizontal run is extended or tested against the following row.
  const gridColor = new Uint32Array(gw * gh);
  const stoneEdge = new Uint8Array(gw * gh);
  let landColumns = 0;
  for (let z = 0; z < gh; z++) {
    for (let x = 0; x < gw; x++) {
      const k = z * gw + x, h = gridH[k];
      if (h < 0) continue;
      const xx = groundMinX + x + .5, zz = groundMinZ + z + .5;
      gridColor[k] = groundColor(xx, zz, h);
      stoneEdge[k] = roadAt(xx, zz) || canalNear(xx, zz, .3) ? 1 : 0;
      landColumns++;
    }
    if (z % 64 === 0) await tick();
  }

  const size = 48;
  const stats = { landColumns, colorEvaluations: landColumns, topQuads: 0, wallQuads: 0, chunks: 0, exactSurfaceMerge: true };
  const height = (x, z) => x < 0 || x >= gw || z < 0 || z >= gh ? -1 : gridH[z * gw + x];
  for (let z0 = 0; z0 < gh; z0 += size) {
    for (let x0 = 0; x0 < gw; x0 += size) {
      const b = new BoxBatch(), xEnd = Math.min(gw, x0 + size), zEnd = Math.min(gh, z0 + size);
      const chunkWidth = xEnd - x0, used = new Uint8Array(chunkWidth * (zEnd - z0));

      // Top rectangles merge in both X and Z only when height AND color
      // are identical. No interpolation, averaging or change to the steps.
      for (let z = z0; z < zEnd; z++) {
        for (let x = x0; x < xEnd;) {
          const local = (z - z0) * chunkWidth + x - x0, k = z * gw + x;
          const h = gridH[k], co = gridColor[k];
          if (used[local] || h < 0) { x++; continue; }
          let endX = x + 1;
          while (endX < xEnd && !used[(z - z0) * chunkWidth + endX - x0] && gridH[z * gw + endX] === h && gridColor[z * gw + endX] === co) endX++;
          let endZ = z + 1;
          row: while (endZ < zEnd) {
            for (let xx = x; xx < endX; xx++) {
              const next = endZ * gw + xx;
              if (used[(endZ - z0) * chunkWidth + xx - x0] || gridH[next] !== h || gridColor[next] !== co) break row;
            }
            endZ++;
          }
          for (let zz = z; zz < endZ; zz++) used.fill(1, (zz - z0) * chunkWidth + x - x0, (zz - z0) * chunkWidth + endX - x0);
          const ax = groundMinX + x, bx = groundMinX + endX, az = groundMinZ + z, bz = groundMinZ + endZ;
          b.quad([ax, h, bz], [bx, h, bz], [bx, h, az], [ax, h, az], [0, 1, 0], co);
          stats.topQuads++;
          x = endX;
        }
      }

      // For each of the four wall directions, scan one fixed face plane.
      // Adjacent strips merge only if upper/lower heights and color match.
      // This preserves the old lower limit, exposed-face rule and winding.
      for (let axis = 0; axis < 2; axis++) {
        const fixedStart = axis === 0 ? x0 : z0, fixedEnd = axis === 0 ? xEnd : zEnd;
        const alongStart = axis === 0 ? z0 : x0, alongEnd = axis === 0 ? zEnd : xEnd;
        for (const sign of [-1, 1]) {
          const dx = axis === 0 ? sign : 0, dz = axis === 0 ? 0 : sign;
          for (let fixed = fixedStart; fixed < fixedEnd; fixed++) {
            let along = alongStart;
            while (along < alongEnd) {
              const x = axis === 0 ? fixed : along, z = axis === 0 ? along : fixed;
              const k = z * gw + x, h = gridH[k], nh = height(x + dx, z + dz);
              if (h < 0 || nh >= h - .01) { along++; continue; }
              const low = Math.max(-1, nh), co = nh < 0 || stoneEdge[k] ? 0x8f9987 : 0x6e8260;
              let end = along + 1;
              while (end < alongEnd) {
                const nx = axis === 0 ? fixed : end, nz = axis === 0 ? end : fixed;
                const nk = nz * gw + nx, nextH = gridH[nk], nextNeighbour = height(nx + dx, nz + dz);
                if (nextH !== h || nextNeighbour >= nextH - .01 || Math.max(-1, nextNeighbour) !== low || (nextNeighbour < 0 || stoneEdge[nk] ? 0x8f9987 : 0x6e8260) !== co) break;
                end++;
              }
              const plane = (axis === 0 ? groundMinX : groundMinZ) + fixed + (sign > 0 ? 1 : 0);
              const a = (axis === 0 ? groundMinZ : groundMinX) + along, e = (axis === 0 ? groundMinZ : groundMinX) + end;
              if (axis === 0 && sign > 0) b.quad([plane, low, a], [plane, h, a], [plane, h, e], [plane, low, e], [1, 0, 0], co, .96);
              else if (axis === 0) b.quad([plane, low, e], [plane, h, e], [plane, h, a], [plane, low, a], [-1, 0, 0], co, .96);
              else if (sign > 0) b.quad([e, low, plane], [e, h, plane], [a, h, plane], [a, low, plane], [0, 0, 1], co);
              else b.quad([a, low, plane], [a, h, plane], [e, h, plane], [e, low, plane], [0, 0, -1], co, .94);
              stats.wallQuads++;
              along = end;
            }
          }
        }
      }
      if (b.p.length) {
        const geometry = b.geometry(), m = new T.Mesh(geometry, terrainGroup.userData.material);
        m.receiveShadow = true;
        terrainGroup.add(m);
        state.terrainFaces += b.i.length / 6;
        stats.chunks++;
      }
    }
    await tick();
  }
  state.terrainMeshing = stats;
}
