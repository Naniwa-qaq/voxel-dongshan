# 土地覆盖数据与本地审计

原始 WorldCover 范围子集于 **2026-10-16（北京时间）**通过公开 COG 的 HTTP Range 采集，整幅 3° × 3° 瓦片没有下载。2026-10-19 复用既有子集，核验 SHA-256、全像元解码和类别，再生成水平投影副本，没有重新下载。旧 `landcover_validation.json` 未改写。

- `derived/dongshan_envelope_worldcover_2021_v200_wgs84.tif`：ESA WorldCover 2021 v200；WGS84，1/12000 度原网格，2640 × 2880，7,603,200 个有效像元，完整覆盖采集包络 `[120.28,30.98,120.50,31.22]`。SHA-256：`1d4a9d9a9996edd24b498da0caf61d25e4f835b60bee273a98159d81ff5fa6de`，与原采集记录一致。
- `derived/dongshan_envelope_worldcover_2021_v200_utm51n_10m.tif`：EPSG:32651，10 米最近邻副本，2166 × 2715；与地形 30 米副本网格 1:3 嵌套。外接矩形角部是正常 NoData，有效占比约 95.04%。最近邻保留类别，未产生新类别。重投影不提升实际精度。
- `qa/landcover_audit.json`：本次完整核验与派生栅格统计、SHA、坐标及来源记录。
- `worldcover_classes.json`：原类别代码和颜色表。

原网格类别像元数：树木 1,143,635；草地 163,657；耕地 721,927；建筑用地 577,991；裸地/稀疏植被 32,075；永久水体 4,787,965；草本湿地 175,950。没有其它有效类别。

观测时段为 2021-01-01～2021-12-31，产品 v200 于 2022 年生产。它不能作为 2026 年现状地类。11 大类不能辨别东山果园、茶园、树种或单体建筑；永久水体也不是法定岸线或当日水位线。**InputQuality 尚未获取**：官方说明其入口依赖登录的 Viewer/Terrascope，本次没有注册或绕过权限。类别图的完整覆盖不等于分类百分之百正确。垂直基准不适用。

来源：[官方数据入口](https://esa-worldcover.org/en/data-access)、[原始公开 COG](https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_N30E120_Map.tif)、[官方产品手册](https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/docs/WorldCover_PUM_V2.0.pdf)。采用 CC BY 4.0，使用或改编时保留署名：© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium。

采集包络仅用于收集覆盖半岛、三山岛及周边数据，不是行政边界或最终模型裁切线。本次没有进行土地覆盖综合或三维建模。
