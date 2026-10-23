/* Local voxel construction. Geographic G and cartographic C live in unified-map.js;
   the renderer only converts the C plane to east-x / south-z / up-y metres. */
(() => {
'use strict';
const T=window.THREE, A=window.DSArchitecture, V=window.DSVegetation;
let D=window.DSUnifiedMap||window.DSDesign;
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
 geometry(quantum=.2){if(this.defer){this.p=[];this.n=[];this.c=[];this.i=[];const result=(window.DSBaked&&window.DSBaked.lookup(this.solids,{quantum}))||window.DSMeshing.build(this.solids,{quantum});this.meshStats.push(result.stats);for(const f of result.faces){const n=f.n,shade=n[1]>.5?1.06:n[1]<-.5?.78:n[0]>.5?.96:n[0]<-.5?.94:n[2]<-.5?.94:1;this.quad(f.a,f.b,f.c,f.d,n,f.color,shade)}}const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(this.p,3));g.setAttribute('normal',new T.Float32BufferAttribute(this.n,3));g.setAttribute('color',new T.Float32BufferAttribute(this.c,3));g.setIndex(this.i);g.computeBoundingSphere();return g}
}
const state={ready:false,errors:[],version:'2026-10-22-unified-map',assets:[],treeAssets:[],view:'overview',detailGrid:.2,terrainFaces:0};
window.DSRemake=state;
let renderer,scene,camera,sun,hemi,world,terrainGroup,houseGroup,treeGroup,waterGroup,mat,shadowPending=true;
let dirty=true,frame=0,last=0,tween=null;
const treeChunks=[];
let bounds=D&&D.bounds||{minX:-190,maxX:390,minZ:-280,maxZ:280};
const control={target:new T.Vector3(60,8,0),yaw:-1.0,pitch:.38,distance:180};
const keys=new Set();
let houses=[],trees=[],roads=[],canals=[],shore=[],ponds=[],padIndex=new Map(),waterCells,gridH,gw,gh,groundMinX,groundMinZ;
const roadIndex=new Map();let lakeMask=null;
const placeLabels=[];
function createPlaceLabels(){for(const z of D.zones){const b=document.createElement('button');b.className='map-place-label';b.textContent=z.name;b.onclick=()=>state.goToPlace(z.id);el('mapLabels').appendChild(b);placeLabels.push({el:b,point:new T.Vector3(z.center[0],groundAt(...z.center)+24,z.center[1])})}const b=document.createElement('span');b.className='map-place-label peak-label';b.textContent='莫厘峰';el('mapLabels').appendChild(b);placeLabels.push({el:b,point:new T.Vector3(913.43,groundAt(913.43,-1002.77)+12,-1002.77)})}
function updatePlaceLabels(){for(const l of placeLabels){const p=l.point.clone().project(camera),show=control.distance>360&&p.z<1&&p.z>-1&&Math.abs(p.x)<.96&&Math.abs(p.y)<.94;l.el.hidden=!show;if(show){l.el.style.left=(p.x*.5+.5)*window.innerWidth+'px';l.el.style.top=(-p.y*.5+.5)*window.innerHeight+'px'}}}
function segmentRoadIndex(){roadIndex.clear();for(const r of roads)for(let i=1;i<r.points.length;i++){const a=r.points[i-1],b=r.points[i],pad=r.width/2+2,seg={...r,points:[a,b]};for(let x=Math.floor((Math.min(a[0],b[0])-pad)/32);x<=Math.floor((Math.max(a[0],b[0])+pad)/32);x++)for(let z=Math.floor((Math.min(a[1],b[1])-pad)/32);z<=Math.floor((Math.max(a[1],b[1])+pad)/32);z++){const key=x+','+z;if(!roadIndex.has(key))roadIndex.set(key,[]);roadIndex.get(key).push(seg)}}}
function nearbyRoads(x,z){return roadIndex.get(Math.floor(x/32)+','+Math.floor(z/32))||[]}
function decodeLakeMask(){const m=D.water.mask||D.waterMask;if(!m)return;const a=new Uint8Array(m.cols*m.rows),r=m.runs||m.rle||m.values;let offset=0;for(let i=0;i<r.length;i+=2){a.fill(r[i+1],offset,offset+r[i]);offset+=r[i]}lakeMask={...m,values:a}}
function lakeAt(x,z){if(!lakeMask)return x<shoreAt(z);const m=lakeMask,ix=Math.floor((x-m.minX)/m.step),iz=Math.floor((z-m.minZ)/m.step);return ix>=0&&iz>=0&&ix<m.cols&&iz<m.rows?m.values[iz*m.cols+ix]===1:false}
function setLoading(t){el('loadingText').textContent=t}
function makeMaterial(land=false){const m=new T.MeshLambertMaterial({vertexColors:true});m.customProgramCacheKey=()=>land?'terrain-v2':'craft-v2';m.onBeforeCompile=s=>{
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
 diffuseColor.rgb*=1.0-.025*joint+(grain-.5)*.03*visible;
 `);
 if(land)s.fragmentShader=s.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
 float grass=step(diffuseColor.r*1.12,diffuseColor.g)*step(diffuseColor.b*1.12,diffuseColor.g);
 vec2 gp=vCraftPosition.xz;
 float fine=fract(sin(dot(floor(gp*1.25),vec2(127.1,311.7)))*43758.5453);
 float broad=sin(gp.x*.037+sin(gp.y*.019)*1.7)*sin(gp.y*.031+sin(gp.x*.015));
 diffuseColor.rgb*=1.0+grass*((fine-.5)*.035+broad*.035);
 `);
 };return m}
function rawHeight(x,z){
 const g=D.terrain&&D.terrain.grid;if(!g||!g.values)return Math.max(.8,(x+140)*.045);
 const fx=clamp((x-g.minX)/g.step,0,g.cols-1),fz=clamp((z-g.minZ)/g.step,0,g.rows-1),ix=Math.floor(fx),iz=Math.floor(fz),jx=Math.min(ix+1,g.cols-1),jz=Math.min(iz+1,g.rows-1),tx=fx-ix,tz=fz-iz;
 const a=g.values[iz*g.cols+ix]*(1-tx)+g.values[iz*g.cols+jx]*tx,b=g.values[jz*g.cols+ix]*(1-tx)+g.values[jz*g.cols+jx]*tx;
 return Math.max(.8,a*(1-tz)+b*tz)}
function shoreAt(z){if(!shore.length)return-100000;let a=shore[0];for(let i=1;i<shore.length;i++){const b=shore[i];if(z<=b[1]){const t=clamp((z-a[1])/(b[1]-a[1]||1),0,1);return a[0]+(b[0]-a[0])*t}a=b}return a[0]}
function lineDistance(x,z,points){let best=Infinity,px=x,pz=z,t=0,segment=0;for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],dx=b[0]-a[0],dz=b[1]-a[1],u=clamp(((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1),0,1),cx=a[0]+u*dx,cz=a[1]+u*dz,ds=(x-cx)**2+(z-cz)**2;if(ds<best){best=ds;px=cx;pz=cz;t=u;segment=i-1}}return{distance:Math.sqrt(best),x:px,z:pz,t,segment}}
function inside(x,z,polygon){let yes=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])yes=!yes}return yes}
function canalWidth(c,near){if(!c.head)return c.width;const h=c.head.pointIndex===c.points.length-1?c.points[c.points.length-1]:c.points[0],dist=Math.hypot(near.x-h[0],near.z-h[1]);return c.head.widthAtHead+(c.width-c.head.widthAtHead)*clamp(dist/c.head.taperLength,0,1)}
function designHeight(x,z){let y=rawHeight(x,z);const terr=D.designTerraces;
 for(const t of D.sharedTerraces||[]){if(!t.polygon||t.mode==='shore-inland')continue;const level=t.level==null?t.height:t.level,dist=inside(x,z,t.polygon)?0:lineDistance(x,z,t.polygon.concat([t.polygon[0]])).distance,blend=t.blendWidth||35;if(dist<blend){const a=clamp(dist/blend,0,1),f=a*a*(3-2*a);y=level*(1-f)+y*f}}
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
 if(lakeAt(x,z))return-.8;
 for(const p of ponds)if(inside(x,z,p.polygon))return (p.level||0)-.6;
 for(const c of canals){const near=lineDistance(x,z,c.points);if(near.distance<canalWidth(c,near)/2)return-.6}
 let y=designHeight(x,z);if(!lakeMask)y=Math.min(y,.8+coastDist*.36);
 const list=padIndex.get(bucket(x,z))||[];
 for(const h of list){const[a,b]=localOf(h,x,z),dx=Math.abs(a)-h.padW/2,dz=Math.abs(b)-h.padD/2,m=Math.max(dx,dz);if(m<-.2)return h.baseY;if(m<.8){const t=clamp((m+.2),0,1);y=h.baseY*(1-t)+y*t}}
 let rd=Infinity,ry=y;for(const r of nearbyRoads(x,z)){const near=lineDistance(x,z,r.points);if(near.distance<r.width/2+1.4&&near.distance<rd){rd=near.distance;ry=designHeight(near.x,near.z);if(!lakeMask)ry=Math.min(ry,.8+(near.x-shoreAt(near.z))*.36);if(near.distance<r.width/2)y=ry;else y=ry*(1-(near.distance-r.width/2)/1.4)+y*(near.distance-r.width/2)/1.4}}
 return q(Math.round(Math.max(.8,y)/.2)*.2)
}
function groundAt(x,z){if(!gridH)return heightAt(x,z);const ix=clamp(Math.floor(x-groundMinX),0,gw-1),iz=clamp(Math.floor(z-groundMinZ),0,gh-1);return gridH[iz*gw+ix]}
function roadAt(x,z){for(const r of nearbyRoads(x,z)){if(lineDistance(x,z,r.points).distance<r.width/2)return r}return null}
function canalNear(x,z,d=.6){for(const c of canals){const near=lineDistance(x,z,c.points);if(near.distance<canalWidth(c,near)/2+d)return true}return false}
function groundColor(x,z,y){
 for(const g of D.grounds||[])if(g.polygon&&inside(x,z,g.polygon)){if(g.kind==='court'||g.kind==='plaza')return 0xa9aa9c;if(g.kind==='gravel')return 0xa6a18c}
 const c=x-shoreAt(z);if(!lakeMask&&c<1.1)return 0x969e8c;
 const r=roadAt(x,z);if(r){if(r.surface==='asphalt'||r.sourceKind==='primary')return 0x858d88;if(r.surface==='earth'||r.sourceKind==='path'||r.kind==='service')return 0x999a80;return 0xa7aa96}
 // No per-house pad tint, no parcel-colour mask, no 16 m hash blocks.
 return 0x708e60}
function coverAt(x,z){const m=D.designForestMask;if(!m)return 0;const ix=Math.round((x-m.minX)/m.step),iz=Math.round((z-m.minZ)/m.step);return ix<0||iz<0||ix>=m.cols||iz>=m.rows?0:m.values[iz*m.cols+ix]}
function addForest(){if(!D.designForestMask)return;const rng=random(7739),candidates=[];for(let z=bounds.minZ+9;z<bounds.maxZ-9;z+=10.4)for(let x=bounds.minX+9;x<bounds.maxX-9;x+=10.4){const xx=x+(rng()-.5)*6,zz=z+(rng()-.5)*6;if(coverAt(xx,zz)!==10||lakeAt(xx,zz))continue;if(D.designTerraces&&inside(xx,zz,D.designTerraces.core.polygon)&&rng()>.18)continue;const t={x:q(xx),z:q(zz),type:'broadleaf',seed:Math.floor(rng()*100000),scale:rng()>.6?1.2:1,background:true};if(!treeClear(t)||trees.some(t0=>(t0.x-t.x)**2+(t0.z-t.z)**2<28))continue;candidates.push(t)}
 candidates.sort((a,b)=>hash(a.seed,7)-hash(b.seed,7));const cap=D.zones?6500:1050;trees.push(...candidates.slice(0,cap));state.forestTreeCount=Math.min(cap,candidates.length);state.forestRule='WorldCover 2021 class 10, inverse G/C lookup; schematic crown locations, full voxel assets'}
async function buildTerrain() {
  groundMinX = Math.floor(bounds.minX);
  groundMinZ = Math.floor(bounds.minZ);
  gw = Math.ceil(bounds.maxX - groundMinX);
  gh = Math.ceil(bounds.maxZ - groundMinZ);
  gridH = new Float32Array(gw * gh);
  waterCells = 0;

  // Keep the existing 1 m local / 2 m background sampling exactly as it was.
  for (let z = 0; z < gh; z += 2) {
    for (let x = 0; x < gw; x += 2) {
      const xx = groundMinX + x, zz = groundMinZ + z;
      const near = (D.zones || [{ bounds }]).some(s => xx > s.bounds.minX - 25 && xx < s.bounds.maxX + 25 && zz > s.bounds.minZ - 25 && zz < s.bounds.maxZ + 25);
      const coarse = near ? null : heightAt(xx + 1, zz + 1);
      for (let dz = 0; dz < 2 && z + dz < gh; dz++) {
        for (let dx = 0; dx < 2 && x + dx < gw; dx++) {
          const h = near ? heightAt(xx + dx + .5, zz + dz + .5) : coarse;
          gridH[(z + dz) * gw + x + dx] = h;
          if (h < 0) waterCells++;
        }
      }
    }
    if (z % 32 === 0) {
      setLoading(`铺设连续方阶地表 · ${Math.round(z / gh * 100)}%`);
      await tick();
    }
  }

  // Color is constant on a sampled column: evaluate it once, not each time
  // a horizontal run is extended or tested against the following row.
  const gridColor = new Uint32Array(gw * gh);
  const stoneEdge = new Uint8Array(gw * gh);
  let landColumns = 0;
  for (let z = 0; z < gh; z++) {
    for (let x = 0; x < gw; x++) {
      const k = z * gw + x, h = gridH[k];
      if (h < 0) continue;
      const xx = groundMinX + x + .5, zz = groundMinZ + z + .5;
      gridColor[k] = groundColor(xx, zz, h);
      stoneEdge[k] = roadAt(xx, zz) || canalNear(xx, zz, .3) ? 1 : 0;
      landColumns++;
    }
    if (z % 64 === 0) await tick();
  }

  const size = 96;
  const stats = { landColumns, colorEvaluations: landColumns, topQuads: 0, wallQuads: 0, chunks: 0, exactSurfaceMerge: true };
  const height = (x, z) => x < 0 || x >= gw || z < 0 || z >= gh ? -1 : gridH[z * gw + x];
  for (let z0 = 0; z0 < gh; z0 += size) {
    for (let x0 = 0; x0 < gw; x0 += size) {
      const b = new BoxBatch(), xEnd = Math.min(gw, x0 + size), zEnd = Math.min(gh, z0 + size);
      const chunkWidth = xEnd - x0, used = new Uint8Array(chunkWidth * (zEnd - z0));

      // Top rectangles merge in both X and Z only when height AND color
      // are identical. No interpolation, averaging or change to the steps.
      for (let z = z0; z < zEnd; z++) {
        for (let x = x0; x < xEnd;) {
          const local = (z - z0) * chunkWidth + x - x0, k = z * gw + x;
          const h = gridH[k], co = gridColor[k];
          if (used[local] || h < 0) { x++; continue; }
          let endX = x + 1;
          while (endX < xEnd && !used[(z - z0) * chunkWidth + endX - x0] && gridH[z * gw + endX] === h && gridColor[z * gw + endX] === co) endX++;
          let endZ = z + 1;
          row: while (endZ < zEnd) {
            for (let xx = x; xx < endX; xx++) {
              const next = endZ * gw + xx;
              if (used[(endZ - z0) * chunkWidth + xx - x0] || gridH[next] !== h || gridColor[next] !== co) break row;
            }
            endZ++;
          }
          for (let zz = z; zz < endZ; zz++) used.fill(1, (zz - z0) * chunkWidth + x - x0, (zz - z0) * chunkWidth + endX - x0);
          const ax = groundMinX + x, bx = groundMinX + endX, az = groundMinZ + z, bz = groundMinZ + endZ;
          b.quad([ax, h, bz], [bx, h, bz], [bx, h, az], [ax, h, az], [0, 1, 0], co);
          stats.topQuads++;
          x = endX;
        }
      }

      // For each of the four wall directions, scan one fixed face plane.
      // Adjacent strips merge only if upper/lower heights and color match.
      // This preserves the old lower limit, exposed-face rule and winding.
      for (let axis = 0; axis < 2; axis++) {
        const fixedStart = axis === 0 ? x0 : z0, fixedEnd = axis === 0 ? xEnd : zEnd;
        const alongStart = axis === 0 ? z0 : x0, alongEnd = axis === 0 ? zEnd : xEnd;
        for (const sign of [-1, 1]) {
          const dx = axis === 0 ? sign : 0, dz = axis === 0 ? 0 : sign;
          for (let fixed = fixedStart; fixed < fixedEnd; fixed++) {
            let along = alongStart;
            while (along < alongEnd) {
              const x = axis === 0 ? fixed : along, z = axis === 0 ? along : fixed;
              const k = z * gw + x, h = gridH[k], nh = height(x + dx, z + dz);
              if (h < 0 || nh >= h - .01) { along++; continue; }
              const low = Math.max(-1, nh), co = nh < 0 || stoneEdge[k] ? 0x8f9987 : 0x6e8260;
              let end = along + 1;
              while (end < alongEnd) {
                const nx = axis === 0 ? fixed : end, nz = axis === 0 ? end : fixed;
                const nk = nz * gw + nx, nextH = gridH[nk], nextNeighbour = height(nx + dx, nz + dz);
                if (nextH !== h || nextNeighbour >= nextH - .01 || Math.max(-1, nextNeighbour) !== low || (nextNeighbour < 0 || stoneEdge[nk] ? 0x8f9987 : 0x6e8260) !== co) break;
                end++;
              }
              const plane = (axis === 0 ? groundMinX : groundMinZ) + fixed + (sign > 0 ? 1 : 0);
              const a = (axis === 0 ? groundMinZ : groundMinX) + along, e = (axis === 0 ? groundMinZ : groundMinX) + end;
              if (axis === 0 && sign > 0) b.quad([plane, low, a], [plane, h, a], [plane, h, e], [plane, low, e], [1, 0, 0], co, .96);
              else if (axis === 0) b.quad([plane, low, e], [plane, h, e], [plane, h, a], [plane, low, a], [-1, 0, 0], co, .96);
              else if (sign > 0) b.quad([e, low, plane], [e, h, plane], [a, h, plane], [a, low, plane], [0, 0, 1], co);
              else b.quad([a, low, plane], [a, h, plane], [e, h, plane], [e, low, plane], [0, 0, -1], co, .94);
              stats.wallQuads++;
              along = end;
            }
          }
        }
      }
      if (b.p.length) {
        const geometry = b.geometry(), m = new T.Mesh(geometry, terrainGroup.userData.material);
        m.receiveShadow = true;
        terrainGroup.add(m);
        state.terrainFaces += b.i.length / 6;
        stats.chunks++;
      }
    }
    await tick();
  }
  state.terrainMeshing = stats;
}

function makeMesh(b,group,position,rotation=0){const g=b.geometry(),m=new T.Mesh(g,mat);if(position)m.position.set(...position);m.rotation.y=rotation;m.castShadow=true;m.receiveShadow=true;group.add(m);return m}
function buildWater(){
 const width=bounds.maxX-bounds.minX,depth=bounds.maxZ-bounds.minZ;
 const waterMat=new T.MeshPhongMaterial({color:0x6c9da1,specular:0xc2cbb1,shininess:65});let water;
 if(shore.length||lakeMask){water=new T.Mesh(new T.PlaneGeometry(width+20000,depth+20000),waterMat);water.rotation.x=-Math.PI/2;water.position.set((bounds.minX+bounds.maxX)/2,0,(bounds.minZ+bounds.maxZ)/2)}
 else{const wb=new BoxBatch();for(let z=0;z<gh;z++){let x=0;while(x<gw){if(gridH[z*gw+x]>=0){x++;continue}const start=x;while(x<gw&&gridH[z*gw+x]<0)x++;const xx=groundMinX+start,x1=groundMinX+x,zz=groundMinZ+z;wb.quad([xx,0,zz+1],[x1,0,zz+1],[x1,0,zz],[xx,0,zz],[0,1,0],0xffffff)}}water=new T.Mesh(wb.geometry(),waterMat)}
 water.receiveShadow=true;waterGroup.add(water);
 for(const p of ponds){const b=new BoxBatch(),xs=p.polygon.map(a=>a[0]),zs=p.polygon.map(a=>a[1]),level=p.level||0;for(let z=Math.floor(Math.min(...zs));z<Math.max(...zs);z++)for(let x=Math.floor(Math.min(...xs));x<Math.max(...xs);x++)if(inside(x+.5,z+.5,p.polygon))b.quad([x,level,z+1],[x+1,level,z+1],[x+1,level,z],[x,level,z],[0,1,0],0xffffff);const pm=new T.Mesh(b.geometry(),waterMat);pm.receiveShadow=true;waterGroup.add(pm)}
 const ripple=new BoxBatch(),rng=random(2718);for(let i=0;i<1100;i++){const z=bounds.minZ+rng()*depth,x=shore.length?bounds.minX+rng()*Math.max(10,shoreAt(z)-bounds.minX-2):bounds.minX+rng()*width;if(shore.length?x>shoreAt(z)-1:!ponds.some(p=>inside(x,z,p.polygon)))continue;ripple.box(q(x),.025,q(z),q(shore.length?1+rng()*4:.8),.02,.08,rng()>.5?0xa6c0b4:0x96b7ac)}
 const rm=new T.Mesh(ripple.geometry(),new T.MeshBasicMaterial({vertexColors:true,transparent:true,opacity:.32,depthWrite:false}));waterGroup.add(rm);
}
function buildBridge(b){if(b.points){const bb=new BoxBatch();for(let i=1;i<b.points.length;i++){const a=b.points[i-1],c=b.points[i],len=Math.hypot(c[0]-a[0],c[1]-a[1]),angle=-Math.atan2(c[1]-a[1],c[0]-a[0]),x=(a[0]+c[0])/2,z=(a[1]+c[1])/2,y=b.height||1.6;addOrientedBox(bb,x,y,z,len+.2,.2,b.width||1.2,angle,0xa0a794);for(const sign of[-1,1]){const off=(b.width||1.2)/2;addOrientedBox(bb,x+Math.sin(angle)*off*sign,y+.6,z+Math.cos(angle)*off*sign,len,.2,.2,angle,0x879785);for(let j=0;j<=len;j+=1.4){const xx=a[0]+(c[0]-a[0])*j/len+Math.sin(angle)*off*sign,zz=a[1]+(c[1]-a[1])*j/len+Math.cos(angle)*off*sign;bb.box(xx,y+.3,zz,.2,.8,.2,0x8d9b88)}}}return makeMesh(bb,world)}const batch=new BoxBatch(),len=b.length||9,w=b.width||4,base=Math.max(1.0,designHeight(b.x,b.z));const deck=q(Math.max(base,1.4));
 batch.box(0,deck-.2,0,len,.4,w,0xb1b1a1);for(let i=0;i<5;i++){const top=deck-.2*(i+1),height=Math.max(.2,top-.6),xx=len/2+.3+i*.6;for(const sign of[-1,1])batch.box(sign*xx,.6+height/2,0,.6,height,w,0xa5a89a)}
 for(const z of[-w/2+.2,w/2-.2]){batch.box(0,deck+.7,z,len,.2,.2,0x858f80);for(let x=-len/2+.4;x<len/2;x+=1.8)batch.box(x,deck+.5,z,.2,1,.2,0x929a8b)}
 for(const x of[-len*.32,len*.32])batch.box(x,deck/2-.1,0,.6,deck+.2,w-.4,0x919a8c);
 return makeMesh(batch,world,[b.x,0,b.z],b.rotation||0)
}
async function buildHouses(){for(let i=0;i<houses.length;i++){const h=houses[i],b=new BoxBatch(true),asset=window.DSContent?DSContent.build(b,h):A.build(b,h);h.asset=asset;const m=makeMesh(b,houseGroup,[h.x,h.baseY,h.z],h.rotation||0);m.userData={kind:'house',id:h.id};h.mesh=m;state.assets.push({id:h.id,type:h.type,boxes:b.boxes,width:asset.width,depth:asset.depth,height:asset.height,bounds:asset.bounds,tags:asset.tags,baseY:h.baseY,meshing:b.meshStats[0],sourceIds:h.sourceIds||[]});if(i%5===0){setLoading(`构筑屋舍与设施 · ${i+1} / ${houses.length}`);await tick()}}}
function isPlayingSurface(x,z,clearance=0){for(const g of D.grounds||[]){if(!['sportsField','basketballCourt','basketball','track'].includes(g.kind))continue;if(g.polygon&&(inside(x,z,g.polygon)||lineDistance(x,z,g.polygon.concat([g.polygon[0]])).distance<clearance))return true}return false}
function treeClear(t){if(groundAt(t.x,t.z)<.1||lakeAt(t.x,t.z)||ponds.some(p=>inside(t.x,t.z,p.polygon))||isPlayingSurface(t.x,t.z,4.5))return false;for(const h of padIndex.get(bucket(t.x,t.z))||[]){const[a,b]=localOf(h,t.x,t.z);if(Math.abs(a)<h.padW/2+3.2&&Math.abs(b)<h.padD/2+3.2)return false}for(const r of nearbyRoads(t.x,t.z))if(lineDistance(t.x,t.z,r.points).distance<r.width/2+2)return false;return !canalNear(t.x,t.z,2)}
async function buildTrees(){const groups=new Map(),templates=new Map();for(const t of trees){if(!treeClear(t)){state.rejectedTrees=(state.rejectedTrees||0)+1;continue}const variant=(t.seed||1)%6,scale=Math.round((t.scale||1)*10)/10,template=`${t.type||'broadleaf'}:${variant}:${scale}`,k=template;if(!groups.has(k))groups.set(k,{template,list:[]});groups.get(k).list.push(t)}
 let n=0;for(const[k,{template,list}]of groups){let cache=templates.get(template);if(!cache){const[type,v,scale]=template.split(':'),b=new BoxBatch(true),asset=V.build(b,{type,seed:137+Number(v)*71,scale:Number(scale)});cache={asset,near:b.geometry(.2),mid:b.geometry(.4),far:b.geometry(.8)};state.treeAssets.push({type,variant:template,boxes:b.boxes,height:asset.height,radius:asset.radius,meshing:b.meshStats});templates.set(template,cache)}
 const near=new T.InstancedMesh(cache.near,mat,list.length),mid=new T.InstancedMesh(cache.mid,mat,list.length),far=new T.InstancedMesh(cache.far,mat,list.length),dummy=new T.Object3D();for(const m of[near,mid,far]){m.castShadow=true;m.receiveShadow=true}for(let i=0;i<list.length;i++){const t=list[i];t.baseY=groundAt(t.x,t.z);t.asset=cache.asset;dummy.position.set(t.x,t.baseY,t.z);dummy.rotation.y=((t.seed||1)%4)*Math.PI/2;dummy.updateMatrix();t.matrix=dummy.matrix.clone();t.lod=0;for(const m of[near,mid,far])m.setMatrixAt(i,t.matrix)}for(const m of[near,mid,far])m.computeBoundingSphere();near.userData={kind:'trees',chunk:k,lod:'full'};mid.userData={kind:'trees',chunk:k,lod:'mid'};far.userData={kind:'trees',chunk:k,lod:'far'};mid.count=far.count=0;treeGroup.add(near,mid,far);treeChunks.push({near,mid,far,list});n+=list.length;if(n%80<list.length){setLoading(`生长连续林地 · ${n} 株`);await tick()}}
 state.treeCount=n;state.treeChunkCount=treeChunks.length;state.treeLODPolicy='0.2m full geometry; 0.4/0.8m merged silhouette only after 0.2/0.6m error projects below 0.85 physical pixels. Full assets remain resident. global template batches with per-tree conservative frustum culling.'}
const treeFrustum=new T.Frustum(),treeProjection=new T.Matrix4(),treeSphere=new T.Sphere();
function updateTreeLOD(){const proj=window.innerHeight*renderer.getPixelRatio()/(2*Math.tan(camera.fov*Math.PI/360)),threshold=Math.max(260,.2*proj/.85),farThreshold=Math.max(780,.6*proj/.85);treeFrustum.setFromProjectionMatrix(treeProjection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));let nn=0,nm=0,nf=0,culled=0;for(const c of treeChunks){let ni=0,mi=0,fi=0;for(const t of c.list){const h=t.asset.height;treeSphere.center.set(t.x,t.baseY+h/2,t.z);treeSphere.radius=Math.hypot(h/2,t.asset.radius)+h*1.3;if(!treeFrustum.intersectsSphere(treeSphere)){culled++;continue}const dist=Math.hypot(t.x-camera.position.x,t.baseY+h/2-camera.position.y,t.z-camera.position.z);t.lod=dist<threshold*(t.lod===0?1.08:1)?0:dist<farThreshold*(t.lod===1?1.08:1)?1:2;if(t.lod===2)c.far.setMatrixAt(fi++,t.matrix);else if(t.lod===1)c.mid.setMatrixAt(mi++,t.matrix);else c.near.setMatrixAt(ni++,t.matrix)}c.near.count=ni;c.mid.count=mi;c.far.count=fi;for(const m of[c.near,c.mid,c.far]){m.visible=m.count>0;m.instanceMatrix.needsUpdate=true}nn+=ni;nm+=mi;nf+=fi}state.treeLODCounts={full:nn,mid:nm,far:nf,culled,thresholdMetres:Math.round(threshold),farThresholdMetres:Math.round(farThreshold)}}
function buildStreetDetail(){const b=new BoxBatch();for(const h of houses){const c=Math.cos(h.rotation||0),s=Math.sin(h.rotation||0),w=h.width||12,d=h.depth||8;if(h.type==='courtyard')continue;const pz=d/2+1.4,xx=h.x+s*pz,zz=h.z+c*pz,y=groundAt(xx,zz);if(y<0||Math.abs(y-h.baseY)>1)continue;
 // Door-side stone seat and two small earthen pots. These remain separate from the opening.
 const x0=h.x+c*(-w/2+.7)+s*pz,z0=h.z-s*(-w/2+.7)+c*pz;
 b.box(q(x0),y+.2,q(z0),.8,.4,.6,0x9ca494);
 if((h.seed||1)%3===0){b.box(q(x0+.8),y+.3,q(z0),.4,.6,.4,0x9d8662);b.box(q(x0+.8),y+.7,q(z0),.6,.4,.6,0x6f8a50)} }
 // Stone paving joints belong to the close pedestrian surface, not to a painted macro grid.
 for(const r of roads){if(r.surface==='earth'||r.pavingJoints===false||r.surface==='asphalt'||r.sourceKind==='primary')continue;for(let i=1;i<r.points.length;i++){const a=r.points[i-1],c=r.points[i],dx=c[0]-a[0],dz=c[1]-a[1],len=Math.hypot(dx,dz);for(let t=0;t<len;t+=1.6){const x=a[0]+dx*t/len,z=a[1]+dz*t/len,y=groundAt(x,z);if(y<0)continue;const width=r.width*.72;if(Math.abs(dx)>Math.abs(dz))b.box(q(x),y+.012,q(z),.08,.02,q(width),0x969d89);else b.box(q(x),y+.012,q(z),q(width),.02,.08,0x969d89)}}}
 makeMesh(b,world);(D.bridges||[]).forEach(buildBridge)
}
function groundFeatures(){
 const b=new BoxBatch(),rng=random(5577);
 // Small shore grasses give unresolved source heads an inward taper, without
 // inventing a pond, culvert, or continuation beyond the recorded endpoint.
 for(const t of D.water.terminals||[]){for(let i=0;i<65;i++){const a=rng()*Math.PI*2,r=.7+rng()*3.5,x=t.x+Math.cos(a)*r,z=t.z+Math.sin(a)*r,y=groundAt(x,z);if(y<.1||roadAt(x,z))continue;const h=.2+Math.floor(rng()*3)*.2;b.box(q(x),y+h/2,q(z),.2,h,.2,[0x718a4e,0x82965b,0x637f4b][i%3])}}
 for(let i=0;i<950;i++){const x=bounds.minX+rng()*(bounds.maxX-bounds.minX),z=bounds.minZ+rng()*(bounds.maxZ-bounds.minZ),y=groundAt(x,z);if(y<0||roadAt(x,z)||canalNear(x,z,.8)||isPlayingSurface(x,z,.5)||(padIndex.get(bucket(x,z))||[]).some(h=>{const p=localOf(h,x,z);return Math.abs(p[0])<h.width/2+1&&Math.abs(p[1])<h.depth/2+1}))continue;if(rng()>.4)continue;const size=q(.2+rng()*.4);b.box(q(x),y+.1,q(z),size,.2,size,0x79905a)}
 makeMesh(b,world);
 for(const g of D.grounds||[]){if(!['sportsField','basketballCourt','basketball','track'].includes(g.kind))continue;let x=g.x,z=g.z,w=g.width,d=g.depth,angle=g.rotation||0;if(g.polygon){const xs=g.polygon.map(p=>p[0]),zs=g.polygon.map(p=>p[1]);x=(Math.min(...xs)+Math.max(...xs))/2;z=(Math.min(...zs)+Math.max(...zs))/2;w=w||Math.max(...xs)-Math.min(...xs);d=d||Math.max(...zs)-Math.min(...zs)}if(g.center){x=g.center[0];z=g.center[1]}x=x||0;z=z||0;w=w||80;d=d||45;if(g.kind!=='basketball'&&g.kind!=='basketballCourt'&&d>w){[w,d]=[d,w];angle+=Math.PI/2}const bb=new BoxBatch(),base=groundAt(x,z)+.025;
 if(g.kind==='basketballCourt'||g.kind==='basketball'){bb.box(0,.01,0,w,.02,d,0x6d9285);for(const sign of[-1,1]){bb.box(sign*(w/2-.4),.03,0,.2,.02,d-.6,0xd9d9bc);bb.box(0,.03,sign*(d/2-.4),w-.6,.02,.2,0xd9d9bc);bb.box(sign*(w/2-1.6),1.2,0,.2,2.4,.2,0x70857c);bb.box(sign*(w/2-1.6),2.8,0,.2,1,1.6,0xd9dfd2)}bb.box(0,.03,0,.2,.02,d-.8,0xd9d9bc)}else{
 const radius=Math.min(d/2,w/2),straight=Math.max(0,w/2-radius),laneCount=5,lane=.9,inner=radius-laneCount*lane;
 for(let zz=-d/2;zz<d/2-.01;zz+=.2){let runColor=null,runStart=-w/2;for(let xx=-w/2;xx<=w/2+.01;xx+=.2){const dist=Math.hypot(Math.max(0,Math.abs(xx+.1)-straight),zz+.1),isEnd=xx>=w/2-.01;let co=dist>radius?null:dist>inner?0xa56e56:0x5e8d57;if(co&&dist>inner){const r=(dist-inner)%lane;if(Math.min(r,lane-r)<.12)co=0xddd9be}if(co!==runColor||isEnd){if(runColor!=null)bb.box((runStart+xx)/2,.01,zz+.1,xx-runStart,.02,.2,runColor);runStart=xx;runColor=co}}}
 const fw=Math.max(20,w*.57),fd=Math.max(14,inner*1.45);for(const sign of[-1,1]){bb.box(0,.035,sign*fd/2,fw,.02,.2,0xc8d1b6);bb.box(sign*fw/2,.035,0,.2,.02,fd,0xc8d1b6);for(const gz of[-2,2])bb.box(sign*fw/2,1.2,gz,.2,2.4,.2,0xd6dbcb);bb.box(sign*fw/2,2.4,0,.2,.2,4.2,0xd6dbcb)}bb.box(0,.035,0,.2,.02,fd,0xc8d1b6)
 }makeMesh(bb,world,[x,base,z],angle)}
}
function addOrientedBox(batch,cx,cy,cz,w,h,d,angle,hex){const base=new BoxBatch();base.box(0,0,0,w,h,d,hex);const co=Math.cos(angle),si=Math.sin(angle),offset=batch.p.length/3;for(let i=0;i<base.p.length;i+=3){const x=base.p[i],y=base.p[i+1],z=base.p[i+2];batch.p.push(cx+co*x+si*z,cy+y,cz-si*x+co*z);const nx=base.n[i],ny=base.n[i+1],nz=base.n[i+2];batch.n.push(co*nx+si*nz,ny,-si*nx+co*nz)}batch.c.push(...base.c);for(const i of base.i)batch.i.push(offset+i);batch.boxes++}
function buildYardWalls(){const b=new BoxBatch();for(const wall of[...(D.courtyardWalls||[]),...(D.walls||[])]){for(let i=1;i<wall.points.length;i++){const a=wall.points[i-1],c=wall.points[i],dx=c[0]-a[0],dz=c[1]-a[1],len=Math.hypot(dx,dz),n=Math.max(1,Math.ceil(len/2)),angle=-Math.atan2(dz,dx),width=wall.thickness||wall.width||.4,height=wall.height||2;
 for(let j=0;j<n;j++){const t=(j+.5)/n,x=a[0]+dx*t,z=a[1]+dz*t,y=groundAt(x,z);if(y<0)continue;if(wall.gateGap&&lineDistance(x,z,[[wall.gateGap[0],wall.gateGap[1]],[wall.gateGap[2],wall.gateGap[3]]]).distance<2)continue;
 addOrientedBox(b,x,y+.2,z,len/n+.02,.4,width,angle,0x9ba18c);
 if(wall.kind==='schoolFence'){addOrientedBox(b,x,y+height/2,z,.2,height,.2,angle,0x71897d);for(const h of[.6,1.2])addOrientedBox(b,x,y+h,z,len/n,.2,.2,angle,0x71897d);continue}
 if(wall.windows&&j%3===1){addOrientedBox(b,x,y+.8,z,len/n,.8,width,angle,0xd5d4bf);addOrientedBox(b,x,y+height-.3,z,len/n,.6,width,angle,0xd5d4bf);for(const sign of[-1,1])addOrientedBox(b,x+Math.cos(angle)*sign*(len/n/2-.2),y+height/2,z-Math.sin(angle)*sign*(len/n/2-.2),.4,height,width,angle,0xd5d4bf);for(const offset of[-.4,0,.4])addOrientedBox(b,x+Math.cos(angle)*offset,y+height/2,z-Math.sin(angle)*offset,.2,height-1.3,.2,angle,0x8d9b8b)}
 else addOrientedBox(b,x,y+.4+(height-.4)/2,z,len/n+.02,height-.4,width,angle,0xd5d4bf);
 addOrientedBox(b,x,y+height+.1,z,len/n+.04,.2,width+.2,angle,0x657775)} }}makeMesh(b,world);state.yardWallSegments=(D.courtyardWalls||[]).length+(D.walls||[]).length}
const defaultViewLabels={waterfront:['湖岸入村','石岸、灰瓦与山前街巷'],street:['巷间见山','完整房屋构成街墙，巷道留出行走的尺度'],house:['一座民居','层瓦、檐椽、墙厚与门窗进深'],court:['院落有空','主屋与配屋之间，留下真正的天井'],tree:['枝叶之间','阶梯枝干承托叶簇，冠层留有透空'],overview:['山湖之间','西湖东山，经过选择与编排的连续街村']};
let viewLabels={...defaultViewLabels};
const views={};
function fullMapView(){const yaw=-.22,pitch=1.03,target=new T.Vector3((bounds.minX+bounds.maxX)/2,45,(bounds.minZ+bounds.maxZ)/2),cp=Math.cos(pitch),sp=Math.sin(pitch),dir=new T.Vector3(Math.sin(yaw)*cp,sp,Math.cos(yaw)*cp),right=new T.Vector3(Math.cos(yaw),0,-Math.sin(yaw)),up=new T.Vector3(-Math.sin(yaw)*sp,cp,-Math.cos(yaw)*sp),tan=Math.tan(Math.PI/8),aspect=window.innerWidth/window.innerHeight;let distance=0;
 const include=(x,y,z)=>{const p=new T.Vector3(x,y,z).sub(target),depth=p.dot(dir);distance=Math.max(distance,depth+Math.abs(p.dot(right))/(tan*aspect),depth+Math.abs(p.dot(up))/tan)};
 for(const x of[bounds.minX,bounds.maxX])for(const z of[bounds.minZ,bounds.maxZ])include(x,groundAt(x,z)+15,z);
 if(gridH)for(let z=0;z<gh;z+=24)for(let x=0;x<gw;x+=24){const h=gridH[z*gw+x];if(h>=0)include(groundMinX+x,h+15,groundMinZ+z)}
 return{target:target.toArray(),yaw,pitch,distance:Math.ceil(distance*1.15)}
}
function makeViews(){if(D.id!=='luxiang'&&!D.zones){const c=D.cameraSuggestions||{},h=houses.find(h=>h.id===c.houseId)||houses[0],p=(v,y)=>v&&v.length===3?v:[v?v[0]:h.x,y,v?v[1]:h.z];views.overview={target:p(c.overviewTarget,3),yaw:c.yaw||.8,pitch:c.pitch||.7,distance:c.distance||200};views.house={target:[h.x,h.baseY+5,h.z],yaw:h.rotation-.5,pitch:.25,distance:Math.max(42,h.width*2.1)};views.street={target:p(c.streetTarget,4),yaw:.65,pitch:.10,distance:65};views.court={target:p(c.blockTarget,3),yaw:.8,pitch:.66,distance:D.id==='dongshan-school'?110:75};views.waterfront={target:p(c.waterfrontTarget,2),yaw:.5,pitch:.56,distance:D.id==='dongshan-school'?150:55};views.tree={target:p(c.treeTarget,4),yaw:-.9,pitch:.15,distance:36};state.heroHouse=h.id;state.views=views;return}
const ordinary=houses.find(h=>h.id===(D.cameraSuggestions&&D.cameraSuggestions.houseId))||houses.find(h=>h.type==='house')||houses[0];const court=houses.find(h=>h.type==='courtyard')||ordinary;
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
 views.street={target:[184,3.3,16],yaw:.1201,pitch:.025,distance:58.42};
 views.court={target:[court.x,court.baseY+3,court.z],yaw:-.57+(court.rotation||0),pitch:.67,distance:67};
 let heroTree=null,treeAngle=-1.1,treeScore=Infinity;for(const t of trees.filter(t=>t.asset&&!t.background&&['willow','broadleaf'].includes(t.type))){for(const angle of[-1.6,-1.0,-.4,.5,1.2,2.1]){const dist=34,cx=t.x+Math.sin(angle)*dist,cz=t.z+Math.cos(angle)*dist;let score=t.type==='willow'?0:3;
 for(const n of trees){if(n===t)continue;const near=lineDistance(n.x,n.z,[[cx,cz],[t.x,t.z]]);if(near.t>.01&&near.t<.91&&near.distance<5.4)score+=40}
 for(const h of houses){const near=lineDistance(h.x,h.z,[[cx,cz],[t.x,t.z]]);if(near.t>.02&&near.t<.9&&near.distance<Math.hypot(h.width,h.depth)*.48)score+=100}
 if(groundAt(cx,cz)>t.baseY+2)score+=100;score+=Math.abs(angle+1.1);if(score<treeScore){treeScore=score;heroTree=t;treeAngle=angle}
 }}if(heroTree)views.tree={target:[heroTree.x,heroTree.baseY+heroTree.asset.height*.50,heroTree.z],yaw:treeAngle,pitch:.11,distance:34};else views.tree=views.house;
 views.overview={target:[mid.x,15,mid.z],yaw:-.95,pitch:.76,distance:410};
 if(D.zones){const school=D.zones.find(z=>z.id==='dongshan-school'),garden=D.zones.find(z=>z.id==='chunzailou-garden');for(const[z,key]of[[school,'school'],[garden,'garden']]){const c=z.cameraSuggestions;views[key]={target:c.overviewTarget,yaw:c.yaw,pitch:c.pitch,distance:c.distance}}views.pond={target:[garden.center[0]-56,garden.displayGroundLevel+1,garden.center[1]-37],yaw:.5,pitch:.56,distance:55};views.overview=fullMapView();viewLabels.school=['东山中学','同一地图上的校园组团'];viewLabels.garden=['春在楼 · 宅园','三进楼厅、双层跑马廊与北园池石'];viewLabels.pond=['北园池石','沿连续地图接近园林细部'];viewLabels.overview=['东山 · 连续地图','学校、宅园、村落与山湖共处一张地图']}
 state.heroHouse=hero.id;state.heroTree=heroTree?{x:heroTree.x,z:heroTree.z,type:heroTree.type}:null;state.views=views;
}
function view(name,instant=false){if(!views[name])return;const v=views[name];state.view=name;if(instant){control.target.set(...v.target);control.yaw=v.yaw;control.pitch=v.pitch;control.distance=v.distance;tween=null}else{tween={from:{target:control.target.clone(),yaw:control.yaw,pitch:control.pitch,distance:control.distance},to:v,t:0}}
 document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===name));const ids=Object.keys(defaultViewLabels),labels=viewLabels[name],index=ids.indexOf(name);el('viewNumber').textContent=index<0?'地图定位':`0${index+1} / 06`;el('viewTitle').textContent=labels[0];el('viewDesc').textContent=labels[1];dirty=true}
function updateCamera(){const cp=Math.cos(control.pitch),sp=Math.sin(control.pitch);camera.position.set(control.target.x+Math.sin(control.yaw)*cp*control.distance,control.target.y+sp*control.distance,control.target.z+Math.cos(control.yaw)*cp*control.distance);if(camera.position.x>bounds.minX&&camera.position.x<bounds.maxX&&camera.position.z>bounds.minZ&&camera.position.z<bounds.maxZ)camera.position.y=Math.max(camera.position.y,groundAt(camera.position.x,camera.position.z)+1.2);const near=clamp(control.distance/200,.15,3);if(Math.abs(camera.near-near)>.02){camera.near=near;camera.updateProjectionMatrix()}scene.fog.near=Math.max(400,control.distance*1.1);scene.fog.far=Math.max(1900,control.distance*3.2);camera.lookAt(control.target);camera.updateMatrixWorld();updateShadowFocus();updatePlaceLabels()}
const sunOffset=new T.Vector3(-80,300,220),shadowFocus=new T.Vector3(Infinity,0,Infinity);let shadowRange=0;
function updateShadowFocus(){const range=clamp(control.distance*.75,100,1300);if(Math.hypot(control.target.x-shadowFocus.x,control.target.z-shadowFocus.z)>24||Math.abs(range-shadowRange)>30){shadowFocus.set(control.target.x,0,control.target.z);shadowRange=range;sun.target.position.copy(shadowFocus);sun.position.copy(shadowFocus).add(sunOffset);for(const k of['left','bottom'])sun.shadow.camera[k]=-range;for(const k of['right','top'])sun.shadow.camera[k]=range;sun.shadow.camera.updateProjectionMatrix();shadowPending=true}}
function lighting(value){const t=value/100,elv=Math.sin(Math.PI*(.12+t*.75)),warm=Math.abs(t-.5)*2;hemi.color.setHex(0xe0e6d2);hemi.groundColor.setHex(0x77876c);hemi.intensity=1.55-warm*.20;sun.color.setRGB(1,.96-warm*.13,.86-warm*.21);sun.intensity=2.4;sunOffset.set((.5-t)*700,150+elv*210,250);shadowFocus.set(Infinity,0,Infinity);scene.background=new T.Color().setRGB(.65+warm*.08,.76-warm*.025,.77-warm*.065);scene.fog.color.copy(scene.background);el('lightLabel').textContent=value<32?'清晨':value>75?'薄暮':'午后';shadowPending=true;dirty=true}
function bind(){
 document.querySelectorAll('[data-place]').forEach(b=>b.onclick=()=>state.goToPlace(b.dataset.place));
 document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>view(b.dataset.view)));
 el('resetView').onclick=()=>view(state.view);el('infoToggle').onclick=()=>el('info').showModal();el('closeInfo').onclick=()=>el('info').close();el('info').addEventListener('click',e=>{if(e.target===el('info'))el('info').close()});el('hideUi').onclick=()=>document.body.classList.toggle('bare');el('daylight').oninput=e=>lighting(Number(e.target.value));
 let down=null;const canvas=renderer.domElement;canvas.addEventListener('contextmenu',e=>e.preventDefault());canvas.addEventListener('pointerdown',e=>{if(el('info').open)return;down={x:e.clientX,y:e.clientY,button:e.button,shift:e.shiftKey};canvas.setPointerCapture(e.pointerId);tween=null});canvas.addEventListener('pointerup',()=>down=null);canvas.addEventListener('pointercancel',()=>down=null);
 canvas.addEventListener('pointermove',e=>{if(!down)return;const dx=e.clientX-down.x,dy=e.clientY-down.y;if(down.button===2||e.shiftKey){const scale=control.distance*.001;control.target.x+=(-Math.cos(control.yaw)*dx-Math.sin(control.yaw)*dy)*scale;control.target.z+=(Math.sin(control.yaw)*dx-Math.cos(control.yaw)*dy)*scale}else{control.yaw-=dx*.004;control.pitch=clamp(control.pitch+dy*.003,.04,1.46)}down.x=e.clientX;down.y=e.clientY;dirty=true});
 canvas.addEventListener('wheel',e=>{e.preventDefault();tween=null;control.distance=clamp(control.distance*Math.exp(e.deltaY*.001),8,3200);dirty=true},{passive:false});
 canvas.addEventListener('dblclick',e=>{const ray=new T.Raycaster();ray.setFromCamera(new T.Vector2(e.clientX/window.innerWidth*2-1,1-e.clientY/window.innerHeight*2),camera);const hit=ray.intersectObjects([terrainGroup,houseGroup,treeGroup],true)[0];if(hit){tween=null;control.target.copy(hit.point);control.distance=clamp(control.distance*.42,18,80);dirty=true}});
 window.addEventListener('keydown',e=>{if(e.target.tagName==='INPUT'||el('info').open)return;keys.add(e.code);if(e.code==='KeyH')document.body.classList.toggle('bare');const index=Number(e.key)-1;if(index>=0&&index<6)view(Object.keys(viewLabels)[index]);if(['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE','Space'].includes(e.code))e.preventDefault()});window.addEventListener('keyup',e=>keys.delete(e.code));window.addEventListener('blur',()=>keys.clear());
 window.addEventListener('resize',resize)
}
function resize(){renderer.setSize(window.innerWidth,window.innerHeight,false);camera.aspect=window.innerWidth/window.innerHeight;camera.updateProjectionMatrix();if(views.overview&&D.zones){views.overview=fullMapView();if(state.view==='overview')view('overview',true)}dirty=true}
function render(now){requestAnimationFrame(render);const dt=Math.min(.05,(now-last)/1000||.016);last=now;
 if(tween){tween.t=Math.min(1,tween.t+dt/1.1);const t=tween.t*tween.t*(3-2*tween.t),f=tween.from,to=tween.to;control.target.copy(f.target).lerp(new T.Vector3(...to.target),t);control.yaw=f.yaw+(to.yaw-f.yaw)*t;control.pitch=f.pitch+(to.pitch-f.pitch)*t;control.distance=f.distance+(to.distance-f.distance)*t;if(tween.t>=1)tween=null;dirty=true}
 let mx=0,mz=0,my=0;if(keys.has('KeyW'))mz--;if(keys.has('KeyS'))mz++;if(keys.has('KeyA'))mx--;if(keys.has('KeyD'))mx++;if(keys.has('KeyQ'))my--;if(keys.has('KeyE'))my++;
 if(mx||mz||my){tween=null;const step=dt*Math.max(6,control.distance*.25)*(keys.has('ShiftLeft')?3:1);control.target.x+=(mx*Math.cos(control.yaw)+mz*Math.sin(control.yaw))*step;control.target.z+=(-mx*Math.sin(control.yaw)+mz*Math.cos(control.yaw))*step;control.target.y+=my*step;dirty=true}
 if(dirty&&state.ready){updateCamera();updateTreeLOD();if(shadowPending){renderer.shadowMap.needsUpdate=true;shadowPending=false}renderer.render(scene,camera);dirty=false;frame++;state.lastRender={drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures}}
}
async function init(){if(!T||!D||!A||!V)throw new Error('本地模块未完整载入，请保留整个重制版目录。');
 renderer=new T.WebGLRenderer({canvas:el('scene'),antialias:true,powerPreference:'high-performance',preserveDrawingBuffer:true});renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.5));renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;renderer.shadowMap.autoUpdate=false;
 scene=new T.Scene();scene.fog=new T.Fog(0xc1cfc4,400,2200);camera=new T.PerspectiveCamera(45,1,.2,7000);hemi=new T.HemisphereLight(0xe0e6d2,0x8e997e,2);scene.add(hemi);sun=new T.DirectionalLight(0xffedd2,2.25);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-230;sun.shadow.camera.right=230;sun.shadow.camera.top=230;sun.shadow.camera.bottom=-230;sun.shadow.camera.near=1;sun.shadow.camera.far=5000;sun.shadow.bias=-.00004;sun.shadow.normalBias=.12;sun.shadow.radius=2;sun.target.position.set(80,0,0);scene.add(sun,sun.target);
 world=new T.Group();scene.add(world);mat=makeMaterial();
 state.getCamera=()=>({position:camera.position.toArray(),target:control.target.toArray(),fov:camera.fov,width:window.innerWidth,height:window.innerHeight,dpr:renderer.getPixelRatio(),yaw:control.yaw,pitch:control.pitch,distance:control.distance});state.setView=name=>view(name,true);state.setCamera=spec=>{tween=null;if(spec.target)control.target.set(...spec.target);for(const k of['yaw','pitch','distance'])if(spec[k]!=null)control[k]=spec[k];dirty=true};state.setLight=lighting;state.render=()=>{updateCamera();updateTreeLOD();renderer.shadowMap.needsUpdate=shadowPending;shadowPending=false;renderer.render(scene,camera);dirty=false;state.lastRender={drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures}};state.capture=()=>{state.render();return renderer.domElement.toDataURL('image/png')};state.groundAt=groundAt;state.setBare=value=>document.body.classList.toggle('bare',value);state.goToPlace=(id,instant=false)=>{const v={luxiang:'waterfront','dongshan-school':'school','chunzailou-garden':'garden',all:'overview'}[id];if(v){state.currentPlace=id;view(v,instant)}};
 if(window.DSBaked){setLoading('读取完整构件…');await DSBaked.load()}
 bind();resize();await loadWorld();requestAnimationFrame(render)
}
function showError(e){state.errors.push(e.stack||e.message);el('loading').style.display='none';el('error').hidden=false;el('error').textContent='场景未能完成载入：'+e.message;console.error(e)}
async function loadWorld(){
 const data=window.DSUnifiedMap;if(!data)throw new Error('统一地图数据未载入');
 state.loading=true;state.ready=false;el('loading').style.display='grid';el('loading').style.opacity='1';setLoading('构筑同一张东山地图…');await tick();
 D=data;bounds=D.bounds;state.worldIdentity=world.uuid;state.mapMode='single-continuous-world';state.currentPlace='all';state.loadedZoneIds=D.zones.map(z=>z.id);
 terrainGroup=new T.Group();terrainGroup.userData.material=makeMaterial(true);houseGroup=new T.Group();treeGroup=new T.Group();waterGroup=new T.Group();world.add(terrainGroup,houseGroup,treeGroup,waterGroup);
 houses=(D.houses||D.buildings||[]).map(h=>window.DSContent?DSContent.varied(h,D):({...h}));for(const r of D.rocks||[])houses.push({...r,type:'gardenRock'});trees=(D.trees||[]).map(t=>({...t}));roads=D.roads||[];canals=D.water&&D.water.canals||[];shore=D.water&&D.water.shore||[];ponds=D.water&&D.water.ponds||[];segmentRoadIndex();decodeLakeMask();
 for(const h of houses){h.padW=h.width||(h.type==='courtyard'?28:12);h.padD=h.depth||(h.type==='courtyard'?24:8);h.baseY=q(designHeight(h.x,h.z));h.baseY=Math.max(.8,h.baseY);indexPad(h)}
 const started=performance.now();await buildTerrain();if(shore.length||ponds.length||canals.length)buildWater();await buildHouses();addForest();await buildTrees();buildStreetDetail();buildYardWalls();groundFeatures();
 viewLabels={...defaultViewLabels};document.querySelector('.subtitle').textContent='东山 · 体素山湖地图';makeViews();view('overview',true);lighting(58);shadowPending=true;dirty=true;
 state.generatedMs=Math.round(performance.now()-started);state.houseCount=houses.length;state.source=D.provenance;state.houses=houses.map(h=>({id:h.id,x:h.x,z:h.z,rotation:h.rotation,width:h.width,depth:h.depth,type:h.type,baseY:h.baseY}));state.trees=trees.filter(t=>t.asset).map(t=>({x:t.x,z:t.z,type:t.type,baseY:t.baseY,height:t.asset.height}));state.typeCounts=houses.reduce((a,h)=>(a[h.type]=(a[h.type]||0)+1,a),{});state.waterTerminals=D.water.terminals||[];state.surfacePolicy='无逐屋地坪染色；草色为连续细尺度变化；路面按功能分级';
 state.residentHouseCount=houses.length;state.residentIds=houses.map(h=>h.id);createPlaceLabels();el('sceneStatus').textContent='同一张连续地图 · 0.2 m 构件';el('houseCount').textContent=`${houses.length} 处构筑`;state.loading=false;state.ready=true;el('loading').style.opacity='0';setTimeout(()=>{el('loading').style.display='none'},500);return{world:world.uuid,buildings:houses.length,types:state.typeCounts}
}
window.addEventListener('error',e=>state.errors.push(e.message));
init().catch(showError);
})();
