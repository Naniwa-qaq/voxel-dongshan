"""Rebuild the read-only DSDesign landscape patch from the local OSM snapshot.

This script never imports/runs the original design builder or alters a source.
Run with the installed GDAL Python. No web access, ArcPy or credentials needed.
"""
from __future__ import annotations

import copy
import hashlib
import json
import math
from pathlib import Path

from osgeo import ogr, osr

ogr.UseExceptions()
osr.UseExceptions()

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '东山镇_重制版'
BASE = OUT / 'data/design.json'
FULL = ROOT / '东山镇_数据/osm/selected_features_full_geometry.geojson'
RAW_WATER = ROOT / '东山镇_数据/osm/raw/20261019/water.json'
RAW_ROADS = ROOT / '东山镇_数据/osm/raw/20261019/roads.json'
VERSION = '2026-10-22-landscape-revision-1'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def distance(points):
    return round(sum(math.dist(a, b) for a, b in zip(points, points[1:])), 3)


def load_json(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


sources = [BASE, FULL, RAW_WATER, RAW_ROADS, ROOT / 'scripts/build_remake_design.py']
hashes_before = {str(p.relative_to(ROOT)): digest(p) for p in sources}
design = load_json(BASE)
fc = load_json(FULL)
features = {f['id']: f for f in fc['features']}
water_raw = load_json(RAW_WATER)
water_ways = {f"way/{v['id']}": v for v in water_raw['elements'] if v['type'] == 'way'}

wgs = osr.SpatialReference()
wgs.ImportFromEPSG(4326)
utm = osr.SpatialReference()
utm.ImportFromEPSG(32651)
wgs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
utm.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
transform = osr.CoordinateTransformation(wgs, utm)


def projected(feature):
    geometry = ogr.CreateGeometryFromJson(json.dumps(feature['geometry']))
    geometry.Transform(transform)
    return geometry


mapped_water = {sid: projected(f) for sid, f in features.items()
                if f['properties'].get('waterway') and f['geometry']['type'] in ['LineString', 'MultiLineString']}
water_polygons = {sid: projected(f) for sid, f in features.items()
                  if f['geometry']['type'] in ['Polygon', 'MultiPolygon']
                  and (f['properties'].get('water') or f['properties'].get('natural') == 'water')}

# The renderer used to interpret every service loop as a broad pale stone band.
# Only the subsidiary return loops are suppressed, not their useful approach
# traces and not a single primary/residential/unclassified source road.
omitted_road_ids = {
    'way/1094233028:1': '低等级service附属回环；无路名、无公共设施功能标签；原样高亮形成湖岸空地白圈，综合时择除回环，保留接近段。',
    'way/1098577064:1': '低等级service附属回环；无路名、无公共设施功能标签；综合时择除回环，保留源接近段。',
    'way/1094233030:0': '图幅南缘service附属回环的裁切残段；不承担连续主路通达，综合时择除。',
}
roads = []
road_changes = []
widths = {'primary': 6.8, 'residential': 3.0, 'unclassified': 3.8,
          'service': 1.6, 'path': 1.0, 'footway': 1.2, 'lane': 1.0}
surfaces = {'primary': ('aged-grey-road', 'continuous'),
            'residential': ('mixed-old-stone', 'broken-soft'),
            'unclassified': ('grey-earth-track', 'broken-soft'),
            'service': ('packed-earth', 'soft'),
            'path': ('woodland-earth', 'soft'),
            'footway': ('weathered-stone', 'broken-soft'),
            'lane': ('packed-earth-stone', 'soft')}
for original in design['roads']:
    sid = (original.get('sourceIds') or [None])[0]
    if original['id'] in omitted_road_ids:
        road_changes.append(dict(id=original['id'], sourceIds=original.get('sourceIds', []),
                                 action='omit-subsidiary-display', old=original,
                                 new=None, reason=omitted_road_ids[original['id']],
                                 sourceTags=features[sid]['properties'].get('_all_tags', {})))
        continue
    r = copy.deepcopy(original)
    source_kind = r.get('sourceKind') or r['kind']
    surface, edge = surfaces.get(source_kind, ('packed-earth', 'soft'))
    r.update(width=widths.get(source_kind, original['width']),
             surface=surface, edgeStyle=edge,
             renderPriority=1 if source_kind == 'primary' else (2 if source_kind in ['residential', 'unclassified'] else 3),
             pavingJoints=source_kind in ['residential', 'footway'],
             roadsideCurb=False,
             widthBasis='制图显示宽度；不是源数据的实测路宽')
    roads.append(r)
    road_changes.append(dict(id=r['id'], sourceIds=r.get('sourceIds', []), action='restyle-by-road-hierarchy',
                             old=dict(width=original['width'], kind=original['kind']),
                             new={key: r[key] for key in ['width', 'surface', 'edgeStyle', 'renderPriority', 'pavingJoints']},
                             reason='以通达等级和用途区分路面，附属道路与设计步巷不再统一铺成等宽亮石带。'))

canals = []
terminals = []
water_changes = []
width_plan = {'way/1104698619': (2.4, 18.0), 'way/1104698622': (2.2, 14.0), 'way/1104698625': (2.6, 20.0)}
for original in design['water']['canals']:
    sid = original['id']
    if sid == 'way/1104698628':
        water_changes.append(dict(id=sid, action='omit-clipped-fragment', old=original, new=None,
                                  reason='当前样区仅留下南边界约13米的末段，原河首位于样区外。择除边缘碎段，不捏造跨边界河源。',
                                  sourceGeometry=features[sid]['geometry'], sourceNodesComplete=True))
        continue
    raw = water_ways[sid]
    source = features[sid]
    head = source['geometry']['coordinates'][0]
    hp = ogr.Geometry(ogr.wkbPoint)
    hp.AddPoint_2D(*head)
    hp.Transform(transform)
    connected = [other_id for other_id, other in water_ways.items()
                 if other_id != sid and raw['nodes'][0] in other.get('nodes', [])]
    nearest_line = sorted((hp.Distance(g), other_id) for other_id, g in mapped_water.items() if other_id != sid)[0]
    nearest_polygon = sorted((hp.Distance(g), other_id) for other_id, g in water_polygons.items())[0]
    c = copy.deepcopy(original)
    width, taper = width_plan[sid]
    p, nxt = c['points'][0], c['points'][1]
    delta = [nxt[0] - p[0], nxt[1] - p[1]]
    magnitude = math.hypot(*delta)
    c.update(width=width, kind='canal', label='入湖沟港',
             widthBasis='无实测宽度；类型化窄沟显示；头段收窄属于制图表达',
             head=dict(pointIndex=0, taperLength=taper, widthAtHead=.8,
                       endTreatment='vegetated-drain-head', evidence='unresolved-source-end'),
             widthProfile=[dict(distanceFromHead=0, width=.8), dict(distanceFromHead=taper, width=width)],
             bankStyle='low-earth-stone-mix', bankBuffer=.8)
    terminals.append(dict(id='head-' + sid.replace('/', '-'), sourceId=sid,
                          x=p[0], z=p[1], directionFromHead=[round(v / magnitude, 6) for v in delta],
                          kind='unresolved-drain-head', taperLength=taper, widthAtHead=.8,
                          grassRadius=2.4, stoneCap=False, pond=False, culvert=False,
                          evidence='源线完整但村内上游未连接；保留源端，不解释为已核实河源/暗涵/塘面。',
                          rendering='从源端向既有线方向渐宽；源端附近低岸草/土沟融合，不增加河段、不新增水面。'))
    canals.append(c)
    water_changes.append(dict(id=sid, action='retain-source-line-narrow-and-resolve-display-head',
                              sourceEndpointWgs84=head, sourceHeadNode=raw['nodes'][0],
                              rawNodeCount=len(raw['nodes']), rawGeometryCount=len(raw.get('geometry', [])),
                              sharedWaterwayHeadNodeIds=connected,
                              sourceGeometryWasClipped=False,
                              sourceEndReason='原始OSM way记录到此结束，几何无缺点；上游状态在本地资料中未解决，并非生成器意外裁切。',
                              nearestOtherMappedWater=dict(sourceId=nearest_line[1], distanceMetres=round(nearest_line[0], 2)),
                              nearestWaterPolygon=dict(sourceId=nearest_polygon[1], distanceMetres=round(nearest_polygon[0], 2)),
                              old=original, new=c,
                              reason='维持源中心线与通湖端，取消4.6米等宽亮色渠槽；末段在源线内渐窄为低岸草沟，表达未解决的上游边界。无证据不延长、不连接近旁水系、不捏造塘面或暗涵。'))

bridges = copy.deepcopy(design['bridges'])
for bridge in bridges:
    r = next((r for r in roads if set(r.get('sourceIds', [])).intersection(bridge.get('sourceIds', []))), None)
    if r:
        bridge['width'] = r['width']
        bridge['widthBasis'] = '随分级后的源道路显示宽度；桥型仍为类型化低板桥'

# Remove design alley traces that previously ended only on a suppressed return
# loop. They do not become long invented replacement roads. Source approaches
# stay available as narrow earth traces.
def line_distance(p, pts):
    best = float('inf')
    for a, b in zip(pts, pts[1:]):
        dx, dz = b[0] - a[0], b[1] - a[1]
        den = dx * dx + dz * dz
        t = max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / max(den, 1e-9)))
        best = min(best, math.dist(p, [a[0] + t * dx, a[1] + t * dz]))
    return best

omitted_original = [r for r in design['roads'] if r['id'] in omitted_road_ids]
filtered_roads = []
for r in roads:
    if r['kind'] == 'lane' and any(line_distance(r['points'][-1], old['points']) < .8 for old in omitted_original):
        connected_retained = any(line_distance(r['points'][-1], other['points']) < 1.2
                                 for other in roads if other.get('sourceIds'))
        if not connected_retained:
            road_changes.append(dict(id=r['id'], sourceIds=[], action='omit-dependent-design-alley', old=r, new=None,
                                     reason='原设计步巷只接入已择除附属回环，去掉悬空路尾；未捏造新的源道路。'))
            continue
    filtered_roads.append(r)
roads = filtered_roads

original_major = {r['id'] for r in design['roads'] if r.get('sourceKind') in ['primary', 'residential', 'unclassified']}
retained_major = {r['id'] for r in roads if r.get('sourceKind') in ['primary', 'residential', 'unclassified']}
assert original_major == retained_major
assert all(c['points'] == next(old['points'] for old in design['water']['canals'] if old['id'] == c['id']) for c in canals)
assert len(canals) == 3 and len(terminals) == 3
for p in sources:
    assert digest(p) == hashes_before[str(p.relative_to(ROOT))], str(p)

patch = dict(version=VERSION, roads=roads, canals=canals, waterTerminals=terminals, bridges=bridges,
             surfaceStyle=dict(largeGrassPaletteTiles=False, hierarchy='主路灰色连续；住宅旧石；service/山径/设计步巷土石混合窄线'),
             topologyPolicy='不新增水道中心线、不猜测塘面/暗涵；只择除低等级回环展示与图边残段，全部主要源道路保持。')
audit = dict(version=VERSION, sourceSnapshot='OSM local snapshot 2026-10-19',
             inputsSha256=hashes_before, sourceFilesUnchanged=True,
             roadChanges=road_changes, waterChanges=water_changes,
             checks=dict(majorRoadSegmentsBefore=len(original_major), majorRoadSegmentsAfter=len(retained_major),
                         majorRoadIdsIdentical=original_major == retained_major,
                         retainedCanalCenterlinesIdentical=True, inventedWaterSegments=0, inventedPonds=0,
                         unresolvedSourceHeads=len(terminals), sourceCanalsBefore=len(design['water']['canals']),
                         renderedCanalsAfter=len(canals), roadSegmentsBefore=len(design['roads']), roadSegmentsAfter=len(roads)),
             patch=patch)
(OUT / 'data/landscape-revision-audit.json').write_text(json.dumps(audit, ensure_ascii=False, indent=2), encoding='utf-8')
(OUT / 'js/landscape-revision.js').write_text('''/* Generated by scripts/revise_landscape.py. Local-only cartographic display revision.
   All source files and the baseline DSDesign remain unchanged on disk. */
(() => {
  'use strict';
  const D = window.DSDesign;
  if (!D) throw new Error('landscape-revision requires design.js first');
  const P = ''' + compact(patch) + ''';
  D.roads = P.roads;
  D.water.canals = P.canals;
  D.water.terminals = P.waterTerminals;
  D.bridges = P.bridges;
  D.landscapeRevision = {version:P.version,surfaceStyle:P.surfaceStyle,topologyPolicy:P.topologyPolicy};
  window.DSLandscapeRevision = P;
})();
''', encoding='utf-8')
print(json.dumps(audit['checks'], ensure_ascii=False))
