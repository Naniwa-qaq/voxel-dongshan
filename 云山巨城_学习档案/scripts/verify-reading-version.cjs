const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {pathToFileURL}=require('node:url');
const {chromium}=require('C:/Users/YHJ/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
  const localFiles=['学习手册.html','notes/01-美术风格详解.html','notes/02-程序架构详解.html','notes/03-学习与仿作练习.html'];
  const broken=[];
  for(const file of localFiles){
    const html=fs.readFileSync(path.join(root,file),'utf8');
    for(const match of html.matchAll(/(?:href|src)="([^"]+)"/g)){
      const ref=match[1];if(ref.startsWith('#')||/^https?:/.test(ref))continue;
      const target=path.resolve(path.dirname(path.join(root,file)),decodeURIComponent(ref.split('#')[0]));
      if(!fs.existsSync(target))broken.push({file,ref});
    }
  }
  const evidence=JSON.parse(fs.readFileSync(path.join(root,'runtime-evidence.json'),'utf8'));
  const checksum=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'source','云山巨城.html'))).digest('hex');
  const pairs=[['01-panorama-afternoon','02-panorama-morning'],['01-panorama-afternoon','03-panorama-noon'],['01-panorama-afternoon','04-panorama-dusk'],['01-panorama-afternoon','05-panorama-night'],['07-street-afternoon','13-street-night'],['06-falls-afternoon','14-falls-atmos-off']].map(([first,second])=>{
    const a=evidence.captures.find(c=>c.name===first),b=evidence.captures.find(c=>c.name===second);
    return{first,second,sameCamera:JSON.stringify(a.cam)===JSON.stringify(b.cam),sameNearChunks:a.nearChunks===b.nearChunks,sameOpaqueTriangles:a.stats.tris===b.stats.tris};
  });
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1280,height:900}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const checks=[];
    for(const file of localFiles){await page.goto(pathToFileURL(path.join(root,file)).href,{waitUntil:'load'});checks.push(await page.evaluate(()=>({title:document.title,width:innerWidth,scrollWidth:document.documentElement.scrollWidth,images:[...document.images].map(i=>({src:i.getAttribute('src'),loaded:i.naturalWidth>0}))})));}
    await page.goto(pathToFileURL(path.join(root,'学习手册.html')).href,{waitUntil:'load'});
    await page.screenshot({path:path.join(root,'images','qa-report-desktop.png')});
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:path.join(root,'images','qa-report-mobile.png')});
    checks.push(await page.evaluate(()=>({title:document.title,width:innerWidth,scrollWidth:document.documentElement.scrollWidth,mobile:true})));
    const report={broken,checksumMatches:checksum===evidence.sourceSha256,pairs,checks,pageErrors:errors};
    fs.writeFileSync(path.join(root,'reading-version-evidence.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
    if(broken.length||checksum!==evidence.sourceSha256||pairs.some(p=>!p.sameCamera||!p.sameNearChunks||!p.sameOpaqueTriangles)||checks.some(c=>c.width!==c.scrollWidth||c.images?.some(i=>!i.loaded))||errors.length)process.exitCode=1;
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
