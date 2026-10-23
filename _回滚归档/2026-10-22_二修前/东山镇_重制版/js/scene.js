/* Local voxel construction. Geographic G and cartographic C live in design.js;
   the renderer only converts the C plane to east-x / south-z / up-y metres. */
(() => {
'use strict';
const T=window.THREE, D=window.DSDesign, A=window.DSArchitecture, V=window.DSVegetation;
const el=id=>document.getElementById(id), tick=()=>new Promise(r=>requestAnimationFrame(r));
const q=v=>Math.round(v*5)/5, clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function random(seed){return()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
function hash(x,z){let h=Math.imul(x|0,374761393)^Math.imul(z|0,668265263);h=Math.imul(h^h>>>13,1274126177);return((h^h>>>16)>>>0)/4294967296}
const colors=new Map();function color(hex){if(!colors.has(hex)){const c=new T.Color(hex);colors.set(hex,[c.r,c.g,c.b])}return colors.get(hex)}
class BoxBatch{
 constructor(defer=false){this.p=[];this.n=[];this.c=[];this.i=[];this.boxes=0;this.defer=defer;this.solids=[];this.meshStats=[]}
 quad(a,b,c,d,n,hex,shade=1){const index=this.p.length/3,co=color(hex);for(const p of[a,b,c,d]){this.p.push(...p);this.n.push(...n);this.c.push(co[0]*shade,co[1]*shade,co[2]*shade)}this.i.push(index,index+1,index+2,index,index+2,index+3)}
 box(x,y,z,w,h,d,hex=0xffffff){if(w<=0||h<=0||d<=0)return;this.boxes++;if(this.defer){this.solids.push({x,y,z,w,h,d,color:hex});return}const x0=x-w/2,x1=x+w/2,y0=y-h/2,y1=y+h/2,z0=z-d/2,z1=z+d/2;
 this.quad([x1,y0,z0],[x1,y1,z0],[x1,y1,z1],[x1,y0,z1],[1,0,0],hex,.96);
 this.quad([x0,y0,z1],[x0,y1,z1],[x0,y1,z0],[x0,y0,z0],[-1,0,0],hex,.94);
 this.quad([x0,y1,z1],[x1,y1,z1],[x1,y1,z0],[x0,y1,z0],[0,1,0],hex,1.06);
 this.quad([x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1],[0,-1,0],hex,.78);
 this.quad([x1,y0,z1],[x1,y1,z1],[x0,y1,z1],[x0,y0,z1],[0,0,1],hex,1);
 this.quad([x0,y0,z0],[x0,y1,z0],[x1,y1,z0],[x1,y0,z0],[0,0,-1],hex,.94)}
 geometry(quantum=.2){if(this.defer){this.p=[];this.n=[];this.c=[];this.i=[];const result=window.DSMeshing.build(this.solids,{quantum});this.meshStats.push(result.stats);for(const f of result.faces){const n=f.n,shade=n[1]>.5?1.06:n[1]<-.5?.78:n[0]>.5?.96:n[0]<-.5?.94:n[2]<-.5?.94:1;this.quad(f.a,f.b,f.c,f.d,n,f.color,shade)}}const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(this.p,3));g.setAttribute('normal',new T.Float32BufferAttribute(this.n,3));g.setAttribute('color',new T.Float32BufferAttribute(this.c,3));g.setIndex(this.i);g.computeBoundingSphere();return g}
}
const state={ready:false,errors:[],version:'2026-10-20-remake',assets:[],treeAssets:[],view:'waterfront',detailGrid:.2,terrainFaces:0};
window.DSRemake=state;
let renderer,scene,camera,sun,hemi,world,terrainGroup,houseGroup,treeGroup,waterGroup,mat,shadowPending=true;
let dirty=true,frame=0,last=0,tween=null;
const treeChunks=[];
const bounds=D&&D.bounds||{minX:-190,maxX:390,minZ:-280,maxZ:280};
const control={target:new T.Vector3(60,8,0),yaw:-1.0,pitch:.38,distance:180};
const keys=new Set();
let houses=[],trees=[],roads=[],canals=[],shore=[],padIndex=new Map(),waterCells,gridH,gw,gh,groundMinX,groundMinZ;
function setLoading(t){el('loadingText').textContent=t}
function makeMaterial(){const m=new T.MeshLambertMaterial({vertexColors:true});m.onBeforeCompile=s=>{
 s.vertexShader='varying vec3 vCraftPosition; varying vec3 vCraftNormal;\n'+s.vertexShader;
 s.vertexShader=s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvCraftPosition=position;vCraftNormal=normal;');
 s.fragmentShader='varying vec3 vCraftPosition; varying vec3 vCraftNormal;\n'+s.fragmentShader;
 s.fragmentShader=s.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
 vec3 cp=vCraftPosition*5.0; vec3 cn=abs(vCraftNormal);
 vec2 uv=cn.y>.5?cp.xz:(cn.x>.5?cp.zy:cp.xy);
 vec2 footprint=fwidth(uv); vec2 cell=abs(fract(uv+.5)-.5);
 vec2 edge=smoothstep(vec2(.465)-footprint,vec2(.5),cell);
 float visible=1.0-smoothstep(.25,.85,max(footprint.x,footprint.y));
 float joint=max(edge.x,edge.y)*visible;
 float grain=fract(sin(dot(floor(cp),vec3(12.9898,78.233,37.719)))*43758.5453);
 diffuseColor.rgb*=1.0-.055*joint+(grain-.5)*.045*visible;
 `);
 };return m}
function rawHeight(x,z){
 const g=D.terrain&&D.terrain.grid;if(!g||!g.values)return Math.max(.8,(x+140)*.045);
 const fx=clamp((x-g.minX)/g.step,0,g.cols-1),fz=clamp((z-g.minZ)/g.step,0,g.rows-1),ix=Math.floor(fx),iz=Math.floor(fz),jx=Math.min(ix+1,g.cols-1),jz=Math.min(iz+1,g.rows-1),tx=fx-ix,tz=fz-iz;
 const a=g.values[iz*g.cols+ix]*(1-tx)+g.values[iz*g.cols+jx]*tx,b=g.values[jz*g.cols+ix]*(1-tx)+g.values[jz*g.cols+jx]*tx;
 return Math.max(.8,a*(1-tz)+b*tz)}
function shoreAt(z){if(!shore.length)return-140;let a=shore[0];for(let i=1;i<shore.length;i++){const b=shore[i];if(z<=b[1]){const t=clamp((z-a[1])/(b[1]-a[1]||1),0,1);return a[0]+(b[0]-a[0])*t}a=b}return a[0]}
function lineDistance(x,z,points){let best=Infinity,px=x,pz=z,t=0,segment=0;for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],dx=b[0]-a[0],dz=b[1]-a[1],u=clamp(((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1),0,1),cx=a[0]+u*dx,cz=a[1]+u*dz,ds=(x-cx)**2+(z-cz)**2;if(ds<best){best=ds;px=cx;pz=cz;t=u;segment=i-1}}return{distance:Math.sqrt(best),x:px,z:pz,t,segment}}
function inside(x,z,polygon){let yes=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])yes=!yes}return yes}
function designHeight(x,z){let y=rawHeight(x,z);const terr=D.designTerraces;
 if(!terr)return y;
 const core=terr.core;if(core&&core.polygon){const target=Math.round(clamp(core.shoreHeight+core.inlandSlope*Math.max(0,x-shoreAt(z)-12),core.minHeight,core.maxHeight)/core.quantum)*core.quantum;
 if(inside(x,z,core.polygon))y=target;else{const points=core.polygon.concat([core.polygon[0]]),dist=lineDistance(x,z,points).distance,t=clamp(dist/core.blendWidth,0,1);y=target*(1-t*t*(3-2*t))+y*t*t*(3-2*t)}}
 const bank=terr.canalBanks;if(bank){let dist=Infinity;for(const c of canals)dist=Math.min(dist,lineDistance(x,z,c.points).distance);if(dist<bank.halfWidth+bank.blendWidth){const target=Math.round(Math.min(bank.maxHeight,bank.shoreHeight+bank.inlandSlope*Math.max(0,x-shoreAt(z)))/bank.quantum)*bank.quantum,t=clamp((dist-bank.halfWidth)/bank.blendWidth,0,1);y=Math.min(y,target*(1-t)+y*t)}}
 return Math.max(.8,y)}
function localOf(h,x,z){const c=Math.cos(h.rotation||0),s=Math.sin(h.rotation||0),dx=x-h.x,dz=z-h.z;return[c*dx-s*dz,s*dx+c*dz]}
function bucket(x,z){return`${Math.floor(x/24)},${Math.floor(z/24)}`}
function indexPad(h){const r=Math.hypot(h.padW,h.padD)/2+4;for(let x=Math.floor((h.x-r)/24);x<=Math.floor((h.x+r)/24);x++)for(let z=Math.floor((h.z-r)/24);z<=Math.floor((h.z+r)/24);z++){const k=`${x},${z}`;if(!padIndex.has(k))padIndex.set(k,[]);padIndex.get(k).push(h)}}
function heightAt(x,z){
 const coast=shoreAt(z),coastDist=x-coast;
 if(coastDist<0)return-.8;
 for(const c of canals){const near=lineDistance(x,z,c.points);if(near.distance<c.width/2)return-.6}
 let y=designHeight(x,z);y=Math.min(y,.8+coastDist*.36);
 const list=padIndex.get(bucket(x,z))||[];
 for(const h of list){const[a,b]=localOf(h,x,z),dx=Math.abs(a)-h.padW/2,dz=Math.abs(b)-h.padD/2,m=Math.max(dx,dz);if(m<0)return h.baseY;if(m<2.2){const t=clamp(m/2.2,0,1);y=h.baseY*(1-t)+y*t}}
 let rd=Infinity,ry=y;for(const r of roads){const near=lineDistance(x,z,r.points);if(near.distance<r.width/2+1.4&&near.distance<rd){rd=near.distance;ry=designHeight(near.x,near.z);ry=Math.min(ry,.8+(near.x-shoreAt(near.z))*.36);if(near.distance<r.width/2)y=ry;else y=ry*(1-(near.distance-r.width/2)/1.4)+y*(near.distance-r.width/2)/1.4}}
 return q(Math.round(Math.max(.8,y)/.4)*.4)
}
function groundAt(x,z){if(!gridH)return heightAt(x,z);const ix=clamp(Math.floor(x-groundMinX),0,gw-1),iz=clamp(Math.floor(z-groundMinZ),0,gh-1);return gridH[iz*gw+ix]}
function roadAt(x,z){for(const r of roads){if(lineDistance(x,z,r.points).distance<r.width/2)return r}return null}
function canalNear(x,z,d=1.7){for(const c of canals){const near=lineDistance(x,z,c.points);if(near.distance<c.width/2+d)return true}return false}
function groundColor(x,z,y){const c=x-shoreAt(z);if(c<2.2||canalNear(x,z))return hash(Math.floor(x/3),Math.floor(z/3))>.5?0xaaa997:0x989d8d;
 const r=roadAt(x,z);if(r)return r.kind==='main'?0xa9aaa0:0xb7b5a2;
 for(const h of padIndex.get(bucket(x,z))||[]){const[a,b]=localOf(h,x,z);if(Math.abs(a)<h.padW/2+1&&Math.abs(b)<h.padD/2+1)return 0xb4b3a1}
 for(const c of D.compounds||[])if(inside(x,z,c.polygon))return 0xb0b29e;
 const v=hash(Math.floor(x/16),Math.floor(z/16));if(coverAt(x,z)===10)return v>.6?0x587950:0x608254;if(x>220||y>24)return v>.72?0x658255:v>.32?0x6a8958:0x718e5b;return v>.75?0x799862:v>.3?0x73945d:0x6d8d59}
function coverAt(x,z){const m=D.designForestMask;if(!m)return 0;const ix=Math.round((x-m.minX)/m.step),iz=Math.round((z-m.minZ)/m.step);return ix<0||iz<0||ix>=m.cols||iz>=m.rows?0:m.values[iz*m.cols+ix]}
function addForest(){if(!D.designForestMask)return;const rng=random(7739),candidates=[];for(let z=bounds.minZ+9;z<bounds.maxZ-9;z+=10.4)for(let x=bounds.minX+9;x<bounds.maxX-9;x+=10.4){const xx=x+(rng()-.5)*6,zz=z+(rng()-.5)*6;if(coverAt(xx,zz)!==10||xx<shoreAt(zz)+8)continue;if(inside(xx,zz,D.designTerraces.core.polygon)&&rng()>.18)continue;const t={x:q(xx),z:q(zz),type:'broadleaf',seed:Math.floor(rng()*100000),scale:rng()>.6?1.2:1,background:true};if(!treeClear(t)||trees.some(t0=>(t0.x-t.x)**2+(t0.z-t.z)**2<28))continue;candidates.push(t)}
 candidates.sort((a,b)=>hash(a.seed,7)-hash(b.seed,7));trees.push(...candidates.slice(0,1050));state.forestTreeCount=Math.min(1050,candidates.length);state.forestRule='WorldCover 2021 class 10, inverse G/C lookup; schematic crown locations, full voxel assets'}
async function buildTerrain(){
 groundMinX=Math.floor(bounds.minX);groundMinZ=Math.floor(bounds.minZ);gw=Math.ceil(bounds.maxX-groundMinX);gh=Math.ceil(bounds.maxZ-groundMinZ);gridH=new Float32Array(gw*gh);waterCells=0;
 for(let z=0;z<gh;z++){for(let x=0;x<gw;x++){const h=heightAt(groundMinX+x+.5,groundMinZ+z+.5);gridH[z*gw+x]=h;if(h<0)waterCells++}if(z%32===0){setLoading(`铺设方阶地表 · ${Math.round(z/gh*100)}%`);await tick()}}
 const size=48;for(let z0=0;z0<gh;z0+=size){for(let x0=0;x0<gw;x0+=size){const b=new BoxBatch(),xEnd=Math.min(gw,x0+size),zEnd=Math.min(gh,z0+size);
 for(let z=z0;z<zEnd;z++){let x=x0;while(x<xEnd){const h=gridH[z*gw+x];if(h<0){x++;continue}const xx=groundMinX+x,zz=groundMinZ+z,co=groundColor(xx+.5,zz+.5,h);let end=x+1;while(end<xEnd&&gridH[z*gw+end]===h&&groundColor(groundMinX+end+.5,zz+.5,h)===co)end++;
 b.quad([xx,h,zz+1],[groundMinX+end,h,zz+1],[groundMinX+end,h,zz],[xx,h,zz],[0,1,0],co);x=end}
 for(let x=x0;x<xEnd;x++){const h=gridH[z*gw+x];if(h<0)continue;const xx=groundMinX+x,zz=groundMinZ+z;
 for(const[dx,dz]of[[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,nz=z+dz,nh=nx<0||nx>=gw||nz<0||nz>=gh?-1:gridH[nz*gw+nx];if(nh>=h-.01)continue;const low=Math.max(-1,nh),co=(h<3.6||nh<0||roadAt(xx+.5,zz+.5)||canalNear(xx+.5,zz+.5))?0x999d8c:0x9a9a72;
 if(dx===1)b.quad([xx+1,low,zz],[xx+1,h,zz],[xx+1,h,zz+1],[xx+1,low,zz+1],[1,0,0],co,.96);
 if(dx===-1)b.quad([xx,low,zz+1],[xx,h,zz+1],[xx,h,zz],[xx,low,zz],[-1,0,0],co,.96);
 if(dz===1)b.quad([xx+1,low,zz+1],[xx+1,h,zz+1],[xx,h,zz+1],[xx,low,zz+1],[0,0,1],co);
 if(dz===-1)b.quad([xx,low,zz],[xx,h,zz],[xx+1,h,zz],[xx+1,low,zz],[0,0,-1],co,.94)} }
 }
 if(b.p.length){const geometry=b.geometry(),m=new T.Mesh(geometry,mat);m.receiveShadow=true;terrainGroup.add(m);state.terrainFaces+=b.i.length/6}
 }await tick()}
}
function makeMesh(b,group,position,rotation=0){const g=b.geometry(),m=new T.Mesh(g,mat);if(position)m.position.set(...position);m.rotation.y=rotation;m.castShadow=true;m.receiveShadow=true;group.add(m);return m}
function buildWater(){
 const width=bounds.maxX-bounds.minX,depth=bounds.maxZ-bounds.minZ;
 const water=new T.Mesh(new T.PlaneGeometry(width+12,depth+12),new T.MeshPhongMaterial({color:0x6c9da1,specular:0xc2cbb1,shininess:65}));water.rotation.x=-Math.PI/2;water.position.set((bounds.minX+bounds.maxX)/2,0,(bounds.minZ+bounds.maxZ)/2);water.receiveShadow=true;waterGroup.add(water);
 const ripple=new BoxBatch(),rng=random(2718);for(let i=0;i<1100;i++){const z=bounds.minZ+rng()*depth,x=bounds.minX+rng()*Math.max(10,shoreAt(z)-bounds.minX-2);if(x>shoreAt(z)-1)continue;ripple.box(q(x),.025,q(z),q(1+rng()*4),.02,.08,rng()>.5?0xa6c0b4:0x96b7ac)}
 const rm=new T.Mesh(ripple.geometry(),new T.MeshBasicMaterial({vertexColors:true,transparent:true,opacity:.32,depthWrite:false}));waterGroup.add(rm);
}
function buildBridge(b){const batch=new BoxBatch(),len=b.length||9,w=b.width||4,base=Math.max(1.0,designHeight(b.x,b.z));const deck=q(Math.max(base,1.4));
 batch.box(0,deck-.2,0,len,.4,w,0xb1b1a1);for(let i=0;i<5;i++){const top=deck-.2*(i+1),height=Math.max(.2,top-.6),xx=len/2+.3+i*.6;for(const sign of[-1,1])batch.box(sign*xx,.6+height/2,0,.6,height,w,0xa5a89a)}
 for(const z of[-w/2+.2,w/2-.2]){batch.box(0,deck+.7,z,len,.2,.2,0x858f80);for(let x=-len/2+.4;x<len/2;x+=1.8)batch.box(x,deck+.5,z,.2,1,.2,0x929a8b)}
 for(const x of[-len*.32,len*.32])batch.box(x,deck/2-.1,0,.6,deck+.2,w-.4,0x919a8c);
 return makeMesh(batch,world,[b.x,0,b.z],b.rotation||0)
}
async function buildHouses(){for(let i=0;i<houses.length;i++){const h=houses[i],b=new BoxBatch(true),asset=A.build(b,h);h.asset=asset;const m=makeMesh(b,houseGroup,[h.x,h.baseY,h.z],h.rotation||0);m.userData={kind:'house',id:h.id};h.mesh=m;state.assets.push({id:h.id,type:h.type,boxes:b.boxes,width:asset.width,depth:asset.depth,height:asset.height,bounds:asset.bounds,baseY:h.baseY,meshing:b.meshStats[0],sourceIds:h.sourceIds||[]});if(i%5===0){setLoading(`构筑完整房院 · ${i+1} / ${houses.length}`);await tick()}}}
function treeClear(t){if(groundAt(t.x,t.z)<.1)return false;for(const h of houses){const[a,b]=localOf(h,t.x,t.z);if(Math.abs(a)<h.padW/2+3.2&&Math.abs(b)<h.padD/2+3.2)return false}for(const r of roads)if(lineDistance(t.x,t.z,r.points).distance<r.width/2+2)return false;return !canalNear(t.x,t.z,2)}
async function buildTrees(){const groups=new Map(),templates=new Map();for(const t of trees){if(!treeClear(t)){state.rejectedTrees=(state.rejectedTrees||0)+1;continue}const variant=(t.seed||1)%6,scale=Math.round((t.scale||1)*10)/10,template=`${t.type||'broadleaf'}:${variant}:${scale}`,k=`${template}:${Math.floor(t.x/96)}:${Math.floor(t.z/96)}`;if(!groups.has(k))groups.set(k,{template,list:[]});groups.get(k).list.push(t)}
 let n=0;for(const[k,{template,list}]of groups){let cache=templates.get(template);if(!cache){const[type,v,scale]=template.split(':'),b=new BoxBatch(true),asset=V.build(b,{type,seed:137+Number(v)*71,scale:Number(scale)});cache={asset,near:b.geometry(.2),far:b.geometry(.4)};state.treeAssets.push({type,variant:template,boxes:b.boxes,height:asset.height,radius:asset.radius,meshing:b.meshStats});templates.set(template,cache)}
 const near=new T.InstancedMesh(cache.near,mat,list.length),far=new T.InstancedMesh(cache.far,mat,list.length),dummy=new T.Object3D();near.castShadow=far.castShadow=true;near.receiveShadow=far.receiveShadow=true;for(let i=0;i<list.length;i++){const t=list[i];t.baseY=groundAt(t.x,t.z);t.asset=cache.asset;dummy.position.set(t.x,t.baseY,t.z);dummy.rotation.y=((t.seed||1)%4)*Math.PI/2;dummy.updateMatrix();t.matrix=dummy.matrix.clone();t.lod=0;near.setMatrixAt(i,t.matrix);far.setMatrixAt(i,t.matrix)}near.computeBoundingSphere();far.computeBoundingSphere();near.userData={kind:'trees',chunk:k,lod:'full'};far.userData={kind:'trees',chunk:k,lod:'far'};far.count=0;treeGroup.add(near,far);treeChunks.push({near,far,list});n+=list.length;if(n%40<list.length){setLoading(`生长枝叶 · ${n} 株`);await tick()}}
 state.treeCount=n;state.treeChunkCount=treeChunks.length;state.treeLODPolicy='0.2m full geometry; 0.4m union only when 0.2m displacement projects below 0.85 physical pixels, with hysteresis. 96m spatial culling.'}
function updateTreeLOD(){const proj=window.innerHeight*renderer.getPixelRatio()/(2*Math.tan(camera.fov*Math.PI/360)),threshold=Math.max(260,.2*proj/.85);let nn=0,nf=0;for(const c of treeChunks){let ni=0,fi=0;for(const t of c.list){const dist=Math.hypot(t.x-camera.position.x,t.baseY+5-camera.position.y,t.z-camera.position.z);t.lod=dist<(t.lod?threshold:threshold*1.08)?0:1;if(t.lod){c.far.setMatrixAt(fi++,t.matrix)}else c.near.setMatrixAt(ni++,t.matrix)}c.near.count=ni;c.far.count=fi;c.near.instanceMatrix.needsUpdate=true;c.far.instanceMatrix.needsUpdate=true;nn+=ni;nf+=fi}state.treeLODCounts={full:nn,far:nf,thresholdMetres:Math.round(threshold)}}
function buildStreetDetail(){const b=new BoxBatch();for(const h of houses){const c=Math.cos(h.rotation||0),s=Math.sin(h.rotation||0),w=h.width||12,d=h.depth||8;if(h.type==='courtyard')continue;const pz=d/2+1.4,xx=h.x+s*pz,zz=h.z+c*pz,y=groundAt(xx,zz);if(y<0||Math.abs(y-h.baseY)>1)continue;
 // Door-side stone seat and two small earthen pots. These remain separate from the opening.
 const x0=h.x+c*(-w/2+.7)+s*pz,z0=h.z-s*(-w/2+.7)+c*pz;
 b.box(q(x0),y+.2,q(z0),.8,.4,.6,0x9ca494);
 if((h.seed||1)%3===0){b.box(q(x0+.8),y+.3,q(z0),.4,.6,.4,0x9d8662);b.box(q(x0+.8),y+.7,q(z0),.6,.4,.6,0x6f8a50)} }
 // Stone paving joints belong to the close pedestrian surface, not to a painted macro grid.
 for(const r of roads){if(r.kind==='main')continue;for(let i=1;i<r.points.length;i++){const a=r.points[i-1],c=r.points[i],dx=c[0]-a[0],dz=c[1]-a[1],len=Math.hypot(dx,dz);for(let t=0;t<len;t+=1.6){const x=a[0]+dx*t/len,z=a[1]+dz*t/len,y=groundAt(x,z);if(y<0)continue;const width=r.width*.72;if(Math.abs(dx)>Math.abs(dz))b.box(q(x),y+.012,q(z),.08,.02,q(width),0xa1a28e);else b.box(q(x),y+.012,q(z),q(width),.02,.08,0xa1a28e)}}}
 makeMesh(b,world);(D.bridges||[]).forEach(buildBridge)
}
function addOrientedBox(batch,cx,cy,cz,w,h,d,angle,hex){const base=new BoxBatch();base.box(0,0,0,w,h,d,hex);const co=Math.cos(angle),si=Math.sin(angle),offset=batch.p.length/3;for(let i=0;i<base.p.length;i+=3){const x=base.p[i],y=base.p[i+1],z=base.p[i+2];batch.p.push(cx+co*x+si*z,cy+y,cz-si*x+co*z);const nx=base.n[i],ny=base.n[i+1],nz=base.n[i+2];batch.n.push(co*nx+si*nz,ny,-si*nx+co*nz)}batch.c.push(...base.c);for(const i of base.i)batch.i.push(offset+i);batch.boxes++}
function buildYardWalls(){const b=new BoxBatch();for(const wall of D.courtyardWalls||[]){for(let i=1;i<wall.points.length;i++){const a=wall.points[i-1],c=wall.points[i],dx=c[0]-a[0],dz=c[1]-a[1],len=Math.hypot(dx,dz),n=Math.max(1,Math.ceil(len/2)),angle=-Math.atan2(dz,dx),width=wall.thickness||.4,height=wall.height||2;
 for(let j=0;j<n;j++){const t=(j+.5)/n,x=a[0]+dx*t,z=a[1]+dz*t,y=groundAt(x,z);if(y<0)continue;addOrientedBox(b,x,y+.2,z,len/n+.02,.4,width,angle,0x9ba18c);addOrientedBox(b,x,y+.4+(height-.4)/2,z,len/n+.02,height-.4,width,angle,0xd5d4bf);addOrientedBox(b,x,y+height+.1,z,len/n+.04,.2,width+.2,angle,0x657775)} }}makeMesh(b,world);state.yardWallSegments=(D.courtyardWalls||[]).length}
const viewLabels={waterfront:['湖岸入村','石岸、灰瓦与山前街巷'],street:['巷间见山','完整房屋构成街墙，巷道留出行走的尺度'],house:['一座民居','层瓦、檐椽、墙厚与门窗进深'],court:['院落有空','主屋与配屋之间，留下真正的天井'],tree:['枝叶之间','阶梯枝干承托叶簇，冠层留有透空'],overview:['山湖之间','西湖东山，经过选择与编排的连续街村']};
const views={};
function makeViews(){const ordinary=houses.find(h=>h.id===(D.cameraSuggestions&&D.cameraSuggestions.houseId))||houses.find(h=>h.type==='house')||houses[0];const court=houses.find(h=>h.type==='courtyard')||ordinary;
 const west=houses.reduce((a,b)=>a.x<b.x?a:b),mid={x:houses.reduce((s,h)=>s+h.x,0)/houses.length,z:houses.reduce((s,h)=>s+h.z,0)/houses.length};
 views.waterfront={target:[34,5,42],yaw:-1.12,pitch:.30,distance:180};
 const st=D.views&&D.views.street;views.street=st?{target:st.target,yaw:st.yaw,pitch:st.pitch,distance:st.distance}:{target:[ordinary.x,ordinary.baseY+3,ordinary.z+2],yaw:-.35,pitch:.24,distance:80};
 // Choose an unobstructed, sunlit front corner in the continuous scene.
 let hero=ordinary,heroAngle=(ordinary.rotation||0)-.64,heroScore=Infinity;
 for(const h of houses.filter(h=>h.type==='house'&&h.width>=11&&h.floors===2)){for(const offset of[-.65,.65]){const angle=h.rotation+offset,distance=Math.max(30,h.width*2.35),cx=h.x+Math.sin(angle)*distance,cz=h.z+Math.cos(angle)*distance;let score=0;
 for(const n of houses){if(n===h)continue;const near=lineDistance(n.x,n.z,[[cx,cz],[h.x,h.z]]);if(near.t>.02&&near.t<.87&&near.distance<Math.hypot(n.width,n.depth)*.45)score+=100}
 for(const t of trees){const near=lineDistance(t.x,t.z,[[cx,cz],[h.x,h.z]]);if(near.t>.03&&near.t<.9&&near.distance<3.6)score+=35}
 score+=(1-(-.71*Math.sin(angle)+.70*Math.cos(angle)))*12+Math.abs(h.width-14);
 if(score<heroScore){heroScore=score;hero=h;heroAngle=angle}}
 }
 views.house={target:[hero.x,hero.baseY+4,hero.z],yaw:heroAngle,pitch:.28,distance:Math.max(30,hero.width*2.35)};
 views.street={target:[hero.x+10,hero.baseY+3,hero.z-9],yaw:heroAngle-.25,pitch:.13,distance:76};
 views.court={target:[court.x,court.baseY+3,court.z],yaw:-.57+(court.rotation||0),pitch:.67,distance:67};
 let heroTree=null,treeAngle=-1.1,treeScore=Infinity;for(const t of trees.filter(t=>t.asset&&!t.background&&['willow','broadleaf'].includes(t.type))){for(const angle of[-1.6,-1.0,-.4,.5,1.2,2.1]){const dist=34,cx=t.x+Math.sin(angle)*dist,cz=t.z+Math.cos(angle)*dist;let score=t.type==='willow'?0:3;
 for(const n of trees){if(n===t)continue;const near=lineDistance(n.x,n.z,[[cx,cz],[t.x,t.z]]);if(near.t>.01&&near.t<.91&&near.distance<5.4)score+=40}
 for(const h of houses){const near=lineDistance(h.x,h.z,[[cx,cz],[t.x,t.z]]);if(near.t>.02&&near.t<.9&&near.distance<Math.hypot(h.width,h.depth)*.48)score+=100}
 if(groundAt(cx,cz)>t.baseY+2)score+=100;score+=Math.abs(angle+1.1);if(score<treeScore){treeScore=score;heroTree=t;treeAngle=angle}
 }}if(heroTree)views.tree={target:[heroTree.x,heroTree.baseY+heroTree.asset.height*.50,heroTree.z],yaw:treeAngle,pitch:.11,distance:34};else views.tree=views.house;
 views.overview={target:[mid.x,15,mid.z],yaw:-.95,pitch:.76,distance:410};
 state.heroHouse=hero.id;state.heroTree=heroTree?{x:heroTree.x,z:heroTree.z,type:heroTree.type}:null;state.views=views;
}
function view(name,instant=false){if(!views[name])return;const v=views[name];state.view=name;if(instant){control.target.set(...v.target);control.yaw=v.yaw;control.pitch=v.pitch;control.distance=v.distance;tween=null}else{tween={from:{target:control.target.clone(),yaw:control.yaw,pitch:control.pitch,distance:control.distance},to:v,t:0}}
 document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===name));const ids=Object.keys(viewLabels),labels=viewLabels[name];el('viewNumber').textContent=`0${ids.indexOf(name)+1} / 06`;el('viewTitle').textContent=labels[0];el('viewDesc').textContent=labels[1];dirty=true}
function updateCamera(){const cp=Math.cos(control.pitch),sp=Math.sin(control.pitch);camera.position.set(control.target.x+Math.sin(control.yaw)*cp*control.distance,control.target.y+sp*control.distance,control.target.z+Math.cos(control.yaw)*cp*control.distance);camera.lookAt(control.target);camera.updateMatrixWorld()}
function lighting(value){const t=value/100,elv=Math.sin(Math.PI*(.12+t*.75)),warm=Math.abs(t-.5)*2;hemi.color.setHex(0xe0e6d2);hemi.groundColor.setHex(0x77876c);hemi.intensity=1.55-warm*.20;sun.color.setRGB(1,.96-warm*.13,.86-warm*.21);sun.intensity=2.4;sun.position.set(-170+100*(t-.5),85+elv*115,160-100*(t-.5));scene.background=new T.Color().setRGB(.65+warm*.08,.76-warm*.025,.77-warm*.065);scene.fog.color.copy(scene.background);el('lightLabel').textContent=value<32?'清晨':value>75?'薄暮':'午后';shadowPending=true;dirty=true}
function bind(){
 document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>view(b.dataset.view)));
 el('resetView').onclick=()=>view(state.view);el('infoToggle').onclick=()=>el('info').showModal();el('closeInfo').onclick=()=>el('info').close();el('info').addEventListener('click',e=>{if(e.target===el('info'))el('info').close()});el('hideUi').onclick=()=>document.body.classList.toggle('bare');el('daylight').oninput=e=>lighting(Number(e.target.value));
 let down=null;const canvas=renderer.domElement;canvas.addEventListener('contextmenu',e=>e.preventDefault());canvas.addEventListener('pointerdown',e=>{if(el('info').open)return;down={x:e.clientX,y:e.clientY,button:e.button,shift:e.shiftKey};canvas.setPointerCapture(e.pointerId);tween=null});canvas.addEventListener('pointerup',()=>down=null);canvas.addEventListener('pointercancel',()=>down=null);
 canvas.addEventListener('pointermove',e=>{if(!down)return;const dx=e.clientX-down.x,dy=e.clientY-down.y;if(down.button===2||e.shiftKey){const scale=control.distance*.001;control.target.x+=(-Math.cos(control.yaw)*dx-Math.sin(control.yaw)*dy)*scale;control.target.z+=(Math.sin(control.yaw)*dx-Math.cos(control.yaw)*dy)*scale}else{control.yaw-=dx*.004;control.pitch=clamp(control.pitch+dy*.003,.04,1.46)}down.x=e.clientX;down.y=e.clientY;dirty=true});
 canvas.addEventListener('wheel',e=>{e.preventDefault();tween=null;control.distance=clamp(control.distance*Math.exp(e.deltaY*.001),8,850);dirty=true},{passive:false});
 canvas.addEventListener('dblclick',e=>{const ray=new T.Raycaster();ray.setFromCamera(new T.Vector2(e.clientX/window.innerWidth*2-1,1-e.clientY/window.innerHeight*2),camera);const hit=ray.intersectObjects([terrainGroup,houseGroup,treeGroup],true)[0];if(hit){tween=null;control.target.copy(hit.point);control.distance=clamp(control.distance*.42,18,80);dirty=true}});
 window.addEventListener('keydown',e=>{if(e.target.tagName==='INPUT'||el('info').open)return;keys.add(e.code);if(e.code==='KeyH')document.body.classList.toggle('bare');const index=Number(e.key)-1;if(index>=0&&index<6)view(Object.keys(viewLabels)[index]);if(['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE','Space'].includes(e.code))e.preventDefault()});window.addEventListener('keyup',e=>keys.delete(e.code));window.addEventListener('blur',()=>keys.clear());
 window.addEventListener('resize',resize)
}
function resize(){renderer.setSize(window.innerWidth,window.innerHeight,false);camera.aspect=window.innerWidth/window.innerHeight;camera.updateProjectionMatrix();dirty=true}
function render(now){requestAnimationFrame(render);const dt=Math.min(.05,(now-last)/1000||.016);last=now;
 if(tween){tween.t=Math.min(1,tween.t+dt/1.1);const t=tween.t*tween.t*(3-2*tween.t),f=tween.from,to=tween.to;control.target.copy(f.target).lerp(new T.Vector3(...to.target),t);control.yaw=f.yaw+(to.yaw-f.yaw)*t;control.pitch=f.pitch+(to.pitch-f.pitch)*t;control.distance=f.distance+(to.distance-f.distance)*t;if(tween.t>=1)tween=null;dirty=true}
 let mx=0,mz=0,my=0;if(keys.has('KeyW'))mz--;if(keys.has('KeyS'))mz++;if(keys.has('KeyA'))mx--;if(keys.has('KeyD'))mx++;if(keys.has('KeyQ'))my--;if(keys.has('KeyE'))my++;
 if(mx||mz||my){tween=null;const step=dt*Math.max(6,control.distance*.25)*(keys.has('ShiftLeft')?3:1);control.target.x+=(mx*Math.cos(control.yaw)+mz*Math.sin(control.yaw))*step;control.target.z+=(-mx*Math.sin(control.yaw)+mz*Math.cos(control.yaw))*step;control.target.y+=my*step;dirty=true}
 if(dirty){updateCamera();updateTreeLOD();if(shadowPending){renderer.shadowMap.needsUpdate=true;shadowPending=false}renderer.render(scene,camera);dirty=false;frame++;state.lastRender={drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures}}
}
async function init(){if(!T||!D||!A||!V)throw new Error('本地模块未完整载入，请保留整个重制版目录。');
 renderer=new T.WebGLRenderer({canvas:el('scene'),antialias:true,powerPreference:'high-performance',preserveDrawingBuffer:true});renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.5));renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;renderer.shadowMap.autoUpdate=false;
 scene=new T.Scene();scene.fog=new T.Fog(0xc1cfc4,310,920);camera=new T.PerspectiveCamera(45,1,.2,1600);hemi=new T.HemisphereLight(0xe0e6d2,0x8e997e,2);scene.add(hemi);sun=new T.DirectionalLight(0xffedd2,2.25);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-230;sun.shadow.camera.right=230;sun.shadow.camera.top=230;sun.shadow.camera.bottom=-230;sun.shadow.camera.near=1;sun.shadow.camera.far=750;sun.shadow.bias=-.00015;sun.shadow.normalBias=.12;sun.shadow.radius=2;sun.target.position.set(80,0,0);scene.add(sun,sun.target);
 world=new T.Group();scene.add(world);terrainGroup=new T.Group();houseGroup=new T.Group();treeGroup=new T.Group();waterGroup=new T.Group();world.add(terrainGroup,houseGroup,treeGroup,waterGroup);mat=makeMaterial();
 houses=D.houses.map(h=>({...h}));trees=D.trees.map(t=>({...t}));roads=D.roads||[];canals=D.water.canals||[];shore=D.water.shore;
 for(const h of houses){h.padW=(h.width||(h.type==='courtyard'?28:12))+2;h.padD=(h.depth||(h.type==='courtyard'?24:8))+2;h.baseY=q(Math.round(Math.min(designHeight(h.x,h.z),.8+(h.x-shoreAt(h.z))*.36)/.4)*.4);h.baseY=Math.max(.8,h.baseY);indexPad(h)}
 const started=performance.now();await buildTerrain();buildWater();await buildHouses();addForest();await buildTrees();buildStreetDetail();buildYardWalls();makeViews();view('waterfront',true);resize();lighting(58);bind();
 state.ready=true;state.generatedMs=Math.round(performance.now()-started);state.houseCount=houses.length;state.source=D.provenance;state.getCamera=()=>({position:camera.position.toArray(),target:control.target.toArray(),fov:camera.fov,width:window.innerWidth,height:window.innerHeight,dpr:renderer.getPixelRatio(),yaw:control.yaw,pitch:control.pitch,distance:control.distance});state.setView=(name)=>view(name,true);state.setCamera=spec=>{tween=null;if(spec.target)control.target.set(...spec.target);for(const k of['yaw','pitch','distance'])if(spec[k]!=null)control[k]=spec[k];dirty=true};state.setLight=lighting;state.render=()=>{updateCamera();updateTreeLOD();renderer.shadowMap.needsUpdate=shadowPending;shadowPending=false;renderer.render(scene,camera);dirty=false;state.lastRender={drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures}};state.capture=()=>{state.render();return renderer.domElement.toDataURL('image/png')};state.groundAt=groundAt;state.houses=houses.map(h=>({id:h.id,x:h.x,z:h.z,rotation:h.rotation,width:h.width,depth:h.depth,type:h.type,baseY:h.baseY}));state.trees=trees.filter(t=>t.asset).map(t=>({x:t.x,z:t.z,type:t.type,baseY:t.baseY,height:t.asset.height}));state.setBare=value=>document.body.classList.toggle('bare',value);
 el('sceneStatus').textContent=`0.2 m 构件 · ${houses.length} 处完整房院`;el('houseCount').textContent=`${houses.length} 处房院`;el('loading').style.opacity='0';setTimeout(()=>el('loading').remove(),600);requestAnimationFrame(render)
}
window.addEventListener('error',e=>state.errors.push(e.message));
init().catch(e=>{state.errors.push(e.stack||e.message);el('loading').style.display='none';el('error').hidden=false;el('error').textContent='场景未能完成载入：'+e.message;console.error(e)});
})();
