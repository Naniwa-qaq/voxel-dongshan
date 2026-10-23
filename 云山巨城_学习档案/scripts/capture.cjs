const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { chromium } = require('C:/Users/YHJ/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const out = path.resolve(__dirname, '..');
const source = process.argv[2] || 'C:/Users/YHJ/.codex/attachments/c80f289b-3ff1-429b-be36-156a9470fa95/云山巨城.html';
const imageDir = path.join(out, 'images');
fs.mkdirSync(imageDir, { recursive: true });
fs.mkdirSync(path.join(out, 'source'), { recursive: true });
fs.copyFileSync(source, path.join(out, 'source', '云山巨城.html'));

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    // Rendering is self-contained. Use local font fallbacks for reproducible offline captures.
    await page.route('https://fonts.googleapis.com/**', route => route.abort());
    await page.route('https://fonts.gstatic.com/**', route => route.abort());
    await page.goto(pathToFileURL(source).href + '?test=1', { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => window.YS && window.YS.ready, { timeout: 180000 });
    const captures = [
      ['01-panorama-afternoon', 0, 16.3],
      ['02-panorama-morning', 0, 6.8],
      ['03-panorama-noon', 0, 12],
      ['04-panorama-dusk', 0, 18.8],
      ['05-panorama-night', 0, 21.5],
      ['06-falls-afternoon', 1, 16.3],
      ['07-street-afternoon', 2, 16.3],
      ['08-terraces-afternoon', 3, 16.3],
      ['09-palace-afternoon', 4, 16.3],
      ['10-lake-afternoon', 5, 16.3],
      ['11-upper-city-afternoon', 6, 16.3],
      ['12-summit-afternoon', 7, 16.3],
      ['13-street-night', 2, 21.5],
      ['14-falls-atmos-off', 1, 16.3, { noClouds: true, noMist: true, noPts: true }]
    ];
    const records = [];
    for (const [name, view, hours, dbg] of captures) {
      const result = await page.evaluate(({ view, hours, dbg }) => {
        const a = window.YS;
        a.playing = false; a.tourPlaying = false; a.fly = null; a.clock = 20; a.dbg = dbg || {};
        // Reset hysteresis history so paired captures use identical terrain/tree LOD.
        for (const chunk of a.scene.chunks) {
          if (chunk.near) { a.R.free(chunk.near); chunk.near = null; }
        }
        document.body.classList.add('bare');
        a.snap({ view, hours });
        a.scene.update(a.cam, 400);
        const url = a.snap({ view, hours });
        return { url, stats: a.R.stats, cam: a.cam, env: a.env, nearChunks: a.scene.chunks.filter(c => c.near).length };
      }, { view, hours, dbg });
      const file = name + '.jpg';
      fs.writeFileSync(path.join(imageDir, file), Buffer.from(result.url.split(',')[1], 'base64'));
      delete result.url;
      records.push({ name, file, view, hours, ...result });
      console.log('Captured ' + file);
    }
    await page.evaluate(() => { YS.dbg = {}; document.body.classList.remove('bare'); YS.snap({ view: 0, hours: 16.3 }); });
    await page.screenshot({ path: path.join(imageDir, '15-interface.png'), animations: 'disabled' });
    const inventory = await page.evaluate(() => {
      const a = YS, gl = a.R.gl;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const meshes = new Set();
      for (const c of a.scene.chunks) for (const m of [c.far, c.near, c.water, ...c.struct, ...c.detail]) if (m) meshes.add(m);
      for (const e of a.scene.extraOpaque) meshes.add(e.m || e);
      for (const c of a.scene.clouds) meshes.add(c.m);
      if (a.scene.backdrop) meshes.add(a.scene.backdrop);
      for (const m of a.scene.mistMesh || []) meshes.add(m.m);
      let min = Infinity, max = -Infinity;
      for (const h of a.world.H) { min = Math.min(min, h); max = Math.max(max, h); }
      const arrayInfo = {};
      for (const [k,v] of Object.entries(a.world)) if (ArrayBuffer.isView(v)) arrayInfo[k] = { type: v.constructor.name, length: v.length, bytes: v.byteLength };
      return {
        browser: navigator.userAgent,
        renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        genMs: a.genMs, shadowSize: a.R.shadowSize,
        chunkCount: a.scene.chunks.length, treeCount: a.scene.chunks.reduce((n,c) => n+c.trees.length,0),
        lampCount: a.city.lamps?.length, cityKeys: Object.keys(a.city), worldArrays: arrayInfo,
        heightRange: [min,max], tourLength: a.tour.total, stations: a.tour.stations,
        meshCount: meshes.size, meshBytes: [...meshes].reduce((n,m)=>n+(m.bytes||0),0),
        errors: gl.getError(), sceneDynamic: typeof a.scene.updateDynamic
      };
    });
    const sourceData = fs.readFileSync(source);
    fs.writeFileSync(path.join(out, 'runtime-evidence.json'), JSON.stringify({
      sourceBytes: sourceData.length, sourceSha256: crypto.createHash('sha256').update(sourceData).digest('hex'),
      captureMethod: 'Chrome headless; SwiftShader software WebGL; 1440x900; test=1; YS.snap; fonts blocked; fixed animation clock and reset LOD hysteresis per capture',
      inventory, captures: records, pageErrors: errors
    }, null, 2));
    console.log(JSON.stringify({ inventory, pageErrors: errors }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
