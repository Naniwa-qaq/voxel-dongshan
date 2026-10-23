"""Project source-specific vector layers to a convenient GIS work package.

No simplification, height inference, source merging or deduplication. Original
GeoJSON/GeoParquet files remain untouched. Nested/list values may be serialized
to JSON text by the GPKG driver; the complete source fields are compared below.
"""
from pathlib import Path
import datetime as dt
import hashlib
import json

from osgeo import gdal, ogr

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "东山镇_数据"
OUT = DATA / "working"
gdal.UseExceptions()
ogr.UseExceptions()


def normalized(v):
    if isinstance(v, str) and v.lstrip().startswith(("[", "{")):
        try:
            return json.loads(v)
        except (ValueError, TypeError):
            pass
    return v


def sha(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for b in iter(lambda: f.read(1024 * 1024), b""):
            h.update(b)
    return h.hexdigest()


def main():
    OUT.mkdir(exist_ok=True)
    target = OUT / "dongshan_sources_utm51n.gpkg"
    temp = OUT / "dongshan_sources_utm51n.building.gpkg"
    if temp.exists():
        temp.unlink()
    sources = [("osm_" + p.stem, p) for p in sorted((DATA / "osm/layers").glob("*.geojson"))]
    sources += [("overture_buildings", DATA / "overture/buildings_bbox_2026-09-23.1.geojson")]
    warnings = []

    def log_gdal(level, code, message):
        if message not in warnings and len(warnings) < 30:
            warnings.append(message)

    report = {"created_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
              "purpose": "Separate projected source layers; NOT a merged building database or generalized map",
              "output_crs": "EPSG:32651", "geometry_operation": "Horizontal reprojection only",
              "nested_field_handling": "Driver JSON serialization checked semantically against every source feature",
              "layers": [], "driver_messages": warnings}
    first = True
    for name, path in sources:
        if not path.exists():
            continue
        src = ogr.Open(str(path))
        sl = src.GetLayer(0)
        n = sl.GetFeatureCount()
        if n == 0:
            report["layers"].append({"layer": name, "source": path.relative_to(DATA).as_posix(),
                                     "source_count": 0, "status": "empty source not exported"})
            continue
        fields = [fd.GetName() for fd in sl.schema]
        gdal.PushErrorHandler(log_gdal)
        try:
            ds = gdal.VectorTranslate(str(temp), str(path), format="GPKG",
                                      accessMode=None if first else "update", layerName=name,
                                      dstSRS="EPSG:32651", layerCreationOptions=["SPATIAL_INDEX=YES"],
                                      preserveFID=False)
            ds = None
        finally:
            gdal.PopErrorHandler()
        first = False
        dest = ogr.Open(str(temp))
        dl = dest.GetLayerByName(name)
        dest_fields = [fd.GetName() for fd in dl.schema]
        if fields != dest_fields:
            raise ValueError(f"Field schema changed in {name}: {fields} -> {dest_fields}")
        if dl.GetFeatureCount() != n:
            raise ValueError(f"Feature count changed in {name}")
        attribute_mismatches = []
        invalid, null, seen = 0, 0, 0
        sl.ResetReading(); dl.ResetReading()
        for sf, df in zip(sl, dl):
            seen += 1
            sp = {k: normalized(v) for k, v in sf.items().items()}
            dp = {k: normalized(v) for k, v in df.items().items()}
            if sp != dp and len(attribute_mismatches) < 10:
                attribute_mismatches.append({"source_fid": sf.GetFID(),
                    "fields": [k for k in sp if sp[k] != dp.get(k)]})
            g = df.GetGeometryRef()
            if g is None or g.IsEmpty():
                null += 1
            elif not g.IsValid():
                invalid += 1
        if seen != n or attribute_mismatches:
            raise ValueError(f"Attribute transfer failed in {name}: {attribute_mismatches}")
        e = dl.GetExtent()
        report["layers"].append({"layer": name, "source": path.relative_to(DATA).as_posix(),
            "source_count": n, "output_count": n, "all_attribute_records_compared": seen,
            "attribute_mismatch_count": 0, "fields": fields, "empty_geometry_count": null,
            "invalid_geometry_count": invalid,
            "bounds_utm51n": [e[0], e[2], e[1], e[3]], "status": "verified"})
        dest = None; src = None
        print(name, n, "verified", flush=True)
    if first:
        raise RuntimeError("No nonempty vector layer found")
    temp.replace(target)
    report["file"] = target.name
    report["bytes"] = target.stat().st_size
    report["sha256"] = sha(target)
    (OUT / "qa.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    rows = [f"| {x['layer']} | {x['source_count']:,} | {x['status']} |" for x in report["layers"]]
    (OUT / "README.md").write_text(
        "# 米制矢量工作包\n\n"
        "[dongshan_sources_utm51n.gpkg](dongshan_sources_utm51n.gpkg) 可用 QGIS、ArcGIS Pro 等 GIS 打开。"
        "水平坐标为 WGS 84 / UTM zone 51N（EPSG:32651，米），与本批地形米制副本一致。\n\n"
        "OSM 与 Overture 分层保存；建筑不可将两层直接相加。所有来源属性逐条比较通过；"
        "嵌套 tags、sources、数组等可能以 JSON 文本保存，原始 GeoJSON/GeoParquet 另存。"
        "没有做简化、建筑聚合、几何修复、去重或高度推断。\n\n"
        "| 图层 | 来源要素数 | 转换状态 |\n|---|---:|---|\n" + "\n".join(rows) +
        "\n\n图层可能含混合几何类型；源数据的道路面、建筑点、关系几何按源保留。"
        "专题层有交叉，不能相加作为独立对象总数。行政相关图层只代表 OSM 返回的候选关系，"
        "不代表已核准东山镇行政边界。\n\n"
        "逐图层计数、字段、几何检查和文件 SHA-256 见 [qa.json](qa.json)。"
        "许可和署名沿用各来源目录，工作包不改变源数据许可。\n", encoding="utf-8")
    print(json.dumps({"file": str(target), "bytes": report["bytes"], "sha256": report["sha256"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
