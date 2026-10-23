/* Rebuild a read-only geographic comparison from the map and local OSM snapshot.
 * Run: node scripts/build_geographic_audit.cjs
 * No packages, network, source edits or model relocation required.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '东山镇_重制版');
const mapPath = path.join(OUT, 'data', 'unified-map.json');
const osmPath = path.join(ROOT, '东山镇_数据', 'osm', 'selected_features_full_geometry.geojson');
const candidatePath = path.join(ROOT, '东山镇_数据', 'references', 'poi-candidates.json');
const read = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const map = read(mapPath), osm = read(osmPath);
const round = (n, d = 2) => Number(n.toFixed(d));
const deg = Math.PI / 180, a = 6378137, ecc = 0.0066943799901413165, ep = ecc / (1 - ecc), k0 = .9996;
// WGS84 to UTM zone 51N (central meridian 123 E), Snyder series.
function utm([lon, lat]) {
  const p = lat * deg, l = lon * deg, n = a / Math.sqrt(1 - ecc * Math.sin(p) ** 2);
  const t = Math.tan(p) ** 2, c = ep * Math.cos(p) ** 2, A = Math.cos(p) * (l - 123 * deg);
  const m = a * ((1 - ecc / 4 - 3 * ecc ** 2 / 64 - 5 * ecc ** 3 / 256) * p
    - (3 * ecc / 8 + 3 * ecc ** 2 / 32 + 45 * ecc ** 3 / 1024) * Math.sin(2 * p)
    + (15 * ecc ** 2 / 256 + 45 * ecc ** 3 / 1024) * Math.sin(4 * p) - 35 * ecc ** 3 / 3072 * Math.sin(6 * p));
  return [500000 + k0 * n * (A + (1 - t + c) * A ** 3 / 6 + (5 - 18 * t + t * t + 72 * c - 58 * ep) * A ** 5 / 120),
    k0 * (m + n * Math.tan(p) * (A * A / 2 + (5 - t + 9 * c + 4 * c * c) * A ** 4 / 24 + (61 - 58 * t + t * t + 600 * c - 330 * ep) * A ** 6 / 720))];
}
function wgs([east, north]) {
  const e1 = (1 - Math.sqrt(1 - ecc)) / (1 + Math.sqrt(1 - ecc));
  const mu = north / k0 / (a * (1 - ecc / 4 - 3 * ecc ** 2 / 64 - 5 * ecc ** 3 / 256));
  const p = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
    + 151 * e1 ** 3 / 96 * Math.sin(6 * mu) + 1097 * e1 ** 4 / 512 * Math.sin(8 * mu);
  const c = ep * Math.cos(p) ** 2, t = Math.tan(p) ** 2, n = a / Math.sqrt(1 - ecc * Math.sin(p) ** 2);
  const r = a * (1 - ecc) / (1 - ecc * Math.sin(p) ** 2) ** 1.5, d = (east - 500000) / (n * k0);
  return [(123 * deg + (d - (1 + 2 * t + c) * d ** 3 / 6 + (5 - 2 * c + 28 * t - 3 * c * c + 8 * ep + 24 * t * t) * d ** 5 / 120) / Math.cos(p)) / deg,
    (p - n * Math.tan(p) / r * (d * d / 2 - (5 + 3 * t + 10 * c - 4 * c * c - 9 * ep) * d ** 4 / 24 + (61 + 90 * t + 298 * c + 45 * t * t - 252 * ep - 3 * c * c) * d ** 6 / 720)) / deg];
}
const origin = map.geographic.originUTM51N;
const local = coord => { const p = utm(coord); return [p[0] - origin[0], origin[1] - p[1]]; };
const localWgs = p => wgs([origin[0] + p[0], origin[1] - p[1]]);
const tr = map.geographic.designTransform;
function interpolate(value, x, y) {
  if (value <= x[0]) return y[0];
  for (let i = 1; i < x.length; i++) if (value <= x[i]) return y[i - 1] + (value - x[i - 1]) * (y[i] - y[i - 1]) / (x[i] - x[i - 1]);
  return y[y.length - 1];
}
const mapped = p => [interpolate(p[0], tr.sourceX, tr.designX), interpolate(p[1], tr.sourceZ, tr.designZ)];
const features = new Map(osm.features.map(f => [f.id, f]));
function polygonCentroid(rings) {
  let weight = 0, x = 0, z = 0;
  rings.forEach((ring, index) => {
    const ps = ring.map(local); let twice = 0, cx = 0, cz = 0;
    for (let i = 0, j = ps.length - 1; i < ps.length; j = i++) {
      const cross = ps[j][0] * ps[i][1] - ps[i][0] * ps[j][1];
      twice += cross; cx += (ps[j][0] + ps[i][0]) * cross; cz += (ps[j][1] + ps[i][1]) * cross;
    }
    if (Math.abs(twice) < 1e-5) return;
    const ar = Math.abs(twice) * (index === 0 ? 1 : -1);
    x += cx / (3 * twice) * ar; z += cz / (3 * twice) * ar; weight += ar;
  });
  return weight > 0 ? {point: [x / weight, z / weight], weight} : null;
}
function representative(f) {
  const g = f.geometry;
  if (g.type === 'Point') return {point: local(g.coordinates), method: 'OSM点位'};
  if (g.type === 'Polygon') { const c = polygonCentroid(g.coordinates); return c && {...c, method: '源面几何质心'}; }
  if (g.type === 'MultiPolygon') {
    const parts = g.coordinates.map(polygonCentroid).filter(Boolean), total = parts.reduce((s, p) => s + p.weight, 0);
    return total && {point: [0, 1].map(i => parts.reduce((s, p) => s + p.point[i] * p.weight, 0) / total), method: '源面几何质心'};
  }
  return null;
}
function vertices(geometry) {
  if (geometry.type === 'Point') return [geometry.coordinates];
  const points=[];
  function walk(v) { if (Array.isArray(v) && typeof v[0] === 'number') points.push(v); else if (Array.isArray(v)) v.forEach(walk); }
  walk(geometry.coordinates); return points;
}
const specs = [
  {id:'luxiang', label:'陆巷', sourceId:'node/5939534286', anchorId:'luxiang-village', role:'村名点，作为共同坐标原点'},
  {id:'dongshan-school', label:'东山中学', sourceId:'way/1101928342', role:'OSM校区源锚点；校内楼栋功能和形制为综合设计'},
  {id:'chunzailou-garden', label:'春在楼宅园', sourceId:'way/1332791315', role:'OSM“雕花楼”园区源锚点；并非春在楼主楼实测位置'},
  {id:'moli-peak', label:'莫厘峰', sourceId:'node/13800809445', anchorId:'moli-peak', role:'OSM山峰点；源高程标签293.13 m不等于测量复核'}
];
const anchors = specs.map(s => {
  const item = s.anchorId ? map.anchors.find(x => x.id === s.anchorId) : map.zones.find(x => x.id === s.id);
  if (!item || !features.has(s.sourceId)) throw new Error('Missing control ' + s.id);
  const coords = item.wgs84 || item.sourceOriginWgs84, src = item.sourceOriginLocal || local(coords);
  const design = item.center || [item.x, item.z], base = mapped(src), f = features.get(s.sourceId);
  return {...s, wgs84: coords.map(x => round(x, 9)), sourceLocal: src.map(x => round(x, 3)), utm51n: [origin[0] + src[0], origin[1] - src[1]].map(x => round(x, 3)),
    design: design.map(x => round(x, 3)), baseMapped: base.map(x => round(x, 3)), anchorResidualMetres: round(Math.hypot(...design.map((v, i) => v - base[i])), 3),
    snapshotUtc: f.properties._source_snapshots_utc || [], osmUrl:'https://www.openstreetmap.org/' + s.sourceId};
});
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const bearing = (a, b) => (Math.atan2(b[0] - a[0], a[1] - b[1]) / deg + 360) % 360;
const pairs = [];
for (let i = 0; i < anchors.length; i++) for (let j = i + 1; j < anchors.length; j++) {
  const a = anchors[i], b = anchors[j], real = distance(a.sourceLocal, b.sourceLocal), design = distance(a.design, b.design);
  const realBearing = bearing(a.sourceLocal, b.sourceLocal), designBearing = bearing(a.design, b.design);
  pairs.push({from:a.id, to:b.id, label:a.label + '—' + b.label, sourceMetres:round(real), designMetres:round(design), designToSourceRatio:round(design / real, 4),
    sourceGridBearing:round(realBearing, 1), designBearing:round(designBearing, 1), bearingDifferenceDegrees:round(((designBearing - realBearing + 540) % 360) - 180, 1)});
}
const seenSourceIds = new Set();
function collectIds(value) {
  if (!value || typeof value !== 'object') return;
  if (value.sourceId) seenSourceIds.add(value.sourceId);
  if (Array.isArray(value.sourceIds)) value.sourceIds.forEach(id => seenSourceIds.add(id));
  Object.values(value).forEach(collectIds);
}
collectIds(map);
const namedIds = new Set(specs.map(x => x.sourceId));
const priority = new Map([
  ['way/1101928343', {label:'莫厘中学', detail:'独立初中，位于两处已建场景之间；未作具名校园复原', url:'https://dsmlzx.wxedu.net/xx/xwgk/gkzn'}],
  ['way/1327190550', {label:'莫厘实验小学', detail:'OSM源名“江苏省实验小学莫厘实验小学”；雕花楼东侧校区尚未具名建模', url:'https://dszxxx.wxedu.net/xxgk/xxjj'}],
  ['way/1327188516', {label:'东山首末站', detail:'本地OSM站场面；尚未具名建模'}],
  ['node/13800863490', {label:'法海寺', detail:'本地OSM寺名点；可核对点位，暂无建筑轮廓依据'}],
  ['node/13800809431', {label:'莫厘峰观景亭', detail:'本地OSM观景点；尚未建亭，点位不能推导亭体尺寸', url:'https://www.suzhou.gov.cn/szsrmzf/szyw/202510/f6ddb7f4edc749d18c8c86ba9cebdd81.shtml'}]
]);
const env = map.geographic.sourceEnvelopeLocal;
const inside = p => p[0] >= env[0] && p[0] <= env[2] && p[1] >= env[1] && p[1] <= env[3];
const inventory = [];
for (const f of osm.features) {
  const p = f.properties || {}, name = p['name:zh'] || p.name;
  if (!name || p.boundary || p.highway || p.waterway || p.natural === 'water' || ['island','islet'].includes(p.place)) continue;
  if (!(p.amenity || p.tourism || p.historic || p.place || p.leisure || p.shop || p.office || p.natural === 'peak')) continue;
  const ref = representative(f);
  if (!ref || !inside(ref.point)) continue;
  const pr = priority.get(f.id), base = mapped(ref.point), covered = seenSourceIds.has(f.id), named = namedIds.has(f.id);
  inventory.push({id:f.id, sourceId:f.id, label:pr?.label || name, sourceName:name, category:p.amenity || p.tourism || p.historic || p.place || p.leisure || p.shop || p.office || p.natural,
    wgs84:(f.geometry.type === 'Point' ? f.geometry.coordinates : localWgs(ref.point)).map(x => round(x, 9)), sourceLocal:ref.point.map(x => round(x, 3)),
    x:round(base[0]), z:round(base[1]), designMapped:base.map(x => round(x)), designMapping:'base separable transform only; facility displacement collars are not applied; never a surveyed display placement',
    coordinateMethod:ref.method, sourceBoundaryCrossesFrame:vertices(f.geometry).some(p=>!inside(local(p))), status:named ? '具名场景或山峰锚点已表示' : covered ? '源要素有综合几何，尚未具名复原' : '尚未具名复原',
    namedModel:named, sourceGeometryRepresented:covered, priority:priority.has(f.id), detail:pr?.detail || '该名称出现在本地源数据中；普通村镇体块不计作该场所的具名复原',
    snapshotUtc:p._source_snapshots_utc || [], osmUrl:'https://www.openstreetmap.org/' + f.id, referenceUrl:pr?.url || null});
}
const priorityIds=[...priority.keys()];
inventory.sort((a,b) => Number(b.priority) - Number(a.priority) || (a.priority ? priorityIds.indexOf(a.id)-priorityIds.indexOf(b.id) : a.label.localeCompare(b.label, 'zh-CN')));
const unlocatedPlaces=read(candidatePath).candidates.filter(p=>!p.coordinates && !['luxiang-village','chunzailou','mountain-orchard-context'].includes(p.id))
  .map(p=>({id:p.id,label:p.name,category:p.category,status:'未定位，未具名复原',wgs84:null,detail:p.remaining_evidence_gaps,referenceUrls:p.evidence_urls}));
const outsideFramePlaces=['node/10081520539'].map(id=>{
  const f=features.get(id), r=representative(f); if(inside(r.point)) throw new Error('Outside place moved into frame: '+id);
  return {id,label:f.properties.name,wgs84:f.geometry.coordinates,sourceLocal:r.point.map(x=>round(x,3)),status:'当前图幅南界外',osmUrl:'https://www.openstreetmap.org/'+id};
});
const data = {
  version:'2026-10-23-geographic-audit-1', sourceMapVersion:map.version, title:'地理对照',
  summary:'源锚点有地理依据；当前场景是分段压缩后的设计地图，距离和方位角有形变。春在楼采用园区锚点，主楼具体落位仍缺实测总平面。',
  methods:{crs:'WGS84 / UTM zone 51N · EPSG:32651', axes:'源坐标x向东、z向南；图示北向上',
    distance:'真实直线距离由EPSG:32651源锚点计算；图距是当前场景中心间的水平距离，两者均不含高差。图距的单位是模型米。',
    bearing:'方位角以UTM格网北为0°、顺时针；不是磁北。只比较锚点间方向。',
    transform:'X、Z各自按不同控制点分段压缩，可保持东西/南北顺序，却不保持统一比例和方位角。设施内部完整构件另作刚性平移；道路还存在设施衔接位移带。',
    inventory:'自动筛选本地OSM快照：命名的场所/聚落/景点等代表点位于当前图幅源坐标矩形内，排除道路、水系和行政区界。该盘点不是完整镇域名录；数据中缺名的场所无法自动检出。',
    inventoryCoordinates:'面要素采用EPSG:32651几何质心后转回WGS84，点要素保留原坐标。遗漏点的C坐标仅为基础分段变换结果，不作为主场景新建依据。',
    precision:'显示小数便于复核源数据，不代表现场测量精度。未根据本次审计移动任何现有场景。'},
  sourceEnvelopeLocal:env, originWgs84:map.geographic.originWgs84, anchors, pairs,
  namedPlaces:inventory, omittedPlaces:inventory.filter(p => !p.namedModel), priorityOmissions:inventory.filter(p => p.priority),
  unlocatedPlaces, outsideFramePlaces,
  sources:[{title:'本地OSM完整几何快照',path:'../东山镇_数据/osm/selected_features_full_geometry.geojson',license:'© OpenStreetMap contributors · ODbL 1.0',sha256:crypto.createHash('sha256').update(fs.readFileSync(osmPath)).digest('hex')},
    {title:'当前连续地图',path:'data/unified-map.json',sha256:crypto.createHash('sha256').update(fs.readFileSync(mapPath)).digest('hex')},
    {title:'本地待定位参考清单',path:'../东山镇_数据/references/poi-candidates.json',sha256:crypto.createHash('sha256').update(fs.readFileSync(candidatePath)).digest('hex')}],
  checks:{anchorCount:anchors.length, pairCount:pairs.length, sourceCoordinateProjectionMaxResidualMetres:round(Math.max(...anchors.map(x => distance(local(x.wgs84), x.sourceLocal))),3), priorityOmissionCount:inventory.filter(p => p.priority).length}
};
if (data.checks.sourceCoordinateProjectionMaxResidualMetres > .1) throw new Error('Source coordinates disagree with source UTM anchors');
if (data.checks.priorityOmissionCount !== priority.size) throw new Error('Expected priority omissions not found within frame');
fs.writeFileSync(path.join(OUT,'data','geographic-audit.json'), JSON.stringify(data,null,2) + '\n');
fs.writeFileSync(path.join(OUT,'js','geographic-audit-data.js'), '/* Generated by scripts/build_geographic_audit.cjs; source snapshots are read-only. */\nwindow.DSGeographicAuditData=' + JSON.stringify(data) + ';\n');
console.log(JSON.stringify({anchors:data.checks.anchorCount,pairs:data.checks.pairCount,places:inventory.length,omitted:data.omittedPlaces.length,priority:data.checks.priorityOmissionCount,projectionResidualMetres:data.checks.sourceCoordinateProjectionMaxResidualMetres,pairsMetres:pairs.map(p=>[p.label,p.sourceMetres,p.designMetres])},null,2));
