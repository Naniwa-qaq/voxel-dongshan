/* Exact opaque-box union and six-direction greedy surface meshing.
   Intended for one local house/tree asset, never the whole geographic world. */
(function (global) {
  'use strict';
  const NORMALS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const clock = () => typeof performance !== 'undefined' ? performance.now() : Date.now();
  const clean = n => Math.abs(n) < 1e-10 ? 0 : +n.toFixed(10);
  function build(boxes, options) {
    const started = clock(), opt = options || {}, quantum = Number(opt.quantum === undefined ? .2 : opt.quantum);
    if (!Array.isArray(boxes)) throw new TypeError('DSMeshing.build expects an array of box objects.');
    if (!Number.isFinite(quantum) || quantum <= 0) throw new RangeError('quantum must be a positive finite number.');
    const exact = Math.abs(quantum - .2) < 1e-9;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    const input = [], palette = new Set();
    let maxGridError = 0, skipped = 0;
    // One small integer record per input box, never an object per occupied cell.
    for (let b = 0; b < boxes.length; b++) {
      const box = boxes[b];
      const center = [Number(box.x), Number(box.y), Number(box.z)];
      const size = [Number(box.w), Number(box.h), Number(box.d)];
      if (!center.every(Number.isFinite) || !size.every(Number.isFinite)) throw new TypeError('Box ' + b + ' contains a non-finite coordinate or dimension.');
      if (size.some(v => v <= 0)) { skipped++; continue; }
      const record = new Int32Array(7);
      for (let a = 0; a < 3; a++) {
        const lo = (center[a] - size[a] / 2) / quantum;
        const hi = (center[a] + size[a] / 2) / quantum;
        const error = Math.max(Math.abs(lo - Math.round(lo)), Math.abs(hi - Math.round(hi)));
        maxGridError = Math.max(maxGridError, error * quantum);
        if (exact && error > 1e-5) throw new RangeError('Box ' + b + ' has a boundary outside the 0.2 m construction grid.');
        // Exact near assets retain their original boundaries. Optional coarser
        // assets conservatively cover every touched cell, retaining tiny twigs.
        const lower = exact ? Math.round(lo) : Math.floor(lo + 1e-7);
        const upper = exact ? Math.round(hi) : Math.ceil(hi - 1e-7);
        if (upper <= lower) throw new RangeError('Box ' + b + ' is thinner than the exact construction grid.');
        record[a] = lower; record[a + 3] = upper;
        min[a] = Math.min(min[a], lower); max[a] = Math.max(max[a], upper);
      }
      const rawColor = box.color === undefined ? 0xffffff : Number(box.color);
      if (!Number.isInteger(rawColor) || rawColor < 0 || rawColor > 0xffffff) throw new RangeError('Box ' + b + ' color must be a 24-bit RGB integer.');
      const color = rawColor >>> 0;
      record[6] = color + 1; palette.add(color); input.push(record);
    }
    if (!input.length) return { faces: [], stats: { quantum, exact, inputBoxes: boxes.length, skippedBoxes: skipped, occupiedVoxels: 0, visibleUnitFaces: 0, quads: 0, triangles: 0, surfaceArea: 0, denseBytes: 0, dimensions: [0, 0, 0], elapsedMs: clock() - started } };
    const dims = max.map((v, a) => v - min[a]);
    const cellCount = dims[0] * dims[1] * dims[2], maxCells = opt.maxCells || 8000000;
    if (!Number.isSafeInteger(cellCount) || cellCount > maxCells) throw new RangeError('Local asset needs ' + cellCount + ' cells; limit is ' + maxCells + '. Mesh one asset, not world terrain.');
    const stride = [1, dims[0], dims[0] * dims[1]];
    const field = new Uint32Array(cellCount);
    for (let k = 0; k < input.length; k++) {
      const b = input[k], x0 = b[0] - min[0], y0 = b[1] - min[1], z0 = b[2] - min[2];
      const x1 = b[3] - min[0], y1 = b[4] - min[1], z1 = b[5] - min[2], color = b[6];
      for (let z = z0; z < z1; z++) {
        const zOffset = z * stride[2];
        for (let y = y0; y < y1; y++) {
          const row = zOffset + y * stride[1];
          field.fill(color, row + x0, row + x1);
        }
      }
    }
    let occupied = 0;
    for (let k = 0; k < field.length; k++) if (field[k]) occupied++;
    const voxelized = clock(), faces = [];
    let visibleUnitFaces = 0, integerArea = 0;
    // A signed mask value carries both exterior normal and the surface color.
    // Adjacent occupied cells have no face even when their colors differ.
    const mask = new Int32Array(Math.max(dims[0] * dims[1], dims[1] * dims[2], dims[2] * dims[0]));
    for (let axis = 0; axis < 3; axis++) {
      const u = (axis + 1) % 3, v = (axis + 2) % 3;
      const width = dims[u], height = dims[v], axisStride = stride[axis], uStride = stride[u], vStride = stride[v];
      for (let slice = 0; slice <= dims[axis]; slice++) {
        let n = 0;
        for (let j = 0; j < height; j++) {
          let index = slice * axisStride + j * vStride;
          for (let i = 0; i < width; i++, index += uStride) {
            const negative = slice > 0 ? field[index - axisStride] : 0;
            const positive = slice < dims[axis] ? field[index] : 0;
            const color = negative && !positive ? negative : !negative && positive ? -positive : 0;
            mask[n++] = color;
            if (color) visibleUnitFaces++;
          }
        }
        for (let j = 0; j < height; j++) {
          let i = 0;
          while (i < width) {
            const offset = j * width + i, material = mask[offset];
            if (!material) { i++; continue; }
            let rw = 1;
            while (i + rw < width && mask[offset + rw] === material) rw++;
            let rh = 1, same = true;
            while (j + rh < height && same) {
              const nextRow = offset + rh * width;
              for (let k = 0; k < rw; k++) if (mask[nextRow + k] !== material) { same = false; break; }
              if (same) rh++;
            }
            for (let yy = 0; yy < rh; yy++) mask.fill(0, offset + yy * width, offset + yy * width + rw);
            // u,v,axis are cyclic, so cross(+u,+v) is +axis.
            const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0], d = [0, 0, 0];
            a[axis] = b[axis] = c[axis] = d[axis] = clean((min[axis] + slice) * quantum);
            a[u] = d[u] = clean((min[u] + i) * quantum);
            b[u] = c[u] = clean((min[u] + i + rw) * quantum);
            a[v] = b[v] = clean((min[v] + j) * quantum);
            c[v] = d[v] = clean((min[v] + j + rh) * quantum);
            const positive = material > 0, normal = NORMALS[axis * 2 + (positive ? 0 : 1)];
            faces.push(positive ? { a, b, c, d, n: normal, color: material - 1 } : { a, b: d, c, d: b, n: normal, color: -material - 1 });
            integerArea += rw * rh;
            i += rw;
          }
        }
      }
    }
    const finished = clock();
    const stats = {
      quantum, exact, conservativeCoarseQuantization: !exact, inputBoxes: boxes.length, usedBoxes: input.length, skippedBoxes: skipped,
      inputBoxQuads: input.length * 6, inputBoxTriangles: input.length * 12,
      dimensions: dims, bounds: { min: min.map(n => clean(n * quantum)), max: max.map(n => clean(n * quantum)) },
      allocatedVoxels: cellCount, occupiedVoxels: occupied, occupiedVolume: clean(occupied * quantum ** 3),
      visibleUnitFaces, quads: faces.length, triangles: faces.length * 2, surfaceArea: clean(integerArea * quantum ** 2),
      greedyUnitFaceReduction: visibleUnitFaces ? 1 - faces.length / visibleUnitFaces : 0,
      boxTriangleReduction: input.length ? 1 - faces.length / (input.length * 6) : 0,
      inputColors: palette.size, denseBytes: field.byteLength, maskBytes: mask.byteLength,
      maxInputGridErrorMetres: maxGridError, voxelizeMs: voxelized - started, meshMs: finished - voxelized, elapsedMs: finished - started
    };
    const result = { faces, stats };
    if (opt.buffers) result.buffers = buffers(faces);
    return result;
  }
  function buffers(faces) {
    const positions = new Float32Array(faces.length * 12), normals = new Float32Array(faces.length * 12), colors = new Uint32Array(faces.length * 4), indices = new Uint32Array(faces.length * 6);
    for (let f = 0; f < faces.length; f++) {
      const face = faces[f], points = [face.a, face.b, face.c, face.d];
      for (let v = 0; v < 4; v++) {
        positions.set(points[v], f * 12 + v * 3); normals.set(face.n, f * 12 + v * 3); colors[f * 4 + v] = face.color;
      }
      const k = f * 4; indices.set([k, k + 1, k + 2, k, k + 2, k + 3], f * 6);
    }
    // Hex colors intentionally remain integers; a renderer applies its own
    // color-space conversion and directional shading exactly once.
    return { positions, normals, colors, indices };
  }
  global.DSMeshing = Object.freeze({ build, buffers, version: '1.0.0' });
})(typeof window === 'undefined' ? globalThis : window);
