import json,math,heapq
from pathlib import Path
from collections import defaultdict
from osgeo import ogr
ogr.UseExceptions()
ROOT=Path(__file__).resolve().parents[1]
d=json.loads((ROOT/'东山镇_重制版/data/design.json').read_text(encoding='utf-8'))
ox,oy=d['geographic']['originUTM51N']
ds=ogr.Open(str(ROOT/'东山镇_数据/working/dongshan_sources_utm51n.gpkg'))
l=ds.GetLayerByName('osm_roads');l.SetSpatialFilterRect(ox-1200,oy-2000,ox+6500,oy+6000)
ways={}; graph=defaultdict(list)
def key(x,y):return(round(x-ox,2),round(oy-y,2))
for f in l:
 p=json.loads(f.ExportToJson())['properties'];kind=p.get('highway')
 if kind not in ['primary','secondary','tertiary','residential','unclassified','path','footway','service','track']:continue
 g=f.GetGeometryRef();sid=p['id']
 if g.GetGeometryName()!='LINESTRING':continue
 points=[key(*g.GetPoint(i)[:2]) for i in range(g.GetPointCount())]
 ways[sid]={'points':points,'props':p}
 for a,b in zip(points,points[1:]):
  length=math.dist(a,b);cost=length*({'path':2,'footway':1.6,'service':2.4,'track':1.8}.get(kind,1))
  graph[a].append((b,cost,sid));graph[b].append((a,cost,sid))
def nearest(target,sids=None):
 nodes=[p for sid,v in ways.items() if not sids or sid in sids for p in v['points']]
 return min(nodes,key=lambda p:math.dist(p,target))
def route(a,b):
 heap=[(0,a)];dist={a:0};prev={}
 while heap:
  cost,node=heapq.heappop(heap)
  if cost!=dist[node]:continue
  if node==b:break
  for nn,ww,sid in graph[node]:
   nc=cost+ww
   if nc<dist.get(nn,math.inf):dist[nn]=nc;prev[nn]=(node,sid);heapq.heappush(heap,(nc,nn))
 if b not in dist:return None
 seq=[];n=b
 while n!=a:
  pre,sid=prev[n];seq.append((pre,n,sid));n=pre
 seq.reverse();return seq
a=nearest((0,0),{'way/1104698620','way/1104698621'})
b=nearest((3869,-1102),{'way/343590975','way/343590978'})
c=nearest((4146,-434),{'way/1104691356'})
for name,p,q in [('lux-school',a,b),('school-garden',b,c)]:
 r=route(p,q)
 print(name,'start/end',p,q)
 if r:
  ids=list(dict.fromkeys(sid for _,_,sid in r));pts=[r[0][0]]+[v[1] for v in r]
  print('length',sum(math.dist(aa,bb) for aa,bb,_ in r),'bounds',min(x for x,z in pts),min(z for x,z in pts),max(x for x,z in pts),max(z for x,z in pts))
  print('ways',[(sid,ways[sid]['props'].get('name'),ways[sid]['props'].get('highway')) for sid in ids])
 else:print('NO ROUTE')
