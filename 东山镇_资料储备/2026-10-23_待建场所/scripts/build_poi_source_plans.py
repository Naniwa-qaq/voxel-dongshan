"""Create source-geometry reference SVGs without modifying map or source files.

Run with ArcGIS Pro's Python. Uses OSR only for a local azimuthal equidistant
projection (metres, true north at the POI). No ArcPy and no inferred buildings.
"""
from pathlib import Path
import json
import math
from html import escape
from osgeo import osr
import xml.etree.ElementTree as ET

osr.UseExceptions()
ROOT = Path(__file__).resolve().parents[1]
WORKSPACE = ROOT.parents[1]
FULL = WORKSPACE / '东山镇_数据/osm/selected_features_full_geometry.geojson'
FEATURES = json.loads(FULL.read_text(encoding='utf-8'))['features']
ROADS = [f for f in FEATURES if f['properties'].get('highway') and f['geometry']['type'] in ('LineString', 'MultiLineString')]
OUT = ROOT / 'images'
OUT.mkdir(exist_ok=True)

SITES = [
    dict(id='moli-middle-school', name='莫厘中学', way='1101928343', center=(120.397304905,31.084267560), snapshot='2026-10-23', address='东山镇人民街62号', api='sources/moli-middle-school-osm.json'),
    dict(id='moli-primary-school', name='莫厘实验小学 · 紫金路校区', way='1327190550', center=(120.401732300,31.080852189), snapshot='2026-10-23', address='东山镇紫金路45号', api='sources/moli-primary-school-osm.json'),
    dict(id='dongshan-bus-terminal', name='东山首末站', way='1327188516', center=(120.405613266,31.084840747), snapshot='2026-10-19', address='东山镇洞庭路沿线（门牌待核）', api=None),
]

def text(x,y,s,size=16,fill='#263a46',anchor='start',weight='400'):
    return f'<text x="{x}" y="{y}" font-size="{size}" fill="{fill}" text-anchor="{anchor}" font-weight="{weight}">{escape(str(s))}</text>'

def make(site):
    lon0,lat0 = site['center']
    source=osr.SpatialReference(); source.ImportFromEPSG(4326)
    source.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    target=osr.SpatialReference(); target.ImportFromProj4(f'+proj=aeqd +lat_0={lat0} +lon_0={lon0} +datum=WGS84 +units=m +no_defs')
    target.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    transformer=osr.CoordinateTransformation(source,target)
    def project(p):
        a=transformer.TransformPoint(float(p[0]),float(p[1]));return a[0],a[1]
    if site['api']:
        raw=json.loads((ROOT/site['api']).read_text(encoding='utf-8'))['elements']
        nodes={e['id']:(e['lon'],e['lat']) for e in raw if e['type']=='node'}
        way=next(e for e in raw if e['type']=='way' and str(e['id'])==site['way'])
        rings=[[nodes[n] for n in way['nodes']]]
        source_path=site['api']
    else:
        feature=next(f for f in FEATURES if f.get('id')=='way/'+site['way'])
        assert feature['geometry']['type']=='Polygon'
        rings=feature['geometry']['coordinates']
        source_path='东山镇_数据/osm/selected_features_full_geometry.geojson'
    assert len(rings[0])>=4 and rings[0][0]==rings[0][-1], site['id']
    projected=[[project(p) for p in r] for r in rings]
    allp=[p for r in projected for p in r]
    minx,miny,maxx,maxy=min(p[0] for p in allp),min(p[1] for p in allp),max(p[0] for p in allp),max(p[1] for p in allp)
    cx,cy=(minx+maxx)/2,(miny+maxy)/2
    span=math.ceil((max(maxx-minx,maxy-miny)+150)/50)*50
    minx,maxx=cx-span/2,cx+span/2;miny,maxy=cy-span/2,cy+span/2
    px,py,pw,ph=48,174,756,570
    scale=min(pw,ph)/span
    mapw=span*scale
    left=px+(pw-mapw)/2;top=py
    def screen(p):return (left+(p[0]-minx)*scale,top+(maxy-p[1])*scale)
    def path(points,close=False):
        xy=[screen(p) for p in points]
        return ' '.join(('M' if i==0 else 'L')+f'{x:.2f},{y:.2f}' for i,(x,y) in enumerate(xy))+(' Z' if close else '')
    selected=[]
    for f in ROADS:
        parts=[f['geometry']['coordinates']] if f['geometry']['type']=='LineString' else f['geometry']['coordinates']
        keep=[]
        for part in parts:
            coords=[project(p) for p in part]
            bx0,bx1=min(p[0] for p in coords),max(p[0] for p in coords)
            by0,by1=min(p[1] for p in coords),max(p[1] for p in coords)
            if bx1>=minx and bx0<=maxx and by1>=miny and by0<=maxy:keep.append(coords)
        if keep:selected.append((f,keep))
    svg=[f'<svg xmlns="http://www.w3.org/2000/svg" width="1120" height="860" viewBox="0 0 1120 860"><title>{escape(site["name"])}源几何参考平面</title>',
         '<desc>北向上；源地块与邻近道路中心线示意；不是实景图，非测绘总平面；未绘制未经证实的建筑。</desc>',
         '<defs><clipPath id="map"><rect x="'+str(left)+'" y="174" width="570" height="570"/></clipPath></defs>',
         '<g font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif">',
         '<rect width="1120" height="860" fill="#f5f5ef"/>',
         text(48,54,'源几何参考平面',15,'#54716b',weight='700'),
         text(48,96,site['name'],30,weight='700'),text(48,130,site['address'],16,'#52646a'),
         '<rect x="838" y="38" rx="10" width="234" height="70" fill="#e6ece7"/>',
         text(858,67,'资料生成 2026-10-23',15,weight='600'),text(858,91,'内部建模定位参考',14,'#536b65'),
         f'<rect x="{left}" y="174" width="570" height="570" fill="#ffffff" stroke="#d2dad3"/>',
         '<g clip-path="url(#map)">']
    interval=50
    for a in range(math.floor(minx/interval),math.ceil(maxx/interval)+1):
        x=screen((a*interval,0))[0];svg.append(f'<path d="M{x:.2f},174 V744" stroke="#e9eeea" stroke-width="1"/>')
    for a in range(math.floor(miny/interval),math.ceil(maxy/interval)+1):
        y=screen((0,a*interval))[1];svg.append(f'<path d="M{left:.2f},{y:.2f} h570" stroke="#e9eeea" stroke-width="1"/>')
    for f,parts in selected:
        for coords in parts:
            svg.append(f'<path d="{path(coords)}" fill="none" stroke="#fff" stroke-width="8" stroke-linejoin="round"/>')
            svg.append(f'<path d="{path(coords)}" fill="none" stroke="#aeb9b7" stroke-width="4" stroke-linejoin="round"/>')
    svg.append(f'<path d="{" ".join(path(r,True) for r in projected)}" fill="#c7e0cf" fill-opacity="0.8" fill-rule="evenodd" stroke="#33795f" stroke-width="3"/>')
    ox,oy=screen(project(site['center']))
    svg.append(f'<circle cx="{ox:.2f}" cy="{oy:.2f}" r="5" fill="#a34a35" stroke="#fff" stroke-width="2"/>')
    svg.append(text(ox+12,oy-10,'源地块质心',14,'#883e2e',weight='600'))
    labels=[]
    for f,parts in selected:
        name=f['properties'].get('name')
        if not name or name in [a[0] for a in labels]:continue
        candidates=[p for part in parts for p in part if minx+12<p[0]<maxx-12 and miny+12<p[1]<maxy-12]
        if not candidates:continue
        p=min(candidates,key=lambda p:abs(p[0]-cx)+abs(p[1]-cy))
        sx,sy=screen(p)
        if math.hypot(sx-ox,sy-oy)<80 or any(math.hypot(sx-a[1],sy-a[2])<68 for a in labels):continue
        labels.append((name,sx,sy))
        svg.append(f'<text x="{sx:.2f}" y="{sy-9:.2f}" font-size="14" fill="#4c5f65" stroke="#fff" stroke-width="4" paint-order="stroke">{escape(name)}</text>')
    svg.append('</g>')
    svg += [text(838,183,'N · 北',18,weight='700'),'<path d="M865,207 l-10,28 10,-7 10,7 Z" fill="#263a46"/>',
            text(838,277,'源对象',14,'#687c77'),text(838,302,'OSM way/'+site['way'],16,weight='600'),
            text(838,343,'源快照 / 访问日期',14,'#687c77'),text(838,368,'地块 '+site['snapshot'],15),text(838,394,'邻路 2026-10-19',15),
            text(838,436,'几何说明',14,'#687c77'),text(838,463,'绿色面：源地块范围',15),text(838,490,'灰线：OSM道路中心线',15),text(838,517,'红点：源地块面积质心',15),
            text(838,558,'坐标与比例',14,'#687c77'),text(838,585,'WGS84 → 局部等距投影',14),text(838,612,'北向上 · 网格间距50米',14),text(838,639,'道路线宽仅为符号',14)]
    # Metric scale bar is derived from local AEQD metres, not from page pixels.
    bar_m=50 if span<400 else 100;bar_x=left+18;bar_y=715;bar_w=bar_m*scale
    svg += [f'<rect x="{bar_x-8:.2f}" y="{bar_y-28}" width="{bar_w+40:.2f}" height="48" fill="#fff" fill-opacity="0.94"/>',
            f'<path d="M{bar_x:.2f},{bar_y-7} V{bar_y} H{bar_x+bar_w:.2f} V{bar_y-7}" fill="none" stroke="#263a46" stroke-width="2"/>',
            text(bar_x,bar_y-12,'0',12),text(bar_x+bar_w,bar_y-12,f'{bar_m} m',12,anchor='end'),
            text(48,786,'源地块与邻路示意 · 非测绘总平面 · 不是实景图',18,'#853c2e',weight='700'),
            text(48,817,'© OpenStreetMap contributors · ODbL 1.0 | 边界不等于法定用地边界；未绘制建筑与真实出入口。',13,'#5a7069'),
            '</g></svg>']
    output=OUT/(site['id']+'-source-plan.svg');output.write_text('\n'.join(svg),encoding='utf-8')
    ET.parse(output)
    return dict(id=site['id'],file=str(output.relative_to(ROOT)).replace('\\','/'),source_id='way/'+site['way'],source_snapshot=site['snapshot'],roads_snapshot='2026-10-19',source_file=source_path,road_count=len(selected),road_ids=[f['id'] for f,_ in selected],projection=target.ExportToProj4(),scale_bar_m=bar_m,view_span_m=span,is_photograph=False)

results=[make(s) for s in SITES]
(ROOT/'sources/source-plans-manifest.json').write_text(json.dumps({'generated_on':'2026-10-23','plans':results,'record_json_modified':False},ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(results,ensure_ascii=False,indent=2))
