"""Audit acquired derived datasets and index retained sources (no mutations).

Requires GDAL and numpy. Runtime libraries, partial downloads, caches and HTTP
logs are deliberately outside the data inventory. This checks file integrity
and geometry, not completeness or positional accuracy against field survey.
"""
from pathlib import Path
import collections
import csv
import datetime as dt
import hashlib
import json
import math

import numpy as np
from osgeo import gdal, ogr, osr

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "东山镇_数据"
QA = DATA / "qa"
BBOX = (120.28, 30.98, 120.50, 31.22)
gdal.UseExceptions()


def dump(path, obj):
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")


def sha256(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(2 ** 20), b""):
            h.update(block)
    return h.hexdigest()


def vector_info(path):
    ds = ogr.Open(str(path))
    if not ds:
        raise ValueError("OGR cannot open vector")
    result = {"file": path.relative_to(DATA).as_posix(), "layers": []}
    for layer in ds:
        srs = layer.GetSpatialRef()
        if srs:
            srs.AutoIdentifyEPSG()
        counts = collections.Counter()
        missing, empty, invalid = [], [], []
        n = 0
        # Suppress repeated GEOS messages; invalid identities are retained below.
        gdal.PushErrorHandler("CPLQuietErrorHandler")
        try:
            for f in layer:
                n += 1
                g = f.GetGeometryRef()
                if g is None:
                    missing.append(f.GetFID()); continue
                if g.IsEmpty():
                    empty.append(f.GetFID()); continue
                counts[g.GetGeometryName()] += 1
                if not g.IsValid():
                    invalid.append(f.GetFID())
        finally:
            gdal.PopErrorHandler()
        env = layer.GetExtent() if n else None
        result["layers"].append({
            "name": layer.GetName(), "feature_count": n,
            "geometry_types": dict(counts),
            "epsg": srs.GetAuthorityCode(None) if srs else None,
            "extent_west_south_east_north": [env[0], env[2], env[1], env[3]] if env else None,
            "missing_geometry_count": len(missing), "empty_geometry_count": len(empty),
            "invalid_geometry_count": len(invalid),
            "invalid_fids_first_30": invalid[:30],
            "fields": [field.GetName() for field in layer.schema],
            "extent_note": "Some source features may extend across the envelope; source geometry is retained unless the module manifest says it was clipped.",
        })
    return result


def raster_info(path):
    ds = gdal.Open(str(path))
    srs = osr.SpatialReference(wkt=ds.GetProjection())
    try:
        srs.AutoIdentifyEPSG()
    except RuntimeError:
        pass
    gt = ds.GetGeoTransform()
    corners = [gdal.ApplyGeoTransform(gt, x, y)
               for x, y in [(0, 0), (ds.RasterXSize, 0),
                            (0, ds.RasterYSize), (ds.RasterXSize, ds.RasterYSize)]]
    bands = []
    for i in range(1, ds.RasterCount + 1):
        band = ds.GetRasterBand(i)
        a = band.ReadAsArray()
        nd = band.GetNoDataValue()
        valid = np.isfinite(a)
        if nd is not None and not math.isnan(nd):
            valid &= a != nd
        bands.append({"number": i, "dtype": gdal.GetDataTypeName(band.DataType),
                      "nodata": nd, "valid_fraction": float(np.mean(valid)),
                      "min": float(a[valid].min()) if valid.any() else None,
                      "max": float(a[valid].max()) if valid.any() else None})
    return {"file": path.relative_to(DATA).as_posix(),
            "width": ds.RasterXSize, "height": ds.RasterYSize,
            "epsg": srs.GetAuthorityCode(None), "geotransform": gt,
            "bounds_in_native_crs": [min(c[0] for c in corners), min(c[1] for c in corners),
                                     max(c[0] for c in corners), max(c[1] for c in corners)],
            "bands": bands}


def main():
    QA.mkdir(exist_ok=True)
    folders = [DATA / m / "derived" for m in ("terrain", "landcover", "osm", "overture")]
    folders += [DATA / "osm/layers", DATA / "working"]
    derived = sorted({p for folder in folders for p in folder.rglob("*")
                      if p.is_file() and p.suffix.lower() in (".tif", ".geojson", ".gpkg")}
                     | set((DATA / "overture").glob("buildings_bbox_*.geojson")))
    rasters, vectors, failures = [], [], []
    for p in derived:
        try:
            (rasters if p.suffix.lower() == ".tif" else vectors).append(
                raster_info(p) if p.suffix.lower() == ".tif" else vector_info(p))
        except Exception as e:
            failures.append({"file": p.relative_to(DATA).as_posix(), "error": str(e)})
    refs = json.loads((DATA / "references/validation.json").read_text(encoding="utf-8"))
    report = {
        "checked_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
        "method": "Reopen all listed derived rasters and vectors with GDAL/OGR; count all features; check geometry validity; read raster bands; hash selected data and provenance files.",
        "scope": "File integrity and internal geometry only. Not a field accuracy check, source coverage guarantee, date harmonization, or cartographic generalization.",
        "bbox_wgs84": BBOX, "bbox_is_administrative_boundary": False,
        "rasters": rasters, "vectors": vectors, "open_failures": failures,
        "reference_integrity": {k: refs.get(k) for k in ("checked_at_utc", "passed", "sources_downloaded", "images_downloaded", "failed")},
        "module_reports": [p.relative_to(DATA).as_posix() for p in DATA.rglob("*.json")
                           if ("validation" in p.name or "quality" in p.name) and "_runtime" not in p.parts and "qa" not in p.parts],
    }
    dump(QA / "integration-checks.json", report)

    selected = set(derived)
    for folder in [DATA / "terrain/raw", DATA / "terrain/provenance", DATA / "landcover/provenance",
                   DATA / "references/pages", DATA / "references/images", DATA / "overture/raw"]:
        if folder.exists():
            selected.update(p for p in folder.rglob("*") if p.is_file()
                            and not p.name.endswith(".aux.xml") and p.suffix.lower() != ".part")
    # Only a successfully validated response is admitted as an OSM source.
    for manifest in (DATA / "osm/raw").rglob("*.manifest.json"):
        m = json.loads(manifest.read_text(encoding="utf-8"))
        if m.get("status") == "validated" and m.get("file"):
            p = manifest.parent / m["file"]
            if p.exists():
                selected.add(p)
    selected.add(DATA / "collection_envelope.geojson")
    inventory = []
    for p in sorted(selected):
        role = "derived_data" if p in derived else "retained_source"
        if "references" in p.parts:
            role = "internal_research_reference"
        if "provenance" in p.parts:
            role = "provenance_document"
        inventory.append({"file": p.relative_to(DATA).as_posix(), "role": role,
                          "bytes": p.stat().st_size, "sha256": sha256(p)})
    dump(QA / "data-files.json", {"checked_utc": report["checked_utc"],
                                 "scope": "Selected usable data and retained source documents. Excludes runtime, caches, logs, failed responses, and inventory itself.",
                                 "files": inventory})
    with (QA / "data-files.csv").open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["file", "role", "bytes", "sha256"])
        writer.writeheader(); writer.writerows(inventory)
    print(json.dumps({"raster_files": len(rasters), "vector_files": len(vectors),
                      "open_failures": failures, "inventory_files": len(inventory),
                      "inventory_bytes": sum(e["bytes"] for e in inventory)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
