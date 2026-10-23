'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const zlib = require('zlib');
const root = path.resolve(__dirname, '..');
const project = path.join(root, '东山镇_重制版');
const codeFiles = ['js/design.js', 'js/architecture.js', 'js/vegetation.js', 'js/meshing.js'];
const context = { window: {}, performance, console };
vm.createContext(context);
const codeHashes = {};
for (const rel of codeFiles) {
  const source = fs.readFileSync(path.join(project, rel), 'utf8');
  codeHashes[rel] = crypto.createHash('sha256').update(source).digest('hex');
  vm.runInContext(source, context, { filename: rel });
}
const { DSDesign: D, DSArchitecture: A, DSVegetation: V, DSMeshing: M } = context.window;
function meshKey(boxes, options) {
  const quantum = Number(options && options.quantum !== undefined ? options.quantum : .2);
  if (!Array.isArray(boxes) || !Number.isFinite(quantum)) return null;
  let a = 0x811c9dc5, b = 0x9e3779b9;
  const mix = n => { n |= 0; a = Math.imul(a ^ n, 0x01000193); b = Math.imul(b ^ n, 0x85ebca6b); b ^= b >>> 13; };
  mix(boxes.length); mix(Math.round(quantum * 1000000));
  for (let i = 0; i < boxes.length; i++) {
    const box = boxes[i];
    for (const k of ['x', 'y', 'z', 'w', 'h', 'd']) {
      const n = Number(box[k]);
      if (!Number.isFinite(n)) return null;
      mix(Math.round(n * 1000000));
    }
    mix(box.color === undefined ? 0xffffff : box.color);
  }
  return Math.round(quantum * 1000000) + ':' + boxes.length + ':' + (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}
function collect(fn, spec) {
  const boxes = [];
  fn({ box(x, y, z, w, h, d, color) { boxes.push({ x, y, z, w, h, d, color }); } }, spec);
  return boxes;
}
function packFaces(faces, quantum) {
  const bytes = Buffer.alloc(faces.length * 16);
  for (let i = 0; i < faces.length; i++) {
    const f = faces[i], points = [f.a, f.b, f.c, f.d], o = i * 16;
    const min = [0, 1, 2].map(a => Math.min(...points.map(p => p[a])));
    const max = [0, 1, 2].map(a => Math.max(...points.map(p => p[a])));
    for (let a = 0; a < 3; a++) {
      const lo = Math.round(min[a] / quantum), size = Math.round((max[a] - min[a]) / quantum);
      if (lo < -32768 || lo > 32767 || size < 0 || size > 65535) throw new Error('Local face exceeds compact integer bounds.');
      bytes.writeInt16LE(lo, o + a * 2); bytes.writeUInt16LE(size, o + 6 + a * 2);
    }
    const axis = f.n[0] ? 0 : f.n[1] ? 1 : 2;
    bytes[o + 12] = axis * 2 + (f.n[axis] > 0 ? 0 : 1);
    bytes[o + 13] = (f.color >>> 16) & 255; bytes[o + 14] = (f.color >>> 8) & 255; bytes[o + 15] = f.color & 255;
  }
  return bytes;
}
function unpackFaces(view, offset, count, quantum) {
  const faces = [], clean = n => Math.abs(n) < 1e-10 ? 0 : +n.toFixed(10);
  for (let i = 0; i < count; i++) {
    const o = offset + i * 16, code = view.getUint8(o + 12), axis = code >> 1, u = (axis + 1) % 3, v = (axis + 2) % 3;
    const lo = [0, 1, 2].map(a => clean(view.getInt16(o + a * 2, true) * quantum));
    const size = [0, 1, 2].map(a => clean(view.getUint16(o + 6 + a * 2, true) * quantum));
    const a = lo.slice(), b = lo.slice(), c = lo.slice(), d = lo.slice(), n = [0, 0, 0];
    b[u] = c[u] = clean(lo[u] + size[u]); c[v] = d[v] = clean(lo[v] + size[v]); n[axis] = code & 1 ? -1 : 1;
    const color = view.getUint8(o + 13) * 65536 + view.getUint8(o + 14) * 256 + view.getUint8(o + 15);
    faces.push(code & 1 ? { a, b: d, c, d: b, n, color } : { a, b, c, d, n, color });
  }
  return faces;
}
const index = {}, chunks = [], verification = [], typeCounts = {};
let offset = 0, inputAssets = 0, totalFaces = 0;
function bake(label, boxes, quantum) {
  inputAssets++;
  const key = meshKey(boxes, { quantum });
  if (index[key]) return;
  const result = M.build(boxes, { quantum }), bytes = packFaces(result.faces, quantum);
  index[key] = { offset, count: result.faces.length, quantum, stats: result.stats };
  chunks.push(bytes); offset += bytes.length; totalFaces += result.faces.length;
  if (verification.length < 3 && quantum === .2 || quantum === .2 && /^(courtyard|tree):/.test(label) && !verification.some(t => t.label.split(':')[0] === label.split(':')[0])) {
    const decoded = unpackFaces(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), 0, result.faces.length, quantum);
    for (let i = 0; i < decoded.length; i++) if (JSON.stringify(decoded[i]) !== JSON.stringify(result.faces[i])) throw new Error('Decoded geometry mismatch: ' + label + ' face ' + i);
    verification.push({ label, quantum, faces: decoded.length, exactFaceComparisons: decoded.length, passed: true });
  }
}
const start = performance.now();
for (const h of D.houses) {
  typeCounts[h.type] = (typeCounts[h.type] || 0) + 1;
  bake((h.type || 'house') + ':' + h.id, collect(A.build, h), .2);
}
const treeSpecs = new Map();
for (const t of D.trees || []) {
  const variant = (t.seed || 1) % 6, scale = Math.round((t.scale || 1) * 10) / 10;
  treeSpecs.set((t.type || 'broadleaf') + ':' + variant + ':' + scale, { type: t.type || 'broadleaf', seed: 137 + variant * 71, scale });
}
for (const scale of [1, 1.2]) for (let variant = 0; variant < 6; variant++) treeSpecs.set('broadleaf:' + variant + ':' + scale, { type: 'broadleaf', seed: 137 + variant * 71, scale });
for (const [label, spec] of treeSpecs) {
  const boxes = collect(V.build, spec);
  bake('tree:' + label, boxes, .2); bake('tree:' + label + ':far', boxes, .4);
}
const header = Buffer.from(JSON.stringify({ version: 1, faceBytes: 16, layout: 'byteplanes', totalFaces, entries: index }), 'utf8');
const length = Buffer.alloc(4); length.writeUInt32LE(header.length);
// Byte planes preserve all 16 bytes while grouping low-entropy high bytes and
// material channels, improving gzip without changing integer precision.
const interleaved = Buffer.concat(chunks), planar = Buffer.alloc(interleaved.length);
for (let channel = 0; channel < 16; channel++) for (let f = 0; f < totalFaces; f++) planar[channel * totalFaces + f] = interleaved[f * 16 + channel];
const raw = Buffer.concat([length, header, planar]), gzip = zlib.gzipSync(raw, { level: 9 });
const metadata = { version: 1, generatedAt: new Date().toISOString(), codeHashes, designHouseItems: D.houses.length, designTypes: typeCounts, treeVariants: treeSpecs.size, attemptedAssets: inputAssets, cachedAssets: Object.keys(index).length, faces: totalFaces, faceBytes: 16, rawBytes: raw.length, gzipBytes: gzip.length, verification, bakeMs: Math.round(performance.now() - start) };
const source = `/* Generated offline by scripts/bake_remake_meshes.cjs. No network needed. */\n(function(global){'use strict';\nconst info=${JSON.stringify(metadata)};\nlet payload='${gzip.toString('base64')}',ready=false,loading=null,entries=null,data=null,base=0;\nconst decoded=new Map();\nconst meshKey=${meshKey.toString()};\nconst unpackFaces=${unpackFaces.toString()};\nasync function load(){if(ready)return true;if(loading)return loading;loading=(async function(){try{if(typeof DecompressionStream!=='function')return false;const binary=atob(payload),compressed=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)compressed[i]=binary.charCodeAt(i);const stream=new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));const buffer=await new Response(stream).arrayBuffer();const input=new DataView(buffer),len=input.getUint32(0,true);if(len<=0||len>buffer.byteLength-4)throw new Error('Invalid baked header');const header=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,4,len)));if(header.version!==1||header.faceBytes!==16||header.layout!=='byteplanes')throw new Error('Unsupported baked mesh format');const count=header.totalFaces,bytes=new Uint8Array(count*16),packed=new Uint8Array(buffer,4+len);if(packed.length!==bytes.length)throw new Error('Invalid baked body');for(let c=0;c<16;c++)for(let f=0;f<count;f++)bytes[f*16+c]=packed[c*count+f];data=new DataView(bytes.buffer);entries=header.entries;base=0;ready=true;payload=null;return true}catch(error){ready=false;entries=null;data=null;info.loadError=String(error&&error.message||error);return false}})();return loading}\nfunction lookup(boxes,options){if(!ready)return null;try{const key=meshKey(boxes,options),entry=entries[key];if(!entry)return null;if(decoded.has(key))return decoded.get(key);if(base+entry.offset+entry.count*16>data.byteLength)return null;const result={faces:unpackFaces(data,base+entry.offset,entry.count,entry.quantum),stats:Object.assign({},entry.stats,{baked:true})};decoded.set(key,result);return result}catch(error){return null}}\nglobal.DSBaked={load,lookup,info,get ready(){return ready}};\n})(typeof window==='undefined'?globalThis:window);\n`;
const out = path.join(project, 'js/baked.js'); fs.writeFileSync(out, source);
const report = `# 重制版离线构网缓存\n\n生成时间：${metadata.generatedAt}。运行：\n\n\`node scripts/bake_remake_meshes.cjs\`\n\n只读 design、architecture、vegetation、meshing，写入 js/baked.js 与本记录。\n\n## 结果\n\n- 设计房院项：${D.houses.length}；树木近远变体：${treeSpecs.size} 种 × 2 档。\n- 预计算调用 ${inputAssets} 项，按完整输入键去重后缓存 ${metadata.cachedAssets} 项，共 ${totalFaces} 个四边形。\n- 二进制包 ${raw.length} 字节；gzip ${gzip.length} 字节；完整 baked.js ${Buffer.byteLength(source)} 字节。\n- 本次 Node 烘焙约 ${metadata.bakeMs} ms；此为离线预计算时间。\n\n## 接口\n\n\`await DSBaked.load()\` 返回 true 表示原生 gzip 解压成功；不支持 DecompressionStream、内容错误均返回 false，场景可正常回退。\n\n\`DSBaked.lookup(boxes,{quantum:.2})\` 返回与原 mesher 相同的 \`{faces,stats}\`，或 null。近树为 .2、远树为 .4；房屋仅缓存 .2。按整个有序盒输入、盒数与 quantum 计算双32位快速哈希，坐标与尺寸规范到 1e-6 米；修改构件、颜色、seed、尺度或盒顺序后自动 miss，调用端继续走原 mesher。\n\n加载不使用 fetch、外部文件或远程脚本，直接从 baked.js 内嵌 base64 解压，支持 file 打开。首次 lookup 懒解包该资产，之后复用已解码 faces。stats 保留烘焙时的构网指标并增加 baked:true；其中耗时属于源离线计算，不应冒认为本次浏览器生成时间。\n\n## 几何精确性\n\n每四边形16字节：minXYZ Int16 ×3、sizeXYZ Uint16 ×3、法线轴与方向1字节、RGB3字节。全部是 quantum 的整数倍，反解时恢复原mesher的角点起点、绕序、法向和颜色；不进行额外简化。\n\n${verification.map(v => '- ' + v.label + '：逐一比较 ' + v.faces + ' 面的 a/b/c/d、n、RGB，全部精确相等。').join('\n')}\n\n0.4米远景仍是原meshing.js定义的保守粗格化；缓存精确复现该输出，不把它称为0.2米近景无损几何。\n\n## 源代码 SHA-256\n\n${Object.entries(codeHashes).map(([file, hash]) => '- ' + file + ': ' + hash).join('\n')}\n`;
fs.writeFileSync(path.join(root, 'work/重制_烘焙缓存.md'), report);
console.log(JSON.stringify({ ...metadata, jsBytes: Buffer.byteLength(source) }, null, 2));
