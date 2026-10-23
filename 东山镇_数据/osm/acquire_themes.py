"""Small sequential Overpass extracts with validation; TLS remains enabled."""
from pathlib import Path
import argparse, collections, datetime, hashlib, json, subprocess, sys, time

ROOT = Path(__file__).resolve().parent
BBOX = [120.28,30.98,120.50,31.22]
BOX = '(30.98,120.28,31.22,120.50)'
THEMES = {
 'roads':['nwr[highway]'],
 'water':['nwr[waterway]','nwr[water]','nwr[natural=water]','nwr[landuse=reservoir]','nwr[landuse=basin]'],
 'landcover':['nwr[landuse]','nwr[natural][natural!=water]'],
 'buildings':['nwr[building]','nwr["building:part"]'],
 'poi':['nwr[place]','nwr[amenity]','nwr[tourism]','nwr[historic]','nwr[leisure]','nwr[shop]','nwr[office]','nwr[craft]','nwr[man_made]','nwr[public_transport]','nwr[railway]','nwr[sport]','nwr[healthcare]'],
 'admin':['nwr[boundary=administrative]'],
}

def utc(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def dump(path,obj): path.write_text(json.dumps(obj,ensure_ascii=False,indent=2),encoding='utf-8')

def validate(p):
    d=json.loads(p.read_text(encoding='utf-8'))
    if not isinstance(d,dict) or not isinstance(d.get('elements'),list) or d.get('remark'):
        raise ValueError('Not a complete Overpass result: '+str(d.get('remark'))[:300])
    if any(e.get('error') for e in d['elements']): raise ValueError('Error element in result')
    return d

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--theme',choices=list(THEMES)+['all'],default='all')
    ap.add_argument('--endpoint',default='https://overpass-api.de/api/interpreter')
    ap.add_argument('--run',default='20261019')
    ap.add_argument('--cooldown',type=float,default=35,
                    help='Seconds between actual public API requests; no concurrent requests')
    args=ap.parse_args()
    if not args.run.replace('_','').isalnum(): raise ValueError('Invalid run label')
    folder=ROOT/'raw'/args.run
    folder.mkdir(parents=True,exist_ok=True)
    failed=[];requested=False
    for theme in (THEMES if args.theme=='all' else [args.theme]):
        dest=folder/f'{theme}.json'
        if dest.exists():
            try:
                d=validate(dest)
                print(theme,'already validated',len(d['elements']),flush=True)
                continue
            except Exception: pass
        q='[out:json][timeout:180][maxsize:134217728];\n(\n'+''.join(s+BOX+';\n' for s in THEMES[theme])+');\nout body geom;\n'
        if requested and args.cooldown:
            print('Public API cooldown',args.cooldown,'seconds',flush=True)
            time.sleep(min(args.cooldown,60))
        qp=folder/f'{theme}.overpassql'; qp.write_text(q,encoding='utf-8')
        part=folder/f'{theme}.json.part'
        headers=folder/f'{theme}.headers.txt'
        m={'started_utc':utc(),'endpoint':args.endpoint,'bbox_wgs84':BBOX,
           'bbox_is_administrative_boundary':False,'query':q,
           'source_license':'ODbL 1.0','attribution':'© OpenStreetMap contributors',
           'all_tags_on_selected_elements_retained':True,
           'relation_scope':'out body geom; available member geometries, not recursive reference completion'}
        command=['curl.exe','--silent','--show-error','--fail-with-body','--compressed','--location','--get',
           '--connect-timeout','20','--max-time','600','--max-filesize','100000000',
           '--user-agent','Dongshan-OSM-Acquisition/1.1 (one-off local geographical study)',
           '--header','Accept: application/json','--data-urlencode',f'data@{qp}',
           '--dump-header',str(headers),'--output',str(part),'--write-out','%{json}',args.endpoint]
        print('Request',theme,flush=True)
        requested=True
        r=subprocess.run(command,capture_output=True,text=True,encoding='utf-8',errors='replace')
        try:
            curl=json.loads(r.stdout)
            # Do not archive TLS certificate bodies, cookies, or URL credentials.
            m['transport']={k:curl.get(k) for k in ['http_code','content_type','exitcode','errormsg','size_download','time_total','url_effective']}
        except Exception:
            m['transport']={'exitcode':r.returncode}
        if r.stderr: m['transport_error']=r.stderr[-800:]
        try:
            if r.returncode: raise RuntimeError(f'curl exit {r.returncode}: '+r.stderr[-300:])
            data=validate(part)
            part.replace(dest)
            m.update(status='validated',file=dest.name,bytes=dest.stat().st_size,
              sha256=hashlib.sha256(dest.read_bytes()).hexdigest(),
              osm3s=data.get('osm3s',{}),generator=data.get('generator'),
              element_counts=dict(collections.Counter(e['type'] for e in data['elements'])))
            print(theme,'VALID',m['bytes'],m['element_counts'],flush=True)
        except Exception as exc:
            m.update(status='failed',error=str(exc))
            failed.append(theme)
            print(theme,'FAILED',str(exc)[:350],flush=True)
        m['finished_utc']=utc(); dump(folder/f'{theme}.manifest.json',m)
    return 1 if failed else 0

if __name__=='__main__': sys.exit(main())
