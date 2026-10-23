"""Offline audit and local terrain/landcover derivatives; no network or ArcPy.

Run using a Python with osgeo.gdal and numpy. Existing source objects and
collection manifests are read-only. Run date is separate from acquisition date.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import math
from pathlib import Path
import xml.etree.ElementTree as ET

import numpy as np
from osgeo import gdal, osr

import terrain_collect as tc

ROOT = Path(__file__).resolve().parent.parent
TERRAIN = ROOT / "东山镇_数据" / "terrain"
LANDCOVER = ROOT / "东山镇_数据" / "landcover"
BBOX = [120.28, 30.98, 120.50, 31.22]
RUN_TIME = dt.datetime.now(dt.timezone.utc).isoformat()
HANDBOOK = "https://dataspace.copernicus.eu/sites/default/files/media/files/2024-06/geo1988-copernicusdem-spe-002_producthandbook_i5.0.pdf"
gdal.UseExceptions()


def relative(path):
    return str(Path(path).relative_to(ROOT))


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as src:
        for chunk in iter(lambda: src.read(8 * 1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def summary(path, categorical=False):
    ds = gdal.Open(str(path), gdal.GA_ReadOnly)
    band = ds.GetRasterBand(1)
    array = band.ReadAsArray()
    if array is None:
        raise RuntimeError(f"Cannot read {path}")
    nodata = band.GetNoDataValue()
    mask = np.isfinite(array)
    if nodata is not None:
        mask &= array != nodata
    values = array[mask]
    gt = ds.GetGeoTransform()
    x1, y1 = gdal.ApplyGeoTransform(gt, ds.RasterXSize, ds.RasterYSize)
    sr = osr.SpatialReference(wkt=ds.GetProjection())
    try:
        sr.AutoIdentifyEPSG()
    except RuntimeError:
        # The AWS TIFF uses a WGS84 ensemble WKT without a root EPSG authority.
        # Preserve its WKT; record the accepted source CRS separately below.
        pass
    result = {
        "path": relative(path), "bytes": path.stat().st_size, "sha256": digest(path),
        "width": ds.RasterXSize, "height": ds.RasterYSize,
        "crs_wkt": ds.GetProjection(), "epsg": sr.GetAuthorityCode(None),
        "source_horizontal_crs_from_product_metadata": "EPSG:4326" if sr.IsGeographic() else None,
        "geotransform": list(gt), "bounds": [min(gt[0], x1), min(gt[3], y1), max(gt[0], x1), max(gt[3], y1)],
        "pixel_size": [gt[1], abs(gt[5])], "pixel_units": "degree" if sr.IsGeographic() else "metre",
        "type": gdal.GetDataTypeName(band.DataType), "nodata": nodata,
        "valid_pixels": int(mask.sum()), "total_pixels": int(mask.size),
        "valid_fraction": float(mask.mean()),
        "min": float(values.min()) if values.size else None,
        "max": float(values.max()) if values.size else None,
        "gdal_band_checksum": band.Checksum(),
    }
    if categorical:
        unique, counts = np.unique(values, return_counts=True)
        result["valid_pixel_value_counts"] = {str(int(v)): int(c) for v, c in zip(unique, counts)}
    elif values.size:
        result["percentiles_0_25_50_75_95_99_100"] = [float(v) for v in np.percentile(values, [0, 25, 50, 75, 95, 99, 100])]
    ds = None
    return result


def audit_source(manifest):
    records = []
    failures = []
    for item in manifest["downloads"]:
        if not item.get("path"):
            continue
        path = ROOT / item["path"]
        entry = {"path": relative(path), "exists": path.exists()}
        if path.exists():
            entry.update(bytes=path.stat().st_size, sha256=digest(path))
            entry["matches_recorded_bytes"] = entry["bytes"] == item.get("bytes")
            entry["matches_recorded_sha256"] = entry["sha256"] == item.get("sha256")
            if item.get("s3_etag_md5_verified") and item.get("md5"):
                entry["source_etag_md5_verified_during_original_collection"] = True
                entry["md5"] = hashlib.md5(path.read_bytes()).hexdigest()
                entry["matches_original_source_etag_md5"] = entry["md5"] == item["md5"]
                if not entry["matches_original_source_etag_md5"]:
                    failures.append(entry["path"])
        if not entry["exists"] or not entry.get("matches_recorded_bytes") or not entry.get("matches_recorded_sha256"):
            failures.append(entry["path"])
        records.append(entry)
    listing_records = []
    for tile in manifest["tile_listing"]:
        for obj in tile["objects"]:
            path = TERRAIN / "raw" / obj["key"]
            ok = path.exists() and path.stat().st_size == obj["size"]
            listing_records.append({"path": relative(path), "listed_bytes": obj["size"], "matches_listing": ok})
            if not ok:
                failures.append(relative(path))
    # Force a complete decoded read of each science TIFF, not just a header open.
    science = []
    for tile in tc.TILES:
        for kind in ["DEM", "EDM", "FLM", "HEM", "WBM"]:
            path = TERRAIN / "raw" / tile / (tile + ".tif") if kind == "DEM" else TERRAIN / "raw" / tile / "AUXFILES" / (tile[:-3] + kind + ".tif")
            ds = gdal.Open(str(path))
            band = ds.GetRasterBand(1)
            array = band.ReadAsArray()
            if array is None or array.shape != (3600, 3600):
                failures.append(relative(path))
            science.append({"path": relative(path), "width": ds.RasterXSize, "height": ds.RasterYSize,
                            "geotransform": ds.GetGeoTransform(), "gdal_band_checksum": band.Checksum(),
                            "decoded_all_pixels": array is not None, "nodata": band.GetNoDataValue()})
            ds = None
    return {"manifest_records_checked": len(records), "listed_raw_objects_checked": len(listing_records),
            "science_tiffs_full_read": len(science), "failures": sorted(set(failures)),
            "files": records, "listed_objects": listing_records, "science_rasters": science}


def source_dates():
    result = []
    for path in sorted((TERRAIN / "raw").rglob("*.xml")):
        root = ET.parse(path).getroot()
        keep = {"tsxx_startTime", "tsxx_stopTime", "generationTime", "tileVersion", "demTileVersion"}
        fields = {}
        for node in root.iter():
            tag = node.tag.split("}")[-1]
            if tag in keep and node.text:
                fields[tag] = node.text.strip()
        result.append({"path": relative(path), **fields})
    return result


def projected_bounds():
    src = osr.SpatialReference(); src.ImportFromEPSG(4326)
    dst = osr.SpatialReference(); dst.ImportFromEPSG(32651)
    src.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    dst.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    transform = osr.CoordinateTransformation(src, dst)
    west, south, east, north = BBOX
    coords = []
    for t in np.linspace(0, 1, 101):
        x, y = west + t * (east-west), south + t * (north-south)
        coords.extend([transform.TransformPoint(x, south), transform.TransformPoint(x, north),
                       transform.TransformPoint(west, y), transform.TransformPoint(east, y)])
    xmin, ymin = min(p[0] for p in coords), min(p[1] for p in coords)
    xmax, ymax = max(p[0] for p in coords), max(p[1] for p in coords)
    return [math.floor(xmin/30)*30, math.floor(ymin/30)*30, math.ceil(xmax/30)*30, math.ceil(ymax/30)*30]


def reproject(source, target, resolution, bounds, categorical=False, hem=False, worldcover=False):
    if target.exists():
        return summary(target, categorical=categorical)
    nodata = 0 if worldcover else (65535 if categorical else -9999)
    data_type = gdal.GDT_Byte if worldcover else (gdal.GDT_UInt16 if categorical else gdal.GDT_Float32)
    algorithm = "near" if categorical or hem else "bilinear"
    out = gdal.Warp(str(target), str(source), format="GTiff", srcSRS="EPSG:4326", dstSRS="EPSG:32651",
                    xRes=resolution, yRes=resolution, outputBounds=bounds, resampleAlg=algorithm,
                    dstNodata=nodata, outputType=data_type, multithread=True,
                    creationOptions=["TILED=YES", "COMPRESS=DEFLATE", "BIGTIFF=IF_SAFER"])
    if out is None:
        raise RuntimeError(f"Warp failed: {target}")
    metadata = {"REQUESTED_BBOX_WGS84": json.dumps(BBOX), "EXTENT_ROLE": "Collection envelope, NOT administrative boundary",
                "PROCESSING": f"Horizontal reprojection only; {algorithm} resampling; no accuracy gain; source retained",
                "SOURCE_FILE": relative(source), "GRID_RESOLUTION_METRES": str(resolution), "AUDIT_UTC": RUN_TIME}
    if worldcover:
        metadata.update(DATASET="ESA WorldCover 2021 v200", LICENSE="CC BY 4.0", VERTICAL_DATUM="Not applicable; categorical")
    elif not categorical and not hem:
        metadata.update(DATASET="Copernicus GLO-30 AWS 2021 release", HEIGHT_TYPE="DSM", VERTICAL_DATUM="EGM2008 (EPSG:3855)", HEIGHT_UNIT="metre")
        out.GetRasterBand(1).SetUnitType("m")
    elif hem:
        metadata.update(QUALITY_LAYER="HEM", NOTE="Random height-error standard deviation; not total error and not a new projected uncertainty model", UNIT="metre")
    else:
        metadata["QUALITY_LAYER"] = source.stem.split("_")[-2].upper()
    out.SetMetadata(metadata)
    out.FlushCache(); out = None
    return summary(target, categorical=categorical)


def elevation_diagnostics(native, native_results):
    ds = gdal.Open(str(native))
    array, gt = ds.ReadAsArray(), ds.GetGeoTransform()
    q = {kind: gdal.Open(str(TERRAIN / "derived" / f"dongshan_envelope_glo30_2021_{kind.lower()}_wgs84.tif")).ReadAsArray() for kind in ["EDM", "FLM", "WBM"]}
    output = {}
    for name, mask in {"height_below_0m": array < 0, "height_below_minus10m_review": array < -10}.items():
        yy, xx = np.where(mask)
        item = {"pixels": int(mask.sum()), "fraction": float(mask.mean()),
                "range_metres": [float(array[mask].min()), float(array[mask].max())] if mask.any() else None,
                "quality_value_counts": {kind: {str(int(v)): int(c) for v,c in zip(*np.unique(values[mask], return_counts=True))} for kind,values in q.items()}}
        if len(xx):
            item["bbox_pixel_centres_wgs84"] = [gt[0]+(int(xx.min())+.5)*gt[1], gt[3]+(int(yy.max())+.5)*gt[5], gt[0]+(int(xx.max())+.5)*gt[1], gt[3]+(int(yy.min())+.5)*gt[5]]
        output[name] = item
    path = TERRAIN / "qa" / "dongshan_envelope_glo30_2021_height_review_wgs84.tif"
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        out = gdal.GetDriverByName("GTiff").Create(str(path), ds.RasterXSize, ds.RasterYSize, 1, gdal.GDT_Byte, ["TILED=YES", "COMPRESS=DEFLATE"])
        out.SetGeoTransform(gt); out.SetProjection(ds.GetProjection())
        out.GetRasterBand(1).WriteArray((array < -10).astype(np.uint8))
        out.SetMetadata({"FLAGS": "0=unflagged; 1=source height below -10 metres; review only, not proof of error", "ACTION": "No source value corrected or removed", "SOURCE_FILE": relative(native)})
        out.FlushCache(); out = None
    output["review_mask"] = summary(path, categorical=True)
    output["interpretation"] = "Low elevations are retained exactly. They may represent pits/depressions or source artefacts; no independent ground truth establishes which. Do not flatten automatically."
    output["dsm_semantic_void_pixels_from_edm"] = int((q["EDM"] == 0).sum())
    output["hem_unavailable_fraction"] = 1 - native_results["HEM"]["valid_fraction"]
    ds = None
    return output


def main():
    manifest = json.loads((TERRAIN / "terrain_download_manifest.json").read_text("utf-8"))
    audit = audit_source(manifest)
    if audit["failures"]:
        write_json(TERRAIN / "qa" / "terrain_audit.json", {"audit_utc": RUN_TIME, "source_integrity": audit})
        raise RuntimeError("Source file integrity failed; originals untouched")
    native = TERRAIN / "derived" / "dongshan_envelope_glo30_2021_wgs84.tif"
    required = [native] + [TERRAIN / "derived" / f"dongshan_envelope_glo30_2021_{kind}_wgs84.tif" for kind in ["edm", "flm", "hem", "wbm"]]
    if not all(path.exists() for path in required):
        tc.process_terrain()  # Local GDAL only; no collect()/HTTP code is called.
    native_results = {"DSM": summary(native)}
    for kind in ["EDM", "FLM", "HEM", "WBM"]:
        path = TERRAIN / "derived" / f"dongshan_envelope_glo30_2021_{kind.lower()}_wgs84.tif"
        native_results[kind] = summary(path, categorical=kind != "HEM")
        if native_results[kind]["geotransform"] != native_results["DSM"]["geotransform"] or native_results[kind]["width"] != native_results["DSM"]["width"] or native_results[kind]["height"] != native_results["DSM"]["height"]:
            raise RuntimeError(f"Native {kind} grid differs from DSM")
    bounds = projected_bounds()
    projected = {"DSM": reproject(native, TERRAIN / "derived" / "dongshan_envelope_glo30_2021_utm51n_30m.tif", 30, bounds)}
    for kind in ["EDM", "FLM", "HEM", "WBM"]:
        projected[kind] = reproject(TERRAIN / "derived" / f"dongshan_envelope_glo30_2021_{kind.lower()}_wgs84.tif", TERRAIN / "derived" / f"dongshan_envelope_glo30_2021_{kind.lower()}_utm51n_30m.tif", 30, bounds, categorical=kind != "HEM", hem=kind == "HEM")
        if projected[kind]["geotransform"] != projected["DSM"]["geotransform"] or (projected[kind]["width"], projected[kind]["height"]) != (projected["DSM"]["width"], projected["DSM"]["height"]):
            raise RuntimeError(f"Projected {kind} grid differs from DSM")
    terrain_qa = {"audit_utc": RUN_TIME, "audit_date_local": "2026-10-19", "operation": "Reuse source files collected 2026-10-16; offline audit and local derivation only; no new downloads",
                  "original_manifest_created_utc": manifest["created_utc"], "requested_bbox_wgs84": BBOX, "extent_role": "采集包络；不是行政边界",
                  "python_runtime": __import__("sys").executable, "gdal_version": gdal.VersionInfo("--version"),
                  "source_integrity": audit, "source_tile_dates": source_dates(), "native_derivatives": native_results,
                  "metric_derivatives": projected, "metric_grid_epsg": 32651, "metric_grid_bounds": bounds,
                  "native_grids_aligned": True, "elevation_review": elevation_diagnostics(native, native_results), "quality_interpretation_source": HANDBOOK,
                  "quality_notes": ["EDM/FLM 0 means semantic void even where source has no GeoTIFF nodata tag; WBM 0 is valid non-water.",
                                    "HEM -32767 is masked by the source tag; edited water/terrain often has no HEM, which does not mean DSM has a void.",
                                    "HEM is random-error standard deviation, excluding systematic errors and phase-unwrapping errors.",
                                    "The one-arcsecond native grid is about 26.5 m east-west and 30.8 m north-south at Dongshan; a 30 m target grid adds no detail.",
                                    "DSM includes roofs/vegetation. No surveyed local vertical/horizontal accuracy validation has been performed.",
                                    "Only horizontal CRS was transformed; heights remain EGM2008 metres, not the Taihu Zhenjiang-Wusong gauge datum.",
                                    "A globally edited water surface is not a current lake waterline; GLO30 does not guarantee hydrological connectivity."]}
    write_json(TERRAIN / "qa" / "terrain_audit.json", terrain_qa)
    old_lc = json.loads((LANDCOVER / "landcover_validation.json").read_text("utf-8"))
    lc_path = LANDCOVER / "derived" / "dongshan_envelope_worldcover_2021_v200_wgs84.tif"
    lc_native = summary(lc_path, categorical=True)
    if lc_native["sha256"] != old_lc["clipped"]["sha256"]:
        raise RuntimeError("Existing WorldCover crop hash mismatch; original left intact")
    lc_metric = reproject(lc_path, LANDCOVER / "derived" / "dongshan_envelope_worldcover_2021_v200_utm51n_10m.tif", 10, bounds, categorical=True, worldcover=True)
    if not set(lc_metric["valid_pixel_value_counts"]).issubset(lc_native["valid_pixel_value_counts"]):
        raise RuntimeError("Projected WorldCover contains a newly invented category")
    if lc_metric["bounds"] != projected["DSM"]["bounds"] or lc_metric["width"] != projected["DSM"]["width"] * 3 or lc_metric["height"] != projected["DSM"]["height"] * 3:
        raise RuntimeError("WorldCover 10 m and DSM 30 m grids do not nest")
    lc_qa = {"audit_utc": RUN_TIME, "audit_date_local": "2026-10-19", "operation": "Reuse 2026-10-16 HTTP-range subset; offline audit and nearest-neighbour reprojection; no new downloads",
             "original_validation_created_utc": old_lc["created_utc"], "existing_clip_matches_recorded_sha256": True,
             "source_url": old_lc["source"]["url"], "source_observation_interval": ["2021-01-01", "2021-12-31"],
             "source_product": "ESA WorldCover 2021 v200", "license": "CC BY 4.0", "requested_bbox_wgs84": BBOX,
             "extent_role": "采集包络；不是行政边界", "native_derivative": lc_native, "metric_derivative": lc_metric,
             "shared_utm51n_outer_bounds_with_terrain": bounds, "resampling": "nearest neighbour; categorical codes preserved; 10 m target does not improve effective source resolution",
             "quality_gaps": old_lc["quality_gaps"], "attribution": old_lc["attribution"]}
    write_json(LANDCOVER / "qa" / "landcover_audit.json", lc_qa)
    print(json.dumps({"source_records_verified": audit["manifest_records_checked"], "raw_listing_objects_verified": audit["listed_raw_objects_checked"],
                      "science_tiffs_decoded": audit["science_tiffs_full_read"], "integrity_failures": audit["failures"],
                      "dsm_native": {k: native_results["DSM"][k] for k in ["path", "width", "height", "valid_pixels", "min", "max", "bounds", "sha256"]},
                      "quality_counts": {k: native_results[k].get("valid_pixel_value_counts", {"valid_pixels": native_results[k]["valid_pixels"], "total_pixels": native_results[k]["total_pixels"]}) for k in ["EDM", "FLM", "HEM", "WBM"]},
                      "landcover_native_valid_pixels": lc_native["valid_pixels"], "metric_bounds": bounds,
                      "terrain_qa": relative(TERRAIN / "qa" / "terrain_audit.json"), "landcover_qa": relative(LANDCOVER / "qa" / "landcover_audit.json")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
