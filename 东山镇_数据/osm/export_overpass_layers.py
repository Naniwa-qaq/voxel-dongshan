"""Validate available theme responses, retain tags, and export usable GeoJSON.

No cartographic simplification, building deletion, or inferred heights. Spatial
clipping is only a derivative: raw responses and full geometries are retained.
"""
from pathlib import Path
import collections, datetime, hashlib, json, sys
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT.parent/'_runtime'))
import shapely
from shapely.geometry import Point,LineString,MultiLineString,GeometryCollection,Polygon,box,mapping
from shapely.ops import polygonize,unary_union
BBOX=[120.28,30.98,120.50,31.22]
ROI=box(*BBOX)

def dump(p,d):p.write_text(json.dumps(d,ensure_ascii=False,default=str),encoding='utf-8')
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def chunks(g):
    result=[];current=[]
    for p in g or []:
        if p and 'lon' in p and 'lat' in p:current.append((p['lon'],p['lat']))
        else:
            if len(current)>=2:result.append(current)
            current=[]
    if len(current)>=2:result.append(current)
    return result

def polygon_tag(t):
    if t.get('area')=='no':return False
    if t.get('area')=='yes':return True
    if any(k in t for k in ['building','building:part','landuse','amenity','leisure','shop','tourism','historic','water','place','office']):return True
    return t.get('natural') in ['water','wood','scrub','wetland','grassland','heath','sand','bare_rock','beach','mud','glacier','fell','shingle'] or t.get('waterway')=='riverbank'

def main():
    folder=ROOT/'raw'/'20261019';out=ROOT/'layers';out.mkdir(exist_ok=True)
    qa=ROOT/'qa';qa.mkdir(exist_ok=True)
    audits=[];objects={};raw_sources=[]
    for p in sorted(folder.glob('*.json')):
        if p.name.endswith('.manifest.json'):continue
        try:
            d=json.loads(p.read_text(encoding='utf-8'))
            if not isinstance(d.get('elements'),list) or d.get('remark'):raise ValueError(str(d.get('remark','No elements list')))
            m=folder/(p.stem+'.manifest.json')
            if not m.exists() or json.loads(m.read_text(encoding='utf-8')).get('status')!='validated':raise ValueError('No successful acquisition manifest')
            snap=d.get('osm3s',{}).get('timestamp_osm_base')
            raw_sources.append({'file':str(p.relative_to(ROOT)),'sha256':sha(p),'bytes':p.stat().st_size,'snapshot_utc':snap,'element_count':len(d['elements'])})
            for e in d['elements']:
                k=(e['type'],e['id'])
                if k not in objects:objects[k]={'element':e,'files':[],'snapshots':[]}
                o=objects[k];o['files'].append(str(p.relative_to(ROOT)));o['snapshots'].append(snap)
                if (snap or '')>=max((s or '' for s in o['snapshots']),default=''):o['element']=e
        except Exception as exc:
            audits.append({'file':p.name,'status':'not_usable','error':str(exc)})
    legacy=ROOT/'raw'/'overpass_main_get.json'
    if legacy.exists():
        try:json.loads(legacy.read_text(encoding='utf-8'));legacy_status='unexpectedly_valid_recheck_transport'
        except Exception as exc:legacy_status='invalid_truncated_json';legacy_error=str(exc)
        audits.append({'file':str(legacy.relative_to(ROOT)),'status':legacy_status,'error':locals().get('legacy_error'),
                       'excluded_from_exports':True,'bytes':legacy.stat().st_size,'sha256':sha(legacy)})
    dump(qa/'raw_response_validation.json',audits)
    if not raw_sources:raise RuntimeError('No validated responses; no empty success layers created')
    layers={k:[] for k in ['roads','road_points','waterways','water_polygons','buildings','landuse_natural','places_admin_poi','boundaries','other_tagged']}
    full=[];issues=[];relation_audit=[];geoms={}
    for key,o in objects.items():
        e=o['element'];t=e.get('tags',{});typ=e['type'];geom=None;notes={}
        try:
            if typ=='node':geom=Point(e['lon'],e['lat'])
            elif typ=='way':
                segs=chunks(e.get('geometry'))
                if not segs:raise ValueError('No complete line segment')
                missing=sum(not g for g in e.get('geometry',[]))
                notes['_missing_geometry_positions']=missing
                closed=len(segs)==1 and len(segs[0])>=4 and segs[0][0]==segs[0][-1]
                if closed and polygon_tag(t):geom=Polygon(segs[0])
                else:geom=LineString(segs[0]) if len(segs)==1 else MultiLineString(segs)
            elif typ=='relation':
                outer=[];inner=[];all_lines=[];pts=[];missing=[]
                for m in e.get('members',[]):
                    if m['type']=='way':
                        segs=chunks(m.get('geometry'))
                        if not segs:missing.append({'type':m['type'],'ref':m['ref'],'role':m.get('role')})
                        for s in segs:
                            line=LineString(s);all_lines.append(line)
                            (inner if m.get('role')=='inner' else outer).append(line)
                    elif m['type']=='node' and 'lon' in m and 'lat' in m:pts.append(Point(m['lon'],m['lat']))
                    else:missing.append({'type':m['type'],'ref':m['ref'],'role':m.get('role')})
                if t.get('type') in ('multipolygon','boundary') and outer:
                    op=list(polygonize(outer));ip=list(polygonize(inner))
                    if op:
                        geom=unary_union(op)
                        if ip:geom=geom.difference(unary_union(ip))
                        notes['_relation_assembly']='polygon_from_member_rings'
                    else:
                        geom=MultiLineString(all_lines);notes['_relation_assembly']='unclosed_member_lines'
                elif all_lines or pts:
                    geom=GeometryCollection(all_lines+pts)
                    notes['_relation_assembly']='member_geometry_collection'
                relation_audit.append({'osm_id':e['id'],'name':t.get('name'),'type':t.get('type'),
                  'member_count':len(e.get('members',[])),'missing_geometry_member_count':len(missing),
                  'missing_geometry_members':missing,'assembly':notes.get('_relation_assembly'),
                  'reference_complete_osm_graph':False})
                notes['_relation_missing_geometry_members']=len(missing)
            if geom is None or geom.is_empty:
                issues.append({'osm_type':typ,'osm_id':e['id'],'error':'No assembled geometry; original relation and tags retained in raw response'})
                continue
            if not geom.intersects(ROI):continue
            props=dict(t)
            props.update({'_osm_type':typ,'_osm_id':e['id'],'_all_tags':t,
              '_raw_response_files':o['files'],'_source_snapshots_utc':sorted(set(o['snapshots'])),
              '_geometry_valid':bool(geom.is_valid),**notes})
            original={'type':'Feature','id':f'{typ}/{e["id"]}','geometry':mapping(geom),'properties':props}
            full.append(original);geoms[key]=geom
            if not geom.is_valid:issues.append({'osm_type':typ,'osm_id':e['id'],'error':'Invalid original assembled geometry; not silently repaired'})
            cp=dict(props)
            try:
                clip=geom.intersection(ROI);cp['_clipped_to_collection_bbox']=not geom.equals(clip)
            except Exception as ex:
                clip=geom;cp['_clip_failed']=True;issues.append({'osm_type':typ,'osm_id':e['id'],'error':'Clip failed: '+str(ex)})
            f={'type':'Feature','id':original['id'],'geometry':mapping(clip),'properties':cp}
            names=[]
            if 'highway' in t:names.append('road_points' if typ=='node' else 'roads')
            if 'waterway' in t:names.append('waterways')
            if geom.geom_type in ('Polygon','MultiPolygon') and (t.get('natural')=='water' or 'water' in t or t.get('landuse') in ('reservoir','basin') or t.get('waterway')=='riverbank'):names.append('water_polygons')
            if ('building' in t and t['building']!='no') or ('building:part' in t and t['building:part']!='no'):names.append('buildings')
            if 'landuse' in t or 'natural' in t:names.append('landuse_natural')
            if t.get('boundary')=='administrative':names.append('boundaries')
            if any(k in t for k in ['place','amenity','tourism','historic','leisure','shop','office','craft','man_made','public_transport','railway','healthcare','sport']):names.append('places_admin_poi')
            for name in names or ['other_tagged']:layers[name].append(f)
        except Exception as ex:issues.append({'osm_type':typ,'osm_id':e['id'],'error':str(ex)})
    meta={'collection_bbox_wgs84':BBOX,'collection_bbox_is_admin_boundary':False,
      'crs_description':'OGC:CRS84 / WGS84 longitude,latitude (EPSG:4326 datum)',
      'attribution':'© OpenStreetMap contributors','license':'ODbL 1.0',
      'cartographic_generalization_applied':False,
      'geometry_scope':'Spatially clipped thematic extract; raw responses and full geometries retained separately'}
    for name,features in layers.items():dump(out/(name+'.geojson'),{'type':'FeatureCollection','name':name,**meta,'features':features})
    dump(ROOT/'selected_features_full_geometry.geojson',{'type':'FeatureCollection',**meta,
      'geometry_scope':'Full assembled source geometry intersecting collection bbox','features':full})
    with (ROOT/'selected_original_objects.jsonl').open('w',encoding='utf-8') as stream:
        for k,o in sorted(objects.items()):stream.write(json.dumps(o['element'],ensure_ascii=False)+'\n')
    dump(qa/'relation_geometry_audit.json',relation_audit);dump(qa/'geometry_issues.json',issues)
    snapshots=sorted({s['snapshot_utc'] for s in raw_sources})
    manifest={**meta,'created_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),
      'raw_sources':raw_sources,'source_snapshot_range_utc':[snapshots[0],snapshots[-1]],
      'unique_original_objects':len(objects),'canonical_features':len(full),
      'layer_counts':{k:len(v) for k,v in layers.items()},'layer_counts_overlap':True,
      'roads_highway_counts':dict(collections.Counter(f['properties'].get('highway') for f in layers['roads'])),
      'roads_bridge_count':sum(f['properties'].get('bridge') not in (None,'no') for f in layers['roads']),
      'buildings_geometry_types':dict(collections.Counter(f['geometry']['type'] for f in layers['buildings'])),
      'buildings_with_height':sum('height' in f['properties'] for f in layers['buildings']),
      'buildings_with_levels':sum('building:levels' in f['properties'] for f in layers['buildings']),
      'relations_with_missing_member_geometry':sum(bool(r['missing_geometry_member_count']) for r in relation_audit),
      'relation_count':len(relation_audit),'reference_complete_osm_graph':False,
      'geometry_issue_count':len(issues),'files':{str(p.relative_to(ROOT)):{'bytes':p.stat().st_size,'sha256':sha(p)} for p in list(out.glob('*.geojson'))+[ROOT/'selected_features_full_geometry.geojson',ROOT/'selected_original_objects.jsonl']},
      'limitations':['Not an administrative boundary; collection bbox includes surrounding water and neighboring areas.',
       'Overpass bbox selection depends on OSM element locations/members; area-containing-bbox cases may require explicit relation lookup.',
       'Raw responses retain all tags on selected elements; referenced members outside selection may lack their own tags.',
       'Non-area relations are not asserted reference-complete. See relation_geometry_audit.json.',
       'No external imagery/reference completeness validation performed; absence in OSM is not proof of absence in reality.',
       'Thematic layers overlap. Do not sum their feature counts as unique buildings/objects.']}
    dump(ROOT/'extraction_manifest.json',manifest)
    (ROOT/'ATTRIBUTION.txt').write_text('© OpenStreetMap contributors\nOpen Database License (ODbL) 1.0\nhttps://www.openstreetmap.org/copyright\nhttps://opendatacommons.org/licenses/odbl/1-0/\nSource: Overpass API, https://overpass-api.de/api/interpreter\nCollection bbox is not an administrative boundary.\nSource snapshots: '+', '.join(snapshots)+'\n',encoding='utf-8')
    print(json.dumps({k:manifest[k] for k in ['unique_original_objects','canonical_features','layer_counts','buildings_with_height','buildings_with_levels','relation_count','relations_with_missing_member_geometry','geometry_issue_count']},ensure_ascii=False,indent=2),flush=True)

if __name__=='__main__':main()
