"""One continuous Dongshan design world; all audited source datasets read-only.

Run with the installed GDAL/NumPy/SciPy Python. No ArcPy or web calls.
Buildings retain their existing metric dimensions. G/C warp acts on geographic
anchors and networks; two local facility contexts are rigidly translated.
"""
from __future__ import annotations

import copy
import hashlib
import heapq
import json
import math
from collections import defaultdict
from pathlib import Path

import numpy as np
from osgeo import gdal, ogr, osr
from scipy.ndimage import gaussian_filter, median_filter

gdal.UseExceptions(); ogr.UseExceptions(); osr.UseExceptions()
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '东山镇_重制版'
DATA = OUT / 'data'
SOURCE = ROOT / '东山镇_数据/working/dongshan_sources_utm51n.gpkg'
DSM = ROOT / '东山镇_数据/terrain/derived/dongshan_envelope_glo30_2021_utm51n_30m.tif'
WC = ROOT / '东山镇_数据/landcover/derived/dongshan_envelope_worldcover_2021_v200_utm51n_10m.tif'
VERSION = '2026-10-22-unified-map-2'


def load(path): return json.loads(path.read_text(encoding='utf-8-sig'))
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def compact(value): return json.dumps(value, ensure_ascii=False, separators=(',', ':'))
def rnd(v, n=2): return round(float(v), n)


original = load(DATA / 'design.json')
landscape = load(DATA / 'landscape-revision-audit.json')['patch']
districts = [load(DATA / f'districts/{sid}.json') for sid in ['dongshan-school', 'chunzailou-garden']]
source_paths = [SOURCE, DSM, WC, DATA / 'design.json', OUT / 'js/design.js',
                DATA / 'landscape-revision-audit.json'] + [DATA / f"districts/{d['id']}.json" for d in districts]
source_hashes = {str(p.relative_to(ROOT)): sha(p) for p in source_paths}
OX, OY = original['geographic']['originUTM51N']
school_g = [districts[0]['georeference']['originUTM51N'][0] - OX, OY - districts[0]['georeference']['originUTM51N'][1]]
garden_g = [districts[1]['georeference']['originUTM51N'][0] - OX, OY - districts[1]['georeference']['originUTM51N'][1]]
# Every original anchor inside the Luxiang domain stays exactly in place.
GX = np.array([-1200, -450, -320, -240, -160, -80, 0, 100, 200, 350, 500, 700, school_g[0], garden_g[0], 6000], float)
CX = np.array([-600, -240, -160, -100, -40, 12, 60, 120, 172, 240, 300, 390, 1050, 1170, 1450], float)
GZ = np.array([-3500, -3000, school_g[1], -450, -300, -180, -80, 0, 100, 220, 350, 450, 1000], float)
CZ = np.array([-1250, -1100, -650, -270, -198, -130, -64, 0, 68, 145, 220, 270, 460], float)
assert np.all(np.diff(GX) > 0) and np.all(np.diff(CX) > 0)
assert np.all(np.diff(GZ) > 0) and np.all(np.diff(CZ) > 0)
BOUNDS = dict(minX=-300, maxX=1450, minZ=-1120, maxZ=460)


def map_g(x, z): return [rnd(np.interp(x, GX, CX)), rnd(np.interp(z, GZ, CZ))]
def inverse(x, z): return [float(np.interp(x, CX, GX)), float(np.interp(z, CZ, GZ))]
def pt(x, z):
    p = ogr.Geometry(ogr.wkbPoint); p.AddPoint_2D(x, z); return p
def line(points):
    g = ogr.Geometry(ogr.wkbLineString)
    for x, z in points: g.AddPoint_2D(float(x), float(z))
    return g
def polygon(points):
    ring = ogr.Geometry(ogr.wkbLinearRing)
    for x, z in points + [points[0]]: ring.AddPoint_2D(float(x), float(z))
    g = ogr.Geometry(ogr.wkbPolygon); g.AddGeometry(ring); return g
def rectangle(x0, z0, x1, z1): return polygon([[x0, z0], [x1, z0], [x1, z1], [x0, z1]])
def all_lines(g):
    if g.IsEmpty(): return
    if g.GetGeometryName() in ['LINESTRING', 'LINEARRING']: yield g
    else:
        for i in range(g.GetGeometryCount()): yield from all_lines(g.GetGeometryRef(i))
def road_length(points): return sum(math.dist(a, b) for a, b in zip(points, points[1:]))
def house_rect(h, margin=0):
    c, s = math.cos(h.get('rotation', 0)), math.sin(h.get('rotation', 0))
    w, d = h['width'] + 2 * margin, h['depth'] + 2 * margin
    return polygon([[h['x'] + c*u+s*v, h['z']-s*u+c*v]
                    for u, v in [(-w/2,-d/2),(w/2,-d/2),(w/2,d/2),(-w/2,d/2)]])


ds = ogr.Open(str(SOURCE))
dem = gdal.Open(str(DSM)); gt = dem.GetGeoTransform()
dem_array = gaussian_filter(median_filter(dem.ReadAsArray().astype(float), size=3), .65)
wc_ds = gdal.Open(str(WC)); wc_gt = wc_ds.GetGeoTransform(); wc_array = wc_ds.ReadAsArray()


def sample_dem(gx, gz):
    fx=(OX+gx-gt[0])/gt[1]-.5; fz=(OY-gz-gt[3])/gt[5]-.5
    ix,iz=math.floor(fx),math.floor(fz);tx,tz=fx-ix,fz-iz
    ix=max(0,min(dem_array.shape[1]-2,ix));iz=max(0,min(dem_array.shape[0]-2,iz))
    return float((dem_array[iz,ix]*(1-tx)*(1-tz)+dem_array[iz,ix+1]*tx*(1-tz)
                  +dem_array[iz+1,ix]*(1-tx)*tz+dem_array[iz+1,ix+1]*tx*tz)-.5)


def level_for(district):
    origin=district['georeference']['originUTM51N'];gx,gz=origin[0]-OX,OY-origin[1]
    boundary=polygon(district['boundary']);envelope=boundary.GetEnvelope();samples=[]
    for z in np.arange(envelope[2],envelope[3]+1,30):
        for x in np.arange(envelope[0],envelope[1]+1,30):
            if boundary.Contains(pt(x,z)):samples.append(sample_dem(gx+x,gz+z))
    level=round(float(np.median(samples))/.2)*.2
    return max(.8,level),dict(sampleCount=len(samples),filteredSourceMedian=rnd(np.median(samples)),
                              filteredSourceRange=[rnd(min(samples)),rnd(max(samples))],
                              method='Median over source facility parcel on the same 3x3 native-pixel median + sigma .65 filtered DSM; subtract common local-lake baseline .5m; quantize .2m')


D = copy.deepcopy(original)
D.update(id='unified-dongshan', version=VERSION, title='东山 · 山湖之间', subtitle='一张连续体素地图', bounds=BOUNDS)
D['roads'] = copy.deepcopy(landscape['roads'])
D['water']['canals'] = copy.deepcopy(landscape['canals'])
D['water']['terminals'] = copy.deepcopy(landscape['waterTerminals'])
D['bridges'] = copy.deepcopy(landscape['bridges'])
D['landscapeRevision'] = dict(version=landscape['version'], surfaceStyle=landscape['surfaceStyle'], topologyPolicy=landscape['topologyPolicy'])
for kind in ['houses', 'trees', 'compounds', 'courtyardWalls', 'bridges']:
    for item in D.get(kind, []): item.update(zoneId='luxiang',districtId='luxiang')
D['grounds'] = []; D['walls'] = []; D['rocks'] = []; D['water']['ponds'] = []
D['zones'] = [dict(id='luxiang', name='陆巷街村', center=[60, 0], bounds=original['bounds'],
                   sourceOriginWgs84=original['geographic']['originWgs84'], cameraSuggestions=original['cameraSuggestions'],
                   sourceRelationship='源路水和足迹锚点的街村综合，原C坐标全部保持')]
D['sharedTerraces'] = [dict(id='luxiang-grading', zoneId='luxiang', mode='shore-inland',
                            polygon=original['designTerraces']['core']['polygon'],
                            config=original['designTerraces'],
                            basis='既有陆巷连片设计整地，不逐屋染色，不新增测量精度')]
contexts=[]; facility_metrics=[]; elevation_transfers=[]


def translate(item, cx, cz, zone_id, level):
    v=copy.deepcopy(item);v['zoneId']=zone_id;v['districtId']=zone_id
    if 'x' in v:v['x']=rnd(v['x']+cx)
    if 'z' in v:v['z']=rnd(v['z']+cz)
    for key in ['points','polygon','sourceFootprint']:
        if key in v:v[key]=[[rnd(x+cx),rnd(z+cz)] for x,z in v[key]]
    if 'level' in v:
        old=v['level'];v['level']=rnd(old+level-1.2)
        elevation_transfers.append(dict(zoneId=zone_id,id=v['id'],field='level',sourceLocalValue=old,sourceFacilityGround=1.2,globalGround=level,globalValue=v['level']))
    # gardenBridge.height is the absolute deck centre elevation in the old
    # facility frame, whereas wall/rock.height is a relative component size.
    if v.get('kind')=='gardenBridge' and 'height' in v:
        old=v['height'];v['height']=rnd(old+level-1.2)
        v['sourceLocalDeckHeight']=old
        v['heightDatum']='global world metres relative to the shared local-lake DSM baseline'
        elevation_transfers.append(dict(zoneId=zone_id,id=v['id'],field='height',role='absolute bridge deck centre',sourceLocalValue=old,sourceFacilityGround=1.2,globalGround=level,globalValue=v['height']))
    if 'gateGap' in v:
        a=v['gateGap'];v['gateGap']=[rnd(a[0]+cx),rnd(a[1]+cz),rnd(a[2]+cx),rnd(a[3]+cz)]
    return v


for district in districts:
    zone_id=district['id'];u,v=district['georeference']['originUTM51N'];gx,gz=u-OX,OY-v
    cx,cz=map_g(gx,gz);level,metrics=level_for(district)
    contexts.append(dict(id=zone_id,sourceCenter=[gx,gz],center=[cx,cz],bounds=district['bounds'],collar=220))
    b=district['bounds'];global_bounds=dict(minX=rnd(b['minX']+cx),maxX=rnd(b['maxX']+cx),minZ=rnd(b['minZ']+cz),maxZ=rnd(b['maxZ']+cz))
    cameras=copy.deepcopy(district['cameraSuggestions'])
    for key,value in cameras.items():
        if isinstance(value,list) and len(value)==2:cameras[key]=[rnd(value[0]+cx),rnd(value[1]+cz)]
        elif isinstance(value,list) and len(value)==3:cameras[key]=[rnd(value[0]+cx),rnd(value[1]+level-1.2),rnd(value[2]+cz)]
    zone=dict(id=zone_id,name=district['name'],center=[cx,cz],bounds=global_bounds,sourceOriginWgs84=district['originWgs84'],
              sourceOriginLocal=[rnd(gx),rnd(gz)],cameraSuggestions=cameras,displayGroundLevel=rnd(level),
              sourceRelationship='真实G方向与源地块锚点进入同一分段单调C域；局部完整构件仅刚性平移，不缩放')
    D['zones'].append(zone)
    for key in ['houses','grounds','walls','rocks','bridges','trees']:
        for item in district.get(key,[]):
            moved=translate(item,cx,cz,zone_id,level)
            if key!='houses':moved['id']=zone_id+'::'+moved['id']
            D[key].append(moved)
    for item in district['water'].get('ponds',[]):
        moved=translate(item,cx,cz,zone_id,level);moved['id']=zone_id+'::'+moved['id'];D['water']['ponds'].append(moved)
    for item in district.get('roads',district.get('paths',[])):
        if item.get('sourceIds'):continue # Full connected source route is built below, once.
        moved=translate(item,cx,cz,zone_id,level);moved['id']=zone_id+'::'+moved['id']
        moved.update(surface='weathered-stone' if zone_id=='chunzailou-garden' else 'aged-grey-road',edgeStyle='broken-soft',pavingJoints=False)
        D['roads'].append(moved)
    global_boundary=[[rnd(x+cx),rnd(z+cz)] for x,z in district['boundary']]
    D['sharedTerraces'].append(dict(id=zone_id+'-grading',zoneId=zone_id,mode='constant',polygon=global_boundary,
                                    level=rnd(level),blendWidth=45,edgeQuantum=.2,sourceGroundEstimate=metrics,
                                    basis='沿源校区/园区地块整体平整；地坪取同一过滤DSM的地块中值，45m缓和接原宏观地形；非新增测量'))
    facility_metrics.append(dict(id=zone_id,center=[cx,cz],sourceCenter=[rnd(gx),rnd(gz)],groundLevel=rnd(level),
                                 buildingCount=len(district['houses']),componentScale=1,rotationAdded=0,
                                 dimensionsPreserved=True,groundMetrics=metrics))

# Context displacement of source road nodes is shared by all ways at each node.
# It makes room for the complete metric facilities after broader G/C distance
# compression. Exact local source roads remain rigid around the two parcels;
# a 220m source-space collar blends back to the common scalar G/C base.
network_displacements=[]
def network_map(gx,gz):
    base=np.array(map_g(gx,gz),float);best=None
    for ctx in contexts:
        dx,dz=gx-ctx['sourceCenter'][0],gz-ctx['sourceCenter'][1];b=ctx['bounds']
        ex=max(b['minX']-dx,0,dx-b['maxX']);ez=max(b['minZ']-dz,0,dz-b['maxZ']);dist=math.hypot(ex,ez)
        if dist>=ctx['collar']:continue
        t=1-dist/ctx['collar'];weight=t*t*(3-2*t)
        if best is None or weight>best[0]:best=(weight,ctx,dx,dz)
    if best:
        weight,ctx,dx,dz=best;desired=np.array([ctx['center'][0]+dx,ctx['center'][1]+dz])
        p=base*(1-weight)+desired*weight
        if np.linalg.norm(p-base)>.25:network_displacements.append(dict(source=[rnd(gx),rnd(gz)],base=base.tolist(),design=[rnd(p[0]),rnd(p[1])],zoneId=ctx['id'],distance=rnd(np.linalg.norm(p-base))))
        return [rnd(p[0]),rnd(p[1])]
    return base.tolist()

# A continuous real OSM walking route connects the existing village network,
# the school frontage and Qiyuan Road at the garden. No straight substitute.
layer=ds.GetLayerByName('osm_roads');layer.SetSpatialFilterRect(OX-1200,OY-2000,OX+6500,OY+6000)
ways={};graph=defaultdict(list)
allowed={'primary','secondary','tertiary','residential','unclassified','path','footway','service','track'}
for f in layer:
    props=json.loads(f.ExportToJson())['properties'];kind=props.get('highway');g=f.GetGeometryRef()
    if kind not in allowed or g.GetGeometryName()!='LINESTRING':continue
    if props.get('access') in ['no','private'] and kind in ['service','track']:continue
    points=[(rnd(g.GetX(i)-OX),rnd(OY-g.GetY(i))) for i in range(g.GetPointCount())]
    ways[props['id']]=dict(props=props,points=points)
    for a,b in zip(points,points[1:]):
        cost=math.dist(a,b)*{'path':2,'footway':1.6,'service':2.4,'track':1.8}.get(kind,1)
        graph[a].append((b,cost,props['id']));graph[b].append((a,cost,props['id']))


def nearest(target,sids):return min([p for sid,v in ways.items() if sid in sids for p in v['points']],key=lambda p:math.dist(p,target))
def route(a,b):
    heap=[(0,a)];dist={a:0};prev={}
    while heap:
        cost,node=heapq.heappop(heap)
        if cost!=dist[node]:continue
        if node==b:break
        for neighbor,weight,sid in graph[node]:
            nc=cost+weight
            if nc<dist.get(neighbor,math.inf):dist[neighbor]=nc;prev[neighbor]=(node,sid);heapq.heappush(heap,(nc,neighbor))
    if b not in prev:raise RuntimeError(f'OSM route is disconnected: {a}->{b}')
    result=[];node=b
    while node!=a:
        old,sid=prev[node];result.append((old,node,sid));node=old
    return list(reversed(result))


start=nearest((0,0),{'way/1104698620','way/1104698621'})
school_node=nearest(school_g,{'way/343590975','way/343590978'})
garden_node=nearest(garden_g,{'way/1104691356'})
routes=[('luxiang-to-school',route(start,school_node)),('school-to-garden',route(school_node,garden_node))]
route_metrics=[];selected_edges=defaultdict(set)
for name,edges in routes:
    source_points=[edges[0][0]]+[e[1] for e in edges]
    route_metrics.append(dict(id=name,sourceLengthMetres=rnd(sum(math.dist(a,b) for a,b,_ in edges)),
                              sourceIds=list(dict.fromkeys(sid for _,_,sid in edges)),
                              sourcePoints=[list(p) for p in source_points],designPoints=[network_map(*p) for p in source_points],
                              sourceContinuity='连续相邻OSM几何节点；在同一个源道路图中Dijkstra选线',
                              access='walking',terrainRelationship='源山径与村路连续；不宣称全程可通机动车'))
    for a,b,sid in edges:selected_edges[sid].add(tuple(sorted([a,b])))

# Include the school's other real frontage way so the source campus gate has
# a proper road edge in addition to the main chosen through route.
for sid in ['way/343590978']:
    if sid in ways:
        for a,b in zip(ways[sid]['points'],ways[sid]['points'][1:]):selected_edges[sid].add(tuple(sorted([a,b])))

world_poly=rectangle(BOUNDS['minX'],BOUNDS['minZ'],BOUNDS['maxX'],BOUNDS['maxZ'])
lux_poly=rectangle(original['bounds']['minX'],original['bounds']['minZ'],original['bounds']['maxX'],original['bounds']['maxZ'])
new_roads=[]
for sid,selected in selected_edges.items():
    props=ways[sid]['props'];points=ways[sid]['points'];parts=[];current=[]
    for a,b in zip(points,points[1:]):
        if tuple(sorted([a,b])) in selected:
            if not current:current=[a]
            current.append(b)
        elif current:parts.append(current);current=[]
    if current:parts.append(current)
    for pidx,part in enumerate(parts):
        dense=[]
        for a,b in zip(part,part[1:]):
            n=max(1,math.ceil(math.dist(a,b)/18))
            dense.extend([network_map(a[0]+(b[0]-a[0])*i/n,a[1]+(b[1]-a[1])*i/n) for i in range(n)])
        dense.append(network_map(*part[-1]));geom=line(dense).Intersection(world_poly)
        if sid in {s for r in original['roads'] for s in r.get('sourceIds',[])}:geom=geom.Difference(lux_poly)
        for index,segment in enumerate(all_lines(geom)):
            if segment.Length()<.5:continue
            points_out=[[rnd(segment.GetX(i)),rnd(segment.GetY(i))] for i in range(segment.GetPointCount())]
            kind=props['highway'];width={'primary':6.8,'secondary':6.0,'tertiary':5.4,'residential':3.0,'unclassified':3.8,'path':1.4,'footway':1.4,'track':2.0,'service':1.6}[kind]
            r=dict(id=f'unified::{sid}:{pidx}:{index}',points=points_out,width=width,kind=kind,sourceKind=kind,
                   sourceIds=[sid],name=props.get('name') or '',zoneId='shared-network',bridge=props.get('bridge')=='yes',
                   surface='aged-grey-road' if kind in ['primary','secondary','tertiary'] else ('woodland-earth' if kind in ['path','track'] else 'mixed-old-stone'),
                   edgeStyle='soft' if kind in ['path','track','footway'] else 'broken-soft',pavingJoints=False,
                   basis='同一真实OSM连续步行骨架；全局单调G/C基映射，设施邻接段统一节点位移为完整场地让位，逐点记录')
            new_roads.append(r)
D['roads'].extend(new_roads)

# Full lake polygon mask in the same cartographic plane, including island holes.
# A single west-shore function is insufficient east of Luxiang.
lake_layer=ds.GetLayerByName('osm_water_polygons');lake_layer.SetSpatialFilter(None);lake_layer.SetAttributeFilter("id='relation/1126533'")
lake_feature=lake_layer.GetNextFeature();lake=lake_feature.GetGeometryRef().Clone()
gx0,gz0=inverse(BOUNDS['minX'],BOUNDS['minZ']);gx1,gz1=inverse(BOUNDS['maxX'],BOUNDS['maxZ'])
source_clip=rectangle(OX+gx0,OY-gz1,OX+gx1,OY-gz0)
lake=lake.Intersection(source_clip);lake.Segmentize(15)


def map_geometry(g):
    source=json.loads(g.ExportToJson())
    def walk(v):
        if v and isinstance(v[0],(int,float)):
            return map_g(v[0]-OX,OY-v[1])
        return [walk(part) for part in v]
    source['coordinates']=walk(source['coordinates'])
    return ogr.CreateGeometryFromJson(json.dumps(source))


mapped_lake=map_geometry(lake).Intersection(world_poly)
step=2;cols=math.ceil((BOUNDS['maxX']-BOUNDS['minX'])/step);rows=math.ceil((BOUNDS['maxZ']-BOUNDS['minZ'])/step)
mask_ds=gdal.GetDriverByName('MEM').Create('',cols,rows,1,gdal.GDT_Byte)
mask_ds.SetGeoTransform((BOUNDS['minX'],step,0,BOUNDS['minZ'],0,step))
vector_ds=ogr.GetDriverByName('Memory').CreateDataSource('');mask_layer=vector_ds.CreateLayer('lake',geom_type=ogr.wkbUnknown)
feature=ogr.Feature(mask_layer.GetLayerDefn());feature.SetGeometry(mapped_lake);mask_layer.CreateFeature(feature)
gdal.RasterizeLayer(mask_ds,[1],mask_layer,burn_values=[1],options=['ALL_TOUCHED=FALSE'])
mask=mask_ds.ReadAsArray().astype(np.uint8);flat=mask.ravel();rle=[];last=int(flat[0]);count=0
for value in flat:
    value=int(value)
    if value==last:count+=1
    else:rle.extend([count,last]);last=value;count=1
rle.extend([count,last])
D['water']['mask']=dict(encoding='rle-u8',cols=cols,rows=rows,minX=BOUNDS['minX'],minZ=BOUNDS['minZ'],step=step,runs=rle,
                        order='row-major z increasing, x increasing; flat [count,value,...]',values={'0':'land','1':'source Taihu water'},
                        sourceIds=['relation/1126533'],sourceCRS='EPSG:32651',sourceSampling='source lake polygon clipped then segmented15m and mapped by the common monotone G/C anchor transform; centre-of-cell rasterize; not ALL_TOUCHED',
                        facilityPondsExcluded=True,identity='2m显示掩膜；不是新增2m测绘水岸精度')
D['water']['legacyShoreBounds']=copy.deepcopy(original['bounds'])
coastlines=[]
for ring in all_lines(mapped_lake.Boundary()):
    coords=[[rnd(ring.GetX(i)),rnd(ring.GetY(i))] for i in range(ring.GetPointCount())]
    if len(coords)>2:coastlines.append(coords)
D['water']['coastlines']=coastlines


def source_lake_at_c(x,z):
    ix=max(0,min(cols-1,int((x-BOUNDS['minX'])/2)));iz=max(0,min(rows-1,int((z-BOUNDS['minZ'])/2)))
    return bool(mask[iz,ix])


terrain_step=20;tc=math.ceil((BOUNDS['maxX']-BOUNDS['minX'])/terrain_step)+1;tr=math.ceil((BOUNDS['maxZ']-BOUNDS['minZ'])/terrain_step)+1
terrain=[]
for j in range(tr):
    for i in range(tc):
        x,z=BOUNDS['minX']+i*terrain_step,BOUNDS['minZ']+j*terrain_step;gx,gz=inverse(x,z)
        terrain.append(rnd(max(.8,sample_dem(gx,gz))))
D['terrain']=dict(grid=dict(cols=tc,rows=tr,minX=BOUNDS['minX'],minZ=BOUNDS['minZ'],step=terrain_step,values=terrain),
                   units='metres relative to the same source-lake DSM baseline',sourceLakeBaseline=.5,sourcePixelSize=30,
                   macroFilter='3x3 native30m pixel median, Gaussian sigma .65 native pixel; not new survey detail',
                   displaySampling='20m C-domain macro-control grid via inverse common G/C; renderer reconstructs horizontal voxel tops and vertical faces',
                   sourceHeightRange=[rnd(min(terrain)),rnd(max(terrain))])
fs=40;fc=math.ceil((BOUNDS['maxX']-BOUNDS['minX'])/fs)+1;fr=math.ceil((BOUNDS['maxZ']-BOUNDS['minZ'])/fs)+1;forest=[]
for j in range(fr):
    for i in range(fc):
        x,z=BOUNDS['minX']+i*fs,BOUNDS['minZ']+j*fs;gx,gz=inverse(x,z)
        ix=int((OX+gx-wc_gt[0])/wc_gt[1]);iz=int((OY-gz-wc_gt[3])/wc_gt[5]);forest.append(int(wc_array[iz,ix]))
D['designForestMask']=dict(cols=fc,rows=fr,minX=BOUNDS['minX'],minZ=BOUNDS['minZ'],step=fs,values=forest,sourcePixelSize=10,
                            source='ESA WorldCover 2021 v200 native10m classes, inverse common G/C lookup',
                            identity='40m显示域布林参考，非实测树位/树种；开敞地不自动生成稠密房屋',license='CC BY 4.0')
D['geographic']['designTransform']=dict(sourceX=GX.tolist(),designX=CX.tolist(),sourceZ=GZ.tolist(),designZ=CZ.tolist(),
                                       kind='strictly monotone separable piecewise-linear anchor warp; original Luxiang control knots preserved',
                                       componentPolicy='Every complete facility and house keeps metric component dimensions, no nonuniform asset scale',
                                       roadContextPolicy='Source road nodes near two unscaled facility parcels use one shared 2D displacement collar, recorded in QA; macro DEM/lake use common base inverse map')
D['geographic']['designEnvelope']=BOUNDS
D['geographic']['sourceEnvelopeLocal']=[gx0,gz0,gx1,gz1]
D['networkRoutes']=route_metrics
D['provenance']['coordinatePolicy']='一个持续加载的连续世界。陆巷原C坐标保留；两设施按真实G方位进入同一C域，局部完整形制仅刚性平移。各区只做相机导航。'
D['provenance']['unifiedMapScope']='覆盖陆巷—莫厘山势—东山中学—春在楼的连续学习图幅；不是完整镇域/行政边界；源山径连接按真实OSM网络选线。'
D['provenance']['sourceFiles']=list(dict.fromkeys(D['provenance']['sourceFiles']+[str(SOURCE.relative_to(ROOT)).replace('\\','/')]))
for zone in D['zones']:
    if zone['id']!='luxiang':zone['provenance']=copy.deepcopy(next(d['provenance'] for d in districts if d['id']==zone['id']))
    if 'provenance' in zone:zone['provenance']['coordinatePolicy']=D['provenance']['coordinatePolicy']

# Locate the source peak separately from the coarse macro maximum.
wgs=osr.SpatialReference();wgs.ImportFromEPSG(4326);wgs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
utm=osr.SpatialReference();utm.ImportFromEPSG(32651);utm.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
project=osr.CoordinateTransformation(wgs,utm);px,py,_=project.TransformPoint(120.3894991,31.1003028);peak=map_g(px-OX,OY-py)
D['anchors'].append(dict(id='moli-peak',label='莫厘峰',x=peak[0],z=peak[1],sourceId='node/13800809445',wgs84=[120.3894991,31.1003028]))

# Independent evidence checks. Unresolved geometric problems are exposed.
building_crossings=[]
for r in new_roads:
    rg=line(r['points']).Buffer(r['width']/2+.4)
    for h in D['houses']:
        if rg.Intersects(house_rect(h,.1)):building_crossings.append(dict(roadId=r['id'],sourceIds=r['sourceIds'],houseId=h['id']))
road_buffers=ogr.Geometry(ogr.wkbMultiPolygon)
for r in D['roads']:road_buffers.AddGeometry(line(r['points']).Buffer(r['width']/2+.2))
merged_roads=road_buffers.UnionCascaded()
road_components=[merged_roads] if merged_roads.GetGeometryName()=='POLYGON' else [merged_roads.GetGeometryRef(i) for i in range(merged_roads.GetGeometryCount())]
connection_points=[route_metrics[0]['designPoints'][0],route_metrics[0]['designPoints'][-1],route_metrics[1]['designPoints'][-1]]
road_connected=any(all(component.Contains(pt(*p)) for p in connection_points) for component in road_components)
assert road_connected, 'Rendered street buffers do not connect the village, school frontage and garden frontage'
ids=[h['id'] for h in D['houses']]
dimension_failures=[]
relative_height_failures=[]
for district in districts:
    for h in district['houses']:
        new=next(v for v in D['houses'] if v['id']==h['id'])
        if any(new.get(key)!=h.get(key) for key in ['width','depth','rotation','floors','type']):dimension_failures.append(h['id'])
    for key in ['walls','rocks']:
        for old in district.get(key,[]):
            new=next(v for v in D[key] if v['id']==district['id']+'::'+old['id'])
            if new.get('height')!=old.get('height'):relative_height_failures.append(new['id'])
for transfer in elevation_transfers:
    assert abs(transfer['globalValue']-(transfer['sourceLocalValue']+transfer['globalGround']-1.2))<.011
assert not relative_height_failures
lux_moves=[h['id'] for h in original['houses'] if any(next(v for v in D['houses'] if v['id']==h['id'])[key]!=h[key] for key in ['x','z','width','depth','rotation'])]
school_bounds=D['zones'][1]['bounds'];garden_bounds=D['zones'][2]['bounds']
overlap=rectangle(school_bounds['minX'],school_bounds['minZ'],school_bounds['maxX'],school_bounds['maxZ']).Intersects(rectangle(garden_bounds['minX'],garden_bounds['minZ'],garden_bounds['maxX'],garden_bounds['maxZ']))
assert not dimension_failures and not lux_moves and not overlap and len(ids)==len(set(ids))
assert sum(rle[::2])==cols*rows
assert BOUNDS['minX']<peak[0]<BOUNDS['maxX'] and BOUNDS['minZ']<peak[1]<BOUNDS['maxZ']
for path in source_paths:assert sha(path)==source_hashes[str(path.relative_to(ROOT))]
qa=dict(version=VERSION,onePersistentWorld=True,zoneNavigationOnly=True,sourceFilesUnchanged=True,inputsSha256=source_hashes,
        bounds=BOUNDS,zones=D['zones'],houseCount=len(D['houses']),houseTypes={k:sum(h['type']==k for h in D['houses']) for k in sorted({h['type'] for h in D['houses']})},
        originalLuxiangMovedAssets=lux_moves,facilityDimensionsChanged=dimension_failures,facilityMetrics=facility_metrics,
        absoluteElevationTransfers=elevation_transfers,relativeWallRockHeightsChanged=relative_height_failures,
        facilityElevationAudit='pond/pond-ground level and gardenBridge absolute deck height translated by globalGround-1.2m; walls/rocks/architecture heights remain relative sizes; zone 3D camera targets translated by the same vertical offset; old standalone facility terrain grids are not included',
        schoolGardenBoundsOverlap=overlap,duplicateHouseIds=len(ids)-len(set(ids)),
        routeMetrics=[{k:v for k,v in r.items() if k not in ['sourcePoints','designPoints']} for r in route_metrics],
        newSourceRoadSegments=len(new_roads),newSourceRoadBuildingCrossings=building_crossings,
        renderedRoadNetworkConnected=road_connected,renderedRoadContinuityCheck=dict(method='Union of rendered width buffers + .2m edge tolerance; one component contains all three frontage anchors',anchors=connection_points),
        roadContextDisplacements=dict(count=len(network_displacements),maximumMetres=max((p['distance'] for p in network_displacements),default=0),points=network_displacements),
        waterMask=dict(cols=cols,rows=rows,step=2,pixels=cols*rows,waterPixels=int(mask.sum()),runs=len(rle)//2,rleDecodePixelCount=sum(rle[::2])),
        terrainGrid=dict(cols=tc,rows=tr,step=terrain_step,heightRange=D['terrain']['sourceHeightRange'],sourcePixelSize=30),
        worldCover=dict(cols=fc,rows=fr,step=fs,sourcePixelSize=10),
        sourcePeak=dict(id='node/13800809445',design=peak,insideWorld=True),
        checksPassed=not building_crossings and road_connected)
D['checks']['unifiedMap']=dict(houseCount=len(D['houses']),zoneCount=len(D['zones']),onePersistentWorld=True,
                              originalLuxiangMovedAssets=0,facilityDimensionsChanged=0,sourceRoadBuildingCrossings=len(building_crossings))
(DATA/'unified-map.json').write_text(compact(D),encoding='utf-8')
(DATA/'unified-map-qa.json').write_text(json.dumps(qa,ensure_ascii=False,indent=2),encoding='utf-8')
(OUT/'js/unified-map.js').write_text('/* Generated by scripts/build_unified_map.py; one persistent cartographic world. */\nwindow.DSUnifiedMap = '+compact(D)+';\n',encoding='utf-8')
import matplotlib
matplotlib.use('Agg')
from matplotlib import pyplot as plt
from matplotlib.colors import ListedColormap
from matplotlib.patches import Polygon
plt.rcParams['font.sans-serif']=['Microsoft YaHei','DejaVu Sans']
fig,ax=plt.subplots(figsize=(16,14),dpi=130)
ax.imshow(mask,origin='lower',extent=[BOUNDS['minX'],BOUNDS['maxX'],BOUNDS['minZ'],BOUNDS['maxZ']],cmap=ListedColormap(['#d9e1c9','#8cb8bb']),interpolation='nearest')
for r in D['roads']:
    a=np.array(r['points']);major=r.get('sourceKind') in ['primary','secondary','tertiary'];ax.plot(a[:,0],a[:,1],color='#78796b' if major else '#a09575',linewidth=1.7 if major else .8,zorder=3)
for h in D['houses']:
    ring=house_rect(h).GetGeometryRef(0)
    # Keep the owning polygon alive while reading its borrowed ring.
    owner=house_rect(h);ring=owner.GetGeometryRef(0)
    a=[[ring.GetX(i),ring.GetY(i)] for i in range(ring.GetPointCount())]
    ax.add_patch(Polygon(a,facecolor='#ad805b' if h['zoneId']=='chunzailou-garden' else '#50676a' if h['zoneId']=='dongshan-school' else '#778478',edgecolor='#3f5149',linewidth=.4,zorder=4))
for terrace in D['sharedTerraces']:
    if terrace['mode']=='constant':ax.add_patch(Polygon(terrace['polygon'],fill=False,edgecolor='#9c6441',linewidth=1.2,zorder=5))
for zone in D['zones']:
    ax.text(zone['center'][0],zone['bounds']['minZ']-20,zone['name'],fontsize=13,color='#293f3c',ha='center',zorder=6)
ax.scatter(*peak,marker='^',s=70,c='#766a46',zorder=6);ax.text(peak[0]+12,peak[1]-5,'莫厘峰',fontsize=12,color='#554e37')
ax.set_xlim(BOUNDS['minX'],BOUNDS['maxX']);ax.set_ylim(BOUNDS['maxZ'],BOUNDS['minZ']);ax.set_aspect('equal')
ax.set_title('一张连续地图 · 真实路网骨架与完整设施\n源中心线共网；建筑构件不缩放；山径通行不等于机动车道路',fontsize=17,pad=18)
ax.set_xlabel('C · east metres');ax.set_ylabel('C · south metres')
fig.tight_layout();(OUT/'qa').mkdir(exist_ok=True);fig.savefig(OUT/'qa/unified-design-plan.png');plt.close(fig)
print(json.dumps({k:qa[k] for k in ['houseCount','newSourceRoadSegments','newSourceRoadBuildingCrossings','facilityMetrics','sourcePeak','checksPassed']},ensure_ascii=False))
