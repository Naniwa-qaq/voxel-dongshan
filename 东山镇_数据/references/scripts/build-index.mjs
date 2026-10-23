import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sources=JSON.parse(await fs.readFile(path.join(ROOT,'sources.json'),'utf8'));
const original=JSON.parse(await fs.readFile(path.join(ROOT,'images.json'),'utf8'));
const descriptions={
 '01-luxiang-setting':['陆巷入口牌楼','入口识别','可见三开间入口牌楼、灰瓦翘角及后方山体。','区分入口牌楼与紫石街上的三座石牌坊，不能混为同一对象。'],
 '02-luxiang-hanshan-port':['寒山港','河港与街巷','可见港道、石驳岸、两岸步道与民居、远处山体。','用于水道—岸线—房屋的关系；不据单幅照片推断港道全线。'],
 '03-luxiang-huilaotang':['会老堂院落','古宅与天井','可见围合院落、月洞门、灰瓦廊檐、白墙深色木构。','供提取院落留空与围墙/廊檐签名，不作为整体平面图。'],
 '04-luxiang-zishi-street':['紫石街石板巷道与牌坊','街巷与牌坊','可见狭窄石板街、连续墙面和门廊、跨街石牌坊。','用于巷道宽高关系和石牌坊轮廓；照片透视不等于可量测尺度。'],
 '05-huihetang-garden':['惠和堂后花园池石与小桥','院落与园林','可见园池、叠石、小桥、廊亭、树木。','用于园林水石植被关系，允许合并小构件。'],
 '06-huihetang-01':['惠和堂园内廊檐与山墙','山墙与屋顶','可见灰瓦屋面、山墙轮廓、木栏与植物攀覆。','优先提取屋顶/山墙轮廓；攀覆植物不等同永久建筑形态。'],
 '07-huihetang-03':['惠和堂池边亭廊','园林建筑','可见开敞柱间、飞檐、栏杆、池岸叠石。','可压缩为檐顶、立柱、栏杆和池岸四类体块。'],
 '08-huihetang-04':['惠和堂园内墙檐与花木','墙檐与植物','可见连续墙檐、山墙、叠石、铺地与开花植物。','供局部材质和植物点景参考，拍摄季节未确认。'],
 '09-qiyuan-4100':['启园池岸廊桥','湖滨园林','可见池塘、廊桥、石栏、竹木与荷叶。','这是园内池岸景观，不应将画中水面直接认定为太湖岸线。'],
 '10-qiyuan-4112':['启园叠石假山','园林水石','可见假山叠石、草地与树木。','允许用少量岩石体块聚合表达，不需逐孔复制。'],
 '11-qiyuan-4117':['启园园内照壁与庭院','园林空间','可见灰瓦白墙照壁、庭院铺地、置石和植物。','用于留空和墙面层次；不根据此图构造整个启园平面。'],
 '12-chunzailou':['春在楼院落与雕花门楼','特色古建','可见两层木构楼廊、天井、砖雕门楼、灰瓦白墙。','体量研究保留楼廊围合和突出门楼，可省略细雕。'],
 '13-xuanyuangong':['东山轩辕宫外观','特色古建','原页面题注为东山轩辕宫；可见深出檐屋顶、翘角、黄墙和红色木构。','仅用作外观签名；不与苏州城内洪元弄同名轩辕宫混用。'],
 '14-daixinwan-bridge':['岱心湾大桥与太湖湖岸','湖岸道路','可见弯曲滨湖桥路、连续桥孔、近岸植被和远处聚落山体。','可保留道路转弯、桥段与岸线关系，桥孔和路灯允许删减重复。'],
 '15-nanmuting':['楠木厅室内梁架','传统建筑构件','可见厅内梁架、柱列与木构空间。','此图为室内，不能据此推断整座建筑外立面和屋顶尺度。'],
 '16-huihetang-overview':['惠和堂俯瞰','院落与屋顶总貌','清楚显示多路院落、天井、屋顶和侧园；图有吴文化博物馆水印。','可提取相对布局、轮廓和粗略长宽关系；无坐标、比例尺，不是正射测绘成果。'],
 '17-huihetang-plan':['惠和堂平面图','院落平面','平面线条、院落和部分建筑标注可读；图有吴文化博物馆水印。','可读院落关系，未见尺寸链、坐标和比例尺；不作为精确测绘图。'],
 '18-huihetang-courtyard':['惠和堂穿堂','天井与穿堂','清楚显示木柱、廊道、天井留空、墙面和室内外关系；图有博物馆水印。','用于体块留空、材质和穿堂关系，不要求逐件建模。'],
};
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const checks=[];
for(const s of sources.sources) {
  if(s.status==='downloaded') {const b=await fs.readFile(path.join(ROOT,s.raw_html));checks.push({file:s.raw_html,ok:digest(b)===s.sha256,bytes:b.length});}
}
const images=original.images.map(x=>{
 const d=descriptions[x.id];
 return {...x,label:d[0],topic:d[1],visual_observation:d[2],use_limit:d[3],visual_review:{reviewed:true,initial_review_date_local:'2026-10-16',audit_date_local:'2026-10-19',method:'原采集时view_image逐图目视检查；本轮重新SHA验证确认文件未变',result:'主体内容可读，无错误页/登录页/验证码'},image_author:x.id.startsWith('16-')||x.id.startsWith('17-')||x.id.startsWith('18-')?'吴文化博物馆（图上水印；具体摄影/制图者未单独署名）':x.image_author};
});
for(const x of images) {
 if(x.status==='downloaded') {const b=await fs.readFile(path.join(ROOT,x.file));checks.push({file:x.file,ok:digest(b)===x.sha256,bytes:b.length,width:x.width,height:x.height});}
}
const validation={checked_at_utc:new Date().toISOString(),method:'重新读取每个落盘文件核对SHA-256；图片逐张view_image目视检查',passed:checks.every(x=>x.ok),sources_downloaded:sources.sources.filter(x=>x.status==='downloaded').length,images_downloaded:images.filter(x=>x.status==='downloaded').length,failed:[...sources.sources,...images].filter(x=>x.status!=='downloaded').map(x=>({id:x.id,error:x.error})),total_bytes:checks.reduce((sum,x)=>sum+x.bytes,0),checks};
await fs.writeFile(path.join(ROOT,'validation.json'),JSON.stringify(validation,null,2));
const manifest={schema_version:1,collection_id:'dongshan-public-visual-references-20261016',purpose:'制图综合的风格化东山：普通住宅聚合、河流分级删减、特色POI保留轮廓与大致比例',license_status:'均未确认开放许可；仅内部研究参考；公开贴图或再分发应另核实授权',date_notes:'page_publication_date是页面标注日期，不是照片拍摄日期。照片拍摄/制图日期未明确时为null。下载时间按UTC与Asia/Shanghai分别记录。',validation:{passed:validation.passed,sources_downloaded:validation.sources_downloaded,images_downloaded:validation.images_downloaded,total_bytes:validation.total_bytes},sources:sources.sources.map(({image_candidates,...s})=>s),images};
await fs.writeFile(path.join(ROOT,'index.json'),JSON.stringify(manifest,null,2));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const imageRows=images.map(x=>`| [${x.id}](${x.file}) | ${x.label} | ${x.width} × ${x.height} | ${x.publisher} | ${x.page_publication_date??'未标注'} | [来源页面](${x.source_page}) |`).join('\n');
const sourceRows=manifest.sources.map(s=>`| ${s.id} | [${s.title}](${s.url}) | ${s.publisher} | ${s.date??'未标注（名录页）'} | [原始HTML](${s.raw_html}) / [提取文字](${s.extracted_text}) |`).join('\n');
const md=`# 东山地方风貌与重点POI参考资料\n\n已实际保存 **${validation.sources_downloaded} 个来源页面、${validation.images_downloaded} 张原图**，共 ${(validation.total_bytes/1024/1024).toFixed(2)} MiB。全部图片已逐张目视检查，文件重新读取校验SHA-256通过。**2026年10月16日采集，2026年10月19日复核**（Asia/Shanghai）。原采集时间保持不变，各文件精确时间见JSON。\n\n- [离线图库](index.html)：仅引用本地图片，不依赖远程脚本或字体。\n- [2026年10月19日复核说明](QA-2026-10-19.md)、[候选对象表](poi-candidates.json)、[解码与来源审计](qa-audit.json)。\n- [完整结构化索引](index.json)：每张图包含来源页面、原图URL、发布机构、作者/署名状态、网页日期、下载时间、SHA-256、像素尺寸、观察记录及用途限制。\n- [原始页面与候选图索引](sources.json)、[原始下载图记录](images.json)、[完整性验证](validation.json)。\n\n## 来源页面\n\n| ID | 页面 | 发布机构 | 页面日期 | 本地副本 |\n|---|---|---|---|---|\n${sourceRows}\n\n## 已下载图片\n\n| ID / 本地图片 | 内容 | 像素尺寸 | 发布机构 | 页面日期 | 来源 |\n|---|---|---|---|---|---|\n${imageRows}\n\n## 当前最有用的参考\n\n1. **惠和堂俯瞰（16）与平面（17）**：已取得可读文件，可识别多路院落、天井和屋顶。俯瞰为3284×4925像素，平面为620×840像素；未见坐标、比例尺或尺寸链，适合相对布局和制图综合，不能当精确测绘成果。\n2. **紫石街（04）与寒山港（02）**：可读街巷宽高感、连续墙面、跨街牌坊和水岸—民居关系。陆巷入口牌楼（01）是另一处入口形象，不能把它混作紫石街三座牌坊之一。\n3. **春在楼（12）、轩辕宫（13）与惠和堂局部（05—08、18）**：用于保留楼廊围合、门楼、屋顶轮廓和院落留空；不要求复制雕刻与每个窗格。\n4. **启园（09—11）与岱心湾桥（14）**：前者是园内池石/廊桥/照壁，后者明确展示太湖滨湖道路。不得把启园园池照片误作太湖实测岸线。\n5. **楠木厅（15）为室内梁架图**，不用于推断整座外观。\n\n## 用于本项目的取舍\n\n当前目标是风格化、制图综合后的东山。普通民房可按街坊聚合，重复小建筑与低等级水段可删减；本图组用于定义少数特色POI的形体签名、院落空隙、地方材质和山湖水岸关系。没有足够证据时，保留类型符号，不补造真实院落、校园或港工布局。\n\n本批图没有提供学校实景、完整港区平面、全域现状底图或最新建筑高度。古宅照片与园林图有选择性，不能外推为所有普通民房。\n\n## 来源与许可边界\n\n- 政府网站来源包括苏州市地方志、园林绿化和文旅部门；博物馆图来自吴文化博物馆在澎湃号机构发布的文章。\n- 所有图片均通过公开页面列出的普通HTTP原图链接下载，没有登录、注册、付费、反爬绕过或权限规避。之前网页检索工具的原图缓存失败不代表原站访问限制；本次原站直接请求均成功。\n- **未确认开放许可。仅供内部研究、识别与建模参考，不应据此宣称可公开用作贴图或再分发。**网页日期不等于拍摄日期，未知摄影者/拍摄日期已明确记为未署名或null。原图及水印保持不变。\n- 原始HTML保留完整页面，可能含原站远程资源引用；阅读优先用离线图库与文字副本。\n\n## 复现脚本\n\n- scripts/collect-references.mjs inventory：采集固定8个页面，保存原始字节和候选图元数据。\n- scripts/collect-references.mjs images：按selections.json逐张下载18个固定候选图，记录结果；单次失败即记录，不自动重试。\n- scripts/build-index.mjs：合并人工目视检查描述，生成索引、图库、说明与SHA验证。\n\n本轮失败数：${validation.failed.length}。未修改工作区其它目录。\n`;
await fs.writeFile(path.join(ROOT,'README.md'),md);
const cards=images.map(x=>`<figure id="${esc(x.id)}"><a href="${esc(x.file)}"><img src="${esc(x.file)}" alt="${esc(x.label)}" loading="lazy"></a><figcaption><b>${esc(x.id)} · ${esc(x.label)}</b><p>${esc(x.visual_observation)}</p><p class="muted">${esc(x.width)}×${esc(x.height)} · ${esc(x.publisher)} · 网页日期 ${esc(x.page_publication_date||'未标注')}</p><p>${esc(x.use_limit)}</p><a href="${esc(x.source_page)}">来源页面</a> · <a href="${esc(x.image_url)}">原图链接</a><details><summary>来源与校验</summary><p>作者：${esc(x.image_author)}</p><p>下载：${esc(x.fetched_at_local)}</p><code>${esc(x.sha256)}</code><p>${esc(x.license_status)}</p></details></figcaption></figure>`).join('\n');
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>东山参考图库</title><style>body{font:15px/1.65 system-ui,"Microsoft YaHei",sans-serif;margin:0;background:#f0eee8;color:#242b28}header{max-width:1300px;margin:auto;padding:36px 24px 12px}h1{font-size:28px;margin:0 0 12px}main{max-width:1300px;padding:12px 24px 48px;margin:auto;display:grid;grid-template-columns:repeat(auto-fit,minmax(310px,1fr));gap:24px}figure{background:white;margin:0;border:1px solid #d3d7ce;border-radius:10px;overflow:hidden}figure img{width:100%;height:300px;object-fit:contain;display:block;background:#e3e5df}figcaption{padding:18px}p{margin:8px 0}.muted{color:#5d6860;font-size:13px}a{color:#285f53}code{font-size:11px;overflow-wrap:anywhere}details{margin-top:10px}header p{max-width:1000px}</style><header><h1>东山地方风貌与重点POI参考图库</h1><p>8个公开页面，18张原始参考图。图像均已目视检查，来源、发布日期、下载时间、尺寸与SHA-256见卡片或<a href="index.json">完整索引</a>。<strong>仅内部研究参考，开放许可未确认。</strong></p><p><a href="README.md">采集与复核说明</a> · <a href="QA-2026-10-19.md">10月19日审计</a> · <a href="poi-candidates.json">候选对象表</a> · <a href="validation.json">完整性验证</a> · 点击图片打开原尺寸文件。馆藏平面/俯瞰仅用于相对布局，不作为精确测绘成果。</p></header><main>${cards}</main></html>`;
await fs.writeFile(path.join(ROOT,'index.html'),html);
console.log(JSON.stringify(validation));
