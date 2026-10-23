# 地形数据与本地审计

原始数据于 **2026-10-16（北京时间）**采集；2026-10-19 复用原文件进行离线完整性核验、裁剪与水平投影，没有重新下载。本目录未对地形作艺术化处理或人工修补。

采集包络为 WGS84 `[120.28, 30.98, 120.50, 31.22]`，不是东山镇行政边界。原始 GLO-30 两个瓦片 `N30E120`、`N31E120` 连同 XML、EDM、FLM、HEM、WBM、SRC/ACM KML、预览与许可文件保留于 `raw/`。

核验结果：39 个已记录文件的尺寸和 SHA-256 一致；32 个原始对象与原 S3 目录尺寸一致；10 个科学栅格完成全部像元解码。原次 Range 下载的 4 个 DEM/HEM 对象曾与 S3 单段 ETag 的 MD5 比对，本次再次比对一致。逐文件结果见 `qa/terrain_audit.json`；旧采集清单未改写。

## 可用栅格

- `derived/dongshan_envelope_glo30_2021_wgs84.tif`：原网格 DSM；793 × 865，共 685,945 个有效像元，无 EDM 语义空洞，范围 −62.0～291.332611 米。按源像元边界向外扩展的实际边界为 `[120.2798611111, 30.9798611111, 120.5001388889, 31.2201388889]`。
- 同目录 `..._edm_wgs84.tif`、`..._flm_wgs84.tif`、`..._hem_wgs84.tif`、`..._wbm_wgs84.tif` 与 DSM 严格同网格。
- `..._utm51n_30m.tif`：EPSG:32651、30 米副本，DSM 用双线性，质量层用最近邻。5 个栅格严格同网格，722 × 905；共用范围 `[240210, 3430050, 261870, 3457200]` 米。外接矩形角部有正常的覆盖外 NoData，DSM 有效占比约 95.28%，不代表采集包络内原 DSM 缺失。与 WorldCover 的 10 米副本网格按 1:3 嵌套。

原网格为 WGS84、1 角秒，在本地约东西 26.5 米、南北 30.8 米。源 TIFF 的 WKT 未带根 EPSG 标识，但产品 XML 明确水平 EPSG:4326；保留原 WKT，投影时明确指定 2D EPSG:4326。高度为 **EGM2008（EPSG:3855）正高、米**，水平投影没有进行垂直基准转换。30 米重采样不增加源数据精度。

## 时间和质量约束

AWS 镜像标为 2021 release，并非 2021 年全新实测地形。两瓦片 XML 的采集时段分别为 2011-02-15～2014-09-05 与 2011-02-15～2014-04-04，XML 所示生产时间为 2015-06-24。

这是 DSM，会包含植被和建筑；不能直接承担裸地、街坡、建筑高度或亚米精度。未做当地控制点验证。太湖水位站采用的镇江吴淞基面不能直接赋给 EGM2008 栅格。

EDM 为最后一次编辑类别，FLM 为编辑/填补及来源类别；其 0 为语义空洞。WBM 的 0 为有效非水域，2 为湖泊，3 为河流，不能把 0 全当 NoData。AOI 内 EDM/FLM 均无 0。HEM 有效像元 209,812，占 30.59%；其 −32767 表示编辑区不提供该误差估计，尤其大量水域，并非 DSM 同位置空洞。HEM 只描述随机高度误差标准差，不含全部系统误差、相位解缠错误。

有 900 个源像元低于 −10 米，集中在 `[120.33528,31.12639,120.35056,31.14528]`，最低 −62 米。其中 530 个被源 WBM/EDM 标为湖泊。可能涉及采坑、洼地或源数据问题，尚无独立地面依据；**全部保留原值，没有擅自抹平**。`qa/dongshan_envelope_glo30_2021_height_review_wgs84.tif` 以 1 标记这类待复核像元，0 表示未被此筛选标记，不代表已验证准确。

全球水体编辑不等于现状岸线，GLO-30 也不保证河网水文连通。后续简化河流、确定太湖水面和岸线时需结合独立水系数据。

## 来源与复现

- [公开镜像目录与说明](https://registry.opendata.aws/copernicus-dem/)；[镜像网格说明](https://copernicus-dem-30m.s3.amazonaws.com/readme.html)
- [官方产品页](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM)
- [官方产品手册 v5.0](https://dataspace.copernicus.eu/sites/default/files/media/files/2024-06/geo1988-copernicusdem-spe-002_producthandbook_i5.0.pdf)（质量解释见第 1.2.5 节）；许可和手册副本在 `provenance/`。
- `scripts/terrain_audit_finish.py` 为离线审计与派生脚本，使用 GDAL/NumPy，不调用 ArcPy。原始采集脚本为 `scripts/terrain_collect.py`；本次仅调用其本地处理函数。
