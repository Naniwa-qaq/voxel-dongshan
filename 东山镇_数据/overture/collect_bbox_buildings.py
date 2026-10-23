"""Read only spatially selected Overture building rows from a pinned release."""
from pathlib import Path
import collections, datetime, hashlib, json, sys
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT.parent/'_runtime'))
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.dataset as ds
import pyarrow.fs as fs
import pyarrow.parquet as pq
import shapely
from shapely.geometry import box, mapping

BBOX=[120.28,30.98,120.50,31.22]
RELEASE='2026-09-23.1'
def dump(p,d):p.write_text(json.dumps(d,ensure_ascii=False,indent=2,default=str),encoding='utf-8')
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def utc():return datetime.datetime.now(datetime.timezone.utc).isoformat()

def main():
    prov=ROOT/'provenance';prov.mkdir(exist_ok=True)
    raw=ROOT/'raw';raw.mkdir(exist_ok=True)
    manifest={'started_utc':utc(),'release':RELEASE,'bbox_wgs84':BBOX,
      'collection_bbox_is_administrative_boundary':False,'theme':'buildings','type':'building',
      'crs':'OGC:CRS84 / WGS84 longitude,latitude','license':'ODbL 1.0',
      'license_url':'https://docs.overturemaps.org/attribution/',
      'source_fields_preserved':True,'raw_geometry_modified':False,
      'relationship_to_osm':'Separate candidate building dataset, not blindly concatenated with OSM.'}
    try:
        index=prov/f'collections_{RELEASE}.parquet.part'
        if not index.exists():index=prov/f'collections_{RELEASE}.parquet'
        table=pq.read_table(index)
        filt=(pc.field('collection')=='building') & (pc.field('type')=='Feature') & (
          (pc.field('bbox','xmin')<BBOX[2]) & (pc.field('bbox','xmax')>BBOX[0]) &
          (pc.field('bbox','ymin')<BBOX[3]) & (pc.field('bbox','ymax')>BBOX[1]))
        hits=table.filter(filt).to_pylist()
        assets=[h['assets']['aws']['alternate']['s3']['href'] for h in hits]
        manifest.update(index_sha256=sha(index),selected_asset_count=len(assets),selected_assets=assets)
        dump(prov/'selected_building_assets.json',{'release':RELEASE,'bbox':BBOX,'assets':assets,
            'stac_matches':[{k:h.get(k) for k in ['id','bbox','collection']} for h in hits]})
        print('Spatially selected files:',len(assets),flush=True)
        if not assets:raise RuntimeError('STAC reports no intersecting building files')
        s3=fs.S3FileSystem(anonymous=True,region='us-west-2',connect_timeout=20,request_timeout=180)
        source=ds.dataset([a.removeprefix('s3://') for a in assets],filesystem=s3,format='parquet')
        f=(pc.field('bbox','xmin')<BBOX[2]) & (pc.field('bbox','xmax')>BBOX[0]) & (
          pc.field('bbox','ymin')<BBOX[3]) & (pc.field('bbox','ymax')>BBOX[1])
        batches=[]
        for b in source.to_batches(filter=f,batch_size=8192,use_threads=False,batch_readahead=1,fragment_readahead=1):
            if b.num_rows:
                batches.append(b);print('Received building rows:',sum(x.num_rows for x in batches),flush=True)
        if not batches:
            table=pa.Table.from_batches([],schema=source.schema)
        else:table=pa.Table.from_batches(batches)
        # Preserve source schema and values; remove stale global file-level bbox only.
        md=dict(table.schema.metadata or {})
        if b'geo' in md:
            geo=json.loads(md[b'geo'])
            for col in geo.get('columns',{}).values():col.pop('bbox',None)
            md[b'geo']=json.dumps(geo).encode()
        table=table.replace_schema_metadata(md)
        path=raw/f'buildings_bbox_{RELEASE}.parquet'
        pq.write_table(table,path,compression='zstd')
        # Exact geometry intersection removes bbox-only false hits from the derived
        # GeoJSON; the raw GeoParquet retains every returned row, unchanged.
        roi=box(*BBOX);features=[];sources=collections.Counter();invalid=[]
        for row in table.to_pylist():
            geom=shapely.from_wkb(row.pop('geometry'))
            if not geom.intersects(roi):continue
            fid=row.get('id')
            if not geom.is_valid:invalid.append(fid)
            for src in row.get('sources') or []:sources[str(src.get('dataset'))]+=1
            row['_collection_release']=RELEASE
            row['_collection_bbox_is_admin_boundary']=False
            features.append({'type':'Feature','id':fid,'geometry':mapping(geom),'properties':row})
        geo=ROOT/f'buildings_bbox_{RELEASE}.geojson'
        dump(geo,{'type':'FeatureCollection','name':'Overture building candidates','release':RELEASE,
          'collection_bbox_wgs84':BBOX,'geometry_scope':'Full source buildings intersecting the collection bbox; not simplified or clipped',
          'features':features})
        manifest.update(status='acquired',raw_feature_rows=table.num_rows,exact_intersection_features=len(features),
          source_dataset_mentions=dict(sources),invalid_geometry_ids=invalid,
          features_with_height=sum(f['properties'].get('height') is not None for f in features),
          features_with_num_floors=sum(f['properties'].get('num_floors') is not None for f in features),
          raw_parquet_file=str(path.relative_to(ROOT)),raw_parquet_bytes=path.stat().st_size,raw_parquet_sha256=sha(path),
          geojson_file=geo.name,geojson_bytes=geo.stat().st_size,geojson_sha256=sha(geo),
          observed_bounds=shapely.total_bounds([shapely.from_geojson(json.dumps(f['geometry'])) for f in features]).tolist() if features else None,
          schema_fields=table.schema.names)
        (ROOT/'ATTRIBUTION.txt').write_text('Overture Maps Foundation\n© OpenStreetMap contributors and other upstream data providers listed in each feature sources field.\nBuildings theme: ODbL 1.0\nhttps://docs.overturemaps.org/attribution/\nPinned release: '+RELEASE+'\nFull source metadata remains in raw GeoParquet and GeoJSON.\n',encoding='utf-8')
        print(json.dumps({k:manifest[k] for k in ['status','raw_feature_rows','exact_intersection_features','source_dataset_mentions','features_with_height']},ensure_ascii=False,indent=2),flush=True)
    except Exception as e:
        manifest.update(status='failed',error=f'{type(e).__name__}: {e}')
        print(manifest['error'],flush=True)
        raise
    finally:
        manifest['finished_utc']=utc();dump(prov/'bbox_buildings_manifest.json',manifest)

if __name__=='__main__':main()
