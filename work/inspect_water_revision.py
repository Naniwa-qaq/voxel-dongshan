import json, math
from pathlib import Path
from osgeo import ogr, osr
root=Path(__file__).resolve().parents[1]
ids={'way/1104698619','way/1104698622','way/1104698625','way/1104698628','way/1094233028','way/1098577064','way/1094233030'}
fc=json.loads((root/'东山镇_数据/osm/selected_features_full_geometry.geojson').read_text(encoding='utf-8'))
selected=[]
for f in fc['features']:
 if f['id'] in ids:
  p=f['properties'];g=f['geometry'];print('FEATURE',f['id'],json.dumps(p,ensure_ascii=False),json.dumps(g))
  selected.append(f)
water=[f for f in fc['features'] if f.get('properties',{}).get('waterway')]
wp=[f for f in fc['features'] if f.get('geometry',{}).get('type') in ['Polygon','MultiPolygon'] and (f.get('properties',{}).get('water') or f.get('properties',{}).get('natural')=='water')]
for f in selected:
 if not f['properties'].get('waterway'):continue
 for end in [f['geometry']['coordinates'][0],f['geometry']['coordinates'][-1]]:
  def distance(g):
   p=ogr.CreateGeometryFromJson(json.dumps({'type':'Point','coordinates':end}));geom=ogr.CreateGeometryFromJson(json.dumps(g));return p.Distance(geom)*110000
  near=sorted([(distance(v['geometry']),v['id'],v['properties']) for v in water if v['id']!=f['id']])[:3]
  polygons=sorted([(distance(v['geometry']),v['id'],v['properties']) for v in wp])[:3]
  print('END',f['id'],end,'NEAR_WATER',json.dumps(near,ensure_ascii=False),'NEAR_POLYGON',json.dumps(polygons,ensure_ascii=False))
raw=json.loads((root/'东山镇_数据/osm/raw/20261019/water.json').read_text(encoding='utf-8'))
ways={str(v['id']):v for v in raw['elements'] if v['type']=='way'}
for sid in ['1104698619','1104698622','1104698625','1104698628']:
 v=ways[sid];ns=[v['nodes'][0],v['nodes'][-1]]
 print('RAW_NODES',sid,ns,'COUNT',len(v['nodes']),'GEOMETRYCOUNT',len(v.get('geometry',[])))
 print('SHARED',[(o['id'],o.get('tags'),[n for n in ns if n in o.get('nodes',[])]) for o in ways.values() if str(o['id'])!=sid and set(ns).intersection(o.get('nodes',[]))])
