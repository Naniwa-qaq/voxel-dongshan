const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('C:/Users/YHJ/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const out = path.resolve(__dirname, '..');
const source = path.join(out, 'source', '云山巨城.html');
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://fonts.googleapis.com/**', route => route.abort());
    await page.route('https://fonts.gstatic.com/**', route => route.abort());
    await page.goto(pathToFileURL(source).href + '?test=1');
    await page.waitForFunction(() => window.YS?.ready, { timeout: 180000 });
    const map = await page.evaluate(() => {
      const w = YS.world, N = 640;
      const mapCanvas = document.createElement('canvas'); mapCanvas.width = N; mapCanvas.height = N;
      const ctx = mapCanvas.getContext('2d'), data = ctx.createImageData(N,N);
      for (let j=0;j<N;j++) for (let i=0;i<N;i++) {
        const k=(j*2)*w.N+i*2, h=w.H[k], o=w.occ[k];
        const hL=w.H[k-2]??h, hU=w.H[k-w.N*2]??h;
        const t=Math.max(0,Math.min(1,h/305)), s=Math.max(0.65,Math.min(1.18,1+(hL+hU-2*h)*0.035));
        let c=[(62+86*t)*s,(92+63*t)*s,(75+68*t)*s];
        if (w.W[k]>-1000 && w.W[k]>h) c=[67,139,167];
        if(o===1)c=[175,159,132]; else if(o===2)c=[238,225,197]; else if(o===4)c=[176,168,148]; else if(o===5)c=[115,160,89];
        const p=(j*N+i)*4; data.data[p]=c[0];data.data[p+1]=c[1];data.data[p+2]=c[2];data.data[p+3]=255;
      }
      ctx.putImageData(data,0,0);
      const cv=document.createElement('canvas'); cv.width=920;cv.height=800;
      const g=cv.getContext('2d');g.fillStyle='#f3efe5';g.fillRect(0,0,920,800);
      g.fillStyle='#263c35';g.font='bold 25px Microsoft YaHei';g.fillText('云山巨城 · 地形与占用布局',35,40);
      g.font='14px Microsoft YaHei';g.fillText('来自运行时 H / W / occ 数组；2m 采样；图顶为 z=-640，图底为 z=+640',35,68);
      const left=35,top=92,size=640;g.drawImage(mapCanvas,left,top);
      const xy=(x,z)=>[left+(x+640)/2,top+(z+640)/2];
      const points=[['上城',20,-390,705,175],['云瀑阁',-28,-209,705,230],['瀑布',42,-203.5,705,285],['东岭宫城',226,0,705,340],['长街',-40,60,705,395],['西山台城',-180,20,705,450],['揽云亭',-330,-40,705,505],['湖心塔',100,400,705,560]];
      g.font='16px Microsoft YaHei';
      for(const [name,x,z,lx,ly] of points){const p=xy(x,z);g.strokeStyle='#d6b16d';g.lineWidth=1.5;g.beginPath();g.moveTo(...p);g.lineTo(687,ly-5);g.lineTo(lx-6,ly-5);g.stroke();g.fillStyle='#fff0c0';g.beginPath();g.arc(...p,4,0,Math.PI*2);g.fill();g.fillStyle='#263c35';g.fillText(name,lx,ly);}
      const legend=[['#438ba7','水面'],['#af9f84','道路'],['#eee1c5','建筑地块'],['#b0a894','预留 / 平台'],['#73a059','园林']];
      g.font='14px Microsoft YaHei';for(let i=0;i<legend.length;i++){const x=35+i*166;g.fillStyle=legend[i][0];g.fillRect(x,758,16,16);g.fillStyle='#263c35';g.fillText(legend[i][1],x+22,772);}
      return cv.toDataURL('image/png');
    });
    fs.writeFileSync(path.join(out,'images','16-world-plan.png'),Buffer.from(map.split(',')[1],'base64'));
    const checks=[];
    await page.locator('#modeTour').click();
    checks.push(await page.evaluate(()=>({check:'tour button',mode:YS.mode,touring:document.body.classList.contains('touring'),playing:YS.tourPlaying})));
    for (const stationIndex of [0,2,4,6]) {
      const state=await page.evaluate(index=>{const a=YS,s=a.tour.stations[index];a.snap({tour:s.s,hours:16.3});return{check:'tour station',name:s.name,cam:a.cam.pos,target:a.cam.target,glError:a.R.gl.getError()};},stationIndex);
      checks.push(state);
    }
    await page.locator('#modeFree').click();
    checks.push(await page.evaluate(()=>({check:'free button',mode:YS.mode,touring:document.body.classList.contains('touring')})));
    await page.locator('#timeSlider').fill('21.5');
    checks.push(await page.evaluate(()=>{YS.snap();return{check:'time slider',hours:YS.hours,label:document.getElementById('timeLbl').textContent,lamp:YS.env.lamp,winFrac:YS.env.winFrac};}));
    const city = await page.evaluate(()=>({nBuild:YS.city.nBuild,roads:YS.city.roads.length,designatedTrees:YS.city.treeSpots.length,halos:YS.city.haloArr.length/8,sprayPoints:YS.scene.spray.n,clouds:YS.scene.cloudObjs.length,weirs:YS.city.weirs,stations:YS.tour.stations}));
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>{YS.fly=null;YS.playing=false;YS.snap({view:0,hours:16.3});});
    await page.screenshot({path:path.join(out,'images','17-interface-mobile.png'),animations:'disabled'});
    const responsive = await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,dock:document.getElementById('dock').getBoundingClientRect().toJSON(),glError:YS.R.gl.getError()}));
    fs.writeFileSync(path.join(out,'interaction-evidence.json'),JSON.stringify({checks,city,responsive,pageErrors:errors},null,2));
    console.log(JSON.stringify({checks,city,responsive,pageErrors:errors},null,2));
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
