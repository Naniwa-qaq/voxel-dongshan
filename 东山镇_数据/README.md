# 东山镇首批数据

2026-10-19 完成这一批采集与核验。地形、土地覆盖和地方图文复用 2026-10-16 的已落盘文件，本次检查完整性并补投影/裁剪；OSM 和 Overture 为 2026-10-19 新采集。原始来源日期保留。

先打开 [离线数据入口](数据入口.html)，或直接使用 [GIS 米制矢量工作包](working/dongshan_sources_utm51n.gpkg)。实际资料范围见 [总览图](qa/collection-overview.png)。

## 已落盘内容

| 数据 | 本批数量/规格 | 用途 |
|---|---|---|
| [地形 DSM](terrain/derived/dongshan_envelope_glo30_2021_wgs84.tif) | 原网格 793 × 865；约 30 米级 | 山体、坡地与聚落高低关系；另附 4 种质量层 |
| [土地覆盖](landcover/derived/dongshan_envelope_worldcover_2021_v200_wgs84.tif) | 原网格 2640 × 2880；约 10 米级 | 林木、耕地、建成区、水面等大类 |
| [OSM 道路](osm/layers/roads.geojson) | 3,446 个要素 | 路网与桥头关系；保留主次标签，另有道路点 |
| [OSM 水系](osm/layers/water_polygons.geojson) | 381 个水系对象；2,162 个水面 | 湖面、港渠、溪流、坝闸及航道；水道另存一层 |
| [OSM 地点与设施](osm/layers/places_admin_poi.geojson) | 366 个要素 | 聚落、校园和其他地点；面、点按源保留 |
| [OSM 建筑](osm/layers/buildings.geojson) | 330 个要素（329 面、1 点） | 来源标签与局部建筑语义参考 |
| [Overture 建筑](overture/raw/buildings_bbox_2026-09-23.1.parquet) | 60,873 个建筑面 | 聚落密度、屋顶朝向与后续住宅聚合输入；与 OSM 独立保存 |
| [地方图文参考](references/index.html) | 8 个页面、18 张图 | 陆巷、街巷港道、园林与古建形态；含惠和堂平面/俯瞰 |

数量均针对 WGS84 采集包络 `[120.28,30.98,120.50,31.22]`，包含周边水陆区域，**不是东山镇行政区统计**。OSM 共 7,286 个去除重复 ID 后的原始对象；专题层互有交叉，不能相加为独立对象总数。另有 2,678 个土地利用/自然要素、72 个行政关系候选、28 个道路点。

## 怎样使用

1. 用 GIS 打开 `working/dongshan_sources_utm51n.gpkg`，道路、水系、建筑、地点与行政候选均按来源分层。工作坐标为 EPSG:32651（米），转换前后逐层计数、全属性逐条比较通过，见 [转换核验](working/qa.json)。
2. 叠加 `terrain/derived/*_utm51n_30m.tif` 中的 DSM，以及 `landcover/derived/*_utm51n_10m.tif`。4 种质量层有独立含义，不能当成地形；地形和土地覆盖格网按 1:3 嵌套。
3. 查古村与重点对象时打开 [参考图库](references/index.html) 和 [10 项候选/背景记录](references/poi-candidates.json)。候选记录没有可靠坐标时留空；OSM 地点层另有陆巷村、东山镇及部分校园的位置参考，两者未经匹配确认为同一对象。
4. 后续先审定作品范围、必保道路/港道/地标，再对重复住宅聚合和次要内容筛选。全部源数据保留，本批未执行制图综合或三维建模。

## 本批质量边界

- 采集包络含西山及周边区域；它不是东山镇行政边界或最终作品范围。OSM 行政关系仅作候选，需另行核准。
- DSM 取自 AWS 2021 发布版，瓦片观测时段约 2011–2014；含植被和建筑。WorldCover 描述 2021 年，不能当作 2026 年现状。
- Overture 这 60,873 条轮廓以及 OSM 建筑均没有高度/层数。建筑轮廓仅作聚落分析和综合底稿，不对应最终渲染数量；两来源不可直接相加。
- 部分地形低于 −10 米，尚未判明真实洼地或源问题；已保留源值和待复核掩膜。DSM 为 EGM2008，不能直接套用太湖镇江吴淞基面水位。
- WorldCover 不区分茶园/果园，InputQuality 尚未取得；重点古建与港道仍需可靠落位。参考图尚未确认开放使用许可，惠和堂平面无比例尺/坐标，不作精测图。

OSM 水系包括港渠/溪流、航道、沟渠与坝闸，并非 381 条独立河流。10 个行政关系合计 196 个未展开成员均为 `relation/subarea`，外环已组装；它们不构成完整递归 OSM 图。参见 [关系检查](osm/qa/relation_geometry_audit.json)。

首批数据可支持范围审查、骨架梳理和聚落综合试验。重点 POI 精细表达前，仍需核准古建/港道落位、茶果林类型与必要的现状参考；不要求全镇逐栋补拍或补高。

## 来源、许可和追溯

- 地形：[Copernicus GLO-30 公开镜像](https://registry.opendata.aws/copernicus-dem/)，按其免费许可使用并保留指定署名；[本地审计](terrain/README_地形审计.md)与许可 PDF 保留。
- 土地覆盖：[ESA WorldCover](https://registry.opendata.aws/esa-worldcover-vito/)，2021 v200，CC BY 4.0；[本地审计](landcover/README_土地覆盖审计.md)。
- 路网/水系/地点：[OpenStreetMap](https://www.openstreetmap.org/copyright)，ODbL 1.0；[采集与图层说明](osm/README.md)。原始 6 主题响应、标签、快照日期、查询与校验值均保留。旧截断响应及失败的省级下载未计入可用数据。
- 建筑补充：[Overture Maps](https://docs.overturemaps.org/getting-data/)，固定版 2026-09-23.1，建筑主题 ODbL；[来源与限制](overture/README.md)。原始区域 GeoParquet 约 5.6 MiB，GeoJSON 是便于互操作的较大副本。
- 地方图文：8 个网页、18 张原图来自地方志、园林部门与博物馆机构发布；[逐图来源和用途](references/README.md)。开放复用权未确认，限当前内部研究。

[机器台账](catalog.json)、[文件 SHA 清单](qa/data-files.csv)、[综合读取与几何核验](qa/integration-checks.json)保留全部检查依据。文件可读和几何有效不等于现状覆盖/定位精度已经实地验证。

`_runtime/` 是本地处理依赖，`terrain/range_cache/` 是下载缓存，均不属于交付地理数据。没有调用商业地图 API 或提交外部资料申请。
