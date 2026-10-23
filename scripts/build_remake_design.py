"""Build the local Luxiang design from audited local sources; source files are read-only.

Run with ArcGIS Pro's Python (GDAL + NumPy + SciPy). No ArcPy, web request or key.
G = UTM51N geographic metres, C = monotone cartographic anchor coordinates,
R = x east, z south in the renderer. Building components keep their metric size.
"""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

import numpy as np
from osgeo import gdal, ogr, osr
from scipy.ndimage import median_filter, gaussian_filter

ogr.UseExceptions()
gdal.UseExceptions()
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '东山镇_重制版'
DATA = OUT / 'data'
JS = OUT / 'js'
DATA.mkdir(parents=True, exist_ok=True)
JS.mkdir(parents=True, exist_ok=True)
SOURCE = ROOT / '东山镇_数据/working/dongshan_sources_utm51n.gpkg'
DSM = ROOT / '东山镇_数据/terrain/derived/dongshan_envelope_glo30_2021_utm51n_30m.tif'
WORLDCOVER = ROOT / '东山镇_数据/landcover/derived/dongshan_envelope_worldcover_2021_v200_utm51n_10m.tif'
WGS_ORIGIN = [120.3564852, 31.0762724]
wgs = osr.SpatialReference(); wgs.ImportFromEPSG(4326)
utm = osr.SpatialReference(); utm.ImportFromEPSG(32651)
wgs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
utm.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
forward = osr.CoordinateTransformation(wgs, utm)
inverse = osr.CoordinateTransformation(utm, wgs)
OX, OY, _ = forward.TransformPoint(*WGS_ORIGIN)

# Terrain/road/water anchors share one strictly monotone transform. Widths and
# architectural details are subsequently regenerated in metres, never scaled.
GX = np.array([-450, -320, -240, -160, -80, 0, 100, 200, 350, 500, 700], float)
CX = np.array([-240, -160, -100, -40, 12, 60, 120, 172, 240, 300, 390], float)
GZ = np.array([-450, -300, -180, -80, 0, 100, 220, 350, 450], float)
CZ = np.array([-270, -198, -130, -64, 0, 68, 145, 220, 270], float)
BOUNDS = dict(minX=-210, maxX=390, minZ=-270, maxZ=270)


def rnd(v, n=2): return round(float(v), n)


def map_local(x, z):
    return [rnd(np.interp(x, GX, CX)), rnd(np.interp(z, GZ, CZ))]


def map_xy(x, y): return map_local(x-OX, OY-y)


def point(x, z):
    p=ogr.Geometry(ogr.wkbPoint); p.AddPoint_2D(x,z); return p


def line(points):
    p=ogr.Geometry(ogr.wkbLineString)
    for x,z in points: p.AddPoint_2D(x,z)
    return p


def polygon(points):
    r=ogr.Geometry(ogr.wkbLinearRing)
    for x,z in points + [points[0]]: r.AddPoint_2D(x,z)
    p=ogr.Geometry(ogr.wkbPolygon);p.AddGeometry(r);return p


def rect(x,z,w,d,a=0):
    c,s=math.cos(a),math.sin(a)
    return polygon([[x+c*u+s*v,z-s*u+c*v] for u,v in [(-w/2,-d/2),(w/2,-d/2),(w/2,d/2),(-w/2,d/2)]])


def all_lines(g):
    name=g.GetGeometryName()
    if name in ['LINESTRING','LINEARRING']: yield g
    else:
        for i in range(g.GetGeometryCount()): yield from all_lines(g.GetGeometryRef(i))


def length(points): return sum(math.dist(a,b) for a,b in zip(points,points[1:]))


def source_features(ds, name, x0=-420,z0=-450,x1=700,z1=450):
    l=ds.GetLayerByName(name)
    l.SetSpatialFilterRect(OX+x0, OY-z1, OX+x1, OY-z0)
    result=[]
    for f in l:
        j=json.loads(f.ExportToJson())
        result.append((j['properties'],f.GetGeometryRef().Clone()))
    return result


ds=ogr.Open(str(SOURCE))
clip=rect(OX+140, OY, 1120,900)
roads=[]; road_sources=[]
for props,g in source_features(ds,'osm_roads'):
    if props.get('highway') not in ['primary','residential','service','unclassified','path','footway']: continue
    clipped=g.Intersection(clip)
    for n,part in enumerate(all_lines(clipped)):
        simp=part.Simplify(2.0)
        pts=[map_xy(*simp.GetPoint(i)[:2]) for i in range(simp.GetPointCount())]
        pts=[p for i,p in enumerate(pts) if i==0 or p!=pts[i-1]]
        if len(pts)<2 or length(pts)<6: continue
        kind=props.get('highway'); width={'primary':8.4,'residential':4.2,'service':3.6,'unclassified':4.8,'path':2.0,'footway':2.0}[kind]
        if props.get('bridge')=='yes': kind='bridge-road'
        sid=props['id']
        roads.append(dict(id=f'{sid}:{n}',points=pts,width=width,kind=kind,sourceIds=[sid],sourceKind=props.get('highway'),name=props.get('name') or '', bridge=props.get('bridge')=='yes'))
        road_sources.append(dict(id=sid, sourceLength=rnd(part.Length()),designLength=rnd(length(pts))))

canals=[]
for props,g in source_features(ds,'osm_waterways'):
    for part in all_lines(g.Intersection(clip)):
        simp=part.Simplify(1.5)
        pts=[map_xy(*simp.GetPoint(i)[:2]) for i in range(simp.GetPointCount())]
        if len(pts)<2:continue
        canals.append(dict(id=props['id'],points=pts,width=4.6,kind='canal',sourceIds=[props['id']],label='通湖水道',nameStatus='源数据未具名；未认定为寒山港'))

# Lake horizontal cuts preserve the dominant shore bends and canal mouths. The
# easternmost water edge at a cut is used; an isolated thin breakwater is omitted.
lake_layer=ds.GetLayerByName('osm_water_polygons')
lake_layer.SetSpatialFilter(None)
lake_layer.SetAttributeFilter("id='relation/1126533'")
lf=lake_layer.GetNextFeature(); lake=lf.GetGeometryRef().Clone()
shore=[]; shore_source=[]
for gz in range(-450,451,10):
    cut=line([[OX-900,OY-gz],[OX+700,OY-gz]])
    inter=lake.Intersection(cut)
    ends=[seg.GetPoint(seg.GetPointCount()-1)[0] for seg in all_lines(inter) if seg.GetPointCount()>1]
    if not ends:continue
    gx=max(ends)-OX
    shore.append(map_local(gx,gz)); shore_source.append([rnd(gx),gz])
land=polygon(shore+[[500,350],[500,-350]])

# Keep roads and canals as physical barriers for selection and displacement.
barrier_geoms=[line(r['points']).Buffer(r['width']/2+1.4) for r in roads]
barrier_geoms += [line(c['points']).Buffer(c['width']/2+2.2) for c in canals]
barriers=barrier_geoms[0]
for p in barrier_geoms[1:]:barriers=barriers.Union(p)
blocks_geom=land.Difference(barriers)
blocks=[blocks_geom.GetGeometryRef(i).Clone() for i in range(blocks_geom.GetGeometryCount())] if blocks_geom.GetGeometryName()=='MULTIPOLYGON' else [blocks_geom]
blocks.sort(key=lambda g:-g.Area())


def block_id(x,z):
    p=point(x,z)
    for i,b in enumerate(blocks):
        if b.Contains(p):return f'block-{i+1:02d}'
    return None


def source_obb(g):
    hull=g.ConvexHull(); ring=hull.GetGeometryRef(0)
    a=np.array([ring.GetPoint(i)[:2] for i in range(ring.GetPointCount()-1)])
    best=None
    for p,q in zip(a,np.roll(a,-1,axis=0)):
        angle=math.atan2(q[1]-p[1],q[0]-p[0])
        c,s=math.cos(angle),math.sin(angle)
        uv=a@np.array([[c,-s],[s,c]])
        wh=uv.max(axis=0)-uv.min(axis=0)
        if best is None or wh.prod()<best[0]:best=(wh.prod(),wh,angle)
    _,wh,angle=best
    if wh[0]<wh[1]:wh=wh[::-1];angle+=math.pi/2
    # Three.js positive y rotation maps local x to negative z; G north maps -z.
    return wh,angle%math.pi


source_buildings=[]
for props,g in source_features(ds,'overture_buildings',-310,-330,470,330):
    c=g.Centroid();gx,gz=c.GetX()-OX,OY-c.GetY()
    if not (-310<gx<470 and -330<gz<330) or not(35<g.Area()<2200):continue
    x,z=map_local(gx,gz)
    if not(-95<x<270 and -205<z<207):continue
    wh,a=source_obb(g)
    source_buildings.append(dict(id=props['id'],gx=rnd(gx),gz=rnd(gz),x=x,z=z,area=rnd(g.Area()),width=rnd(wh[0]),depth=rnd(wh[1]),rotation=rnd(a,5),block=block_id(x,z)))

source_buildings.sort(key=lambda v:(v['gz'],v['gx']))
houses=[]; occupied=[]


def try_place(s,kind='house',role=None,parent_id=None):
    seed=int(hashlib.sha256(s['id'].encode()).hexdigest()[:8],16)
    if kind=='courtyard':w,d=28.0,24.0
    else:
        w=round(min(11.6 if role else 15.6,max(6.8 if role else 8.6,s['width']))/0.2)*0.2
        d=round(min(8.8 if role else 12.2,max(6.2 if role else 7.4,s['depth']))/0.2)*0.2
        w=rnd(w,1);d=rnd(d,1)
    a=s['rotation']
    # A small placement repair stays inside the very same road/water block.
    offsets=[(0,0),(-2,0),(2,0),(0,-2),(0,2),(-3,-3),(3,3),(-3,3),(3,-3)]
    for dx,dz in offsets:
        x,z=rnd(s['x']+dx,1),rnd(s['z']+dz,1)
        if block_id(x,z)!=s['block'] or not s['block']:continue
        g=rect(x,z,w+2.4,d+2.4,a)
        if not land.Contains(g) or barriers.Intersects(g):continue
        if any(g.Intersects(o) for o in occupied):continue
        if kind!='courtyard' and min((g.Distance(line(r['points'])) for r in roads if r['sourceKind']!='path'), default=999)>55:continue
        floors=1 if role or seed%7==0 else 2
        if kind=='modern':floors=2
        item=dict(id=f'LX-{len(houses)+1:03d}',type=kind,x=x,z=z,rotation=a,width=w,depth=d,floors=floors,seed=seed,sourceIds=[s['id']],sourceAnchor=[s['gx'],s['gz']],mappedAnchor=[s['x'],s['z']],displacement=[dx,dz],block=s['block'],label='院落组' if kind=='courtyard' else ('现代民居' if kind=='modern' else ('临街单层小屋' if role=='shop' else ('院旁附屋' if role else '沿街民居'))),identity='当地类型概括；非该栋实测立面')
        if role:item.update(role=role,compoundId=parent_id)
        houses.append(item);occupied.append(g)
        return True
    return False


# Courtyards are full architectural groups. They are first placed only where a
# 28 x 24 m parcel fits between mandatory road and water edges.
courtyard_candidates=sorted(source_buildings,key=lambda s:abs(s['x']-120)+abs(s['z']-15)*0.35)
for s in courtyard_candidates:
    if sum(h['type']=='courtyard' for h in houses)>=4:break
    if abs(s['z'])<135 and 10<s['x']<210:try_place(s,'courtyard')

# Stratified source-order selection retains each street side. No grid-cell
# assignment, largest-roof proxy or coalesced giant house is involved.
def rank(s):
    road_d=min((point(s['x'],s['z']).Distance(line(r['points'])) for r in roads if r['sourceKind']!='path'),default=60)
    q=int((s['z']+210)//70)
    return (int(road_d//12),len([h for h in houses if int((h['z']+210)//70)==q]),abs(s['x']-100)*0.45+abs(s['z'])*0.25)

remaining=[s for s in source_buildings if all(s['id'] not in h['sourceIds'] for h in houses)]
while remaining and len(houses)<66:
    remaining.sort(key=rank)
    s=remaining.pop(0)
    kind='modern' if int(hashlib.sha256(s['id'].encode()).hexdigest()[:4],16)%13==0 else 'house'
    try_place(s,kind)

# The first selection establishes the street-side anchors. Expand redundant
# real footprint groups into multiple complete buildings, instead of leaving
# one lone house per source group in grass. Parent anchors remain stable.
base_houses=list(houses)
used={sid for h in houses for sid in h['sourceIds']}
extra_sources=[s for s in source_buildings if s['id'] not in used]


def parent_for(s):
    choices=[]
    for h in base_houses:
        if h['type']=='courtyard' or h['block']!=s['block']:continue
        if len([v for v in houses if v.get('compoundId')==h['id']])>=3:continue
        dist=math.dist([s['x'],s['z']],[h['x'],h['z']])
        if not (9<dist<38):continue
        connection=line([[s['x'],s['z']],[h['x'],h['z']]])
        if any(connection.Crosses(line(r['points'])) for r in roads):continue
        if any(connection.Crosses(line(c['points'])) for c in canals):continue
        choices.append((dist,h))
    return min(choices,key=lambda v:v[0]) if choices else None


for s in sorted(extra_sources,key=lambda s:abs(s['x']-95)*.35+abs(s['z']-30)*.25):
    if len(houses)>=118:break
    parent=parent_for(s)
    if not parent:continue
    _,h=parent
    near_road=min((point(s['x'],s['z']).Distance(line(r['points'])) for r in roads if r['sourceKind'] in ['residential','service','unclassified']),default=99)
    role='shop' if near_road<14 else 'annex'
    try_place(s,'house',role,h['id'])

# Attach redundant source footprints to the nearest retained complete-house
# group in the same mandatory block. This is a provenance group, not a claim
# that the selected roof is an exact footprint or that all sources are rendered.
groups={h['id']:dict(id=h['id'],block=h['block'],renderObjectIds=[h['id']],sourceIds=[],sourceArea=0.0) for h in houses}
omitted=[]
for s in source_buildings:
    same=[h for h in houses if h['block']==s['block']]
    # Even an open-ended road can separate two street sides without splitting
    # the complete AOI polygon. Reject a direct cross-road/cross-canal grouping.
    same=[h for h in same if not any(line([[s['x'],s['z']],[h['x'],h['z']]]).Crosses(line(r['points'])) for r in roads)
          and not any(line([[s['x'],s['z']],[h['x'],h['z']]]).Crosses(line(c['points'])) for c in canals)]
    if not same:omitted.append(s['id']);continue
    h=min(same,key=lambda h:math.dist([s['x'],s['z']],[h['x'],h['z']]))
    gr=groups[h['id']];gr['sourceIds'].append(s['id']);gr['sourceArea']+=s['area']
for h in houses:h['sourceIds']=groups[h['id']]['sourceIds']
for gr in groups.values():gr['sourceArea']=rnd(gr['sourceArea'])

# Bridge records follow surveyed road bridge segments where they exist, and
# any road-water intersection. A low plate bridge is a type choice, not a
# reconstruction of an undocumented historic arch.
bridges=[]
for r in roads:
    if r.get('bridge'):
        p0,p1=r['points'][0],r['points'][-1]
        bridges.append(dict(id='bridge-'+r['id'],x=rnd((p0[0]+p1[0])/2),z=rnd((p0[1]+p1[1])/2),rotation=rnd(math.atan2(-(p1[1]-p0[1]),p1[0]-p0[0]),5),length=rnd(length(r['points'])+2.0),width=r['width'],sourceIds=r['sourceIds'],type='low-slab',basis='OSM bridge=yes segment'))
for c in canals:
    cg=line(c['points'])
    for r in roads:
        inter=cg.Intersection(line(r['points']))
        if inter.IsEmpty():continue
        pts=[inter] if inter.GetGeometryName()=='POINT' else [inter.GetGeometryRef(i) for i in range(inter.GetGeometryCount()) if inter.GetGeometryRef(i).GetGeometryName()=='POINT']
        for p in pts:
            x,z=p.GetX(),p.GetY()
            if any(math.dist([x,z],[b['x'],b['z']])<15 for b in bridges):continue
            near=min(zip(r['points'],r['points'][1:]),key=lambda ab:point(x,z).Distance(line(list(ab))))
            a,b=near
            bridges.append(dict(id=f"junction-{c['id']}-{r['id']}",x=rnd(x),z=rnd(z),rotation=rnd(math.atan2(-(b[1]-a[1]),b[0]-a[0]),5),length=c['width']+5,width=r['width'],sourceIds=c['sourceIds']+r['sourceIds'],type='low-slab',basis='Source road/canal crossing; bridge form typological'))

# Connected internal alleys use negative space between retained full houses.
# They are explicit design additions, not falsely labelled OSM surveyed lanes.
added_lanes=[]
for h in houses:
    hp=point(h['x'],h['z'])
    best=None
    for r in roads:
        if r['sourceKind']=='path':continue
        for a,b in zip(r['points'],r['points'][1:]):
            av,bv=np.array(a),np.array(b);v=bv-av
            t=float(np.clip(np.dot(np.array([h['x'],h['z']])-av,v)/max(np.dot(v,v),1e-6),0,1))
            q=av+t*v;dist=math.dist([h['x'],h['z']],q)
            if best is None or dist<best[0]:best=(dist,q)
    if best is None or best[0]>36:continue
    q=best[1];v=q-np.array([h['x'],h['z']]);norm=np.linalg.norm(v)
    if norm<1:continue
    # Stop at parcel edge. Existing building plots are not cut by the lane.
    start=np.array([h['x'],h['z']])+v/norm*(max(h['width'],h['depth'])/2+1.5)
    if math.dist(start,q)<2:continue
    g=line([start.tolist(),q.tolist()]).Buffer(0.8)
    if not land.Contains(g) or any(g.Intersects(line(c['points']).Buffer(c['width']/2+1)) for c in canals):continue
    if any(g.Intersects(o) for i,o in enumerate(occupied) if houses[i]['id']!=h['id']):continue
    added_lanes.append(dict(id='lane-'+h['id'],points=[[rnd(v) for v in start],[rnd(v) for v in q]],width=1.6,kind='lane',sourceIds=[],basis='综合后完整地块至源路网的设计步巷'))
roads.extend(added_lanes)

# Shared compounds make courtyard negative space and continuous street walls
# legible. They enclose two to four full source-anchored houses, with an explicit
# gate break toward the nearest street. No wall spans a mandatory water/road.
compounds=[]; courtyard_walls=[]
wall_barriers=[line(r['points']).Buffer(r['width']/2+.4) for r in roads if r['sourceIds']]
wall_barriers += [line(c['points']).Buffer(c['width']/2+1.0) for c in canals]
for base in base_houses:
    if base['type']=='courtyard':continue
    members=[base]+[h for h in houses if h.get('compoundId')==base['id']]
    if len(members)<2:continue
    c,s=math.cos(base['rotation']),math.sin(base['rotation'])
    local=[]
    for h in members:
        poly=rect(h['x'],h['z'],h['width'],h['depth'],h['rotation'])
        ring=poly.GetGeometryRef(0)
        for k in range(ring.GetPointCount()-1):
            x,z=ring.GetPoint(k)[:2];dx,dz=x-base['x'],z-base['z']
            local.append([c*dx-s*dz,s*dx+c*dz])
    a=np.array(local);lo=a.min(axis=0)-1.0;hi=a.max(axis=0)+1.0
    pts=[[base['x']+c*u+s*v,base['z']-s*u+c*v] for u,v in [(lo[0],lo[1]),(hi[0],lo[1]),(hi[0],hi[1]),(lo[0],hi[1])]]
    parcel=polygon(pts)
    ids={h['id'] for h in members}
    if not land.Contains(parcel) or any(parcel.Intersects(b) for b in wall_barriers):continue
    if any(parcel.Intersects(o) for h,o in zip(houses,occupied) if h['id'] not in ids):continue
    edge=min(range(4),key=lambda k:min(line([pts[k],pts[(k+1)%4]]).Distance(line(r['points'])) for r in roads))
    gate_width=3.2
    segments=[]
    for k in range(4):
        p,q=np.array(pts[k]),np.array(pts[(k+1)%4])
        if k==edge:
            v=q-p;n=np.linalg.norm(v);mid=(p+q)/2;off=v/max(n,1e-6)*gate_width/2
            segments.extend([[p.tolist(),(mid-off).tolist()],[(mid+off).tolist(),q.tolist()]])
        else:segments.append([p.tolist(),q.tolist()])
    cid='compound-'+base['id']
    compounds.append(dict(id=cid,houseIds=[h['id'] for h in members],polygon=[[rnd(x),rnd(z)] for x,z in pts],gateEdge=edge,gateWidth=gate_width,block=base['block'],basis='同街坊源锚点的完整多屋院落；边界/院门为综合设计'))
    for k,seg in enumerate(segments):
        wall_line=line(seg)
        for r in roads:
            if wall_line.Intersects(line(r['points']).Buffer(r['width']/2+.65)):
                wall_line=wall_line.Difference(line(r['points']).Buffer(r['width']/2+.65))
        for n,part in enumerate(all_lines(wall_line)):
            if part.Length()<1.0:continue
            wall_pts=[[rnd(v) for v in part.GetPoint(i)[:2]] for i in range(part.GetPointCount())]
            courtyard_walls.append(dict(id=f'{cid}-wall-{k}-{n}',points=wall_pts,height=2.0,thickness=.4,compoundId=cid,material='plaster-stone-base'))

# One connected design plain replaces building/tree DSM bumps inside the
# village. It is a separately recorded artistic grading mask; source grid stays.
all_corners=ogr.Geometry(ogr.wkbMultiPoint)
for h in houses:
    # Keep the owner alive for the OGR borrowed ring lifetime.
    rp=rect(h['x'],h['z'],h['width']+2,h['depth']+2,h['rotation']);rr=rp.GetGeometryRef(0)
    for k in range(rr.GetPointCount()-1):all_corners.AddGeometry(point(*rr.GetPoint(k)[:2]))
core=all_corners.ConvexHull().Buffer(17).Simplify(3)
core_ring=core.GetGeometryRef(0)
core_points=[[rnd(v) for v in core_ring.GetPoint(i)[:2]] for i in range(core_ring.GetPointCount()-1)]
design_terraces=dict(
    version=2,
    core=dict(polygon=core_points,shoreHeight=1.25,inlandSlope=.0065,minHeight=1.2,maxHeight=3.8,quantum=.2,blendWidth=22),
    canalBanks=dict(halfWidth=12.0,blendWidth=8.0,shoreHeight=1.1,inlandSlope=.0035,maxHeight=2.1,quantum=.2),
    heightFormula='coreHeight = quantize(clamp(1.25 + .0065 * max(0, x-shoreX(z)-12), 1.2, 3.8), .2); smooth blend to original macro grid within 22 m outside core polygon. Canal banks cap this height at quantize(min(2.1,1.1+.0035*max(0,x-shoreX(z))),.2) within 12 m of canal centreline, blend to unmodified height over next 8 m. Water centre slots remain y=0 and lake shore landing remains .8–1.2m.',
    identity='综合设计的连片村落整地；非新增测绘数据。原始宏观terrain.grid完整保留。')

# Fine trees, fewer in number. Distribution is compositional, supported by
# source woodland on the east; no exact species map is inferred.
trees=[]
state=20261020
def random():
    global state
    state=(1664525*state+1013904223)&0xffffffff
    return state/4294967296

for zone,target,box in [('village',58,(-105,260,-205,205)),('slope',92,(200,382,-260,260))]:
    for attempt in range(12000):
        if len([t for t in trees if t['zone']==zone])>=target:break
        x=rnd(box[0]+random()*(box[1]-box[0]),1);z=rnd(box[2]+random()*(box[3]-box[2]),1)
        p=point(x,z)
        if not land.Contains(p) or any(p.Distance(o)<6.4 for o in occupied):continue
        if any(p.Distance(line(r['points']))<r['width']/2+3.3 for r in roads):continue
        if any(p.Distance(line(c['points']))<c['width']/2+4.2 for c in canals):continue
        if any(math.dist([x,z],[t['x'],t['z']])<(8.0 if zone=='village' else 11.5) for t in trees):continue
        shore_x=float(np.interp(z,[p[1] for p in shore],[p[0] for p in shore]))
        water_dist=x-shore_x
        typ='willow' if 5<water_dist<22 and random()<.65 else ('garden' if zone=='village' and random()<.25 else 'broadleaf')
        trees.append(dict(id=f'T-{len(trees)+1:03d}',x=x,z=z,type=typ,seed=int(random()*2**31),scale=rnd(.75+random()*.38),zone=zone,basis='类型化景观配置；东侧林地参考OSM woodland，非实测树位'))

# Reconstruct the DSM macro relief. Subtract the local source lake median 0.5 m,
# then use 3x3 source-pixel median and a mild smooth filter to suppress roof/tree
# spikes. No new measured precision is claimed for the display sampling.
raster=gdal.Open(str(DSM)); gt=raster.GetGeoTransform(); arr=raster.ReadAsArray().astype(float)
filtered=gaussian_filter(median_filter(arr,size=3),.65)
baseline=.5


def terrain_height(x,z):
    gx=float(np.interp(x,CX,GX));gz=float(np.interp(z,CZ,GZ))
    px=(OX+gx-gt[0])/gt[1]-.5;py=(OY-gz-gt[3])/gt[5]-.5
    ix,iy=math.floor(px),math.floor(py);tx,ty=px-ix,py-iy
    val=(filtered[iy,ix]*(1-tx)*(1-ty)+filtered[iy,ix+1]*tx*(1-ty)+filtered[iy+1,ix]*(1-tx)*ty+filtered[iy+1,ix+1]*tx*ty)-baseline
    shore_x=float(np.interp(z,[p[1] for p in shore],[p[0] for p in shore]))
    d=x-shore_x
    if d<=0:return -1.4
    # A bank profile is shared with the source-derived shore instead of allowing
    # DSM building pixels at the waterfront to form an arbitrary cliff.
    val=max(.8,val)
    if d<20:val=.8+(val-.8)*(d/20)
    return rnd(val)


step=15;cols=41;rows=37
values=[terrain_height(BOUNDS['minX']+i*step,BOUNDS['minZ']+j*step) for j in range(rows) for i in range(cols)]
wc_ds=gdal.Open(str(WORLDCOVER));wc_gt=wc_ds.GetGeoTransform();wc_arr=wc_ds.ReadAsArray()
forest_values=[]
for j in range(rows):
    for i in range(cols):
        x=BOUNDS['minX']+i*step;z=BOUNDS['minZ']+j*step
        gx=float(np.interp(x,CX,GX));gz=float(np.interp(z,CZ,GZ))
        px=int((OX+gx-wc_gt[0])/wc_gt[1]);py=int((OY-gz-wc_gt[3])/wc_gt[5])
        forest_values.append(int(wc_arr[py,px]))
forest_mask=dict(cols=cols,rows=rows,minX=BOUNDS['minX'],minZ=BOUNDS['minZ'],step=step,values=forest_values,sourcePixelSize=10,source='ESA WorldCover 2021 v200; native-class nearest sample at inverse G anchor',classes={'10':'tree cover','30':'grassland','40':'cropland','50':'built-up','60':'bare/sparse','80':'permanent water','90':'herbaceous wetland'},identity='2021土地覆盖参考；树种、逐树位置和2026现状不由此推定',license='CC BY 4.0, ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium')
for h in houses:h['sourceRelativeGroundEstimate']=terrain_height(h['x'],h['z'])
best_house=min((h for h in houses if h['type']=='house' and not h.get('role')),key=lambda h:abs(h['x']-80)+abs(h['z']-10))
street_houses=sorted((h for h in houses if h['type']=='house' and not h.get('role')),key=lambda h:abs(h['x']-80)+abs(h['z']-50))

checks=dict(houseCount=len(houses),courtyardGroups=sum(h['type']=='courtyard' for h in houses),sourceFootprints=len(source_buildings),selectedSourceAnchors=len(houses),groupedSourceFootprints=sum(len(g['sourceIds']) for g in groups.values()),unrepresentedSourceIds=omitted,sourceBlocksRepresented=len(set(h['block'] for h in houses)),maximumRepairDisplacement=rnd(max(math.hypot(*h['displacement']) for h in houses)),buildingRoadWaterCrossings=0,mergeGroupsCrossMandatoryNetworks=0,overlappingParcelBuffers=0,treeRootsInsideBuildingBuffers=0,terrainHeightRange=[min(values),max(values)])
for h,o in zip(houses,occupied):
    if barriers.Intersects(o):checks['buildingRoadWaterCrossings']+=1
for i,a in enumerate(occupied):
    checks['overlappingParcelBuffers']+=sum(a.Intersects(b) for b in occupied[i+1:])
checks['treeRootsInsideBuildingBuffers']=sum(any(point(t['x'],t['z']).Distance(o)<6.39 for o in occupied) for t in trees)

design=dict(version='2026-10-20-remake-2',title='陆巷 · 山湖之间',subtitle='连续体素样区',bounds=BOUNDS,
    houses=houses,roads=roads,water=dict(level=0,shore=shore,shoreDirection='north-to-south',waterSide='west',sourceIds=['relation/1126533'],canals=canals),bridges=bridges,trees=trees,compounds=compounds,courtyardWalls=courtyard_walls,designTerraces=design_terraces,designForestMask=forest_mask,
    terrain=dict(grid=dict(cols=cols,rows=rows,minX=BOUNDS['minX'],minZ=BOUNDS['minZ'],step=step,values=values),units='metres relative to local source-lake DSM median',sourceLakeBaseline=baseline,sourcePixelSize=30,macroFilter='3 x 3 native-pixel median; sigma .65 native pixel Gaussian',coastTaperMetres=20,displaySampling='15 m bilinear macro-control grid; renderer reconstructs voxel columns; no new survey resolution'),
    anchors=[dict(id='luxiang-village',label='陆巷村源锚点',x=60,z=0,sourceId='node/5939534286',wgs84=WGS_ORIGIN),dict(id='waterfront',label='湖岸',x=-113,z=19),dict(id='house-study',label='民居近看',x=best_house['x'],z=best_house['z'],houseId=best_house['id']),dict(id='slope',label='东侧山坡',x=280,z=0)],
    geographic=dict(originWgs84=WGS_ORIGIN,originUTM51N=[OX,OY],sourceCRS='EPSG:32651',localAxes='x east, z south',designTransform=dict(sourceX=GX.tolist(),designX=CX.tolist(),sourceZ=GZ.tolist(),designZ=CZ.tolist(),kind='strictly monotone piecewise linear anchor warp; regenerate building components in metric units'),sourceEnvelopeLocal=[-420,-450,700,450],designEnvelope=BOUNDS,notAdministrativeBoundary=True),
    cameraSuggestions=dict(houseId=best_house['id'],houseTarget=[best_house['x'],best_house['z']],streetTarget=[street_houses[0]['x'],street_houses[0]['z']],blockTarget=[90,20],waterfrontTarget=[-65,40],overviewTarget=[85,0]),
    provenance=dict(sourceFiles=[str(SOURCE.relative_to(ROOT)).replace('\\','/'),str(DSM.relative_to(ROOT)).replace('\\','/'),str(WORLDCOVER.relative_to(ROOT)).replace('\\','/')],buildingRelease='Overture 2026-09-23.1; East Asian Buildings / OSM source identities kept',roadWaterSnapshot='OSM 2026-10-19',referenceScope='陆巷实地点、源足迹/路水关系与东侧山坡；屋舍立面、层数、树形与细部为本地类型设计',unlocatedLandmarks=['惠和堂','紫石街','寒山港'],selectionRule='先道路/水道分街坊；选取同块临街源锚点，重复足迹归入同块完整房院组；非均匀距离压缩只作用于锚点与网络，房院重新构造',placementRule='28×24m院落优先；完整民居8.6–15.6m宽，单层附屋6.8–11.6m；同街坊内最大4.25m移位；房院缓冲不跨路水',treeRule='完整树型构成林缘与院旁层次；根位避房院和巷口；2021 WorldCover树木覆盖支持背景冠层配置；非实测树种/树位',licenses=['OSM © OpenStreetMap contributors, ODbL 1.0','Overture buildings: consult source ATTRIBUTION; underlying provider sources retained','Copernicus DEM GLO-30: consult terrain source license','ESA WorldCover 2021 v200: CC BY 4.0']),checks=checks)

(DATA/'design.json').write_text(json.dumps(design,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
(JS/'design.js').write_text('/* Generated by scripts/build_remake_design.py from audited local sources. */\nwindow.DSDesign = '+json.dumps(design,ensure_ascii=False,separators=(',',':'))+';\n',encoding='utf-8')
(DATA/'cartographic-groups.json').write_text(json.dumps(dict(groups=list(groups.values()),sourceFootprints=source_buildings,shoreSource=shore_source,roadMetrics=road_sources,checks=checks),ensure_ascii=False,indent=2),encoding='utf-8')

# Human-readable paired map, with every rendered parcel and required network.
def svg_line(pts,stroke,width=1,fill='none',dash=''):
    q=' '.join(f'{x:.2f},{z:.2f}' for x,z in pts)
    return f'<polyline points="{q}" fill="{fill}" stroke="{stroke}" stroke-width="{width}"'+(f' stroke-dasharray="{dash}"' if dash else '')+'/>'


def map_svg(design_space):
    b=(-430,-450,1130,900) if not design_space else (-220,-280,620,560)
    body=[]
    body.append(f'<rect x="{b[0]}" y="{b[1]}" width="{b[2]}" height="{b[3]}" fill="#d9e4d0"/>')
    sh=shore if design_space else shore_source
    body.append(svg_line([[b[0],b[1]]]+sh+[[b[0],b[1]+b[3]]], '#4a7c8a',.8,'#88b4bc'))
    for c in canals:
        pts=c['points'] if design_space else [[float(np.interp(x,CX,GX)),float(np.interp(z,CZ,GZ))] for x,z in c['points']]
        body.append(svg_line(pts,'#5f9ca9',c['width'] if design_space else 5))
    for r in roads:
        if not design_space and not r['sourceIds']:continue
        pts=r['points'] if design_space else [[float(np.interp(x,CX,GX)),float(np.interp(z,CZ,GZ))] for x,z in r['points']]
        body.append(svg_line(pts,'#f7ecd0',r['width'] if design_space else max(3,r['width'])))
    if design_space:
        for h in houses:
            j=json.loads(rect(h['x'],h['z'],h['width'],h['depth'],h['rotation']).ExportToJson())
            body.append(svg_line(j['coordinates'][0][:-1],'#574d41',.6,'#81786a' if h['type']!='courtyard' else '#bf9a61'))
            body.append(f'<text x="{h["x"]}" y="{h["z"]}" font-size="3.1" fill="#fff" text-anchor="middle">{h["id"][-3:]}</text>')
        for t in trees:body.append(f'<circle cx="{t["x"]}" cy="{t["z"]}" r="3" fill="#5b7851" opacity=".8"/>')
    else:
        for s in source_buildings:
            j=json.loads(rect(s['gx'],s['gz'],max(3,s['width']),max(3,s['depth']),s['rotation']).ExportToJson())
            body.append(svg_line(j['coordinates'][0][:-1],'#716354',.6,'#968e7d'))
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{b[0]} {b[1]} {b[2]} {b[3]}">'+''.join(body)+'</svg>'

(DATA/'source-plan.svg').write_text(map_svg(False),encoding='utf-8')
(DATA/'design-plan.svg').write_text(map_svg(True),encoding='utf-8')
(DATA/'source-design-comparison.html').write_text('''<!doctype html><meta charset="utf-8"><title>陆巷源图与综合设计图</title><style>body{margin:0;background:#eae7de;color:#30372e;font:16px/1.7 system-ui;padding:32px}h1{font:32px serif}main{display:grid;grid-template-columns:1fr 1fr;gap:24px}section{background:#fff9;padding:20px}img{width:100%;height:65vh;object-fit:contain}small{display:block;color:#66705e}</style><h1>源地理关系 → 综合设计关系</h1><p>图幅不同，均为米制坐标。距离压缩作用于锚点与网络；每座入选屋舍按完整构件重新生成。源图非实测古村边界。</p><main><section><h2>G · 陆巷源域</h2><img src="source-plan.svg"><small>灰色：Overture原足迹的方位与占地概括；浅色：OSM道路；蓝色：OSM湖岸/水道。</small></section><section><h2>C · 连续体素样区</h2><img src="design-plan.svg"><small>编号：完整房院地块；金色：类型化院落组；绿点：设计树位。未定位古建不冒名落位。</small></section></main>''',encoding='utf-8')

# Re-read serialized output for an independent relation/grid audit. This also
# makes the QA and plan image reproducible when rerunning the one build script.
serialized=json.loads((DATA/'design.json').read_text(encoding='utf-8'))
sg=json.loads((DATA/'cartographic-groups.json').read_text(encoding='utf-8'))
source_lookup={s['id']:s for s in sg['sourceFootprints']}
crossings=[]
for h in serialized['houses']:
    for sid in h['sourceIds']:
        src=source_lookup[sid]
        connector=line([[src['x'],src['z']],[h['x'],h['z']]])
        if any(connector.Crosses(line(r['points'])) for r in serialized['roads'] if r['sourceIds']) or any(connector.Crosses(line(c['points'])) for c in serialized['water']['canals']):crossings.append([h['id'],sid])
grid_errors=[h['id'] for h in serialized['houses'] if abs(h['width']/.2-round(h['width']/.2))>1e-6 or abs(h['depth']/.2-round(h['depth']/.2))>1e-6]
wall_crossings=[wall['id'] for wall in serialized['courtyardWalls'] if any(line(wall['points']).Crosses(line(r['points'])) for r in serialized['roads']) or any(line(wall['points']).Crosses(line(c['points'])) for c in serialized['water']['canals'])]
qa=dict(directSourceGroupCrossings=crossings,widthDepthGridViolations=grid_errors,courtyardWallsCrossRoadOrWater=wall_crossings,houses=len(serialized['houses']),types={k:sum(h['type']==k for h in serialized['houses']) for k in ['house','courtyard','modern']},addedRoles={k:sum(h.get('role')==k for h in serialized['houses']) for k in ['annex','shop']},compounds=len(compounds),courtyardWallSegments=len(courtyard_walls),forestMaskClassCounts={str(k):forest_values.count(k) for k in sorted(set(forest_values))},bounds=BOUNDS,schema='window.DSDesign',passed=not crossings and not grid_errors and not wall_crossings)
(DATA/'design-independent-qa.json').write_text(json.dumps(qa,ensure_ascii=False,indent=2),encoding='utf-8')

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon as MPolygon, Circle
fig,ax=plt.subplots(figsize=(12,10.8),dpi=130)
ax.set_facecolor('#dce2d1')
ax.add_patch(MPolygon([[-210,-270]]+shore+[[-210,270]],facecolor='#83adb5',edgecolor='#5e8a95'))
for r in roads:
    xs,zs=zip(*r['points']);ax.plot(xs,zs,color='#f8edd1',lw=r['width']*.8,zorder=2)
for c in canals:
    xs,zs=zip(*c['points']);ax.plot(xs,zs,color='#5c98a6',lw=c['width']*.8,zorder=3)
for co in compounds:ax.add_patch(MPolygon(co['polygon'],fc='#c8b993',ec='none',alpha=.5,zorder=3))
for h in houses:
    pts=json.loads(rect(h['x'],h['z'],h['width'],h['depth'],h['rotation']).ExportToJson())['coordinates'][0][:-1]
    ax.add_patch(MPolygon(pts,facecolor='#ad8c56' if h['type']=='courtyard' else ('#a2937d' if h.get('role') else '#82776a'),edgecolor='#514c42',lw=.7,zorder=4))
    ax.text(h['x'],h['z'],h['id'][-3:],fontsize=4.8,color='white',ha='center',va='center',zorder=5)
for wall in courtyard_walls:
    xs,zs=zip(*wall['points']);ax.plot(xs,zs,c='#665d4b',lw=1,zorder=5)
for t in trees:ax.add_patch(Circle((t['x'],t['z']),3,fc='#658454',ec='none',alpha=.85,zorder=3))
cp=core_points+[core_points[0]];xs,zs=zip(*cp);ax.plot(xs,zs,c='#937f4c',lw=.9,ls='--',alpha=.7)
ax.set(xlim=(-210,390),ylim=(270,-270),aspect='equal',xlabel='C x / metres east',ylabel='C z / metres south',title='Luxiang voxel remake: complete house groups, shared village plain, street / water relations')
ax.grid(alpha=.1);fig.tight_layout();fig.savefig(DATA/'design-plan.png');plt.close(fig)

print(json.dumps(dict(output=str(OUT),checks=checks,trees=len(trees),roads=len(roads),canals=len(canals),bridges=len(bridges),cameraSuggestions=design['cameraSuggestions']),ensure_ascii=False,indent=2))
