/* Dongshan: source geography -> generalized display. Three.js r160, local only. */
(function () {
  'use strict';
  const T = window.THREE;
  const D = window.DONGSHAN_SCENE || window.DONGSHAN_DATA;
  const emit = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));
  const fail = (e) => { console.error(e); window.DSUI?.showError(e.message || String(e)); };
  if (!T || !D) return fail(new Error('本地三维库或场景数据未能载入，请保留文件夹的完整结构。'));

  const opts = { relief: 2.4, time: .52, buildings: true, roads: true, water: true, trees: true, labels: true };
  const terrain = D.terrain;
  const lake = D.meta.waterLevelHint?.value ?? .5;
  const clamp = T.MathUtils.clamp;
  let renderer, camera, scene, terrainMesh, waterMesh, sun, ambient, sky;
  let view = 'pano', touring = false, frameCount = 0, fps = 0, lastStats = 0, lastTime = 0;
  const groups = {}, placements = [], markers = [], labels = [];
  const matrices = new T.Object3D();
  const skyUniforms = { top: { value: new T.Color('#a6c2b7') }, bottom: { value: new T.Color('#e7e3ce') }, sunDir: { value: new T.Vector3(-.6, .6, -.4) } };
  const waterUniforms = { clock: { value: 0 }, deep: { value: new T.Color('#689a92') }, pale: { value: new T.Color('#a9c1ab') }, lightDir: { value: new T.Vector3(-.6, .6, -.4) }, haze: { value: new T.Color('#d9dfcf') } };
  const control = { target: new T.Vector3(), desiredTarget: new T.Vector3(), azimuth: -.37, desiredAzimuth: -.37, polar: .86, desiredPolar: .86, distance: 17700, desiredDistance: 17700 };
  const startTime = performance.now();
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let quality = { canopyCount: 0, roofGroups: D.settlements.length, roofUnits: 0, sourceBuildings: D.settlements.reduce((s, a) => s + a.sourceCount, 0) };

  function sample(x, z, field = 'heights', nearest = false) {
    const gx = clamp((x - terrain.x0) / terrain.dx, 0, terrain.nx - 1.001);
    const gz = clamp((z - terrain.z0) / terrain.dz, 0, terrain.nz - 1.001);
    const a = terrain[field];
    if (!a) return 0;
    if (nearest) return a[Math.round(gz) * terrain.nx + Math.round(gx)];
    const ix = Math.floor(gx), iz = Math.floor(gz), tx = gx - ix, tz = gz - iz;
    const p = iz * terrain.nx + ix;
    return T.MathUtils.lerp(T.MathUtils.lerp(a[p], a[p + 1], tx), T.MathUtils.lerp(a[p + terrain.nx], a[p + terrain.nx + 1], tx), tz);
  }
  function height(x, z) { return sample(x, z) * opts.relief; }
  function hash(n) { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); }
  function rng(id, n = 0) { let h = 2166136261; for (let i = 0; i < String(id).length; i++) h = Math.imul(h ^ String(id).charCodeAt(i), 16777619); return hash((h >>> 0) + n * 13.13); }
  function color(hex) { return new T.Color(hex); }
  function addPlacement(object, x, z, offset = 0) { object.position.set(x, height(x, z) + offset, z); placements.push({ object, x, z, offset }); }

  function makeTerrain() {
    const positions = [], colors = [], sourceY = [];
    const base = { 10: '#68806a', 20: '#87996c', 30: '#a3aa85', 40: '#9ba483', 50: '#b9b49d', 60: '#b7b49e', 80: '#a8bbaa', 90: '#91a68d' };
    const cell = (a, b, c) => {
      const ids = [a, b, c];
      if (ids.some(i => terrain.heightValidMask && !terrain.heightValidMask[i])) return;
      if (ids.reduce((s, i) => s + terrain.landMask[i], 0) < 2) return;
      for (const i of ids) {
        const ix = i % terrain.nx, iz = Math.floor(i / terrain.nx);
        const x = terrain.x0 + ix * terrain.dx, z = terrain.z0 + iz * terrain.dz;
        const y = Math.round(terrain.heights[i] / 2) * 2;
        const c = color(base[terrain.landcover[i]] || '#a7ac8b');
        if (terrain.heights[i] > 90) c.lerp(color('#5b8576'), clamp((terrain.heights[i] - 90) / 350, 0, .45));
        if (!terrain.focusMask[i]) c.lerp(color('#bdc7af'), .63);
        c.multiplyScalar(.94 + hash(ix * .7 + iz * 3.5) * .1);
        positions.push(x, y * opts.relief, z); sourceY.push(y); colors.push(c.r, c.g, c.b);
      }
    };
    for (let z = 0; z < terrain.nz - 1; z++) for (let x = 0; x < terrain.nx - 1; x++) {
      const a = z * terrain.nx + x, b = a + 1, c = a + terrain.nx, d = c + 1;
      cell(a, c, b); cell(b, c, d);
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    geometry.userData.sourceY = sourceY;
    const material = new T.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: T.DoubleSide });
    material.onBeforeCompile = shader => {
      shader.vertexShader = 'varying vec3 vLandscape;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvLandscape = position;');
      shader.fragmentShader = 'varying vec3 vLandscape;\n' + shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        float grain = fract(sin(dot(floor(vLandscape.xz/12.),vec2(12.9898,78.233)))*43758.5453);
        diffuseColor.rgb *= .97 + grain*.06;
      `);
    };
    terrainMesh = new T.Mesh(geometry, material); terrainMesh.receiveShadow = true;
    scene.add(terrainMesh);
  }

  function makeWater() {
    groups.water = new T.Group(); scene.add(groups.water);
    const mat = new T.ShaderMaterial({ uniforms: waterUniforms, side: T.DoubleSide,
      vertexShader: `varying vec3 wpos; void main(){ vec4 p=modelMatrix*vec4(position,1.);wpos=p.xyz;gl_Position=projectionMatrix*viewMatrix*p; }`,
      fragmentShader: `uniform float clock;uniform vec3 deep,pale,lightDir,haze;varying vec3 wpos;
      void main(){
        vec2 p=wpos.xz;
        float a=dot(p,vec2(.007,.004))+clock*.22;
        float b=dot(p,vec2(-.012,.009))-clock*.16;
        vec3 n=normalize(vec3(cos(a)*.014+cos(b)*.006,1.,sin(a)*.012-sin(b)*.008));
        vec3 eye=normalize(cameraPosition-wpos);
        float fr=pow(1.-max(dot(n,eye),0.),3.);
        vec3 c=mix(deep,pale,.24+fr*.55);
        float light=pow(max(dot(reflect(-normalize(lightDir),n),eye),0.),120.);
        c+=vec3(.65,.49,.28)*light*.35;
        float fleck=sin(a*1.8+b)*sin(a*.4-b*.7);
        c+=vec3(.004)*fleck;
        float fog=smoothstep(14000.,46000.,distance(cameraPosition,wpos));
        gl_FragColor=vec4(mix(c,haze,fog),1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }` });
    waterMesh = new T.Mesh(new T.PlaneGeometry(140000, 140000), mat);
    waterMesh.rotation.x = -Math.PI / 2; waterMesh.position.y = lake * opts.relief - .2;
    groups.water.add(waterMesh);
    // Source inland waters retain their boundary/holes; height is a display drape.
    const vertices = [], waterHeights = [];
    for (const p of D.waterPolygons) {
      if (!p.rings?.length || (p.sourceAreaM2 || 0) > 1e8) continue;
      const shape = new T.Shape(p.rings[0].map(v => new T.Vector2(v[0], v[1])));
      for (const ring of p.rings.slice(1)) shape.holes.push(new T.Path(ring.map(v => new T.Vector2(v[0], v[1]))));
      const geo = new T.ShapeGeometry(shape).toNonIndexed();
      const a = geo.attributes.position;
      for (let j = 0; j < a.count; j++) {
        const x = a.getX(j), z = a.getY(j), y = sample(x, z);
        vertices.push(x, y * opts.relief + 1.6, z); waterHeights.push(y);
      }
      geo.dispose();
    }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
    g.userData.sourceY = waterHeights; g.userData.offset = 1.6;
    const pond = new T.Mesh(g, new T.MeshBasicMaterial({ color: '#84aba1', side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }));
    groups.water.add(pond); groups.water.userData.pond = pond;
  }

  function boxGeometry(parts) {
    const pos = [], norm = [];
    for (const p of parts) {
      const g = new T.BoxGeometry(p[3], p[4], p[5]).toNonIndexed();
      g.translate(p[0], p[1], p[2]); pos.push(...g.attributes.position.array); norm.push(...g.attributes.normal.array); g.dispose();
    }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new T.Float32BufferAttribute(norm, 3)); return g;
  }
  function buildHouseRecords() {
    const records = [];
    for (const s of D.settlements) {
      const campus = s.semanticType === 'campus';
      records.push({ ...s, w: s.width, d: s.depth, h: s.height, campus });
    }
    return records;
  }
  const houses = buildHouseRecords();
  const houseMeshes = [];
  function makeHouses() {
    groups.buildings = new T.Group(); scene.add(groups.buildings);
    const body = new T.InstancedMesh(new T.BoxGeometry(1, 1, 1), new T.MeshLambertMaterial({ color: '#ffffff' }), houses.length);
    const parts = []; for (let i = 0; i < 5; i++) parts.push([0, .075 + i * .075, 0, 1.09, .095, 1.13 * (1 - i * .17)]);
    const roofs = new T.InstancedMesh(boxGeometry(parts), new T.MeshLambertMaterial({ color: '#ffffff', flatShading: true }), houses.length);
    const trim = new T.InstancedMesh(new T.BoxGeometry(1, 1, 1), new T.MeshLambertMaterial({ color: '#8c846e' }), houses.length);
    for (const m of [body, roofs, trim]) { m.castShadow = true; m.receiveShadow = true; m.instanceMatrix.setUsage(T.DynamicDrawUsage); m.frustumCulled = false; groups.buildings.add(m); }
    houseMeshes.push(body, roofs, trim);
    houses.forEach((s, i) => {
      const v = rng(s.id);
      body.setColorAt(i, color(s.campus ? '#d7c7a6' : '#e3dcc6').multiplyScalar(.93 + v * .12));
      roofs.setColorAt(i, color(s.campus ? '#a5aaa0' : '#405254').multiplyScalar(.85 + v * .24));
    });
    updateHouseMatrices();
    quality.roofUnits = houses.length;
  }
  function updateHouseMatrices() {
    if (!houseMeshes.length) return;
    const [body, roof, trim] = houseMeshes;
    houses.forEach((s, i) => {
      const y = height(s.x, s.z) + .7;
      const h = s.h * (s.campus ? 1.35 : 1.15);
      matrices.rotation.set(0, -s.angle, 0);
      matrices.position.set(s.x, y + h / 2, s.z); matrices.scale.set(s.w, h, s.d); matrices.updateMatrix(); body.setMatrixAt(i, matrices.matrix);
      matrices.position.y = y + h; matrices.scale.set(s.w, s.campus ? h * .12 : h * .95, s.d); matrices.updateMatrix(); roof.setMatrixAt(i, matrices.matrix);
      matrices.position.y = y + h * .65; matrices.scale.set(s.w * 1.025, Math.max(.8, h * .09), s.d * 1.025); matrices.updateMatrix(); trim.setMatrixAt(i, matrices.matrix);
    });
    for (const m of houseMeshes) { m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); }
  }

  const treeRecords = [], treeMeshes = [];
  function makeTrees() {
    groups.trees = new T.Group(); scene.add(groups.trees);
    const occupied = new Set(houses.map(s => `${Math.round(s.x / 65)},${Math.round(s.z / 65)}`));
    for (let j = 0; j < terrain.nz; j++) for (let i = 0; i < terrain.nx; i++) {
      const k = j * terrain.nx + i;
      if (!terrain.landMask[k] || !terrain.focusMask[k] || terrain.landcover[k] !== 10) continue;
      for (let t = 0; t < 3; t++) {
        const x = terrain.x0 + i * terrain.dx + (hash(k + t * .71) - .5) * 88;
        const z = terrain.z0 + j * terrain.dz + (hash(k + t * 3.71 + .8) - .5) * 88;
        if (occupied.has(`${Math.round(x / 65)},${Math.round(z / 65)}`)) continue;
        if (!sample(x, z, 'landMask', true)) continue;
        treeRecords.push({ x, z, size: 11 + hash(k * .12 + t) * 11, r: hash(k * .37 + t) * Math.PI });
      }
    }
    const crown = new T.InstancedMesh(new T.IcosahedronGeometry(1, 0), new T.MeshLambertMaterial({ color: '#ffffff', flatShading: true }), treeRecords.length);
    const trunk = new T.InstancedMesh(new T.BoxGeometry(1, 1, 1), new T.MeshLambertMaterial({ color: '#7b7258' }), treeRecords.length);
    for (const m of [crown, trunk]) { m.instanceMatrix.setUsage(T.DynamicDrawUsage); m.frustumCulled = false; groups.trees.add(m); }
    treeRecords.forEach((t, i) => crown.setColorAt(i, color('#567a50').lerp(color('#8b9a5f'), hash(i * .42) * .4).multiplyScalar(.8 + hash(i) * .35)));
    treeMeshes.push(crown, trunk); updateTrees(); quality.canopyCount = treeRecords.length;
  }
  function updateTrees() {
    if (!treeMeshes.length) return;
    const [crown, trunk] = treeMeshes;
    treeRecords.forEach((t, i) => {
      const y = height(t.x, t.z);
      matrices.rotation.set(0, t.r, 0); matrices.position.set(t.x, y + t.size * .84, t.z); matrices.scale.set(t.size * 1.15, t.size * .73, t.size * 1.1); matrices.updateMatrix(); crown.setMatrixAt(i, matrices.matrix);
      matrices.position.y = y + t.size * .35; matrices.scale.set(1.6, t.size * .72, 1.6); matrices.updateMatrix(); trunk.setMatrixAt(i, matrices.matrix);
    });
    treeMeshes.forEach(m => { m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); });
  }

  const ribbonMeshes = [];
  function ribbon(points, width, positions, sources, isBridge) {
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz);
      if (l < .01) continue;
      const ox = dz / l * width / 2, oz = -dx / l * width / 2;
      const corners = [[a[0] + ox, a[1] + oz], [a[0] - ox, a[1] - oz], [b[0] + ox, b[1] + oz], [b[0] - ox, b[1] - oz]];
      for (const idx of [0, 1, 2, 2, 1, 3]) {
        const [x, z] = corners[idx]; const y = sample(x, z);
        const offset = isBridge ? 5 : 2.3;
        positions.push(x, y * opts.relief + offset, z); sources.push([y, offset]);
      }
    }
  }
  function makeNetworks() {
    groups.roads = new T.Group(); groups.waterways = new T.Group(); scene.add(groups.roads, groups.waterways);
    const major = [], minor = [], water = [], mS = [], nS = [], wS = [];
    for (const r of D.roads) {
      const isMajor = /^(primary|secondary|tertiary|trunk)/.test(r.kind);
      const width = isMajor ? 17 : (r.kind === 'path' || r.kind === 'footway' ? 5 : 9);
      ribbon(r.points, width, isMajor ? major : minor, isMajor ? mS : nS, r.bridge);
    }
    for (const r of D.waterways) ribbon(r.points, r.kind === 'river' ? 17 : 10, water, wS, false);
    [[major, mS, '#d8c7a0', groups.roads], [minor, nS, '#b4a98c', groups.roads], [water, wS, '#6a9c98', groups.waterways]].forEach(([p, s, c, group]) => {
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(p, 3));
      const m = new T.Mesh(g, new T.MeshBasicMaterial({ color: c, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3 }));
      m.userData.heightSources = s; ribbonMeshes.push(m); group.add(m);
    });
  }

  function pointInRing(x, z, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if (((a[1] > z) !== (b[1] > z)) && (x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0])) inside = !inside;
    }
    return inside;
  }
  function makePois() {
    groups.markers = new T.Group(); scene.add(groups.markers);
    const overlay = document.createElement('div'); overlay.id = 'map-labels'; document.getElementById('scene-shell').appendChild(overlay);
    for (const p of D.pois) {
      const important = ['陆巷村', '莫厘峰', '三山村', '东山镇'].includes(p.name);
      const label = document.createElement('button'); label.type = 'button'; label.className = 'map-label'; label.textContent = p.name;
      label.dataset.category = p.category; label.setAttribute('aria-label', '查看' + p.name); overlay.appendChild(label);
      label.addEventListener('click', () => showPoi(p));
      const dot = new T.Mesh(new T.CylinderGeometry(important ? 16 : 10, important ? 16 : 10, 5, 8), new T.MeshBasicMaterial({ color: important ? '#a44e36' : '#c0a66d' }));
      addPlacement(dot, p.x, p.z, 10); groups.markers.add(dot); dot.userData.poi = p; markers.push(dot);
      labels.push({ element: label, p, important, world: new T.Vector3() });
      // Campus / park geometry is a real source outline; no invented playing field.
      const outline = p.outlines || (p.rings ? [p.rings] : []);
      const pathSets = [];
      for (const part of outline) {
        if (part.length && typeof part[0]?.[0] === 'number') pathSets.push(part);
        else for (const ring of part) if (ring.length) pathSets.push(ring);
      }
      if (pathSets.length) {
        const vertices = [], sources = [];
        pathSets.forEach(ring => ribbon(ring, 4, vertices, sources, false));
        const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
        const mesh = new T.Mesh(geo, new T.MeshBasicMaterial({ color: p.category === 'school' ? '#b69965' : '#80916c', side: T.DoubleSide }));
        mesh.userData.heightSources = sources; ribbonMeshes.push(mesh); groups.markers.add(mesh);
      }
    }
  }
  function showPoi(p) {
    const desc = p.category === 'school' ? '按来源校园边界保留占地量级；教学体量沿实际建筑轮廓概括，未知操场与内部布局未补造。' :
      p.category === 'cultural_site' ? '此处保留来源中的园区位置与边界，作为文化节点。现有资料不足以逐栋还原园内主楼。' :
      /陆巷/.test(p.name) ? '陆巷村位于东山西侧的山湖之间。村点来自地图记录，周边普通民居用屋顶组团概括；特色院落与港道仍待补足定位资料。' :
      p.category === 'peak' ? '保留源地形中的山势与相对高低。地形起伏可统一调节，坡面林木为根据土地覆盖布置的概括符号。' :
      p.category === 'port' ? '保留来源地点锚点与邻近岸线关系。未以点位推造码头设施、船只或工业港池。' :
      '名称与位置来自地图记录，周边山湖与聚落经过概括表达；点位不代替精确建筑范围或法定边界。';
    emit('ds:pick', { title: p.name, category: ({ school: '校园', port: '水陆节点', peak: '山体', cultural_site: '文化园区', village: '聚落' })[p.category] || '山湖节点', description: desc,
      evidence: `OpenStreetMap · ${p.evidence?.osmId || p.id} · 2026-10-19 快照`, status: '来源定位 · 概括表达' });
  }

  function makeSky() {
    sky = new T.Mesh(new T.SphereGeometry(90000, 24, 12), new T.ShaderMaterial({ uniforms: skyUniforms, side: T.BackSide, depthWrite: false,
      vertexShader: 'varying vec3 vDir;void main(){vDir=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: `uniform vec3 top,bottom,sunDir;varying vec3 vDir;void main(){vec3 d=normalize(vDir);float h=smoothstep(-.02,.7,d.y);vec3 c=mix(bottom,top,h);float sun=pow(max(dot(d,normalize(sunDir)),0.),700.);c+=vec3(.28,.20,.10)*sun;gl_FragColor=vec4(c,1.);
      #include <colorspace_fragment>
      }` }));
    scene.add(sky);
  }
  function updateEnvironment() {
    const t = opts.time, warmth = Math.abs(t - .52) * 1.8;
    const haze = color('#d4decd').lerp(color('#e1c5a5'), warmth * .65);
    skyUniforms.top.value.copy(color('#a9c2b6').lerp(color('#abaeab'), warmth * .6));
    skyUniforms.bottom.value.copy(color('#e8e6cf').lerp(color('#e4c5a0'), warmth));
    waterUniforms.deep.value.copy(color('#61958f').lerp(color('#869b8e'), warmth * .6));
    waterUniforms.pale.value.copy(color('#a0bba4').lerp(color('#c3b79b'), warmth * .65));
    waterUniforms.haze.value.copy(haze);
    const a = .25 + t * Math.PI * .7;
    sun.position.set(-8000 * Math.cos(t * .8), 4000 + Math.sin(a) * 9500, -8500 + t * 6500);
    sun.color.copy(color('#fff2cd').lerp(color('#edba88'), warmth * .75));
    sun.intensity = 1.65 - warmth * .4;
    ambient.intensity = .92 - warmth * .2;
    waterUniforms.lightDir.value.copy(sun.position).normalize(); skyUniforms.sunDir.value.copy(waterUniforms.lightDir.value);
    scene.fog.color.copy(haze); renderer.setClearColor(haze); renderer.toneMappingExposure = 1 - warmth * .1;
    renderer.shadowMap.needsUpdate = true;
  }
  function updateRelief() {
    const g = terrainMesh.geometry, a = g.attributes.position;
    for (let i = 0; i < a.count; i++) a.setY(i, g.userData.sourceY[i] * opts.relief);
    a.needsUpdate = true; g.computeVertexNormals(); g.computeBoundingSphere();
    waterMesh.position.y = lake * opts.relief - .2;
    const pg = groups.water.userData.pond.geometry, pa = pg.attributes.position;
    for (let i = 0; i < pa.count; i++) pa.setY(i, pg.userData.sourceY[i] * opts.relief + pg.userData.offset);
    pa.needsUpdate = true; pg.computeBoundingSphere();
    ribbonMeshes.forEach(m => {
      const a = m.geometry.attributes.position;
      m.userData.heightSources.forEach((s, i) => a.setY(i, s[0] * opts.relief + s[1]));
      a.needsUpdate = true; m.geometry.computeBoundingSphere();
    });
    placements.forEach(p => p.object.position.y = height(p.x, p.z) + p.offset);
    updateHouseMatrices(); updateTrees();
    renderer.shadowMap.needsUpdate = true;
    control.desiredTarget.y = Math.max(50, height(control.desiredTarget.x, control.desiredTarget.z) * .5);
  }

  function setView(name, immediate = false) {
    view = name; touring = false;
    const center = D.meta.focusCenter || [2000, 800];
    let target, az, polar, distance;
    const narrow = innerWidth < 700;
    if (name === 'top') { target = [-800, 900]; az = 0; polar = .075; distance = narrow ? 49000 : 20200; }
    else if (name === 'luxiang') { const p = D.pois.find(p => /陆巷/.test(p.name)); target = p ? [p.x, p.z] : [-807, -459]; az = -.78; polar = .96; distance = narrow ? 4100 : 3200; }
    else { target = [1200, 1300]; az = -.05; polar = 1.02; distance = narrow ? 45000 : 18800; }
    control.desiredTarget.set(target[0], Math.max(70, height(...target) * .4), target[1]);
    control.desiredAzimuth = az; control.desiredPolar = polar; control.desiredDistance = distance;
    if (immediate || reducedMotion) { control.target.copy(control.desiredTarget); control.azimuth = az; control.polar = polar; control.distance = distance; }
    window.DSUI?.syncState();
  }
  function updateCamera(dt) {
    if (touring) { control.desiredAzimuth += dt * .045; }
    const ease = reducedMotion ? 1 : 1 - Math.exp(-dt * 5.5);
    control.target.lerp(control.desiredTarget, ease);
    for (const [a, b] of [['azimuth', 'desiredAzimuth'], ['polar', 'desiredPolar'], ['distance', 'desiredDistance']]) control[a] = T.MathUtils.lerp(control[a], control[b], ease);
    const s = Math.sin(control.polar), d = control.distance;
    camera.position.set(control.target.x + Math.sin(control.azimuth) * s * d, control.target.y + Math.cos(control.polar) * d, control.target.z + Math.cos(control.azimuth) * s * d);
    camera.position.y = Math.max(camera.position.y, height(camera.position.x, camera.position.z) + 55);
    camera.lookAt(control.target); camera.updateMatrixWorld(); sky.position.copy(camera.position);
  }
  function updateLabels() {
    const occupied = [], w = innerWidth, h = innerHeight;
    for (const l of [...labels].sort((a, b) => Number(b.important) - Number(a.important))) {
      const p = l.p;
      const near = Math.hypot(control.target.x - p.x, control.target.z - p.z) < control.distance * .6;
      let visible = opts.labels && (l.important || (control.distance < 7000 && near));
      if (visible) {
        l.world.set(p.x, height(p.x, p.z) + 65, p.z).project(camera);
        const x = (l.world.x * .5 + .5) * w, y = (-l.world.y * .5 + .5) * h;
        visible = l.world.z < 1 && l.world.z > -1 && x > 65 && x < w - 65 && y > 145 && y < h - 110;
        if (w > 700 && x > w - 280 && y < 545 && !document.getElementById('scene-controls').hidden) visible = false;
        if (visible && occupied.some(r => Math.abs(r.x - x) < (r.width + p.name.length * 13) / 2 + 20 && Math.abs(r.y - y) < 36)) visible = false;
        if (visible) { occupied.push({ x, y, width: p.name.length * 13 }); l.element.style.transform = `translate(${x}px,${y}px) translate(-50%,-100%)`; }
      }
      l.element.hidden = !visible;
    }
    groups.markers.visible = opts.labels;
  }
  function bindControls(canvas) {
    const pointers = new Map(); let previous = null, previousSpan = 0;
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); previous = { x: e.clientX, y: e.clientY, button: e.button }; touring = false; view = 'orbit'; window.DSUI?.syncState(); });
    canvas.addEventListener('pointermove', e => {
      if (!pointers.has(e.pointerId)) return;
      const old = pointers.get(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const dx = e.clientX - old.x, dy = e.clientY - old.y;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()], span = Math.hypot(a.x - b.x, a.y - b.y);
        if (previousSpan) control.desiredDistance = clamp(control.desiredDistance * previousSpan / span, 650, 52000);
        previousSpan = span; pan(dx * .5, dy * .5);
      } else if (e.buttons === 2 || e.shiftKey) pan(dx, dy);
      else { control.desiredAzimuth -= dx * .004; control.desiredPolar = clamp(control.desiredPolar + dy * .0035, .08, 1.43); }
    });
    const end = e => { pointers.delete(e.pointerId); previousSpan = 0; previous = null; };
    canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('wheel', e => { e.preventDefault(); touring = false; control.desiredDistance = clamp(control.desiredDistance * Math.exp(e.deltaY * .001), 650, 52000); }, { passive: false });
    canvas.addEventListener('keydown', e => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', 'r', 'R'].includes(e.key)) e.preventDefault();
      if (e.key === 'ArrowLeft') control.desiredAzimuth -= .1;
      if (e.key === 'ArrowRight') control.desiredAzimuth += .1;
      if (e.key === 'ArrowUp') control.desiredPolar = clamp(control.desiredPolar - .1, .08, 1.43);
      if (e.key === 'ArrowDown') control.desiredPolar = clamp(control.desiredPolar + .1, .08, 1.43);
      if (e.key === '+' || e.key === '=') control.desiredDistance = Math.max(650, control.desiredDistance * .88);
      if (e.key === '-') control.desiredDistance = Math.min(52000, control.desiredDistance / .88);
      if (/^[rR]$/.test(e.key)) setView('pano');
    });
    function pan(dx, dy) {
      const amount = control.desiredDistance * .00075;
      const ca = Math.cos(control.azimuth), sa = Math.sin(control.azimuth);
      control.desiredTarget.x = clamp(control.desiredTarget.x - (dx * ca + dy * sa) * amount, -12000, 12000);
      control.desiredTarget.z = clamp(control.desiredTarget.z + (dx * sa - dy * ca) * amount, -11000, 11000);
      control.desiredTarget.y = Math.max(50, height(control.desiredTarget.x, control.desiredTarget.z) * .5);
    }
  }
  function screenshot() {
    renderer.render(scene, camera);
    const source = renderer.domElement, c = document.createElement('canvas'); c.width = source.width; c.height = source.height;
    const ctx = c.getContext('2d'); ctx.drawImage(source, 0, 0);
    const s = c.width / innerWidth; ctx.scale(s, s); ctx.fillStyle = '#f3ead6'; ctx.fillRect(25, 25, 260, 73); ctx.fillStyle = '#2c4841'; ctx.font = '24px Microsoft YaHei'; ctx.fillText('东山 · 太湖山居', 42, 59); ctx.font = '12px Microsoft YaHei'; ctx.fillText('真实地理 · 概括表达 / 起伏 ' + opts.relief.toFixed(1) + '×', 42, 81);
    ctx.font = '10px Microsoft YaHei'; ctx.fillStyle = '#213d36'; ctx.fillText('© OSM contributors · Overture · Copernicus DEM · ESA WorldCover | 原型表达，非现状精测地图', 24, innerHeight - 22);
    const a = document.createElement('a'); a.download = '东山-太湖山居.png'; a.href = c.toDataURL('image/png'); a.click(); return a.href;
  }
  function init() {
    const canvas = document.getElementById('world');
    renderer = new T.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.4)); renderer.setSize(innerWidth, innerHeight);
    renderer.outputColorSpace = T.SRGBColorSpace; renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = false; renderer.shadowMap.type = T.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = false;
    scene = new T.Scene(); scene.fog = new T.FogExp2('#d4decd', .000025);
    camera = new T.PerspectiveCamera(42, innerWidth / innerHeight, 8, 230000);
    ambient = new T.HemisphereLight('#e6edd6', '#8c9c7d', 1.5); scene.add(ambient);
    sun = new T.DirectionalLight('#fff2cd', 2.1); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); sun.shadow.camera.left = -12000; sun.shadow.camera.right = 12000; sun.shadow.camera.top = 11000; sun.shadow.camera.bottom = -11000; sun.shadow.camera.near = 100; sun.shadow.camera.far = 40000; sun.shadow.normalBias = 5; sun.shadow.bias = -.00015; scene.add(sun);
    makeSky(); makeWater(); makeTerrain(); makeNetworks(); makeHouses(); makeTrees(); makePois(); updateEnvironment(); bindControls(canvas); setView('pano', true); updateCamera(1);
    window.DSApp = {
      setView,
      setOption(key, value) {
        if (!(key in opts)) return;
        opts[key] = key === 'relief' ? clamp(Number(value), 1, 4) : key === 'time' ? clamp(Number(value), 0, 1) : !!value;
        if (key === 'relief') updateRelief();
        else if (key === 'time') updateEnvironment();
        else if (groups[key]) groups[key].visible = opts[key];
        if (key === 'water') groups.waterways.visible = opts.water;
      },
      toggleTour() { touring = !touring; window.DSUI?.syncState(); return touring; }, screenshot,
      reset() { Object.assign(opts, { relief: 2.4, time: .52, buildings: true, roads: true, water: true, trees: true, labels: true }); updateRelief(); updateEnvironment(); for (const g of Object.values(groups)) g.visible = true; setView('pano'); },
      getState() { return { options: { ...opts }, touring, view }; },
      getDiagnostics() { return { quality, info: { triangles: renderer.info.render.triangles, calls: renderer.info.render.calls, geometries: renderer.info.memory.geometries }, camera: { position: camera.position.toArray(), target: control.target.toArray(), distance: control.distance }, fps, data: D.meta }; },
      pick(name) { const p = D.pois.find(p => p.name === name || p.id === name); if (p) showPoi(p); },
      renderNow() { updateCamera(1); updateLabels(); renderer.render(scene, camera); },
    };
    addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); if (view === 'pano' || view === 'top') setView(view); });
    renderer.render(scene, camera); emit('ds:ready');
    function frame(now) {
      requestAnimationFrame(frame);
      const dt = Math.min((now - (lastTime || now - 16.7)) / 1000, .06); lastTime = now;
      if (!document.hidden) {
        waterUniforms.clock.value = reducedMotion ? 0 : (now - startTime) / 1000;
        updateCamera(dt); updateLabels();
        const shadows = control.distance < 6500;
        if (renderer.shadowMap.enabled !== shadows) { renderer.shadowMap.enabled = shadows; renderer.shadowMap.needsUpdate = true; }
        renderer.render(scene, camera); frameCount++;
        if (now - lastStats > 1200) {
          fps = Math.round(frameCount / ((now - lastStats) / 1000)); frameCount = 0; lastStats = now;
          emit('ds:stats', { renderBuildings: quality.roofGroups, sourceBuildings: quality.sourceBuildings, roads: D.roads.length, triangles: renderer.info.render.triangles, fps, mode: touring ? 'tour' : view });
        }
      }
    }
    requestAnimationFrame(frame);
  }
  try { init(); } catch (e) { fail(e); }
})();
