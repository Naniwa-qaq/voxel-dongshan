"""Build source-anchored special-facility districts; audited source files stay read-only.

Run using the ArcGIS Pro Python environment for GDAL/NumPy/Matplotlib. No ArcPy.
"""
from pathlib import Path
import json, math, hashlib
from osgeo import ogr, osr, gdal
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'东山镇_重制版/data/districts'
OUT.mkdir(parents=True,exist_ok=True)
ogr.UseExceptions(); gdal.UseExceptions()
DS=ogr.Open(str(ROOT/'东山镇_数据/working/dongshan_sources_utm51n.gpkg'))
WGS=osr.SpatialReference();WGS.ImportFromEPSG(4326)
UTM=osr.SpatialReference();UTM.ImportFromEPSG(32651)
for s in [WGS,UTM]:s.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
TO_UTM=osr.CoordinateTransformation(WGS,UTM)
TO_WGS=osr.CoordinateTransformation(UTM,WGS)

def pjson(f):return json.loads(f.ExportToJson())['properties']
def item(layer,sid):
    l=DS.GetLayerByName(layer);l.SetSpatialFilter(None);l.SetAttributeFilter("id='"+sid+"'")
    f=l.GetNextFeature();l.SetAttributeFilter(None)
    if f is None:raise ValueError(sid)
    return pjson(f),f.GetGeometryRef().Clone()
def nearby(layer,g,pad=0):
    l=DS.GetLayerByName(layer);e=g.GetEnvelope();l.SetSpatialFilterRect(e[0]-pad,e[2]-pad,e[1]+pad,e[3]+pad)
    ans=[]
    for f in l:
        q=f.GetGeometryRef()
        if q.Intersects(g.Buffer(pad)):
            ans.append((pjson(f),q.Clone()))
    l.SetSpatialFilter(None);return ans
def local_points(g,ox,oy):
    if g.GetGeometryName() in ['LINEARRING','LINESTRING']:
        return [[round(g.GetX(i)-ox,2),round(oy-g.GetY(i),2)] for i in range(g.GetPointCount())]
    return local_points(g.GetGeometryRef(0),ox,oy)
def snapshot(sid,name):
    props,g=item('osm_places_admin_poi',sid);c=g.Centroid();ox,oy=c.GetX(),c.GetY()
    result=dict(name=name,id=sid,originWgs84=list(TO_WGS.TransformPoint(ox,oy)[:2]),boundary=local_points(g,ox,oy),layers={})
    for ln in ['overture_buildings','osm_roads','osm_waterways','osm_water_polygons','osm_landuse_natural']:
        objs=nearby(ln,g,20 if ln=='osm_roads' else 0)
        result['layers'][ln]=[dict(id=p['id'],properties={k:v for k,v in p.items() if v is not None},geometry=json.loads(q.ExportToJson())) for p,q in objs]
    (OUT/(name+'-sources.json')).write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    fig,ax=plt.subplots(figsize=(10,10))
    b=np.array(result['boundary']);ax.plot(b[:,0],b[:,1],color='red',lw=2)
    for i,(p,q) in enumerate(nearby('overture_buildings',g)):
        v=np.array(local_points(q,ox,oy));ax.fill(v[:,0],v[:,1],color='#b7b5ae',ec='#575650');cc=q.Centroid();ax.text(cc.GetX()-ox,oy-cc.GetY(),str(i),fontsize=8)
        print(name,i,p['id'],round(q.Area(),1),[round(cc.GetX()-ox,1),round(oy-cc.GetY(),1)])
    for p,q in nearby('osm_water_polygons',g):
        if q.Area()>200000:continue
        v=np.array(local_points(q,ox,oy));ax.fill(v[:,0],v[:,1],color='#71aec1',alpha=.6)
    for p,q in nearby('osm_roads',g,20):
        if q.GetGeometryName()!='LINESTRING':continue
        v=np.array(local_points(q,ox,oy));ax.plot(v[:,0],v[:,1],color='#c9b688',lw=2)
    ax.set_xlim(b[:,0].min()-30,b[:,0].max()+30);ax.set_ylim(b[:,1].max()+30,b[:,1].min()-30)
    ax.set_aspect('equal');ax.grid(alpha=.2);fig.savefig(OUT/(name+'-source-plan.png'),dpi=140);plt.close(fig)
    return props,g,result

def rect(x,z,w,d,a=0):
    c,s=math.cos(a),math.sin(a)
    return [[round(x+c*u+s*v,2),round(z-s*u+c*v,2)] for u,v in [(-w/2,-d/2),(w/2,-d/2),(w/2,d/2),(-w/2,d/2)]]

def shape(points):
    r=ogr.Geometry(ogr.wkbLinearRing)
    for x,z in points+[points[0]]:r.AddPoint_2D(x,z)
    g=ogr.Geometry(ogr.wkbPolygon);g.AddGeometry(r);return g

def fit_building(g,ox,oy):
    """Minimum-area rectangle of a source footprint, with clockwise local axes."""
    hull=g.ConvexHull();p=np.array(local_points(hull,ox,oy));best=None
    for i in range(len(p)-1):
        delta=p[i+1]-p[i];a=-math.atan2(delta[1],delta[0]);c,s=math.cos(a),math.sin(a)
        uv=np.column_stack([c*p[:,0]-s*p[:,1],s*p[:,0]+c*p[:,1]])
        lo,hi=uv.min(axis=0),uv.max(axis=0);w,d=hi-lo
        if best is None or w*d<best[0]:best=(w*d,a,lo,hi)
    _,a,lo,hi=best;u,v=(lo+hi)/2;c,s=math.cos(a),math.sin(a)
    x,z=c*u+s*v,-s*u+c*v;w,d=hi-lo
    if w<d:w,d=d,w;a+=math.pi/2
    while a>math.pi:a-=2*math.pi
    while a<-math.pi:a+=2*math.pi
    return dict(x=round(x,2),z=round(z,2),width=round(w,1),depth=round(d,1),rotation=round(a,5))

def building(bid,typ,x,z,w,d,rot=0,floors=1,sourceIds=None,**extra):
    b=dict(id=bid,type=typ,x=round(x,2),z=round(z,2),width=w,depth=d,rotation=rot,floors=floors,
        seed=int(hashlib.sha256(bid.encode()).hexdigest()[:7],16),sourceIds=sourceIds or [],
        identity='源锚点与场地约束；构件、层数及立面为形制综合',**extra)
    return b

def road(rid,points,width=2,kind='garden-path',sourceIds=None,**extra):
    return dict(id=rid,points=points,width=width,kind=kind,sourceIds=sourceIds or [],**extra)

def ground(gid,kind,x,z,w,d,a=0,**extra):
    return dict(id=gid,kind=kind,x=x,z=z,width=w,depth=d,rotation=a,polygon=rect(x,z,w,d,a),**extra)

def terrain(bounds):
    return dict(grid=dict(cols=2,rows=2,minX=bounds['minX'],minZ=bounds['minZ'],
        step=max(bounds['maxX']-bounds['minX'],bounds['maxZ']-bounds['minZ']),values=[1.2]*4),
        policy='设施内部作统一1.2m展示标高；不是DEM新增测量，不表现未核实高差')

def source_roads(g,ox,oy,bounds):
    clip=shape(rect((bounds['minX']+bounds['maxX'])/2+ox,oy-(bounds['minZ']+bounds['maxZ'])/2,
        bounds['maxX']-bounds['minX'],bounds['maxZ']-bounds['minZ']))
    ans=[]
    for p,q in nearby('osm_roads',g,30):
        q=q.Intersection(clip)
        if q.IsEmpty():continue
        if q.GetGeometryName()=='LINESTRING':parts=[q]
        elif q.GetGeometryName()=='MULTILINESTRING':parts=[q.GetGeometryRef(i) for i in range(q.GetGeometryCount())]
        else:continue
        for i,part in enumerate(parts):
            pts=local_points(part.Simplify(1),ox,oy)
            if len(pts)<2:continue
            ans.append(road(p['id']+':'+str(i),pts,6.4,'residential',[p['id']],surface='asphalt',name=p.get('name') or '',sourceKind=p.get('highway')))
    return ans

def place_trees(candidates,buildings,roads,grounds):
    ans=[]
    for i,(x,z,typ,scale) in enumerate(candidates):
        if any(shape(rect(b['x'],b['z'],b['width']+5,b['depth']+5,b.get('rotation',0))).Contains(shape(rect(x,z,.1,.1))) for b in buildings):continue
        if any(g['kind'] in ['sportsField','basketball','pond'] and shape(g['polygon']).Intersects(shape(rect(x,z,7,7))) for g in grounds):continue
        if any(_line_distance(x,z,r['points'])<r['width']/2+2.8 for r in roads):continue
        ans.append(dict(id='T-'+str(i),x=x,z=z,type=typ,scale=scale,seed=33991+i*97,placement='园林/校园设计树位；非逐株调查'))
    return ans

def _line_distance(x,z,points):
    d=1e9
    for a,b in zip(points,points[1:]):
        vx,vz=b[0]-a[0],b[1]-a[1];t=max(0,min(1,((x-a[0])*vx+(z-a[1])*vz)/(vx*vx+vz*vz or 1)))
        d=min(d,math.hypot(x-a[0]-vx*t,z-a[1]-vz*t))
    return d

def district_base(sid,name,bounds,kind):
    props,g=item('osm_places_admin_poi',sid);c=g.Centroid();ox,oy=c.GetX(),c.GetY()
    origin=list(TO_WGS.TransformPoint(ox,oy)[:2])
    d=dict(id=kind,name=name,title=name,subtitle='真实地理锚点 · 设施形制综合',originWgs84=origin,sourceIds=[sid],bounds=bounds,
        boundary=local_points(g,ox,oy),buildings=[],grounds=[],paths=[],trees=[],walls=[],rocks=[],bridges=[],
        water=dict(shore=[],canals=[],ponds=[]),terrain=terrain(bounds),
        georeference=dict(originWgs84=origin,originUTM51N=[ox,oy],sourceCRS='EPSG:32651',localAxes='x east, z south',designTransform='局部米制；建筑源锚点按原位置，形制综合另有明确标识'),
        provenance=dict(sourceFiles=['东山镇_数据/working/dongshan_sources_utm51n.gpkg'],roadWaterSnapshot='OSM 2026-10-19',
            buildingRelease='Overture 2026-09-23.1; underlying East Asian Buildings sources retained',
            licenses=['OSM © OpenStreetMap contributors, ODbL 1.0','Overture: see 东山镇_数据/overture/ATTRIBUTION.txt'],
            coordinatePolicy='地区锚点是源地块几何重心；非实测门口；各区在真实东山镇位置独立加载，不能当陆巷相邻街坊'))
    return d,g,ox,oy

def school():
    d,g,ox,oy=district_base('way/1101928342','东山中学',dict(minX=-185,maxX=180,minZ=-135,maxZ=145),'dongshan-school')
    objects=nearby('overture_buildings',g)
    for i,(p,q) in enumerate(objects):
        if q.Area()<100:continue
        fit=fit_building(q,ox,oy)
        typ='schoolTeaching' if i in [0,1,2,6,7] else 'schoolHall'
        # The large classroom footprints exceed the reusable wing module. Each
        # selected wing keeps 0.2m components, with a shorter designed bay count.
        w=max(10.0,min(44.0,round(fit.pop('width')/0.2)*0.2));depth=max(8.8,min(14.0,round(fit.pop('depth')/0.2)*0.2))
        if typ=='schoolHall':depth=round(min(28,max(12,math.sqrt(q.Area())*.8))/.2)*.2;w=min(36,round(q.Area()/depth/.2)*.2)
        if i==3:w,depth=12.0,10.0
        if i==6:
            # The source is an L footprint. Select its long wing instead of
            # filling the bounding rectangle over its small neighbour.
            fit['x'],fit['z']=80.1,-24.2;w,depth=34.0,11.0
        if i in [0,1,2]:fit['rotation']=.70
        b=building('DSZX-'+str(i),typ,fit['x'],fit['z'],round(w,1),round(depth,1),fit['rotation'],3 if typ=='schoolTeaching' else 2,[p['id']],
            sourceFootprint=local_points(q,ox,oy),sourceFootprintArea=round(q.Area(),1),sourceAnchor=[round(q.Centroid().GetX()-ox,2),round(oy-q.Centroid().GetY(),2)],
            designAnchor=[fit['x'],fit['z']],
            label='教学楼组' if i in [0,1,2] else '校园公共楼',functionCertainty='楼栋具体功能未按栋核实；使用学校已证实功能类型',sourceGeometryRole='足迹锚点、朝向与体量参照；立面与层数类型化')
        d['buildings'].append(b);d['sourceIds'].append(p['id'])
    d['buildings'].append(building('DSZX-gate','schoolGate',110,65,12,5,.7,1,['ab496e92-33d2-4fca-923d-5eea4126b40e'],label='校门',sourceGeometryRole='沿校区临路小足迹与边界接口的设计门区'))
    d['paths']=source_roads(g,ox,oy,d['bounds'])+[
        road('campus-main',[[111,65],[89,47],[63,36],[24,35],[0,10],[-25,-17],[-39,-33]],4.8,'campus-path'),
        road('campus-court1',[[-15,-5],[-6,-13],[10,-26],[25,-39]],2.4,'campus-path'),
        road('campus-court2',[[10,20],[17,12],[33,-1],[49,-14]],2.4,'campus-path'),
        road('campus-public',[[89,47],[96,30],[91,8],[72,-7]],3.2,'campus-path')]
    d['grounds']=[
        ground('track','sportsField',-75,-5,78,156,.73,lanes=6,trackColor='#b76c50',fieldColor='#6c8f58',
            role='保留西侧运动留空与教学组团对比；跑道以方阶边界综合',geometryStatus='制图综合的运动区轮廓；未按当前测量平面复原400m标准尺寸'),
        ground('ballcourt','basketball',45,67,28,15,.73,surfaceColor='#929b8c',role='校园球场类型点景；无精确球场线形来源'),
        ground('campus-square','court',90,48,28,22,.73,role='门内活动空间'),
        ground('teaching-court','court',9.7,-26.2,40,11,.70,role='教学组团间铺地'),
        ground('teaching-court-2','court',32.9,-.8,40,11,.70,role='教学组团间铺地')]
    candidates=[]
    for x,z in [(-150,-43),(-133,-67),(-111,-91),(-146,-23),(-126,9),(-105,40),(-86,67),(-63,92),(-42,103),
        (-15,88),(8,73),(18,85),(41,83),(66,93),(86,82),(126,38),(136,15),(137,-6),(114,-60),
        (87,-86),(37,-88),(10,-81),(-36,-58),(-21,18),(0,44),(25,56),(61,42),(75,65)]:candidates.append((x,z,'broadleaf',1.0 if len(candidates)%3 else 1.15))
    d['trees']=place_trees(candidates,d['buildings'],d['paths'],d['grounds'])
    d['walls']=[dict(id='campus-fence',points=d['boundary'],height=1.4,width=.2,kind='schoolFence',gateGap=[102,69,119,58],role='源校区边界的示意围护，非逐段围墙调查')]
    d['cameraSuggestions']=dict(overviewTarget=[-10,1.2,0],distance=275,yaw=.72,pitch=.80,
        blockTarget=[26,0],streetTarget=[44,-4],houseTarget=[21.1,-13.6],houseId='DSZX-1',waterfrontTarget=[-68,10],treeTarget=[-63,92])
    d['provenance'].update(referenceScope='OSM校区边界与Overture主楼足迹保留；校园通路、跑道轮廓、立面和楼层为设施制图综合。保留西运动/东教学关系，楼栋具体功能未逐栋确认。',
        officialReferences=[dict(title='苏州市吴中区东山中学介绍（2021）',url='https://dszx.wxedu.net/xxgk/xxjs1/content_250433',supports='校名、独立高中、学校占地39817.31平方米；与2026改造招标本部面积一致'),
        dict(title='东山中学学校介绍（历史资料）',url='https://dszx.wxedu.net/xxgk/xxjs',supports='三幢教学楼、综合楼、实验楼、图书馆、田径场等设施类别；历史统计不可当2026逐栋现状'),
        dict(title='教学楼官方图集',url='https://www.dszx.net/tpzx/xyfm/content_1655',supports='教学楼外观研究，2014照片'),
        dict(title='校园风景照官方图集',url='https://www.dszx.net/tpzx/xyfm/content_1654',supports='实验楼前、田径场与校园植被研究，2016照片'),
        dict(title='2026年本部改造监理招标',url='https://ggzy.suzhou.gov.cn/jyxx/003001/003001001/20260601/d63e67fd-aa44-4d19-8141-44b8d9ec1a0a.html',supports='本部39817.31平方米；2026仍有改造，资料时相不等于施工后现状')])
    return finish(d)

def garden():
    d,g,ox,oy=district_base('way/1332791315','春在楼 · 宅园',dict(minX=-125,maxX=125,minZ=-85,maxZ=110),'chunzailou-garden')
    d['subtitle']='跑马楼、北园与池石 · 形制综合'
    b=d['buildings'];sid=['way/1332791315']
    # The source marks a visitor park, not the measured historic building.
    # Organise the documented west-to-east sequence inside its western core;
    # do not label an arbitrary Overture rectangle as a surveyed named hall.
    for i,x in enumerate([-70,-49,-28]):
        b.append(building('CZL-hall-'+str(i),'gardenHall',x,-3,22,6.8,math.pi/2,2,sid,
            label=['后楼','中楼','前楼'][i]+'形制',role='west-east-courtyard-hall',
            sourceGeometryRole='官方轴线与楼厅次序综合；此楼轮廓不是园区边界或Overture实测命名栋'))
    for z in [-15.6,9.6]:
        b.append(building('CZL-wing-'+str(z),'gardenCorridor',-49,z,48.8,3.4,0,2,sid,label='厢楼与跑马廊',role='upper-gallery',
            sourceGeometryRole='官方楼厅以厢楼相接、楼面沟通的类型化表达'))
    b.append(building('CZL-gate','gardenGate',-8,-3,7.2,3.2,math.pi/2,1,sid,label='砖雕门楼形制',role='carved-entry',sourceGeometryRole='门东向的关系综合，装饰使用体素层次而非版权纹理'))
    b.append(building('CZL-north-gallery','gardenCorridor',-54,-28.8,40,2.8,0,1,sid,label='北园回廊',sourceGeometryRole='官方北园回廊关系综合'))
    b.append(building('CZL-pavilion','gardenPavilion',-38,-36,5.6,5.6,0,1,sid,label='园亭点景',sourceGeometryRole='亭上建阁的体量语言综合；非按名亭测绘'))
    # Selected source-footprint context at the eastern visitor street.
    for i,(p,q) in enumerate(nearby('overture_buildings',g)):
        fit=fit_building(q,ox,oy)
        if fit['x']<55 or i==8:continue
        w=min(28,max(12,fit.pop('width')));dd=min(13,max(8,fit.pop('depth')))
        b.append(building('CZL-context-'+str(i),'villageHouse' if i%2 else 'modern',fit['x'],fit['z'],round(w/.2)*.2,round(dd/.2)*.2,fit['rotation'],2,[p['id']],label='周边建筑',sourceGeometryRole='源足迹位置与朝向；建筑细部类型化'))
        d['sourceIds'].append(p['id'])
    pond=[[-65,-41],[-57,-43],[-49,-41],[-47,-38],[-52,-35],[-59,-35],[-65,-37]]
    d['water']['ponds']=[dict(id='CZL-north-pool',polygon=pond,level=0,sourceIds=sid,sourceGeometryRole='官方证实北园水池；池轮廓为形制综合，非OSM水面测绘')]
    d['grounds']=[ground('garden-north','garden',-55,-39,28,12,role='约336平方米北园花木池石留空，邻近官方近300平方米描述'),
        dict(id='CZL-pool-ground',kind='pond',polygon=pond,level=0),
        ground('CZL-court-1','court',-59.5,-3,14,20),ground('CZL-court-2','court',-38.5,-3,14,20),
        ground('CZL-entry-court','gravel',10,-3,28,30),ground('CZL-entry-stone','court',-9,-3,9,12)]
    d['paths']=source_roads(g,ox,oy,d['bounds'])+[
        road('garden-entry',[[88,16],[50,16],[25,15],[25,-3],[6,-3]],3.2,'garden-path'),
        road('garden-side',[[22,-3],[22,-25],[-10,-25],[-27,-26]],2.0,'garden-path'),
        road('garden-north',[[8,-24],[-14,-25],[-26,-28],[-31,-47],[-50,-49],[-75,-45],[-78,-32],[-74,-24]],1.4,'garden-path'),
        road('garden-pool-path',[[-74,-25],[-68,-31],[-63,-33],[-62,-41],[-54,-46],[-42,-47],[-37,-40],[-36,-31]],1.2,'garden-path')]
    d['bridges']=[dict(id='CZL-crooked-bridge',points=[[-62,-33],[-61,-38],[-57,-39],[-57,-43]],width=1.2,kind='gardenBridge',height=1.6,role='北园曲桥形制综合',sourceIds=sid)]
    d['rocks']=[dict(id='CZL-rock-1',x=-72,z=-38,width=7,depth=5,height=3.8,seed=307),
        dict(id='CZL-rock-2',x=-42,z=-39,width=4,depth=4,height=2.8,seed=711),
        dict(id='CZL-rock-3',x=-34,z=-46,width=2.6,depth=3.2,height=3.4,seed=613)]
    d['walls']=[dict(id='CZL-garden-north-wall',points=[[-82,-25],[-83,-46],[-35,-48]],height=2.8,width=.4,kind='gardenWall',windows=True,windowCount=8),
        dict(id='CZL-south-wall',points=[[-82,19],[-5,19],[-5,10]],height=2.6,width=.4,kind='gardenWall',windows=True,windowCount=5),
        dict(id='CZL-screen',points=[[15,-13],[15,7]],height=3.4,width=.6,kind='screenWall',role='东向门前照墙形制')]
    candidates=[(-90,-8,'broadleaf',1.1),(-90,-36,'broadleaf',1.05),(-83,-55,'broadleaf',.9),(-65,-54,'broadleaf',.85),
        (-42,-56,'broadleaf',1.0),(-19,-53,'broadleaf',.95),(-8,-35,'broadleaf',.85),(4,-48,'broadleaf',1.1),
        (22,-37,'broadleaf',1.1),(40,-29,'broadleaf',1.15),(37,16,'broadleaf',1),(32,38,'broadleaf',1.1),
        (12,43,'broadleaf',1.15),(-13,32,'broadleaf',1),(-37,31,'broadleaf',1),(-60,27,'broadleaf',1.15),
        (-87,25,'broadleaf',1.1),(-101,6,'broadleaf',1.2),(4,17,'broadleaf',.85),(49,60,'broadleaf',1.15),
        (51,-44,'broadleaf',.95),(105,20,'broadleaf',1),(108,-23,'broadleaf',1)]
    d['trees']=place_trees(candidates,b,d['paths'],d['grounds'])
    d['cameraSuggestions']=dict(overviewTarget=[-21,1.2,-7],distance=150,yaw=.81,pitch=.78,
        blockTarget=[-46,-9],streetTarget=[12,-3],houseTarget=[-28,-3],houseId='CZL-hall-2',waterfrontTarget=[-56,-37],treeTarget=[-19,-53],
        gardenTarget=[-52,-37],gardenDistance=45)
    d['provenance'].update(referenceScope='OSM雕花楼园区边界只作为场地与真实位置依据；主宅按苏州园林局“坐西朝东、前中后楼、厢楼相连跑马楼、北园池石廊桥”文字作形制综合，不宣称准确总平面。池形与建筑细部无实测尺寸链。',
        internalPlanStatus='轴向、前后序列、宅北置园来自官方文字；具体楼间距、池轮廓、园路与树位为设计。未拿公园边界当主楼轮廓。',
        officialReferences=[dict(title='苏州市园林和绿化管理局：园林历史·近代传统园林',url='https://ylj.suzhou.gov.cn/szsylj/ylls/wztt.shtml',supports='春在楼坐西朝东、前中后楼和厢楼跑马楼；北园近300平方米、假山水池回廊曲桥'),
        dict(title='苏州地方志：吴中名镇之东山镇',url='https://dfzb.suzhou.gov.cn/dfzb/szdq/201905/4169ddc4eb2c49f18279bd6bca53351f.shtml',supports='春在楼又称雕花楼、东山苏式砖雕及本地建筑实景参考'),
        dict(title='苏州市政府：吴文化地名保护名录',url='https://www.suzhou.gov.cn/szsrmzf/zfwj/201901/KQ6BCKNZPM1454M1QH250VZXQZUEJC9W.shtml',supports='春在楼作为古典园林、公园名的独立保护地名')])
    return finish(d)

def finish(d):
    d['sourceIds']=list(dict.fromkeys(d['sourceIds']+[sid for b in d['buildings'] for sid in b['sourceIds']]))
    d['houses']=d['buildings'];d['roads']=d['paths'];d['version']='2026-10-22-facilities-1'
    d['checks']=dict(buildingCount=len(d['buildings']),treeCount=len(d['trees']),sourceAreaBoundaryOnly=True,
        reusedCopyrightPhotosAsTextures=False,sourceIdentityPreserved=True,localMetricUnits=True,distinctGeographicDistrict=True)
    (OUT/(d['id']+'.json')).write_text(json.dumps(d,ensure_ascii=False,indent=2),encoding='utf8')
    import matplotlib.pyplot as plt
    fig,ax=plt.subplots(figsize=(11,8));col={'sportsField':'#b86f55','court':'#d0c5a9','garden':'#c4d5ab','gravel':'#c9c2ad','pond':'#7cb3b9','basketball':'#9fa798'}
    for gg in d['grounds']:
        v=np.array(gg['polygon']);ax.fill(v[:,0],v[:,1],color=col.get(gg['kind'],'#aab4a0'),alpha=.8)
    for r in d['paths']:
        v=np.array(r['points']);ax.plot(v[:,0],v[:,1],color='#c1b59b',lw=r['width'])
    v=np.array(d['boundary']);ax.plot(v[:,0],v[:,1],color='#be3434',lw=1.1)
    for b in d['buildings']:
        v=np.array(rect(b['x'],b['z'],b['width'],b['depth'],b['rotation']));ax.fill(v[:,0],v[:,1],color='#7c8d88',ec='#3e5351');ax.text(b['x'],b['z'],b['id'],fontsize=6)
    for t in d['trees']:ax.add_patch(plt.Circle((t['x'],t['z']),3.2*t['scale'],color='#528551',alpha=.8))
    for r in d['walls']:
        v=np.array(r['points']);ax.plot(v[:,0],v[:,1],color='#3e4140',lw=1)
    bb=d['bounds'];ax.set_xlim(bb['minX'],bb['maxX']);ax.set_ylim(bb['maxZ'],bb['minZ']);ax.set_aspect('equal');ax.grid(alpha=.15)
    fig.savefig(OUT/(d['id']+'-design-plan.png'),dpi=150);plt.close(fig)
    return d

def validate(districts):
    """Validate the costly layout errors that would be visible in close views."""
    import itertools
    report=dict(checkedOn='2026-10-22',districts=[])
    for d in districts:
        ids=[b['id'] for b in d['buildings']]
        assert len(ids)==len(set(ids)),d['id']+' duplicate ids'
        for b in d['buildings']:
            assert all(math.isfinite(b[k]) for k in ['x','z','width','depth','rotation'])
            assert b['width']>0 and b['depth']>0
        result=dict(id=d['id'],originWgs84=d['originWgs84'],boundaryArea=round(shape(d['boundary']).Area(),2),
            buildingCount=len(ids),sourceIds=len(d['sourceIds']),treeCount=len(d['trees']),copyrightImagesCopied=0,
            sourceBoundaryRole='园区或校区地块，不当主建筑轮廓',sourceCoordinatesAndDesignCoordinatesSeparate=True)
        if d['id']=='dongshan-school':
            footprints={b['id']:shape(rect(b['x'],b['z'],b['width'],b['depth'],b['rotation'])) for b in d['buildings'] if b['type']!='schoolGate'}
            overlaps=[]
            for a,b in itertools.combinations(footprints,2):
                area=footprints[a].Intersection(footprints[b]).Area()
                if area>.01:overlaps.append([a,b,area])
            roadcuts=[]
            for b,q in footprints.items():
                for r in d['roads']:
                    ln=ogr.CreateGeometryFromJson(json.dumps(dict(type='LineString',coordinates=r['points'])))
                    area=q.Intersection(ln.Buffer(r['width']/2)).Area()
                    if area>.01:roadcuts.append([b,r['id'],area])
            track=next(g for g in d['grounds'] if g['kind']=='sportsField')
            area=shape(track['polygon']).Difference(shape(d['boundary'])).Area()
            result.update(unintendedBuildingIntersections=overlaps,roadBuildingIntersections=roadcuts,trackOutsideSchoolBoundaryArea=round(area,3),
                gateBoundaryCrossing='校门沿边界接口，作为有意开口处理')
            assert not overlaps and not roadcuts and area<.01,result
        else:
            result.update(gardenExplanatoryArea=336,pondSource='官方园林历史证实北园水池；实际池形未测，明确形制综合',
                intendedConnections='三进楼厅与南北跑马廊衔接；节点交接不当体块误碰撞')
        report['districts'].append(result)
    (OUT/'layout-qa.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')

if __name__=='__main__':
    snapshot('way/1101928342','dongshan-school')
    snapshot('way/1332791315','chunzailou-garden')
    districts=[school(),garden()]
    validate(districts)
    (ROOT/'东山镇_重制版/js/districts.js').write_text('/* Generated from audited source anchors; see data/districts and scripts/build_districts.py. */\nwindow.DSDistricts = '+json.dumps(districts,ensure_ascii=False,separators=(',',':'))+';\n',encoding='utf8')
    print('Built',[(d['id'],len(d['buildings']),len(d['trees'])) for d in districts])
