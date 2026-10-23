"""Select full metric houses around the town's real streets in the unified map.

Read-only source GeoPackage. Run with GDAL/NumPy in ArcGIS Pro Python; no ArcPy.
This does not replace DSUnifiedMap or move a source anchor to another block.
"""
from pathlib import Path
import json, math, hashlib, subprocess
from collections import Counter, defaultdict
import numpy as np
from osgeo import ogr, osr
ogr.UseExceptions()
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'东山镇_重制版'
UNIFIED_BYTES=(OUT/'data/unified-map.json').read_bytes()
D=json.loads(UNIFIED_BYTES)
G=D['geographic'];TX=G['designTransform'];OX,OY=G['originUTM51N']
DS=ogr.Open(str(ROOT/'东山镇_数据/working/dongshan_sources_utm51n.gpkg'))
W=osr.SpatialReference();W.ImportFromEPSG(4326);W.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
U=osr.SpatialReference();U.ImportFromEPSG(32651);U.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
TO_W=osr.CoordinateTransformation(U,W)
ZONES=[z for z in D['zones'] if z['id']!='luxiang']

def q(v):return round(round(v*5)/5,1)
def rnd(v):return round(float(v),2)
def base_map(x,z):return [float(np.interp(x,TX['sourceX'],TX['designX'])),float(np.interp(z,TX['sourceZ'],TX['designZ']))]
def source_map(x,z):
    """Exact shared source-road collar from build_unified_map.py."""
    base=np.array(base_map(x,z));best=None
    for zone in ZONES:
        gx,gz=zone['sourceOriginLocal'];cx,cz=zone['center'];b=zone['bounds']
        dx,dz=x-gx,z-gz;ex=max(b['minX']-cx-dx,0,dx-(b['maxX']-cx));ez=max(b['minZ']-cz-dz,0,dz-(b['maxZ']-cz))
        dist=math.hypot(ex,ez)
        if dist>=220:continue
        t=1-dist/220;weight=t*t*(3-2*t)
        if best is None or weight>best[0]:best=(weight,cx+dx,cz+dz,zone['id'])
    if best:
        weight,x1,z1,zid=best;p=base*(1-weight)+np.array([x1,z1])*weight
        return [rnd(p[0]),rnd(p[1])],zid
    return [rnd(base[0]),rnd(base[1])],None

def polygon(points):
    ring=ogr.Geometry(ogr.wkbLinearRing)
    for x,z in points+[points[0]]:ring.AddPoint_2D(x,z)
    g=ogr.Geometry(ogr.wkbPolygon);g.AddGeometry(ring);return g
def line(points):
    g=ogr.Geometry(ogr.wkbLineString)
    for x,z in points:g.AddPoint_2D(x,z)
    return g
def rect(x,z,w,d,a=0):
    c,s=math.cos(a),math.sin(a)
    return polygon([[x+c*u+s*v,z-s*u+c*v] for u,v in [(-w/2,-d/2),(w/2,-d/2),(w/2,d/2),(-w/2,d/2)]])
def bbox_intersect(a,b):return a[0]<=b[1] and a[1]>=b[0] and a[2]<=b[3] and a[3]>=b[2]
def local_ring(g):
    while g.GetGeometryName() not in ['LINEARRING','LINESTRING']:g=g.GetGeometryRef(0)
    return np.array([[g.GetX(i)-OX,OY-g.GetY(i)] for i in range(g.GetPointCount())])
def fit(g):
    p=local_ring(g.ConvexHull());best=None
    for i in range(len(p)-1):
        v=p[i+1]-p[i];a=-math.atan2(v[1],v[0]);c,s=math.cos(a),math.sin(a)
        uv=np.column_stack([p[:,0]*c-p[:,1]*s,p[:,0]*s+p[:,1]*c]);lo,hi=uv.min(axis=0),uv.max(axis=0);w,d=hi-lo
        if best is None or w*d<best[0]:best=(w*d,a,lo,hi)
    _,a,lo,hi=best;u,v=(lo+hi)/2;c,s=math.cos(a),math.sin(a);w,d=hi-lo
    if w<d:w,d=d,w;a+=math.pi/2
    return (c*u+s*v,-s*u+c*v,float(w),float(d),a)
def near_road(x,z,roads):
    best=None
    for r in roads:
        if '_bbox' not in r:
            p=r['points'];r['_bbox']=(min(a[0] for a in p),max(a[0] for a in p),min(a[1] for a in p),max(a[1] for a in p))
        e=r['_bbox'];bx=max(e[0]-x,0,x-e[1]);bz=max(e[2]-z,0,z-e[3])
        if best is not None and bx*bx+bz*bz>best[0]*best[0]:continue
        along=0
        for a,b in zip(r['points'],r['points'][1:]):
            dx,dz=b[0]-a[0],b[1]-a[1];ll=dx*dx+dz*dz;t=max(0,min(1,((x-a[0])*dx+(z-a[1])*dz)/(ll or 1)))
            xx,zz=a[0]+t*dx,a[1]+t*dz;dist=math.hypot(x-xx,z-zz)
            if best is None or dist<best[0]:best=(dist,r,xx,zz,along+math.sqrt(ll)*t,1 if dx*(z-zz)-dz*(x-xx)>=0 else -1,dx,dz)
            along+=math.sqrt(ll)
    return best

roads=[]
represented={sid for r in D['roads'] for sid in r.get('sourceIds',[])}
design_streets=defaultdict(list)
for r in D['roads']:
    for sid in r.get('sourceIds',[]):design_streets[sid].append(r)
rl=DS.GetLayerByName('osm_roads');rl.SetSpatialFilterRect(OX-600,OY-700,OX+6500,OY+3300)
for f in rl:
    p=json.loads(f.ExportToJson())['properties'];g=f.GetGeometryRef()
    if p.get('highway') not in ['primary','secondary','tertiary','residential','unclassified','service','path','footway','track'] or g.GetGeometryName()!='LINESTRING':continue
    if p.get('access') in ['no','private'] and p.get('highway') in ['service','path','footway','track']:continue
    roads.append(dict(id=p['id'],kind=p['highway'],points=local_ring(g).tolist(),represented=p['id'] in represented))
rl.SetSpatialFilter(None)

# Source facility parcels exclude ordinary houses even where footprint datasets
# disagree. All actual C roads, water and existing full assets are barriers.
source_parcels=[]
pl=DS.GetLayerByName('osm_places_admin_poi');pl.SetSpatialFilterRect(OX+2900,OY-800,OX+5400,OY+2300)
for f in pl:
    p=json.loads(f.ExportToJson())['properties'];g=f.GetGeometryRef()
    if g.GetGeometryName()=='POLYGON' and (p.get('amenity') in ['school','college','hospital'] or p.get('leisure')=='park'):
        source_parcels.append((p['id'],g.Clone()))
pl.SetSpatialFilter(None)

barriers=[]
for r in D['roads']:
    if len(r.get('points',[]))>=2:barriers.append((r['id'],line(r['points']).Buffer(r.get('width',3)/2+1.2)))
for c in D['water'].get('canals',[]):
    if len(c.get('points',[]))>=2:barriers.append((c.get('id','canal'),line(c['points']).Buffer(c.get('width',4)/2+2.0)))
for p in D['water'].get('ponds',[]):barriers.append((p.get('id','pond'),polygon(p['polygon']).Buffer(2)))
for t in D.get('sharedTerraces',[]):
    if t.get('mode')=='constant':barriers.append((t['id'],polygon(t['polygon']).Buffer(5)))
for g in D.get('grounds',[]):
    if g.get('polygon'):barriers.append((g['id'],polygon(g['polygon']).Buffer(1.2)))
for h in D['houses']:barriers.append((h['id'],rect(h['x'],h['z'],h.get('width',12)+5,h.get('depth',8)+5,h.get('rotation',0))))
barriers=[(sid,g,g.GetEnvelope()) for sid,g in barriers]
used_sources={sid for h in D['houses'] for sid in h.get('sourceIds',[])}
mask=D['water'].get('mask');mask_values=None
if mask and mask.get('runs'):
    runs=np.asarray(mask['runs'],dtype=np.int64);mask_values=np.repeat(runs[1::2],runs[0::2]).reshape(mask['rows'],mask['cols'])
def lake(x,z):
    if mask_values is None:return False
    ix=int((x-mask['minX'])/mask['step']);iz=int((z-mask['minZ'])/mask['step'])
    return 0<=ix<mask['cols'] and 0<=iz<mask['rows'] and mask_values[iz,ix]==1

excluded=[];candidates=[]
def exclude(sid,reason,**details):excluded.append(dict(id=sid,reason=reason,**details))
bl=DS.GetLayerByName('overture_buildings');bl.SetSpatialFilterRect(OX+300,OY-600,OX+5500,OY+2900)
for f in bl:
    p=json.loads(f.ExportToJson())['properties'];sid=p['id'];g=f.GetGeometryRef()
    if sid in used_sources:exclude(sid,'source-already-represented');continue
    area=g.Area()
    if area<38 or area>300:exclude(sid,'footprint-size-outside-ordinary-house-sample');continue
    gx,gz,sw,sd,a=fit(g)
    school_dist=math.hypot(gx-3869.26,gz+1101.99);garden_dist=math.hypot(gx-4146.13,gz+434.47)
    region='school-edge' if school_dist<650 and school_dist<garden_dist else 'garden-edge' if garden_dist<600 else 'route-village'
    near=near_road(gx,gz,roads)
    if not near or near[0]>42:exclude(sid,'not-near-source-street');continue
    dist,r,rx,rz,along,side,rdx,rdz=near
    if not r['represented']:exclude(sid,'nearest-source-street-not-in-unified-network',street=r['id']);continue
    if any(g.Intersects(pp) for _,pp in source_parcels):exclude(sid,'inside-or-crossing-source-facility-parcel');continue
    if sw<7 or sw>24 or sd<4.5 or sd>16:exclude(sid,'source-proportion-unsuitable-for-complete-house');continue
    (x,z),collar=source_map(gx,gz);bb=D['bounds']
    if not(bb['minX']+15<x<bb['maxX']-15 and bb['minZ']+15<z<bb['maxZ']-15):exclude(sid,'outside-unified-bounds');continue
    # Keep full components in metres; choose a matching size rather than apply
    # the compressed geographic derivative to width, depth or window grids.
    w=q(max(8,min(16,sw)));d=q(max(6,min(12,sd)))
    if math.sin(a)*(rx-gx)+math.cos(a)*(rz-gz)<0:a+=math.pi
    a=(a+math.pi)%(2*math.pi)-math.pi
    fp=rect(x,z,w+2.8,d+2.8,a);env=fp.GetEnvelope()
    reason=next((bid for bid,bg,be in barriers if bbox_intersect(env,be) and fp.Intersects(bg)),None)
    if reason:exclude(sid,'complete-house-buffer-collides-with-existing-design',barrier=reason);continue
    if any(lake(xx,zz) for xx in np.arange(env[0],env[1]+1,2) for zz in np.arange(env[2],env[3]+1,2)):
        exclude(sid,'unified-source-lake-mask');continue
    actual_near=near_road(x,z,design_streets[r['id']])
    if actual_near is None or actual_near[0]>55:exclude(sid,'source-anchor-too-far-from-same-actual-C-street-after-context-collar');continue
    # Route extraction may reverse an OSM way. Normalise the tangent before
    # comparing sides, then exclude any true bank/block flip from the collar.
    ll=math.hypot(rdx,rdz) or 1
    ma,_=source_map(rx-rdx/ll,rz-rdz/ll);mb,_=source_map(rx+rdx/ll,rz+rdz/ll)
    expected_side=side*(1 if actual_near[6]*(mb[0]-ma[0])+actual_near[7]*(mb[1]-ma[1])>=0 else -1)
    if expected_side!=actual_near[5]:exclude(sid,'shared-context-warp-would-change-source-street-side-no-repair');continue
    major=r['kind'] in ['primary','secondary','tertiary']
    if major and area>=105:typ='modern';floors=2;why='主街较大紧凑足迹，采用两层平顶现代民居类型'
    elif sw/sd>1.7 and w>=12:typ='rowHouse';floors=1;why='沿源街道的狭长足迹，按连续单层街屋节间重构'
    elif sd>9 and w<10:typ='narrowHouse';floors=2;why='窄面深进源足迹，采用窄间街屋'
    elif region=='route-village':typ='villageHouse';floors=1 if area<85 else 2;why='连接源村路的小体量足迹，保留离散村居肌理'
    else:typ='house';floors=2 if area>95 else 1;why='镇内支路普通紧凑足迹，灰瓦民居类型设计'
    if not major and area>=155 and sd>=9.5:typ='villageHouse';floors=2;why='支路较深完整源足迹，采用带退进的乡镇楼房'
    spec=dict(id='TC-'+sid[:8],type=typ,x=x,z=z,width=w,depth=d,rotation=round(a,5),floors=floors,
        seed=int(hashlib.sha256(sid.encode()).hexdigest()[:8],16),sourceIds=[sid],sourceAnchor=[rnd(gx),rnd(gz)],
        sourceWgs84=[rnd(v*1000000)/1000000 for v in TO_W.TransformPoint(gx+OX,OY-gz)[:2]],
        sourceFootprintArea=rnd(area),sourceFootprintDimensions=[rnd(sw),rnd(sd)],sourceRoadId=r['id'],sourceRoadKind=r['kind'],
        streetSide=side,sourceStreetDistance=rnd(dist),sourceStreetChainage=rnd(along),sourceRoadBlock=r['id']+('::left' if side>0 else '::right'),
        actualCStreetDistance=rnd(actual_near[0]),actualCStreetSide=actual_near[5],expectedCStreetSide=expected_side,
        baseMappedAnchor=[rnd(v) for v in base_map(gx,gz)],sharedCollarZone=collar,mappedAnchor=[x,z],
        displacement=[0,0],componentScale=1,zoneId='town-context',districtId='town-context',region=region,
        identity='源足迹、街段与侧别约束；立面、楼层和建造年代不作测绘断言',variantReason=why)
    candidates.append(dict(spec=spec,footprint=fp,sourceGeometry=g.Clone(),region=region,street=r['id'],side=side,
        score=abs(dist-15)+abs(area-110)*.025,chainage=along))
bl.SetSpatialFilter(None)

# Street-side queues, not spatial hash buckets. Take turns between actual
# represented ways and sides, retaining gaps rather than sliding houses.
groups=defaultdict(list)
for c in candidates:groups[(c['region'],c['street'],c['side'])].append(c)
for values in groups.values():values.sort(key=lambda c:(c['score'],c['chainage']))
keys=sorted(groups,key=lambda k:({'school-edge':0,'garden-edge':1,'route-village':2}[k[0]],-len(groups[k]),k[1],k[2]))
selected=[];occupied=[];region_count=Counter();street_count=Counter();TARGET=60
while len(selected)<TARGET:
    advanced=False
    for key in keys:
        queue=groups[key]
        if not queue:continue
        # First round allows every real street/side a chance. Later rounds
        # preserve the higher town density while the mountain path stays sparse.
        if region_count[key[0]]>={'school-edge':30,'garden-edge':25,'route-village':12}[key[0]]:continue
        while queue:
            c=queue.pop(0);s=c['spec'];fp=c['footprint'];env=fp.GetEnvelope()
            if any(bbox_intersect(env,oe) and fp.Intersects(og) for og,oe in occupied):
                exclude(s['sourceIds'][0],'complete-house-spacing-conflict-no-shrink-or-displacement');continue
            selected.append(s);occupied.append((fp,env));region_count[c['region']]+=1;street_count[s['sourceRoadBlock']]+=1
            advanced=True;break
        if len(selected)>=TARGET:break
    if not advanced:break
selected_ids={s['sourceIds'][0] for s in selected}
for c in candidates:
    sid=c['spec']['sourceIds'][0]
    if sid not in selected_ids and not any(e['id']==sid for e in excluded):exclude(sid,'street-side-selection-cap-preserved-full-house')

assert all(8<=s['width']<=16 and 6<=s['depth']<=12 and s['displacement']==[0,0] for s in selected)
assert not selected_ids.intersection(used_sources)
# Check the actual component generators as well as the design rectangles.
node_code=r'''
const fs=require('fs'),vm=require('vm'),c={window:{}};vm.createContext(c);
vm.runInContext(fs.readFileSync('东山镇_重制版/js/architecture.js','utf8'),c);
vm.runInContext(fs.readFileSync('东山镇_重制版/js/content.js','utf8'),c);
let raw='';process.stdin.on('data',s=>raw+=s);process.stdin.on('end',()=>{
const houses=JSON.parse(raw),out=[];let errors=0,total=0;
for(const h of houses){const bounds=[Infinity,Infinity,-Infinity,-Infinity];let n=0;
const b={box:(x,y,z,w,hh,d)=>{n++;for(const [p,s] of [[x,w],[y,hh],[z,d]])for(const e of [p-s/2,p+s/2])if(Math.abs(e/.2-Math.round(e/.2))>1e-5)errors++;bounds[0]=Math.min(bounds[0],x-w/2);bounds[1]=Math.min(bounds[1],z-d/2);bounds[2]=Math.max(bounds[2],x+w/2);bounds[3]=Math.max(bounds[3],z+d/2)}};
c.window.DSContent.build(b,h);total+=n;out.push({id:h.id,boxes:n,bounds})}
console.log(JSON.stringify({gridErrors:errors,boxCount:total,assets:out}))});
'''
node=subprocess.run([r'C:\Program Files\nodejs\node.exe','-e',node_code],input=json.dumps(selected),text=True,capture_output=True,cwd=ROOT,check=True)
asset_qa=json.loads(node.stdout);assert asset_qa['gridErrors']==0
actual_footprints=[];actual_collisions=[]
for s,aq in zip(selected,asset_qa['assets']):
    x0,z0,x1,z1=aq['bounds'];u,v=(x0+x1)/2,(z0+z1)/2;a=s['rotation'];c,ss=math.cos(a),math.sin(a)
    fp=rect(s['x']+c*u+ss*v,s['z']-ss*u+c*v,x1-x0,z1-z0,a);env=fp.GetEnvelope()
    for bid,bg,be in barriers:
        if bbox_intersect(env,be) and fp.Intersects(bg):actual_collisions.append([s['id'],bid])
    for oid,og,oe in actual_footprints:
        if bbox_intersect(env,oe) and fp.Intersects(og):actual_collisions.append([s['id'],oid])
    actual_footprints.append((s['id'],fp,env))
assert not actual_collisions,actual_collisions
report=dict(version='2026-10-22-town-context-1',sourceFile='东山镇_数据/working/dongshan_sources_utm51n.gpkg',
    unifiedMapVersion=D['version'],unifiedMapSHA256=hashlib.sha256(UNIFIED_BYTES).hexdigest(),
    selectionPolicy='真实源街段+同侧别轮询，完整房屋不能放下就少选；零锚点移位；不机械格网撒屋',
    transform='统一G/C分段控制点及同一220m设施collar；组件米制不缩放',inputCandidateCount=len(candidates),addedHouseCount=len(selected),
    types=dict(Counter(s['type'] for s in selected)),regions=dict(region_count),sourceStreetSides=dict(street_count),
    checks=dict(duplicateSourceIDs=0,anchorRepairs=0,nonuniformAssetScale=0,completeHouseBarrierIntersections=0,
        completeHouseMutualIntersections=0,sourceFacilityParcelIntersections=0,sourceLakeMaskHits=0,
        existingAssetsNotReplaced=len(D['houses']),actualComponentBoxCount=asset_qa['boxCount'],actualComponentGridErrors=asset_qa['gridErrors'],
        actualAssetBoundingRectBarrierIntersections=actual_collisions,
        sourceStreetSideFlips=sum(s['actualCStreetSide']!=s['expectedCStreetSide'] for s in selected),
        maximumMatchedCStreetDistance=max((s['actualCStreetDistance'] for s in selected),default=0)),
    selectedHouses=selected,exclusionCounts=dict(Counter(e['reason'] for e in excluded)),excludedSources=excluded,
    licenses=['OSM © OpenStreetMap contributors, ODbL 1.0','Overture/East Asian Buildings: see 东山镇_数据/overture/ATTRIBUTION.txt'])
(OUT/'data/town-context-qa.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
payload=json.dumps(dict(version=report['version'],houses=selected,counts=dict(addedHouseCount=len(selected),types=report['types'],regions=report['regions']),
    policy=report['selectionPolicy']),ensure_ascii=False,separators=(',',':'))
js='/* Generated source-anchored streetside context. Load after unified-map.js. */\n(function(g){\nconst P='+payload+';\nconst D=g.DSUnifiedMap;if(!D)throw new Error("town-context.js requires unified-map.js");\nconst ids=new Set(D.houses.map(h=>h.id));for(const h of P.houses)if(!ids.has(h.id)){D.houses.push(h);ids.add(h.id)}\nD.townContext=P.counts;D.provenance.townContext={version:P.version,policy:P.policy,qa:"data/town-context-qa.json"};g.DSTownContext=P;\n})(window);\n'
(OUT/'js/town-context.js').write_text(js,encoding='utf8')
print(json.dumps(dict(added=len(selected),types=report['types'],regions=report['regions'],candidates=len(candidates),exclusions=report['exclusionCounts']),ensure_ascii=False))
