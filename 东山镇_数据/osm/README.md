# OpenStreetMap 区域采集

2026-10-19 通过公开 Overpass API 分 6 个主题实际采集：道路、水系、土地覆盖/利用、建筑、地点设施、行政关系。最终快照区间为 2026-10-19T07:11:51Z 至 2026-10-19T10:25:21Z；分别保存查询、响应、日期、HTTP 状态及 SHA-256。

采集包络 WGS84 `[120.28,30.98,120.50,31.22]` 包括西山等邻近区域，不是镇界。共 7,286 个不同 OSM 类型/ID 的对象；[原始完整对象 JSONL](selected_original_objects.jsonl) 与 [未按包络裁切的已组装几何](selected_features_full_geometry.geojson)保留。源标签完整保存在 `_all_tags`，专题层在 `layers/`。

| 专题层 | 要素数 |
|---|---:|
| [roads](layers/roads.geojson) | 3,446 |
| [road_points](layers/road_points.geojson) | 28 |
| [waterways](layers/waterways.geojson) | 381 |
| [water_polygons](layers/water_polygons.geojson) | 2,162 |
| [buildings](layers/buildings.geojson) | 330 |
| [landuse_natural](layers/landuse_natural.geojson) | 2,678 |
| [places_admin_poi](layers/places_admin_poi.geojson) | 366 |
| [boundaries](layers/boundaries.geojson) | 72 |
| [other_tagged](layers/other_tagged.geojson) | 0 |

专题层互有交叉，不能相加。`layers` 中几何只按包络裁剪，没有做制图简化、修复、河网删减或建筑聚合。道路包括不同等级的线、道路面和关系；建筑包含329面、1点，高度和层数全缺。水系细类计数：`{"lock_gate": 2, "canal": 276, "stream": 76, "ditch": 9, "river": 4, "fairway": 1, "drain": 6, "dam": 7}`。这些是数据要素数，不是独立河流数量或实地设施清查统计。

源返回99个关系；10个行政关系合计196个成员为未展开的子区 relation/subarea。外环已成功组装，但不称为递归完整OSM图。其他原始/组装几何问题为0。行政层含东山镇及周边父级/子级候选，未进行官方边界确证。太湖 relation/1126533 已返回73个成员几何并组装。

旧 `raw/overpass_main_get.json` 虽有1.8MB但内容截断、下载超时，已排除；失败省级 PBF、失败响应和 `.part` 均不作可用数据。最终有效文件仅以 [extraction_manifest.json](extraction_manifest.json) 列出的来源为准。

[逐关系检查](qa/relation_geometry_audit.json)、[原响应检查](qa/raw_response_validation.json)、[几何问题](qa/geometry_issues.json)、[米制工作包](../working/dongshan_sources_utm51n.gpkg)。缺少某个地名/港道不代表现实不存在，现状覆盖和拓扑连通尚未独立验证。

© OpenStreetMap contributors，ODbL 1.0。保留 [ATTRIBUTION.txt](ATTRIBUTION.txt)，来源：[OSM版权说明](https://www.openstreetmap.org/copyright)、[公开Overpass接口](https://overpass-api.de/)。
