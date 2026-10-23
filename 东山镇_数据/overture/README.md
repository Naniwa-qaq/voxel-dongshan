# Overture 区域建筑轮廓

2026-10-19 实际下载，固定发布版 **2026-09-23.1**。采集包络为 WGS84 `[120.28,30.98,120.50,31.22]`，包含东山半岛及周边，未按东山镇行政区筛选。

- [原始区域 GeoParquet](raw/buildings_bbox_2026-09-23.1.parquet)：5,875,233 字节，60,877 条包络索引命中行；是紧凑的源数据保留文件。
- [精确相交 GeoJSON](buildings_bbox_2026-09-23.1.geojson)：60,873 个建筑面，剔除 4 个仅包络相交的行；保留原几何，没有按采集边缘切断建筑。
- [来源与完整性清单](provenance/bbox_buildings_manifest.json)：下载资产、版本、字段、要素数、SHA-256 与实际范围。
- [GIS 米制工作包](../working/dongshan_sources_utm51n.gpkg)：本图层与 OSM 分层保存的 EPSG:32651 副本，便于后续空间分析。

每要素的 `id`、`sources` 等来源字段均保留。来源字段中有 60,544 条提及 [东亚建筑数据集](https://doi.org/10.5281/zenodo.8174931)，329 条提及 OpenStreetMap。它已经包含 OSM 来源建筑，**不要再与 OSM 建筑层直接全量相加**；本批未做跨来源合并或几何去重。轮廓主要用于聚落密度、朝向和住宅聚合分析，不意味着未来绘制六万栋房屋。

本区域 `height` 和 `num_floors` 全部缺失。没有以 DSM 减地形推算高度，也没有给源属性补造统一层数。自动提取轮廓可能误分、漏分或把相连屋顶分成多个对象；未经现状影像/实地覆盖率验证，60,873 是数据记录数，不是东山镇真实建筑数量。

建筑主题采用 ODbL 1.0；保留 [署名说明](ATTRIBUTION.txt) 与要素内上游来源。上游影像年代、覆盖和许可不能仅从本发布版日期推断。

来源：[官方数据获取说明](https://docs.overturemaps.org/getting-data/)、[建筑主题说明](https://docs.overturemaps.org/guides/buildings/)、[官方署名与许可](https://docs.overturemaps.org/attribution/)。采集脚本为 [collect_bbox_buildings.py](collect_bbox_buildings.py)，未下载全球建筑库。
