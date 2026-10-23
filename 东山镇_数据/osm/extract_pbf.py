"""Extract the agreed Dongshan collection envelope without cartographic deletion.

Requires pyosmium and shapely. Source PBF remains untouched. Full geometries,
all tags, regional reference objects, clipped thematic GeoJSON, provenance and
reference-completeness audits are retained below this script's directory.
"""
from pathlib import Path
import argparse
from collections import Counter
import datetime as dt
import hashlib
import json
import sys

ROOT = Path(__file__).resolve().parent
BBOX = (120.28, 30.98, 120.50, 31.22)
RUNTIME = ROOT.parent / '_runtime'
if RUNTIME.exists():
    sys.path.insert(0, str(RUNTIME))

def dump(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')

def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()

def utc():
    return dt.datetime.now(dt.timezone.utc).isoformat()

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('source', type=Path)
    args = ap.parse_args()
    source = args.source.resolve()
    if not source.is_file():
        raise FileNotFoundError(source)
    import osmium
    import shapely
    from shapely.geometry import box, shape, mapping, LineString

    roi = box(*BBOX)
    out = ROOT / 'layers'
    out.mkdir(exist_ok=True)
    fab = osmium.geom.GeoJSONFactory()
    selected = {'node': set(), 'way': set(), 'relation': set()}
    records = {}
    full_features = []
    pending_areas = {}
    polygon_origins = set()
    issues = []
    layers = {k: [] for k in ['roads', 'waterways', 'water_polygons', 'buildings',
              'landuse_natural', 'places_admin_poi', 'other_tagged']}

    def common(obj, typ):
        tags = dict(obj.tags)
        return {'osm_type': typ, 'osm_id': obj.id, 'osm_version': obj.version,
                'osm_timestamp': str(obj.timestamp), 'tags': tags}

    class Relations(osmium.SimpleHandler):
        def __init__(self):
            super().__init__()
            self.data = {}
        def relation(self, r):
            d = common(r, 'relation')
            d['members'] = [{'type': m.type, 'ref': m.ref, 'role': m.role} for m in r.members]
            self.data[r.id] = d

    print('Reading source relation metadata', flush=True)
    rels = Relations()
    rels.apply_file(str(source))

    def classify(tags, geom_type):
        result = []
        if 'highway' in tags:
            result.append('roads')
        if 'waterway' in tags:
            result.append('waterways')
        if geom_type in ('Polygon', 'MultiPolygon') and (
            tags.get('natural') == 'water' or 'water' in tags or
            tags.get('landuse') in ('reservoir', 'basin') or tags.get('waterway') == 'riverbank'):
            result.append('water_polygons')
        if ((tags.get('building') and tags['building'] != 'no') or
            (tags.get('building:part') and tags['building:part'] != 'no')):
            result.append('buildings')
        if 'landuse' in tags or 'natural' in tags:
            result.append('landuse_natural')
        if any(k in tags for k in ['place', 'boundary', 'amenity', 'tourism', 'historic',
                'leisure', 'shop', 'office', 'craft', 'man_made', 'public_transport',
                'railway', 'name', 'healthcare', 'sport']):
            result.append('places_admin_poi')
        return result or ['other_tagged']

    def feature(typ, oid, tags, geom, meta):
        if geom.is_empty or not geom.intersects(roi):
            return
        props = dict(tags)
        props.update({'_osm_type': typ, '_osm_id': oid,
                      '_osm_version': meta.get('osm_version'),
                      '_osm_timestamp': meta.get('osm_timestamp'),
                      '_tags': tags, '_geometry_valid': bool(geom.is_valid),
                      '_geometry_scope': 'complete source geometry intersecting collection bbox'})
        if not geom.is_valid:
            issues.append({'osm_type': typ, 'osm_id': oid, 'issue': 'invalid_source_geometry'})
        full = {'type': 'Feature', 'id': f'{typ}/{oid}', 'geometry': mapping(geom), 'properties': props}
        full_features.append(full)
        clipped_props = dict(props)
        try:
            clipped = geom.intersection(roi)
            clipped_props['_geometry_scope'] = 'clipped to collection bbox; not an administrative boundary'
            clipped_props['_bbox_clipped'] = not geom.equals(clipped)
        except Exception as exc:
            clipped = geom
            clipped_props['_clip_failed'] = True
            issues.append({'osm_type': typ, 'osm_id': oid, 'issue': 'clip_failed', 'error': str(exc)})
        f = {'type': 'Feature', 'id': f'{typ}/{oid}', 'geometry': mapping(clipped), 'properties': clipped_props}
        for layer in classify(tags, geom.geom_type):
            layers[layer].append(f)

    area_keys = {'building', 'building:part', 'landuse', 'amenity', 'leisure', 'shop',
                 'tourism', 'historic', 'place', 'water', 'office', 'craft'}
    def expects_area(tags, closed):
        return closed and tags.get('area') != 'no' and (
            tags.get('area') == 'yes' or any(k in tags for k in area_keys) or
            (tags.get('natural') and tags['natural'] not in ('coastline', 'cliff', 'ridge', 'arete', 'tree_row')) or
            tags.get('waterway') == 'riverbank')

    print('Scanning geometries and assembling source polygons', flush=True)
    fp = osmium.FileProcessor(str(source)).with_areas()
    processed = Counter()
    for obj in fp:
        typ = obj.type_str()
        processed[typ] += 1
        if obj.is_node():
            if obj.tags and obj.location.valid() and roi.covers(shape(json.loads(fab.create_point(obj)))):
                d = common(obj, 'node')
                d['lon'], d['lat'] = obj.lon, obj.lat
                selected['node'].add(obj.id)
                records[('node', obj.id)] = d
                feature('node', obj.id, d['tags'], shape(json.loads(fab.create_point(obj))), d)
        elif obj.is_way():
            if not obj.tags:
                continue
            try:
                coords = [(n.lon, n.lat) for n in obj.nodes]
                if len(coords) < 2:
                    continue
                xs, ys = zip(*coords)
                if max(xs) < BBOX[0] or min(xs) > BBOX[2] or max(ys) < BBOX[1] or min(ys) > BBOX[3]:
                    continue
                geom = LineString(coords)
                if not geom.intersects(roi) and not (obj.is_closed() and shape({'type':'Polygon','coordinates':[coords]}).intersects(roi)):
                    continue
                d = common(obj, 'way')
                d['nodes'] = [n.ref for n in obj.nodes]
                selected['way'].add(obj.id)
                records[('way', obj.id)] = d
                if expects_area(d['tags'], obj.is_closed()):
                    pending_areas[obj.id] = (geom, d)
                else:
                    feature('way', obj.id, d['tags'], geom, d)
            except Exception as exc:
                issues.append({'osm_type':'way', 'osm_id':obj.id, 'issue':'way_geometry_error', 'error':str(exc)})
        elif obj.is_area():
            if not obj.tags:
                continue
            try:
                geom = shape(json.loads(fab.create_multipolygon(obj)))
                if not geom.intersects(roi):
                    continue
                original_type = 'way' if obj.from_way() else 'relation'
                original_id = obj.orig_id()
                selected[original_type].add(original_id)
                if original_type == 'relation':
                    d = rels.data.get(original_id, common(obj, 'relation'))
                    records[('relation', original_id)] = d
                else:
                    d = records.get(('way', original_id), common(obj, 'way'))
                    d['osm_id'] = original_id
                    pending_areas.pop(original_id, None)
                origin = (original_type, original_id)
                if origin not in polygon_origins:
                    polygon_origins.add(origin)
                    feature(original_type, original_id, dict(obj.tags), geom, d)
            except Exception as exc:
                issues.append({'osm_type':'area', 'osm_id':obj.id, 'issue':'area_geometry_error', 'error':str(exc)})

    # Retain rather than discard unassembled closed ways.
    for oid, (geom, d) in pending_areas.items():
        issues.append({'osm_type':'way', 'osm_id':oid, 'issue':'expected_area_exported_as_line_unassembled'})
        feature('way', oid, d['tags'], geom, d)

    # Include relations touching selected objects as context. This is not an assertion
    # that a route, administrative region, or any other relation is bbox-bounded.
    member_type = {'n':'node', 'w':'way', 'r':'relation'}
    rounds = 0
    changed = True
    while changed and rounds < 20:
        changed = False
        rounds += 1
        for rid, r in rels.data.items():
            if rid in selected['relation']:
                continue
            if any(m['ref'] in selected[member_type[m['type']]] for m in r['members']):
                selected['relation'].add(rid)
                records[('relation',rid)] = r
                changed = True

    header_reader = osmium.io.Reader(str(source), osmium.osm.NOTHING)
    hdr = header_reader.header()
    source_header = {k: hdr.get(k) for k in ['generator', 'osmosis_replication_timestamp',
                     'osmosis_replication_sequence_number', 'osmosis_replication_base_url', 'timestamp']}
    header_reader.close()
    region_pbf = ROOT / 'dongshan_bbox_reference_objects.osm.pbf'
    print('Writing regional reference objects, preserving member tags', flush=True)
    with osmium.BackReferenceWriter(str(region_pbf), str(source), remove_tags=False,
                                   relation_depth=20, overwrite=True) as writer:
        for obj in osmium.FileProcessor(str(source)):
            typ = {'n':'node', 'w':'way', 'r':'relation'}.get(obj.type_str())
            if typ and obj.id in selected[typ]:
                writer.add(obj)

    print('Auditing referenced nodes, ways and relations', flush=True)
    class Audit(osmium.SimpleHandler):
        def __init__(self):
            super().__init__()
            self.nodes, self.ways, self.rels = set(), set(), set()
            self.missing_nodes = set()
            self.relation_members = {}
            self.tagged = Counter()
        def node(self,n):
            self.nodes.add(n.id)
            if n.tags: self.tagged['node'] += 1
        def way(self,w):
            self.ways.add(w.id)
            if w.tags: self.tagged['way'] += 1
            self.missing_nodes.update(n.ref for n in w.nodes if n.ref not in self.nodes)
        def relation(self,r):
            self.rels.add(r.id)
            if r.tags: self.tagged['relation'] += 1
            self.relation_members[r.id] = [(m.type,m.ref) for m in r.members]
    audit = Audit()
    audit.apply_file(str(region_pbf))
    have = {'n':audit.nodes,'w':audit.ways,'r':audit.rels}
    relation_audit = []
    for rid, members in audit.relation_members.items():
        missing = [{'type':t,'ref':i} for t,i in members if i not in have[t]]
        relation_audit.append({'osm_id':rid,'member_count':len(members),
                               'missing_member_count':len(missing),'missing_members':missing})
    incomplete = [r for r in relation_audit if r['missing_member_count']]
    ref_audit = {'missing_way_node_ids': sorted(audit.missing_nodes),
                 'missing_way_node_count': len(audit.missing_nodes),
                 'relations':relation_audit,
                 'incomplete_relation_count':len(incomplete),
                 'reference_complete': not audit.missing_nodes and not incomplete,
                 'note':'References can only be completed from objects present in the Jiangsu source; nested relation completion depth 20.'}
    dump(ROOT/'reference_completeness.json', ref_audit)

    collection_meta = {'collection_bbox_wgs84': list(BBOX), 'crs':'OGC:CRS84 / WGS84 longitude,latitude (EPSG:4326 datum)',
                       'bbox_is_administrative_boundary':False, 'attribution':'© OpenStreetMap contributors',
                       'license':'ODbL 1.0', 'license_url':'https://www.openstreetmap.org/copyright',
                       'all_source_tags_retained':True,
                       'no_cartographic_generalization_or_feature_deletion':True}
    for name, features in layers.items():
        dump(out/f'{name}.geojson', {'type':'FeatureCollection','name':name,
                                   **collection_meta,'features':features})
    dump(ROOT/'selected_features_full_geometry.geojson', {'type':'FeatureCollection',
          **collection_meta, 'geometry_note':'Full original geometries intersecting collection bbox; may extend beyond it.',
          'features':full_features})
    with (ROOT/'selected_original_objects.jsonl').open('w',encoding='utf-8') as f:
        for key in sorted(records):
            f.write(json.dumps(records[key],ensure_ascii=False)+'\n')

    buildings = layers['buildings']
    highway = Counter(f['properties'].get('highway','') for f in layers['roads'])
    poi_tags = Counter()
    for f in layers['places_admin_poi']:
        for k in ['amenity','tourism','historic','place','boundary','leisure','shop']:
            if k in f['properties']:
                poi_tags[f'{k}={f["properties"][k]}'] += 1
    water_names = sorted({f['properties'].get('name') for f in layers['water_polygons'] if f['properties'].get('name')})
    metadata = {**collection_meta, 'created_utc':utc(), 'source_file':source.name,
                'source_bytes':source.stat().st_size,'source_sha256':digest(source),
                'source_header':source_header,
                'software':{'pyosmium':getattr(osmium,'__version__','see runtime package metadata'),
                            'shapely':shapely.__version__},
                'selected_original_object_counts':{k:len(v) for k,v in selected.items()},
                'regional_pbf_object_counts':{'nodes':len(audit.nodes),'ways':len(audit.ways),'relations':len(audit.rels)},
                'regional_pbf_sha256':digest(region_pbf),
                'thematic_layer_counts':{k:len(v) for k,v in layers.items()},
                'layer_counts_overlap':True,
                'canonical_feature_count':len(full_features),
                'roads_by_highway':dict(highway),
                'building_features_with_height':sum('height' in f['properties'] for f in buildings),
                'building_features_with_levels':sum('building:levels' in f['properties'] for f in buildings),
                'buildings_by_geometry':dict(Counter(f['geometry']['type'] for f in buildings)),
                'water_polygon_names':water_names,
                'poi_tag_counts':dict(poi_tags),
                'reference_complete':ref_audit['reference_complete'],
                'incomplete_relation_count':len(incomplete),
                'geometry_issues_count':len(issues), 'geometry_issues':issues,
                'processed_source_object_counts':dict(processed),
                'limitations':['Collection envelope includes islands, water and neighboring areas; not a town boundary.',
                  'An OSM object not present in the extract does not prove the real object is absent.',
                  'Thematic layers overlap; do not sum them as unique objects.',
                  'Clipped polygons are spatial extracts, not cartographic simplification; source PBF and full geometries are retained.',
                  'Route/restriction and other non-area relations are retained in raw PBF and JSONL context, not synthesized into thematic polygon geometries.',
                  'Geofabrik omits contributor usernames, user IDs and changeset IDs in its public extracts.']}
    dump(ROOT/'extraction_manifest.json', metadata)
    (ROOT/'ATTRIBUTION.txt').write_text('© OpenStreetMap contributors\nData: Open Database License (ODbL) 1.0\nhttps://www.openstreetmap.org/copyright\nhttps://opendatacommons.org/licenses/odbl/1-0/\nRegional source: Geofabrik GmbH, https://download.geofabrik.de/asia/china/jiangsu.html\nThis collection envelope is not an administrative boundary.\n',encoding='utf-8')
    print(json.dumps({k:metadata[k] for k in ['thematic_layer_counts','buildings_by_geometry','building_features_with_height','building_features_with_levels','reference_complete','incomplete_relation_count','geometry_issues_count']},ensure_ascii=False,indent=2),flush=True)

if __name__ == '__main__':
    main()
