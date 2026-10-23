# 东山待建场所基础资料储备

采集/整理日期：2026-10-23（Asia/Shanghai）。用途：后续地图补全前的研究档案。

[离线阅读入口](index.html) · [结构化总表](poi-reserve.json) · [位置GeoJSON](places.geojson) · [原始地块/节点](sources/osm-features-2026-10-19.geojson) · [来源目录](sources.json) · [图像校验](image-manifest.json)

本批整理8处场所，5处保留源位置，3处暂缺可靠数值坐标；共有25张本地图像（新采16张、引用既有9张），30个独立来源链接。图片候选、已有原图和无法获取图像分别记述。

| 场所 | 位置角色 | 地址/定位范围 | 记录 |
|---|---|---|---|
| 莫厘中学 | OpenStreetMap学校用地多边形的面积质心 | 江苏省苏州市吴中区东山镇人民街62号 | [说明](notes/moli-middle-school.md) / [JSON](records/moli-middle-school.json) |
| 莫厘实验小学（紫金路校区） | OpenStreetMap紫金路校区学校用地多边形的面积质心 | 江苏省苏州市吴中区东山镇紫金路45号（紫金路校区） | [说明](notes/moli-primary-school.md) / [JSON](records/moli-primary-school.json) |
| 东山首末站 | OSM公交场站面way/1327188516的质心；非乘车站杆、非入口、非站房中心 | 江苏省苏州市吴中区东山镇，洞庭路沿线（道路关系由官方公交走向确认；门牌未核定） | [说明](notes/dongshan-bus-terminal.md) / [JSON](records/dongshan-bus-terminal.json) |
| 法海寺 | OSM node/13800863490寺庙标签候选点；尚未核定对应文保本体、山门或大殿中心 | 江苏省苏州市吴中区东山镇（官方名录精度；具体山坡、门牌未核定） | [说明](notes/fahai-temple.md) / [JSON](records/fahai-temple.json) |
| 莫厘峰观景亭 | OSM node/13800809431，tourism=viewpoint标签点；不是经测量的亭柱/台基轮廓 | 江苏省苏州市吴中区东山镇莫厘峰山地（精确道路门牌不适用） | [说明](notes/moli-viewing-pavilion.md) / [JSON](records/moli-viewing-pavilion.json) |
| 惠和堂 | 数值坐标待核 | 江苏省苏州市吴中区东山镇陆巷村文宁巷内 | [说明](notes/huihetang.md) / [JSON](records/huihetang.json) |
| 紫石街及三元牌坊组 | 数值坐标待核 | 江苏省苏州市吴中区东山镇陆巷古村村落中心 | [说明](notes/zishi-street.md) / [JSON](records/zishi-street.json) |
| 寒山港 | 数值坐标待核 | 江苏省苏州市吴中区东山镇陆巷古村 | [说明](notes/hanshan-port.md) / [JSON](records/hanshan-port.json) |

## 使用方法

- 位置均区分WGS84、地块质心、OSM节点、街道线形和待定位状态。点坐标不是建筑入口或完整范围；精度小数不代表实测精度。
- 莫厘实验小学紫金路/幼山校区资料分开；法海寺和观景亭避免同名或相近地点误配。
- 照片的网页日期和拍摄日期分别看待；历史图仅用于可见形态研究。没有尺寸链的平面图不作为定尺寸测绘。
- 每条客观描述附来源和时间范围；推断与待核内容不进入已确认事实。
- 旧参考图片直接引用原文件，新图保留下载记录与SHA-256。未确认开放许可的图用于内部研究，不能默认用作公开贴图。

## 文件

- records/：8份单场所结构化记录，作为本包人工整理的主记录。
- notes/：逐场所中文说明，可阅读和继续补充。
- sources/：新增页面/地块存档；GeoJSON保留2026-10-19源快照。
- images/：本次新增原图；旧图保持在原资料目录。
- index.html：完全本地的检索与图文目录，不请求远程资源。
- qa.json：本地图片头、来源引用、静态文件和原文件未变检查。

重建目录：在工作区执行 `node scripts/build_poi_reserve.cjs`。后续只需更新records再重建目录，不自动修改现有地图。

另有3张源地块与邻路平面SVG，单独作为定位参考，不计入照片/图件数量；生成脚本为 `scripts/build_poi_source_plans.py`，溯源见 `sources/source-plans-manifest.json`。
