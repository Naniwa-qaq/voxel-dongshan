"""One bounded, read-only Overpass request; no tile requests or API credentials.

All files are written below this script's directory. This is a fallback when
the Geofabrik province extract is unreachable or no PBF reader is available.
"""
from pathlib import Path
import argparse
import datetime as dt
import hashlib
import json
import sys
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parent
BBOX = [120.28, 30.98, 120.50, 31.22]
SELECTORS = [
    '[highway]', '[waterway]', '[water]', '[natural]', '[landuse]',
    '[building]', '["building:part"]', '[place]', '[boundary=administrative]',
    '[amenity]', '[tourism]', '[historic]', '[leisure]', '[shop]', '[office]',
    '[craft]', '[man_made]', '[public_transport]', '[railway]', '[name]',
]
box = f"({BBOX[1]},{BBOX[0]},{BBOX[3]},{BBOX[2]})"
QUERY = '[out:json][timeout:180][maxsize:134217728];\n(\n' + ''.join(
    f'  nwr{s}{box};\n' for s in SELECTORS
) + ');\nout meta geom;\n'

def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--endpoint', default='https://overpass-api.de/api/interpreter')
    ap.add_argument('--label', default='overpass_main')
    args = ap.parse_args()
    if not args.endpoint.startswith('https://'):
        raise ValueError('HTTPS is required')
    if not args.label.replace('_', '').isalnum():
        raise ValueError('Use a simple alphanumeric label')
    raw_dir = ROOT / 'raw'
    raw_dir.mkdir(exist_ok=True)
    query_path = raw_dir / 'dongshan_bbox_query.overpassql'
    query_path.write_text(QUERY, encoding='utf-8')
    outfile = raw_dir / f'{args.label}.json'
    manifest = {
        'request_started_utc': now(), 'endpoint': args.endpoint,
        'bbox_wgs84': BBOX, 'bbox_order': 'west,south,east,north',
        'selection_scope': 'collection envelope, not an administrative boundary',
        'query_file': str(query_path.relative_to(ROOT)),
        'method': 'POST', 'server_timeout_seconds': 180,
        'client_timeout_seconds': 210,
        'max_response_bytes': 100 * 1024 * 1024,
        'attribution': '© OpenStreetMap contributors',
        'data_license': 'ODbL 1.0',
        'license_url': 'https://www.openstreetmap.org/copyright',
        'query_includes_all_tags_on_selected_elements': True,
        'relation_note': 'out geom returns available member geometries; this is not a recursively reference-complete OSM extract',
    }
    req = urllib.request.Request(
        args.endpoint,
        data=urllib.parse.urlencode({'data': QUERY}).encode('utf-8'),
        headers={
            'User-Agent': 'Dongshan-OSM-Acquisition/1.0 (one-off local geographical study)',
            'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
            'Accept': 'application/json',
        }, method='POST',
    )
    print('Requesting', args.endpoint, 'bbox', BBOX, flush=True)
    try:
        with urllib.request.urlopen(req, timeout=210) as resp:
            headers = dict(resp.headers.items())
            status = resp.status
            body = resp.read(manifest['max_response_bytes'] + 1)
        manifest.update({'http_status': status, 'response_headers': headers,
                         'response_bytes': len(body), 'final_url': args.endpoint})
        (raw_dir / f'{args.label}.headers.json').write_text(
            json.dumps(headers, ensure_ascii=False, indent=2), encoding='utf-8')
        if len(body) > manifest['max_response_bytes']:
            raise RuntimeError('Response exceeded the deliberately bounded size cap')
        data = json.loads(body)
        outfile.write_bytes(body)
        manifest['sha256'] = hashlib.sha256(body).hexdigest()
        manifest['osm3s'] = data.get('osm3s', {})
        manifest['generator'] = data.get('generator')
        manifest['element_counts'] = {
            typ: sum(e.get('type') == typ for e in data.get('elements', []))
            for typ in ['node', 'way', 'relation']
        }
        if data.get('remark'):
            manifest['server_remark'] = data['remark']
            manifest['status'] = 'response_with_server_remark_check_for_truncation'
        else:
            manifest['status'] = 'downloaded_json'
        print(json.dumps({k: manifest[k] for k in ['status', 'response_bytes', 'sha256', 'element_counts']}, ensure_ascii=False), flush=True)
    except Exception as exc:
        manifest['status'] = 'failed'
        manifest['error'] = f'{type(exc).__name__}: {exc}'
        if isinstance(exc, urllib.error.HTTPError):
            manifest['http_status'] = exc.code
            manifest['response_headers'] = dict(exc.headers.items())
            error_body = exc.read(1024 * 1024)
            (raw_dir / f'{args.label}.error.txt').write_bytes(error_body)
        print(manifest['error'], flush=True)
    finally:
        manifest['request_finished_utc'] = now()
        (raw_dir / f'{args.label}.manifest.json').write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    return 0 if manifest['status'] != 'failed' else 1

if __name__ == '__main__':
    sys.exit(main())
