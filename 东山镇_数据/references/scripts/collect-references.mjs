import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCES = [
  { id: 'luxiang-2026', title: '古镇古村系列——吴中区陆巷村：太湖明珠，宰相故里', publisher: '苏州市地方志工作办公室', date: '2026-09-24', url: 'https://dfzb.suzhou.gov.cn/dfzb/szdq/202609/74f82b260f3045e79aeb1cb2c5d0d15d.shtml' },
  { id: 'dongshan-2025', title: '古镇古村系列——吴中区东山镇', publisher: '苏州市地方志工作办公室', date: '2025-05-07', url: 'https://dfzb.suzhou.gov.cn/dfzb/szdq/202505/5abc61edcad04b828dc08cc7a5b8ec9b.shtml' },
  { id: 'dongshan-2019', title: '吴中名镇之东山镇', publisher: '苏州市地方志编纂委员会办公室', date: '2019-05-27', url: 'https://dfzb.suzhou.gov.cn/dfzb/szdq/201905/4169ddc4eb2c49f18279bd6bca53351f.shtml' },
  { id: 'huihetang', title: '惠和堂', publisher: '苏州市园林和绿化管理局', date: '2025-10-20', url: 'https://ylj.suzhou.gov.cn/szsylj/ylml/201912/d3d1a3a77c9d40acaa97f641111d8481.shtml' },
  { id: 'qiyuan', title: '启园', publisher: '苏州市园林和绿化管理局', date: '2025-10-17', url: 'https://ylj.suzhou.gov.cn/szsylj/ylml/201903/e8588bd2ca084a0bbb97b907eff35e2f.shtml' },
  { id: 'museum-huihetang', title: '吴县繁华如许｜遍览世间乐土：自适与宅院', publisher: '吴文化博物馆（澎湃号机构发布）', date: '2021-11-23', url: 'https://www.thepaper.cn/newsDetail_forward_15501667' },
  { id: 'heritage-register', title: '苏州市各级文物保护单位名录', publisher: '苏州市文化广电和旅游局', date: null, url: 'https://wglj.suzhou.gov.cn/szwhgdhlyj/whbf/list_tt.shtml' },
  { id: 'dongshan-scenic', title: '东山景区', publisher: '苏州市园林和绿化管理局', date: '2019-12-24', url: 'https://ylj.suzhou.gov.cn/szsylj/fjmsq/201912/ac947bc93b954ecd9f7fe59f441f3329.shtml' },
];

const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const time = () => ({ fetched_at_utc: new Date().toISOString(), fetched_at_local: new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }) + ' +08:00' });
const deent = s => s.replace(/&(?:amp|lt|gt|quot|apos|nbsp);|&#(?:x[0-9a-f]+|\d+);/gi, a => ({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' '}[a] || String.fromCodePoint(a[2].toLowerCase() === 'x' ? parseInt(a.slice(3,-1),16) : parseInt(a.slice(2,-1),10))));
const plain = s => deent(s.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ')).trim();
function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) out[m[1].toLowerCase()] = deent(m[2] ?? m[3] ?? m[4]);
  return out;
}
async function request(url, referrer) {
  const headers = { 'User-Agent': 'DongshanStudyReferenceCollector/1.0 (personal internal visual research)', Accept: '*/*' };
  if (referrer) headers.Referer = referrer;
  const r = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(30000) });
  const buf = Buffer.from(await r.arrayBuffer());
  return { status: r.status, final_url: r.url, content_type: r.headers.get('content-type'), buf };
}
function decode(buf, type) {
  const head = buf.subarray(0, 4096).toString('ascii');
  const charset = /charset\s*=\s*["']?([\w-]+)/i.exec(type || '')?.[1] || /charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1] || 'utf-8';
  try { return new TextDecoder(charset).decode(buf); } catch { return buf.toString('utf8'); }
}
function dimensions(b) {
  if (b.length >= 24 && b.toString('hex',0,8) === '89504e470d0a1a0a') return { format: 'png', width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b.length >= 10 && /GIF8[79]a/.test(b.toString('ascii',0,6))) return { format:'gif', width:b.readUInt16LE(6), height:b.readUInt16LE(8) };
  if (b.length > 12 && b[0]===255 && b[1]===216) {
    let i = 2;
    while (i + 8 < b.length) {
      if (b[i] !== 255) { i++; continue; }
      while (b[i] === 255) i++;
      const marker = b[i++];
      if (marker===216 || marker===217 || marker===1 || (marker>=208 && marker<=215)) continue;
      if (i+2 > b.length) break;
      const len=b.readUInt16BE(i);
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) return { format:'jpg', width:b.readUInt16BE(i+5), height:b.readUInt16BE(i+3) };
      if (len<2) break;
      i+=len;
    }
  }
  if (b.length >= 30 && b.toString('ascii',0,4)==='RIFF' && b.toString('ascii',8,12)==='WEBP') {
    const kind=b.toString('ascii',12,16);
    if(kind==='VP8X') return {format:'webp',width:1+b.readUIntLE(24,3),height:1+b.readUIntLE(27,3)};
    if(kind==='VP8 ' && b[23]===157 && b[24]===1 && b[25]===42) return {format:'webp',width:b.readUInt16LE(26)&0x3fff,height:b.readUInt16LE(28)&0x3fff};
    if(kind==='VP8L' && b[20]===47) {const x=b.readUInt32LE(21);return {format:'webp',width:1+(x&0x3fff),height:1+((x>>>14)&0x3fff)};}
  }
  return null;
}
async function inventory() {
  await fs.mkdir(path.join(ROOT,'pages'),{recursive:true});
  const records=[];
  for(const source of SOURCES) {
    const rec={...source,...time(), license_status:'未确认开放许可；仅内部研究参考'};
    try {
      const r=await request(source.url);
      Object.assign(rec,{http_status:r.status,final_url:r.final_url,content_type:r.content_type,bytes:r.buf.length,sha256:sha(r.buf)});
      if(r.status!==200) {rec.status='failed';rec.error=`HTTP ${r.status}`;}
      else {
        rec.raw_html=`pages/${source.id}.html`;
        await fs.writeFile(path.join(ROOT,rec.raw_html),r.buf);
        const html=decode(r.buf,r.content_type);
        const contentStart = Math.max(0,html.search(/<div[^>]+class=["'][^"']*(?:TRS_Editor|TRS_UEDITOR)[^"']*["']/i));
        const region = contentStart ? html.slice(contentStart) : html;
        rec.page_title=deent(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '');
        rec.status='downloaded';rec.image_candidates=[];
        for(const [k,m] of Array.from(region.matchAll(/<img\b[^>]*>/gi)).entries()) {
          const a=attrs(m[0]);
          const chosen=a['data-original'] || a['data-src'] || a.src;
          if(!chosen || /^(data:|javascript:)/i.test(chosen)) continue;
          let image_url;try{image_url=new URL(chosen,r.final_url).href;}catch{continue;}
          if(!/^https?:/.test(image_url)) continue;
          rec.image_candidates.push({index:k,url:image_url,alt:a.alt||'',title:a.title||'',html_width:a.width||null,html_height:a.height||null,context_before:plain(region.slice(Math.max(0,m.index-220),m.index)),context_after:plain(region.slice(m.index+m[0].length,m.index+m[0].length+250))});
        }
        if(source.id==='museum-huihetang') {
          const known=[
            {index:900,url:'https://imagepphcloud.thepaper.cn/pph/image/165/326/596.jpg',alt:'惠和堂俯瞰',context_before:'机构文章正文已核实图名',context_after:''},
            {index:901,url:'https://imagepphcloud.thepaper.cn/pph/image/165/326/602.png',alt:'惠和堂平面图',context_before:'机构文章正文已核实图名',context_after:''},
            {index:902,url:'https://imagepphcloud.thepaper.cn/pph/image/165/326/684.png',alt:'三祝堂线图',context_before:'机构文章正文已核实图名',context_after:''},
          ];
          for(const item of known) if(!rec.image_candidates.some(x=>x.url===item.url)) rec.image_candidates.push(item);
        }
        rec.extracted_text=`pages/${source.id}.txt`;
        await fs.writeFile(path.join(ROOT,rec.extracted_text),plain(region),'utf8');
      }
    } catch(e) {rec.status='failed';rec.error=e.message;}
    records.push(rec);
    console.log(JSON.stringify({id:rec.id,status:rec.status,http_status:rec.http_status,bytes:rec.bytes,error:rec.error,image_candidates:rec.image_candidates}));
  }
  await fs.writeFile(path.join(ROOT,'sources.json'),JSON.stringify({schema_version:1,...time(),purpose:'制图综合的风格化东山；地方风貌和重点POI内部研究参考',sources:records},null,2));
}

async function images() {
  const catalog=JSON.parse(await fs.readFile(path.join(ROOT,'sources.json'),'utf8'));
  const selections=JSON.parse(await fs.readFile(path.join(ROOT,'selections.json'),'utf8'));
  await fs.mkdir(path.join(ROOT,'images'),{recursive:true});
  const records=[];
  for(const sel of selections) {
    const source=catalog.sources.find(s=>s.id===sel.source_id);
    const candidate=source.image_candidates.find(i=>i.index===sel.candidate_index);
    if(!candidate) throw new Error(`Unknown image selection: ${JSON.stringify(sel)}`);
    const rec={id:sel.id,label:sel.label,topic:sel.topic,source_id:source.id,source_page:source.url,publisher:source.publisher,page_publication_date:source.date,image_author:sel.image_author||'未单独署名，见原页面',image_publication_date:null,image_url:candidate.url,caption_on_page:candidate.alt||candidate.title||null,license_status:'未确认开放许可；仅内部研究参考；不得据此视为可公开贴图或再分发',...time()};
    try {
      const r=await request(candidate.url,source.url);
      Object.assign(rec,{http_status:r.status,final_url:r.final_url,content_type:r.content_type,bytes:r.buf.length,sha256:sha(r.buf)});
      if(r.status!==200) {rec.status='failed';rec.error=`HTTP ${r.status}`;}
      else {
        const dim=dimensions(r.buf);
        if(!dim) {rec.status='failed';rec.error='Response is not a recognized PNG/JPEG/GIF/WebP image; not saved as image';}
        else {
          Object.assign(rec,dim,{status:'downloaded',file:`images/${sel.id}.${dim.format}`});
          await fs.writeFile(path.join(ROOT,rec.file),r.buf);
        }
      }
    } catch(e) {rec.status='failed';rec.error=e.message;}
    records.push(rec);
    console.log(JSON.stringify({id:rec.id,status:rec.status,width:rec.width,height:rec.height,bytes:rec.bytes,error:rec.error}));
  }
  await fs.writeFile(path.join(ROOT,'images.json'),JSON.stringify({schema_version:1,...time(),images:records},null,2));
}
if(process.argv[2]==='inventory') await inventory();
else if(process.argv[2]==='images') await images();
else throw new Error('Usage: node collect-references.mjs inventory|images');
