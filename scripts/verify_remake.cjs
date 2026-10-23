const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('C:/Users/YHJ/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const out=path.resolve(__dirname,'../东山镇_重制版/qa');
const url='http://127.0.0.1:8876/'+encodeURIComponent('东山镇_重制版')+'/';
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox']});
 try{
 const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
 const errors=[],failed=[];page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>failed.push({url:r.url(),error:r.failure()}));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 await page.goto(url,{waitUntil:'load',timeout:60000});
 await page.waitForFunction(()=>window.DSRemake&&DSRemake.ready,{timeout:240000});
 await page.evaluate(()=>{DSRemake.setLight(58);DSRemake.setBare(true)});
 const shots=[];
 for(const name of(process.argv[2]?process.argv[2].split(','):['house','street','tree','court','waterfront','overview'])){
 await page.evaluate(name=>{DSRemake.setView(name);DSRemake.render()},name);
 const shot=await page.evaluate(()=>({png:DSRemake.capture(),camera:DSRemake.getCamera()}));
 fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(shot.png.split(',')[1],'base64'));shots.push({view:name,camera:shot.camera});console.log('Captured '+name);
 }
 await page.evaluate(()=>{DSRemake.setBare(false);DSRemake.setView('waterfront');DSRemake.render()});
 await page.screenshot({path:path.join(out,'interface.png')});
 const runtime=await page.evaluate(()=>{const a=DSRemake;const gl=document.querySelector('canvas').getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info');return{ready:a.ready,version:a.version,generatedMs:a.generatedMs,houseCount:a.houseCount,treeCount:a.treeCount,rejectedTrees:a.rejectedTrees,terrainFaces:a.terrainFaces,assets:a.assets,treeAssets:a.treeAssets,render:a.lastRender,errors:a.errors,heroHouse:a.heroHouse,views:a.views,renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)}});
 fs.writeFileSync(path.join(out,'runtime.json'),JSON.stringify({at:new Date().toISOString(),url,viewport:{width:1440,height:1000,dpr:1,fov:45},runtime,shots,errors,failed},null,2));
 console.log(JSON.stringify({houses:runtime.houseCount,trees:runtime.treeCount,generatedMs:runtime.generatedMs,terrainFaces:runtime.terrainFaces,render:runtime.render,errors,failed}));
 if(errors.length||failed.length)process.exitCode=1;
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
