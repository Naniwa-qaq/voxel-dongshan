/* Runtime check of the real local file entry. Original unified QA is unchanged.
   node scripts/verify_ecology_runtime.cjs */
'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const {pathToFileURL} = require('node:url');
const {chromium} = require('C:/Users/YHJ/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(__dirname, '..'), out = path.join(root, '东山镇_重制版/qa');
const url = pathToFileURL(path.join(root, '东山镇_重制版/index.html')).href;
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sourceAudit = JSON.parse(fs.readFileSync(path.join(root, '东山镇_重制版/data/unified-map-qa.json'), 'utf8').replace(/^\uFEFF/, ''));
const sourceHashes = Object.entries(sourceAudit.inputsSha256).map(([file, expected]) => ({file,
  expected, actual: hash(path.join(root, file))})).map(s => ({...s, unchanged: s.expected === s.actual}));
const errors = [], failed = [], requests = [], records = [], nav = [];
fs.mkdirSync(out, {recursive: true});

(async () => {
  const browser = await chromium.launch({executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox', '--allow-file-access-from-files']});
  let page;
  try {
    page = await browser.newPage({viewport: {width: 1440, height: 1000}, deviceScaleFactor: 1});
    await page.addInitScript(() => {
      window.DSShaderAudit = {compiled: 0, linked: 0, errors: []};
      for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
        if (!C) continue;
        const compile = C.prototype.compileShader, link = C.prototype.linkProgram;
        C.prototype.compileShader = function (s) {const r = compile.call(this, s); window.DSShaderAudit.compiled++;
          if (!this.getShaderParameter(s, this.COMPILE_STATUS)) window.DSShaderAudit.errors.push(this.getShaderInfoLog(s)); return r;};
        C.prototype.linkProgram = function (p) {const r = link.call(this, p); window.DSShaderAudit.linked++;
          if (!this.getProgramParameter(p, this.LINK_STATUS)) window.DSShaderAudit.errors.push(this.getProgramInfoLog(p)); return r;};
      }
    });
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => {if (m.type() === 'error' || /\bNaN\b/.test(m.text())) errors.push(m.text());});
    page.on('request', r => requests.push(r.url()));
    page.on('requestfailed', r => failed.push({url: r.url(), error: r.failure()}));
    console.log('Loading file entry: ' + url);
    await page.goto(url, {waitUntil: 'load', timeout: 60000});
    await page.waitForFunction(() => window.DSRemake && (DSRemake.ready || DSRemake.errors.length), null, {timeout: 600000});
    const init = await page.evaluate(() => ({ready: DSRemake.ready, errors: DSRemake.errors}));
    if (!init.ready) throw new Error(JSON.stringify(init));
    await page.waitForFunction(() => document.getElementById('loading').style.display === 'none', null, {timeout: 20000});
    console.log('Scene ready; checking every ground-cover centre against independently rebuilt geometry.');

    const signature = () => page.evaluate(() => ({world: DSRemake.worldIdentity,
      ids: DSRemake.residentIds.join('|'), count: DSRemake.residentHouseCount}));
    const initial = await signature(), requestCount = requests.length;
    const geometryChecks = await page.evaluate(() => {
      const D = DSUnifiedMap, R = DSRemake, samples = R.groundCoverSamples || [];
      // Independent winding-number polygon inclusion. Source geometry is read
      // directly; no scene hardGroundAt/roadAt/inside helper is used here.
      function polyContains(x, z, p) {
        if (!p || p.length < 3) return false;
        let winding = 0;
        for (let i = 0; i < p.length; i++) {
          const a = p[i], b = p[(i + 1) % p.length], cross = (b[0] - a[0]) * (z - a[1]) - (x - a[0]) * (b[1] - a[1]);
          if (a[1] <= z && b[1] > z && cross > 0) winding++;
          else if (a[1] > z && b[1] <= z && cross < 0) winding--;
        }
        return winding !== 0;
      }
      function segmentD2(x, z, a, b) {
        const ax = x - a[0], az = z - a[1], bx = x - b[0], bz = z - b[1];
        const dx = b[0] - a[0], dz = b[1] - a[1], len2 = dx * dx + dz * dz;
        if (!len2 || ax * dx + az * dz <= 0) return ax * ax + az * az;
        if (bx * -dx + bz * -dz <= 0) return bx * bx + bz * bz;
        const cross = ax * dz - az * dx; return cross * cross / len2;
      }
      const m = D.water.mask, lake = new Uint8Array(m.cols * m.rows);
      let offset = 0;
      for (let i = 0; i < m.runs.length; i += 2) {lake.fill(m.runs[i + 1], offset, offset + m.runs[i]); offset += m.runs[i];}
      function inLake(x, z) {const ix = Math.floor((x - m.minX) / m.step), iz = Math.floor((z - m.minZ) / m.step);
        return ix >= 0 && iz >= 0 && ix < m.cols && iz < m.rows && lake[iz * m.cols + ix] === 1;}
      const buildings = R.houses.filter(h => h.width && h.depth).map(h => ({...h, c: Math.cos(h.rotation || 0), s: Math.sin(h.rotation || 0)}));
      const grounds = (D.grounds || []).filter(g => g.kind !== 'garden');
      const fieldKinds = ['sportsField', 'basketballCourt', 'basketball', 'track'];
      const fields = grounds.filter(g => fieldKinds.includes(g.kind));
      function inBuilding(x, z, h) {const dx = x - h.x, dz = z - h.z;
        return Math.abs(h.c * dx - h.s * dz) < h.width / 2 && Math.abs(h.s * dx + h.c * dz) < h.depth / 2;}
      const lines = [];
      for (const r of D.roads || []) for (let i = 1; i < r.points.length; i++) lines.push({a: r.points[i - 1], b: r.points[i], half: r.width / 2, kind: 'road', id: r.id});
      for (const c of D.water.canals || []) for (let i = 1; i < c.points.length; i++) lines.push({a: c.points[i - 1], b: c.points[i], half: c.width / 2, kind: 'canal', id: c.id, canal: c});
      // An independent spatial index keeps the exhaustive source test cheap.
      const buckets = new Map(), key = (x, z) => `${Math.floor(x / 20)},${Math.floor(z / 20)}`;
      for (const l of lines) for (let x = Math.floor((Math.min(l.a[0], l.b[0]) - l.half - 1) / 20); x <= Math.floor((Math.max(l.a[0], l.b[0]) + l.half + 1) / 20); x++) {
        for (let z = Math.floor((Math.min(l.a[1], l.b[1]) - l.half - 1) / 20); z <= Math.floor((Math.max(l.a[1], l.b[1]) + l.half + 1) / 20); z++) {
          const k = `${x},${z}`; if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(l);
        }
      }
      const violations = [], counts = {lake: 0, pond: 0, road: 0, canal: 0, hardGround: 0, building: 0, playingField: 0, sceneHardMask: 0, grassUnderClosedCanopy: 0};
      let shadeSamples = 0, shadeNonGrass = 0, minRoadCentreClearance = Infinity;
      for (const p of samples) {
        const hit = [], e = R.ecologyAt(p.x, p.z);
        if (e.hardExcluded) hit.push('sceneHardMask');
        if (inLake(p.x, p.z)) hit.push('lake');
        if ((D.water.ponds || []).some(g => polyContains(p.x, p.z, g.polygon))) hit.push('pond');
        for (const l of buckets.get(key(p.x, p.z)) || []) {
          const d = Math.sqrt(segmentD2(p.x, p.z, l.a, l.b)); let half = l.half;
          if (l.canal && l.canal.head) {const c = l.canal, h = c.head.pointIndex === c.points.length - 1 ? c.points[c.points.length - 1] : c.points[0];
            // At a recorded tapering canal head, use the whole line's nearest
            // projected point to measure width, independently of scene helpers.
            let nearest = {distance: Infinity, x: p.x, z: p.z};
            for (let j = 1; j < c.points.length; j++) {const a = c.points[j - 1], b = c.points[j], vx = b[0] - a[0], vz = b[1] - a[1], t = Math.max(0, Math.min(1, ((p.x - a[0]) * vx + (p.z - a[1]) * vz) / (vx * vx + vz * vz || 1))), x = a[0] + vx * t, z = a[1] + vz * t, distance = Math.hypot(p.x - x, p.z - z); if (distance < nearest.distance) nearest = {distance, x, z};}
            const t = Math.min(1, Math.hypot(nearest.x - h[0], nearest.z - h[1]) / c.head.taperLength);
            half = (c.head.widthAtHead + (c.width - c.head.widthAtHead) * t) / 2;
          }
          if (l.kind === 'road') minRoadCentreClearance = Math.min(minRoadCentreClearance, d - half);
          if (d < half - 1e-6) hit.push(l.kind);
        }
        if (grounds.some(g => polyContains(p.x, p.z, g.polygon))) hit.push('hardGround');
        if (fields.some(g => polyContains(p.x, p.z, g.polygon))) hit.push('playingField');
        if (buildings.some(h => inBuilding(p.x, p.z, h))) hit.push('building');
        if (e.canopy > .52) {shadeSamples++; if (p.kind === 'grass') hit.push('grassUnderClosedCanopy'); else shadeNonGrass++;}
        for (const k of new Set(hit)) counts[k]++;
        if (hit.length && violations.length < 30) violations.push({point: p, hits: [...new Set(hit)]});
      }
      const fieldTrees = R.trees.filter(t => fields.some(g => polyContains(t.x, t.z, g.polygon))).length;
      return {checkedInstances: samples.length, independentSourceGeometry: {waterRleCells: lake.length, waterRleDecodeComplete: offset === lake.length,
        roadAndCanalSegments: lines.length, orientedBuildingFootprints: buildings.length, hardGroundPolygons: grounds.length,
        playingFieldPolygons: fields.length, method: 'winding-number polygons, independent distance-to-segment road/canal buffers, inverse-rotated building rectangles; direct source water RLE'},
        violations: counts, firstViolations: violations, shadeSamples, shadeNonGrass,
        minimumSampledRoadCentreClearance: Number.isFinite(minRoadCentreClearance) ? minRoadCentreClearance : null,
        noTreesInPlayingFields: fieldTrees === 0, fieldTrees,
        allSourceObjectsResident: D.houses.every(h => R.residentIds.includes(h.id))};
    });
    console.log(JSON.stringify({geometryChecks}, null, 2));

    async function shot(name, setup, bare = true) {
      await page.evaluate(({setup, bare}) => {DSRemake.setBare(bare);
        if (typeof setup === 'string') DSRemake.setView(setup); else DSRemake.setCamera(setup);
        DSRemake.render();}, {setup, bare});
      const r = await page.evaluate(() => ({png: DSRemake.capture(), camera: DSRemake.getCamera(), render: DSRemake.lastRender,
        groundVisible: DSRemake.groundCoverVisible, world: DSRemake.worldIdentity}));
      if (bare) fs.writeFileSync(path.join(out, `${name}.png`), Buffer.from(r.png.split(',')[1], 'base64'));
      else await page.screenshot({path: path.join(out, `${name}.png`)});
      delete r.png; records.push({name, ...r}); console.log('Captured ' + name);
    }
    await shot('ecology-overview', 'overview', false);
    const targets = await page.evaluate(() => {
      const samples = DSRemake.groundCoverSamples, trees = DSRemake.trees, D = DSUnifiedMap;
      function select(list, centre) {
        const scored = list.map(p => {let score = 0; for (const n of list) {const d = Math.hypot(p.x - n.x, p.z - n.z); if (d < 18) score += 1 - d / 18;}
          if (centre) score -= Math.hypot(p.x - centre[0], p.z - centre[1]) * .008; return {p, score};});
        scored.sort((a, b) => b.score - a.score); return scored[0]?.p || list[0];
      }
      const grass = select(samples.filter(p => p.kind === 'grass' && p.canopy < .15 && p.slope < .25), [60, 0]);
      const shade = select(samples.filter(p => ['fern', 'litter'].includes(p.kind) && p.canopy > .53 && p.canopy < .86), [60, 0]);
      const wet = select(samples.filter(p => p.kind === 'sedge'), [60, 0]);
      const fruit = select(trees.filter(t => ['loquat', 'waxberry'].includes(t.type)), [60, 0]);
      const school = D.zones.find(z => z.id === 'dongshan-school');
      const view = (p, distance, pitch, yaw = -.9) => p && ({target: [p.x, p.y == null ? p.baseY + 2.6 : p.y + .5, p.z], distance, pitch, yaw});
      return {grass: view(grass, 42, .45), shade: view(shade, 32, .34), wet: view(wet, 38, .4), fruit: view(fruit, 28, .35),
        school: {target: school.cameraSuggestions.overviewTarget, yaw: school.cameraSuggestions.yaw,
          pitch: .88, distance: 250}, selected: {grass, shade, wet, fruit}};
    });
    for (const [key, name] of [['grass', 'ecology-grassland'], ['shade', 'ecology-understory'], ['fruit', 'ecology-fruit-trees'], ['wet', 'ecology-wet-shore'], ['school', 'ecology-school-hardscape']]) {
      if (targets[key]) await shot(name, targets[key]); else errors.push(`No candidate for screenshot ${key}`);
    }
    for (const [id, expected] of [['dongshan-school', 'school'], ['chunzailou-garden', 'garden'], ['luxiang', 'waterfront'], ['all', 'overview']]) {
      await page.evaluate(() => DSRemake.setBare(false));
      await page.locator(`[data-place="${id}"]`).click();
      const active = await page.evaluate(() => DSRemake.view);
      nav.push({place: id, expected, active, signature: await signature()});
    }
    await shot('ecology-geography-background', 'overview', false);
    await page.locator('#geographicToggle').click();
    await page.waitForFunction(() => document.getElementById('geographicAudit').open);
    const dialog = await page.evaluate(() => {const d = document.getElementById('geographicAudit'); return {
      open: d.open, plotCount: d.querySelectorAll('svg').length, priorityRows: document.getElementById('auditOmissions').children.length,
      distanceRows: document.getElementById('auditDistances').children.length, summary: document.getElementById('auditSummary').textContent,
      horizontalOverflow: d.scrollWidth > d.clientWidth + 2, scrollHeight: d.scrollHeight, clientHeight: d.clientHeight};});
    await page.screenshot({path: path.join(out, 'ecology-geographic-dialog.png')});
    await page.locator('#closeGeographicAudit').click();
    const inventory = await page.evaluate(() => ({version: DSRemake.version, ready: DSRemake.ready, mode: DSRemake.mapMode,
      world: DSRemake.worldIdentity, loadedZoneIds: DSRemake.loadedZoneIds, houseCount: DSRemake.houseCount,
      residentHouseCount: DSRemake.residentHouseCount, treeCount: DSRemake.treeCount, treeTypeCounts: DSRemake.treeTypeCounts,
      groundCover: DSRemake.groundCover, generatedMs: DSRemake.generatedMs, terrainFaces: DSRemake.terrainFaces,
      treeChunks: DSRemake.treeChunkCount, surface: DSRemake.surfacePolicy, ecology: DSRemake.ecologyPolicy,
      shaderAudit: window.DSShaderAudit, hasSceneSwitchApi: typeof DSRemake.loadDistrict === 'function', errors: DSRemake.errors}));
    const checks = {
      originalAuditedInputsUnchanged: sourceHashes.every(s => s.unchanged), localFileEntry: url.startsWith('file:///'),
      singleContinuousWorld: inventory.mode === 'single-continuous-world',
      worldNeverReplaced: nav.every(n => n.signature.world === initial.world),
      residentObjectsNeverReplaced: nav.every(n => n.signature.ids === initial.ids),
      allPlacesResidentInitially: inventory.loadedZoneIds.length === 3, noResourceLoadsOnNavigation: requests.length === requestCount,
      noSceneSwitchApi: !inventory.hasSceneSwitchApi, buttonViewsCorrect: nav.every(n => n.active === n.expected),
      allSelectedBuildingsResident: geometryChecks.allSourceObjectsResident,
      noTreesInPlayingFields: geometryChecks.noTreesInPlayingFields,
      groundCoverPopulated: geometryChecks.checkedInstances > 1000,
      allGroundInstancesPassSceneHardMask: geometryChecks.violations.sceneHardMask === 0,
      allGroundInstancesClearIndependentGeometry: Object.entries(geometryChecks.violations).filter(([k]) => !['sceneHardMask', 'grassUnderClosedCanopy'].includes(k)).every(([, v]) => v === 0),
      shadeUsesNonGrass: geometryChecks.shadeSamples > 0 && geometryChecks.violations.grassUnderClosedCanopy === 0,
      atLeastEightTreeTypes: Object.keys(inventory.treeTypeCounts || {}).length >= 8,
      allSixNewTreeTypesPresent: ['camphor', 'evergreen', 'deciduous', 'loquat', 'waxberry', 'metasequoia'].every(t => inventory.treeTypeCounts[t] > 0),
      shadersCompileAndLink: inventory.shaderAudit.compiled > 0 && inventory.shaderAudit.linked > 0 && inventory.shaderAudit.errors.length === 0,
      noRuntimeErrors: inventory.errors.length === 0 && errors.length === 0,
      noResourceFailures: failed.length === 0,
      geographicDialogRenders: dialog.open && dialog.plotCount === 2 && dialog.priorityRows >= 5 && dialog.distanceRows === 6 && !dialog.horizontalOverflow,
      allRequiredVisualsCaptured: records.length >= 7
    };
    const result = {version: '2026-10-23-ecology-runtime-1', date: '2026-10-23', url,
      viewport: {width: 1440, height: 1000, dpr: 1}, checks, sourceHashes, geometryChecks, inventory,
      targets: targets.selected, dialog, records, nav, errors, failed};
    fs.writeFileSync(path.join(out, 'ecology-runtime.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({checks, trees: inventory.treeCount, treeTypes: inventory.treeTypeCounts,
      ground: inventory.groundCover, generatedMs: inventory.generatedMs, errors, failed}, null, 2));
    if (Object.values(checks).some(v => !v)) process.exitCode = 1;
  } catch (e) {
    const debug = page && await page.evaluate(() => ({state: window.DSRemake ? {ready: DSRemake.ready,
      errors: DSRemake.errors, loading: DSRemake.loading} : null, loading: document.getElementById('loadingText')?.textContent,
      error: document.getElementById('error')?.textContent})).catch(() => null);
    fs.writeFileSync(path.join(out, 'ecology-runtime-failure.json'), JSON.stringify({error: String(e), debug, errors, failed}, null, 2));
    if (page) await page.screenshot({path: path.join(out, 'ecology-runtime-failure.png')}).catch(() => {});
    throw e;
  } finally {await browser.close();}
})().catch(e => {console.error(e); process.exitCode = 1;});
