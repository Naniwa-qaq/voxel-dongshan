import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const index=JSON.parse(await fs.readFile(path.join(root,'index.json'),'utf8'));
const src=id=>index.sources.find(x=>x.id===id);
const rows=[
 ['luxiang-village','陆巷古村','聚落组群',['luxiang-2026'],['01-luxiang-setting','02-luxiang-hanshan-port','03-luxiang-huilaotang','04-luxiang-zishi-street'],'古街、巷道、港道与太湖及山坞的整体关系','街坊可聚合、重复民房可删减；保留主要街巷水道骨架','现状边界、道路水网落位、普通民房类型样本'],
 ['hanshan-port','寒山港','港道与岸线',['luxiang-2026'],['02-luxiang-hanshan-port'],'水道、石驳岸、步道和民居的相对关系','可减小岸线碎折和重复护栏；不凭单幅照片补造全线','港道全线、入湖关系、岸线定位与水位'],
 ['huihetang','惠和堂','宅园',['huihetang','museum-huihetang'],['05-huihetang-garden','06-huihetang-01','07-huihetang-03','08-huihetang-04','16-huihetang-overview','17-huihetang-plan','18-huihetang-courtyard'],'官方文字记述五进、三路；图像可辨多路院落、屋顶与天井','以院落带、主屋体量、围墙和留空表达；省略细雕、门窗重复','可靠占地定位、朝向及粗略高度；现有图无坐标/尺寸链'],
 ['huilaotang','会老堂','古宅',['luxiang-2026'],['03-luxiang-huilaotang'],'可读围合院落、月洞门、廊檐、灰瓦白墙','可抽成主屋、围墙、月洞门和院落留空','完整总平面、屋顶轮廓、具体位置；单幅图仅为局部'],
 ['zishi-street','紫石街及三元牌坊组','历史街巷',['luxiang-2026'],['04-luxiang-zishi-street'],'主街及跨街石牌坊是识别对象；图为石板巷道和一处牌坊','保留主街方向与代表性牌坊；重复街屋可聚合','三座牌坊实际坐标、间距、现状尺度；不能将入口牌楼当三元牌坊'],
 ['chunzailou','春在楼（东山雕花楼）','近代宅园',['dongshan-2019','heritage-register'],['12-chunzailou'],'可读两层楼廊围合、天井和突出砖雕门楼','保留楼廊、天井与门楼体块；雕刻可用层次提示','院落整体轮廓、朝向和位置；局部照片不等于全院测绘'],
 ['xuanyuangong-dongshan','东山轩辕宫','寺庙建筑',['dongshan-2019','heritage-register'],['13-xuanyuangong'],'官方名录对象为东山杨湾轩辕宫正殿；外观有深檐、翘角和红黄墙木构','突出主殿屋顶与檐口、台基和墙面色块；省略饰件','具体范围、朝向、正殿体量；不得与洪元弄同名宫观混用'],
 ['qiyuan','启园','湖滨园林',['qiyuan','dongshan-2019'],['09-qiyuan-4100','10-qiyuan-4112','11-qiyuan-4117'],'可读园内池岸廊桥、叠石、照壁和庭院','保留主要建筑、池石与留空；细小假山和园路可聚合','整体平面、湖岸接口与主要建筑外观；园池不能当太湖岸线'],
 ['daixinwan-bridge','岱心湾大桥','滨湖道路桥梁',['dongshan-2019'],['14-daixinwan-bridge'],'可读弯曲桥路、连续桥孔、湖岸植被和山体聚落','保留转弯、跨水段与岸线关系；桥孔、路灯、车辆可减重复','可靠线形、两端连接与高度；照片透视不等于几何线形'],
 ['mountain-orchard-context','东山山体—茶果园背景层','主题环境层（不是单个POI）',['dongshan-scenic','dongshan-2019','dongshan-2025','luxiang-2026'],[],'官方文字支持山水古镇、花果名茶、茶园及枇杷杨梅柑橘等果树的地域主题','作为山体轮廓、果林斑块及少量茶垄表达；不逐株种树','本批无专门可定位茶果园照片、树种冠形和当前种植范围；不能据文字猜出地块'],
];
const candidates=rows.map(([id,name,category,sourceIds,imageIds,identity,simplify,missing])=>({
 id,name,category,coordinates:null,coordinate_reference_system:null,geometry:null,coordinate_status:'本参考包未提供可追溯坐标依据，留空；应与独立地理资料模块匹配后再落位',
 evidence_source_ids:sourceIds,evidence_urls:sourceIds.map(id=>src(id).url),local_image_ids:imageIds,
 identity_evidence_summary:identity,generalization_design_suggestion:simplify,remaining_evidence_gaps:missing,
 research_reference_only:true,model_accuracy_level:'制图综合参考，不是逐栋测绘复原',rights_status:'原图未确认开放许可；仅内部研究，不默认可公开贴图或再分发'
}));
const output={schema_version:1,audited_on_local:'2026-10-19',original_collection_on_local:'2026-10-16',record_count:candidates.length,point_of_interest_records:9,context_layer_records:1,coordinate_policy:'本批全部坐标留空，不从照片、院落示意图或模糊地名猜坐标。',candidates};
await fs.writeFile(path.join(root,'poi-candidates.json'),JSON.stringify(output,null,2));
const table=candidates.map(x=>`| ${x.name} | ${x.category} | ${x.local_image_ids.length ? x.local_image_ids.join('、'):'本批仅文字依据'} | ${x.generalization_design_suggestion} | ${x.remaining_evidence_gaps} |`).join('\n');
await fs.writeFile(path.join(root,'QA-2026-10-19.md'),`# 地方风貌与POI参考资料复核\n\n**2026年10月16日采集，2026年10月19日复核。**本轮复用已有资料，没有新网络请求，没有重复下载，也没有修改原图和原始HTML。\n\n- 已验证8个原始HTML及18张原图，均与原采集SHA-256一致。\n- 18张图经System.Drawing/GDI+完整绘制解码通过，像素尺寸与记录一致。18个离线图库图片链接全部指向存在的本地文件。详见[审计JSON](qa-audit.json)。\n- 此前18图逐张view_image目视检查已确认主体可读；本次SHA一致，因此保留该观察记录，不将复核日期误作新拍摄/新采集日期。\n- 惠和堂俯瞰3284×4925像素、平面620×840像素、穿堂1920×1080像素，适合院落与体块研究；平面未见尺寸链、坐标和比例尺，不能作精确测绘图。\n- [离线图库](index.html)、[来源与图片总索引](index.json)、[候选对象表](poi-candidates.json)。候选表含9个POI/组群和1个主题环境层，全部坐标留空。\n\n## 适合制图综合的资料与缺口\n\n| 对象 | 类型 | 本地图号 | 设计取舍（建议） | 仍缺什么 |\n|---|---|---|---|---|\n${table}\n\n## 关键限制\n\n照片网页日期为页面日期，拍摄/制图时间普遍未单独给出。古宅和园林照片具有选择性，不能外推全部普通民房。当前材料没有学校实景、完整港区图、全域现状底图和最新建筑高度，也没有专门可定位茶果园冠形照片。名录用于对象身份核对，不能替代几何资料。\n\n权利状态均保留为“未确认开放许可；仅内部研究参考”。原作者未单独署名时据实记录，馆方水印保持不变，不默认允许公开贴图或再分发。\n`);
console.log(JSON.stringify({records:candidates.length,coordinates_null:candidates.every(x=>x.coordinates===null),output:'poi-candidates.json'}));
