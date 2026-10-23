"""Build the offline entry point and collection ledger from final manifests."""
from pathlib import Path
import collections
import datetime as dt
import html
import json

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "东山镇_数据"


def load(p):
    return json.loads((DATA / p).read_text(encoding="utf-8"))


def dump(p, obj):
    (DATA / p).write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")


def main():
    osm = load("osm/extraction_manifest.json")
    overture = load("overture/provenance/bbox_buildings_manifest.json")
    refs = load("references/validation.json")
    gpkg = load("working/qa.json")
    lc = osm["layer_counts"]
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    dataset_rows = [
        ("地形 DSM", "原网格 793 × 865；约 30 米级", "terrain/derived/dongshan_envelope_glo30_2021_wgs84.tif", "山体、坡地与聚落高低关系；另附 4 种质量层"),
        ("土地覆盖", "原网格 2640 × 2880；约 10 米级", "landcover/derived/dongshan_envelope_worldcover_2021_v200_wgs84.tif", "林木、耕地、建成区、水面等大类"),
        ("OSM 道路", f"{lc['roads']:,} 个要素", "osm/layers/roads.geojson", "路网与桥头关系；保留主次标签，另有道路点"),
        ("OSM 水系", f"{lc['waterways']:,} 个水系对象；{lc['water_polygons']:,} 个水面", "osm/layers/water_polygons.geojson", "湖面、港渠、溪流、坝闸及航道；水道另存一层"),
        ("OSM 地点与设施", f"{lc['places_admin_poi']:,} 个要素", "osm/layers/places_admin_poi.geojson", "聚落、校园和其他地点；面、点按源保留"),
        ("OSM 建筑", f"{lc['buildings']:,} 个要素（329 面、1 点）", "osm/layers/buildings.geojson", "来源标签与局部建筑语义参考"),
        ("Overture 建筑", f"{overture['exact_intersection_features']:,} 个建筑面", "overture/raw/buildings_bbox_2026-09-23.1.parquet", "聚落密度、屋顶朝向与后续住宅聚合输入；与 OSM 独立保存"),
        ("地方图文参考", f"{refs['sources_downloaded']} 个页面、{refs['images_downloaded']} 张图", "references/index.html", "陆巷、街巷港道、园林与古建形态；含惠和堂平面/俯瞰"),
    ]
    gaps = [
        "采集包络含西山及周边区域；它不是东山镇行政边界或最终作品范围。OSM 行政关系仅作候选，需另行核准。",
        "DSM 取自 AWS 2021 发布版，瓦片观测时段约 2011–2014；含植被和建筑。WorldCover 描述 2021 年，不能当作 2026 年现状。",
        "Overture 这 60,873 条轮廓以及 OSM 建筑均没有高度/层数。建筑轮廓仅作聚落分析和综合底稿，不对应最终渲染数量；两来源不可直接相加。",
        "部分地形低于 −10 米，尚未判明真实洼地或源问题；已保留源值和待复核掩膜。DSM 为 EGM2008，不能直接套用太湖镇江吴淞基面水位。",
        "WorldCover 不区分茶园/果园，InputQuality 尚未取得；重点古建与港道仍需可靠落位。参考图尚未确认开放使用许可，惠和堂平面无比例尺/坐标，不作精测图。",
    ]
    catalog = {
        "title": "东山镇首批数据采集台账", "completed_utc": now,
        "original_material_collection_date_local": "2026-10-16",
        "completion_and_audit_date_local": "2026-10-19",
        "bbox_wgs84": [120.28, 30.98, 120.50, 31.22],
        "extent_role": "Collection envelope only; NOT an administrative or final display boundary",
        "phase": "Acquired and audited before cartographic generalization / modeling",
        "date_policy": "Original acquisition timestamps retained. Terrain, WorldCover and references reused and audited; OSM and Overture newly acquired on 2026-10-19.",
        "datasets": [{"name": n, "amount": a, "entry": p, "use": u} for n, a, p, u in dataset_rows],
        "osm": {"unique_features": osm["canonical_features"], "layer_counts": lc,
                "layer_counts_overlap": True, "snapshot_range_utc": osm["source_snapshot_range_utc"],
                "relation_count": osm["relation_count"], "relations_with_missing_subarea_geometry": osm["relations_with_missing_member_geometry"]},
        "overture": {"release": overture["release"], "building_polygons": overture["exact_intersection_features"],
                     "with_height": overture["features_with_height"], "with_floors": overture["features_with_num_floors"],
                     "raw_parquet": "overture/" + overture["raw_parquet_file"].replace("\\", "/")},
        "working_package": {"file": "working/" + gpkg["file"], "epsg": 32651,
                            "bytes": gpkg["bytes"], "sha256": gpkg["sha256"],
                            "source_layers_kept_separate": True, "all_attributes_compared": True},
        "quality_gaps": gaps,
        "quality_reports": ["qa/integration-checks.json", "qa/data-files.csv", "terrain/qa/terrain_audit.json",
                            "landcover/qa/landcover_audit.json", "osm/extraction_manifest.json", "osm/qa/relation_geometry_audit.json",
                            "overture/provenance/bbox_buildings_manifest.json", "references/qa-audit.json", "working/qa.json"],
        "cartographic_generalization_applied": False,
        "commercial_map_api_used": False,
        "source_links": {"terrain": "https://registry.opendata.aws/copernicus-dem/",
                         "landcover": "https://registry.opendata.aws/esa-worldcover-vito/",
                         "osm": "https://www.openstreetmap.org/copyright",
                         "overture": "https://docs.overturemaps.org/getting-data/"},
    }
    dump("catalog.json", catalog)
    collection = load("collection.json")
    collection.update(current_completion_and_audit_date_local="2026-10-19", status="first_batch_acquired_and_audited",
                      catalog="catalog.json", entry_page="数据入口.html", working_package="working/dongshan_sources_utm51n.gpkg",
                      acquisition_date_policy=catalog["date_policy"])
    dump("collection.json", collection)

    table = "\n".join(f"| [{n}]({p}) | {a} | {u} |" for n, a, p, u in dataset_rows)
    readme = f"""# 东山镇首批数据

2026-10-19 完成这一批采集与核验。地形、土地覆盖和地方图文复用 2026-10-16 的已落盘文件，本次检查完整性并补投影/裁剪；OSM 和 Overture 为 2026-10-19 新采集。原始来源日期保留。

先打开 [离线数据入口](数据入口.html)，或直接使用 [GIS 米制矢量工作包](working/dongshan_sources_utm51n.gpkg)。实际资料范围见 [总览图](qa/collection-overview.png)。

## 已落盘内容

| 数据 | 本批数量/规格 | 用途 |
|---|---|---|
{table}

数量均针对 WGS84 采集包络 `[120.28,30.98,120.50,31.22]`，包含周边水陆区域，**不是东山镇行政区统计**。OSM 共 {osm['canonical_features']:,} 个去除重复 ID 后的原始对象；专题层互有交叉，不能相加为独立对象总数。另有 {lc['landuse_natural']:,} 个土地利用/自然要素、{lc['boundaries']} 个行政关系候选、{lc['road_points']} 个道路点。

## 怎样使用

1. 用 GIS 打开 `working/dongshan_sources_utm51n.gpkg`，道路、水系、建筑、地点与行政候选均按来源分层。工作坐标为 EPSG:32651（米），转换前后逐层计数、全属性逐条比较通过，见 [转换核验](working/qa.json)。
2. 叠加 `terrain/derived/*_utm51n_30m.tif` 中的 DSM，以及 `landcover/derived/*_utm51n_10m.tif`。4 种质量层有独立含义，不能当成地形；地形和土地覆盖格网按 1:3 嵌套。
3. 查古村与重点对象时打开 [参考图库](references/index.html) 和 [10 项候选/背景记录](references/poi-candidates.json)。候选记录没有可靠坐标时留空；OSM 地点层另有陆巷村、东山镇及部分校园的位置参考，两者未经匹配确认为同一对象。
4. 后续先审定作品范围、必保道路/港道/地标，再对重复住宅聚合和次要内容筛选。全部源数据保留，本批未执行制图综合或三维建模。

## 本批质量边界

""" + "\n".join("- " + s for s in gaps) + f"""

OSM 水系包括港渠/溪流、航道、沟渠与坝闸，并非 {lc['waterways']} 条独立河流。10 个行政关系合计 196 个未展开成员均为 `relation/subarea`，外环已组装；它们不构成完整递归 OSM 图。参见 [关系检查](osm/qa/relation_geometry_audit.json)。

首批数据可支持范围审查、骨架梳理和聚落综合试验。重点 POI 精细表达前，仍需核准古建/港道落位、茶果林类型与必要的现状参考；不要求全镇逐栋补拍或补高。

## 来源、许可和追溯

- 地形：[Copernicus GLO-30 公开镜像](https://registry.opendata.aws/copernicus-dem/)，按其免费许可使用并保留指定署名；[本地审计](terrain/README_地形审计.md)与许可 PDF 保留。
- 土地覆盖：[ESA WorldCover](https://registry.opendata.aws/esa-worldcover-vito/)，2021 v200，CC BY 4.0；[本地审计](landcover/README_土地覆盖审计.md)。
- 路网/水系/地点：[OpenStreetMap](https://www.openstreetmap.org/copyright)，ODbL 1.0；[采集与图层说明](osm/README.md)。原始 6 主题响应、标签、快照日期、查询与校验值均保留。旧截断响应及失败的省级下载未计入可用数据。
- 建筑补充：[Overture Maps](https://docs.overturemaps.org/getting-data/)，固定版 {overture['release']}，建筑主题 ODbL；[来源与限制](overture/README.md)。原始区域 GeoParquet 约 5.6 MiB，GeoJSON 是便于互操作的较大副本。
- 地方图文：8 个网页、18 张原图来自地方志、园林部门与博物馆机构发布；[逐图来源和用途](references/README.md)。开放复用权未确认，限当前内部研究。

[机器台账](catalog.json)、[文件 SHA 清单](qa/data-files.csv)、[综合读取与几何核验](qa/integration-checks.json)保留全部检查依据。文件可读和几何有效不等于现状覆盖/定位精度已经实地验证。

`_runtime/` 是本地处理依赖，`terrain/range_cache/` 是下载缓存，均不属于交付地理数据。没有调用商业地图 API 或提交外部资料申请。
"""
    (DATA / "README.md").write_text(readme, encoding="utf-8")

    water = json.loads((DATA / "osm/layers/waterways.geojson").read_text(encoding="utf-8"))["features"]
    types = dict(collections.Counter(f["properties"].get("waterway") for f in water))
    osm_rows = "\n".join(f"| [{k}](layers/{k}.geojson) | {n:,} |" for k, n in lc.items())
    (DATA / "osm/README.md").write_text(f"""# OpenStreetMap 区域采集

2026-10-19 通过公开 Overpass API 分 6 个主题实际采集：道路、水系、土地覆盖/利用、建筑、地点设施、行政关系。最终快照区间为 {osm['source_snapshot_range_utc'][0]} 至 {osm['source_snapshot_range_utc'][1]}；分别保存查询、响应、日期、HTTP 状态及 SHA-256。

采集包络 WGS84 `[120.28,30.98,120.50,31.22]` 包括西山等邻近区域，不是镇界。共 {osm['canonical_features']:,} 个不同 OSM 类型/ID 的对象；[原始完整对象 JSONL](selected_original_objects.jsonl) 与 [未按包络裁切的已组装几何](selected_features_full_geometry.geojson)保留。源标签完整保存在 `_all_tags`，专题层在 `layers/`。

| 专题层 | 要素数 |
|---|---:|
{osm_rows}

专题层互有交叉，不能相加。`layers` 中几何只按包络裁剪，没有做制图简化、修复、河网删减或建筑聚合。道路包括不同等级的线、道路面和关系；建筑包含329面、1点，高度和层数全缺。水系细类计数：`{json.dumps(types,ensure_ascii=False)}`。这些是数据要素数，不是独立河流数量或实地设施清查统计。

源返回99个关系；10个行政关系合计196个成员为未展开的子区 relation/subarea。外环已成功组装，但不称为递归完整OSM图。其他原始/组装几何问题为0。行政层含东山镇及周边父级/子级候选，未进行官方边界确证。太湖 relation/1126533 已返回73个成员几何并组装。

旧 `raw/overpass_main_get.json` 虽有1.8MB但内容截断、下载超时，已排除；失败省级 PBF、失败响应和 `.part` 均不作可用数据。最终有效文件仅以 [extraction_manifest.json](extraction_manifest.json) 列出的来源为准。

[逐关系检查](qa/relation_geometry_audit.json)、[原响应检查](qa/raw_response_validation.json)、[几何问题](qa/geometry_issues.json)、[米制工作包](../working/dongshan_sources_utm51n.gpkg)。缺少某个地名/港道不代表现实不存在，现状覆盖和拓扑连通尚未独立验证。

© OpenStreetMap contributors，ODbL 1.0。保留 [ATTRIBUTION.txt](ATTRIBUTION.txt)，来源：[OSM版权说明](https://www.openstreetmap.org/copyright)、[公开Overpass接口](https://overpass-api.de/)。
""", encoding="utf-8")

    hrows = "\n".join(f'<tr><td><a href="{html.escape(p)}">{html.escape(n)}</a></td><td>{html.escape(a)}</td><td>{html.escape(u)}</td></tr>' for n, a, p, u in dataset_rows)
    hgaps = "".join("<li>" + html.escape(s) + "</li>" for s in gaps)
    page = f"""<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>东山镇 · 首批数据档案</title><style>
*{{box-sizing:border-box}}body{{margin:0;background:#f4f1e8;color:#263b38;font-family:"Microsoft YaHei",sans-serif;line-height:1.8}}main{{max-width:1180px;margin:auto;padding:54px 36px 80px}}.kicker{{letter-spacing:.17em;color:#6a7c72;font-size:12px}}h1{{font-size:40px;line-height:1.35;margin:10px 0 16px}}h2{{font-size:23px;margin:38px 0 12px}}p{{color:#5d6b65}}a{{color:#286f63;text-underline-offset:4px}}.actions{{display:flex;flex-wrap:wrap;gap:10px;margin:26px 0}}.actions a{{display:block;border:1px solid #b6c5b9;padding:10px 20px;border-radius:6px;background:#fcfbf6;text-decoration:none}}.actions a:first-child{{background:#2d665a;color:white;border-color:#2d665a}}.numbers{{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin:24px 0}}.card{{padding:18px;background:#e8e8dc;border-radius:7px}}.card b{{display:block;font-size:27px}}.card span{{font-size:13px;color:#6a746c}}figure{{margin:28px 0 14px}}figure img{{width:100%;display:block;border:1px solid #d1d3c9;border-radius:5px}}figcaption{{font-size:12px;color:#68756c;margin-top:8px}}table{{border-collapse:collapse;width:100%;font-size:14px}}th,td{{border-bottom:1px solid #d4d9cc;text-align:left;padding:14px 12px;vertical-align:top}}th{{background:#e4e8dd}}td:first-child{{min-width:150px}}ul{{padding-left:24px;color:#59695f}}li{{padding:5px 0}}.foot{{border-top:1px solid #c8d0c1;margin-top:40px;padding-top:16px;font-size:12px}}@media(max-width:700px){{main{{padding:30px 18px}}h1{{font-size:29px}}.numbers{{grid-template-columns:repeat(2,1fr)}}.tablewrap{{overflow-x:auto}}table{{min-width:700px}}}}
</style><main><div class="kicker">DONGSHAN · ACQUIRED DATA / 2026-10-19</div><h1>东山镇，先把真实地理留作底稿。</h1>
<p>首批资料已落盘并完成文件与内部几何核验，供后续范围审查、骨架梳理和制图综合使用。<br>地形、土地覆盖、地方图文复用10月16日文件并复核；OSM与Overture为10月19日新采集。</p>
<div class="actions"><a href="working/dongshan_sources_utm51n.gpkg">GIS 米制工作包 · {gpkg['bytes']/2**20:.1f} MiB</a><a href="references/index.html">地方风貌图库</a><a href="README.md">完整使用说明</a><a href="catalog.json">机器台账</a></div>
<div class="numbers"><div class="card"><b>30 m / 10 m</b><span>地形 / 土地覆盖量级</span></div><div class="card"><b>{lc['roads']:,}</b><span>采集包络内道路要素</span></div><div class="card"><b>{overture['exact_intersection_features']:,}</b><span>Overture建筑面 · 聚合输入</span></div><div class="card"><b>8 页 / 18 图</b><span>地方图文研究参考</span></div></div>
<figure><img src="qa/collection-overview.png" alt="已取得地形、水系、道路、建筑和土地覆盖的实际数据范围总览"><figcaption>实际数据范围核验图。WGS84 120.28–120.50°E / 30.98–31.22°N，包含周边区域；不代表行政边界或最终作品裁切范围。</figcaption></figure>
<h2>这批资料能提供什么</h2><div class="tablewrap"><table><thead><tr><th>数据入口</th><th>本批数量 / 规格</th><th>后续作用</th></tr></thead><tbody>{hrows}</tbody></table></div>
<p>工作包中道路、水系、地点、建筑与行政候选分层保存；EPSG:32651，单位米。原始坐标、来源标签与紧凑源文件另存。六万条建筑轮廓用于分析聚落肌理，最终显示数量由制图综合决定。</p>
<h2>进入表达设计前需要知道</h2><ul>{hgaps}</ul>
<p>本批尚未进行住宅聚合、水系筛选、艺术化地形或三维建模。OSM专题层有交叉，Overture也含OSM来源建筑，各层数量不能直接相加。10条行政关系中未展开成员均为子区关系，不作为完整递归行政图。</p>
<h2>检查依据</h2><p><a href="qa/integration-checks.json">综合读取与几何检查</a> · <a href="qa/data-files.csv">文件与SHA-256清单</a> · <a href="working/qa.json">工作包全属性比较</a> · <a href="references/poi-candidates.json">重点对象候选表</a></p>
<p><a href="terrain/README_地形审计.md">地形来源与质量</a> · <a href="landcover/README_土地覆盖审计.md">土地覆盖来源与质量</a> · <a href="osm/README.md">OSM采集说明</a> · <a href="overture/README.md">Overture采集说明</a> · <a href="references/README.md">逐图来源与用途</a></p>
<div class="foot">Copernicus GLO-30 · ESA WorldCover · © OpenStreetMap contributors · Overture Maps Foundation。许可按各来源保留；参考图片的开放复用许可未确认。依赖库与下载缓存不属于地理数据。</div></main></html>"""
    (DATA / "数据入口.html").write_text(page, encoding="utf-8")
    print(json.dumps({"entry": "数据入口.html", "catalog": "catalog.json", "osm_features": osm["canonical_features"],
                      "overture_buildings": overture["exact_intersection_features"], "working_bytes": gpkg["bytes"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
