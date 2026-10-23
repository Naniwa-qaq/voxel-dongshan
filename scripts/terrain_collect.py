"""Collect only the agreed Dongshan terrain/land-cover envelope from public sources.

No account, signed request, API key, paid service, or license click-through is used.
Run with a Python environment containing GDAL and NumPy. Original GLO-30 COGs
are retained. WorldCover is read by HTTP ranges, retaining its original pixel grid.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import hashlib
import json
import math
from pathlib import Path
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
TERRAIN = ROOT / "东山镇_数据" / "terrain"
LANDCOVER = ROOT / "东山镇_数据" / "landcover"
BBOX = [120.28, 30.98, 120.50, 31.22]
TILES = [f"Copernicus_DSM_COG_10_N{lat}_00_E120_00_DEM" for lat in [30, 31]]
DEM_BUCKET = "https://copernicus-dem-30m.s3.amazonaws.com"
WC_URL = "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_N30E120_Map.tif"
HEADERS = {"User-Agent": "DongshanStudyDataCollection/1.0 (public unsigned downloads)"}
RANGE_SEMAPHORE = threading.Semaphore(4)


def utcnow():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


def sha256(path):
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def fetch_ranges(url, path):
    """Reconstruct the exact public S3 object from verified byte ranges."""
    with urllib.request.urlopen(urllib.request.Request(url, method="HEAD", headers=HEADERS), timeout=40) as response:
        original_headers = dict(response.headers.items())
        total = int(response.headers["Content-Length"])
        etag = response.headers.get("ETag")
    chunk_size = 2 * 1024 * 1024
    chunks = [(start, min(start + chunk_size, total) - 1) for start in range(0, total, chunk_size)]
    cache = TERRAIN / "range_cache" / path.parent.name / path.name
    cache.mkdir(parents=True, exist_ok=True)

    def one_chunk(span):
        start, end = span
        target = cache / f"{start:012d}-{end:012d}.bin"
        if target.exists() and target.stat().st_size == end - start + 1:
            return target
        for attempt in range(3):
            try:
                headers = {**HEADERS, "Range": f"bytes={start}-{end}"}
                if etag:
                    headers["If-Match"] = etag
                with RANGE_SEMAPHORE:
                    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=50) as response:
                        expected_range = f"bytes {start}-{end}/{total}"
                        if response.status != 206 or response.headers.get("Content-Range") != expected_range:
                            raise IOError("server did not return the requested byte range")
                        data = response.read()
                if len(data) != end - start + 1:
                    raise IOError("byte-range size mismatch")
                target.write_bytes(data)
                return target
            except Exception:
                if attempt == 2:
                    raise
                time.sleep(2)

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        chunk_paths = list(pool.map(one_chunk, chunks))
    partial = path.with_suffix(path.suffix + ".part")
    path.parent.mkdir(parents=True, exist_ok=True)
    md5 = hashlib.md5()
    with partial.open("wb") as output:
        for chunk in chunk_paths:
            block = chunk.read_bytes()
            output.write(block)
            md5.update(block)
    if partial.stat().st_size != total:
        raise IOError("reconstructed object has wrong length")
    # These S3 objects have single-part ETags. Verify if an MD5 ETag is present.
    clean_etag = etag.strip('"') if etag else ""
    md5_verified = len(clean_etag) == 32 and "-" not in clean_etag
    if md5_verified and md5.hexdigest() != clean_etag:
        raise IOError("S3 ETag/MD5 mismatch; reconstructed object discarded")
    partial.replace(path)
    # Remove only this task's known byte-range files after exact reconstruction.
    for chunk in chunk_paths:
        chunk.unlink()
    record = {"path": str(path.relative_to(ROOT)), "url": url, "bytes": total,
              "sha256": sha256(path), "accessed_utc": utcnow(), "http_headers": original_headers,
              "retrieval": "Exact source object reconstructed from verified HTTP byte ranges",
              "s3_etag_md5_verified": md5_verified, "md5": md5.hexdigest()}
    print(json.dumps({"downloaded": record["path"], "bytes": total, "md5_verified": md5_verified}), flush=True)
    return record


def fetch(url, path, *, optional=False):
    """Download a public object; retain HTTP provenance, atomic completed files."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.stat().st_size:
        return {"path": str(path.relative_to(ROOT)), "url": url,
                "bytes": path.stat().st_size, "sha256": sha256(path), "reused": True}
    if url.endswith("_DEM.tif") or url.endswith("_HEM.tif"):
        return fetch_ranges(url, path)
    partial = path.with_suffix(path.suffix + ".part")
    last_error = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=120) as response:
                response_headers = dict(response.headers.items())
                expected = response.headers.get("Content-Length")
                with partial.open("wb") as output:
                    while block := response.read(1024 * 1024):
                        output.write(block)
                if expected and partial.stat().st_size != int(expected):
                    raise IOError(f"length mismatch for {url}")
            partial.replace(path)
            record = {"path": str(path.relative_to(ROOT)), "url": url,
                      "bytes": path.stat().st_size, "sha256": sha256(path),
                      "accessed_utc": utcnow(), "http_headers": response_headers}
            print(json.dumps({"downloaded": record["path"], "bytes": record["bytes"]}), flush=True)
            return record
        except Exception as error:
            last_error = f"{type(error).__name__}: {error}"
            if isinstance(error, urllib.error.HTTPError) and error.code in [401, 403, 404]:
                break
            if attempt < 2:
                time.sleep(2)
    if partial.exists():
        partial.unlink()
    if optional:
        return {"url": url, "error": last_error, "retrieved": False}
    raise RuntimeError(last_error)


def collect():
    provenance = TERRAIN / "provenance"
    records = []
    for name, url in [
        ("aws_registry_copernicus_dem.html", "https://registry.opendata.aws/copernicus-dem/"),
        ("aws_copernicus_dem_readme.html", DEM_BUCKET + "/readme.html"),
        ("copernicus_product_page.html", "https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM"),
        ("License-COPDEM-30.pdf", "https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Data/DEM/resources/license/License-COPDEM-30.pdf"),
        ("Copernicus_DEM_Product_Handbook_i5.0.pdf", "https://dataspace.copernicus.eu/sites/default/files/media/files/2024-06/geo1988-copernicusdem-spe-002_producthandbook_i5.0.pdf"),
        ("copernicus_30m_stac_collection.json", "https://copernicus-dem-30m-stac.s3.amazonaws.com/collection.json"),
    ]:
        records.append(fetch(url, provenance / name, optional=True))
    urls_paths = []
    listing_summary = []
    for tile in TILES:
        prefix = tile + "/"
        listing_url = DEM_BUCKET + "/?" + urllib.parse.urlencode({"list-type": "2", "prefix": prefix, "max-keys": "100"})
        listing_path = provenance / (tile + "_listing.xml")
        rec = fetch(listing_url, listing_path, optional=True)
        records.append(rec)
        objects = []
        if listing_path.exists():
            tree = ET.fromstring(listing_path.read_bytes())
            for content in tree.findall("{*}Contents"):
                key = content.findtext("{*}Key")
                size = int(content.findtext("{*}Size", "0"))
                if key:
                    objects.append({"key": key, "size": size})
                    if not key.endswith("/"):
                        urls_paths.append((DEM_BUCKET + "/" + key, TERRAIN / "raw" / key))
        if not objects:
            key = prefix + tile + ".tif"
            urls_paths.append((DEM_BUCKET + "/" + key, TERRAIN / "raw" / key))
        listing_summary.append({"tile": tile, "objects": objects})
    # The two geographically independent original COG objects may download in parallel.
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(fetch, url, path) for url, path in urls_paths]
        records.extend(f.result() for f in futures)
    write_json(TERRAIN / "terrain_download_manifest.json", {
        "created_utc": utcnow(), "envelope_wgs84": BBOX,
        "extent_role": "采集包络；不是行政边界", "public_unsigned": True,
        "product": "Copernicus GLO-30 Public; AWS Registry says 2021 release",
        "mirror_operator": "Sinergise; distribution listed in AWS Open Data Registry",
        "source_type": "DSM, not bare-earth DTM", "vertical_datum": "EGM2008; height in metres",
        "tile_listing": listing_summary, "downloads": records,
    })


def raster_summary(dataset):
    from osgeo import gdal, osr
    import numpy as np
    gt = dataset.GetGeoTransform()
    sr = osr.SpatialReference(wkt=dataset.GetProjection())
    x0, y0 = gt[0], gt[3]
    x1, y1 = gdal.ApplyGeoTransform(gt, dataset.RasterXSize, dataset.RasterYSize)
    band = dataset.GetRasterBand(1)
    array = band.ReadAsArray()
    nodata = band.GetNoDataValue()
    good = np.isfinite(array)
    if nodata is not None:
        good &= array != nodata
    values = array[good]
    return {
        "width": dataset.RasterXSize, "height": dataset.RasterYSize,
        "bands": dataset.RasterCount, "crs_wkt": dataset.GetProjection(),
        "authority": [sr.GetAuthorityName(None), sr.GetAuthorityCode(None)],
        "geotransform": gt, "bounds": [min(x0,x1), min(y0,y1), max(x0,x1), max(y0,y1)],
        "pixel_size_degrees": [gt[1], abs(gt[5])], "pixel_type": gdal.GetDataTypeName(band.DataType),
        "nodata": nodata, "valid_pixels": int(good.sum()), "total_pixels": int(array.size),
        "valid_fraction": float(good.mean()), "min": float(values.min()) if values.size else None,
        "max": float(values.max()) if values.size else None,
        "dataset_metadata": dataset.GetMetadata(), "band_metadata": band.GetMetadata(),
    }


def crop_native(dataset, path, extra_metadata):
    """Expand requested bbox to source pixel edges; no resampling or warping."""
    from osgeo import gdal
    gt = dataset.GetGeoTransform()
    inv = gdal.InvGeoTransform(gt)
    xmin, ymin, xmax, ymax = BBOX
    px0, py0 = gdal.ApplyGeoTransform(inv, xmin, ymax)
    px1, py1 = gdal.ApplyGeoTransform(inv, xmax, ymin)
    left, top = math.floor(px0), math.floor(py0)
    right, bottom = math.ceil(px1), math.ceil(py1)
    if left < 0 or top < 0 or right > dataset.RasterXSize or bottom > dataset.RasterYSize:
        raise ValueError("requested envelope not fully within source coverage")
    path.parent.mkdir(parents=True, exist_ok=True)
    out = gdal.Translate(str(path), dataset, format="GTiff", srcWin=[left, top, right-left, bottom-top],
                         creationOptions=["TILED=YES", "COMPRESS=DEFLATE", "BIGTIFF=IF_SAFER"])
    if out is None:
        raise RuntimeError("GDAL Translate returned no output")
    out.SetMetadata({"REQUESTED_BBOX_WGS84": json.dumps(BBOX),
                     "EXTENT_ROLE": "Collection envelope, NOT administrative boundary",
                     "PROCESSING": "Native grid pixel-window subset; NO RESAMPLING; NO WARPING",
                     **extra_metadata})
    out.FlushCache()
    summary = raster_summary(out)
    out = None
    summary.update({"path": str(path.relative_to(ROOT)), "bytes": path.stat().st_size,
                    "sha256": sha256(path), "source_pixel_window": [left, top, right-left, bottom-top]})
    return summary


def process_terrain():
    from osgeo import gdal
    gdal.UseExceptions()
    paths = [TERRAIN / "raw" / tile / (tile + ".tif") for tile in TILES]
    raw_summaries = []
    for path in paths:
        ds = gdal.Open(str(path), gdal.GA_ReadOnly)
        summary = raster_summary(ds)
        summary.update({"path": str(path.relative_to(ROOT)), "sha256": sha256(path)})
        raw_summaries.append(summary)
        ds = None
    vrt_path = TERRAIN / "derived" / "glo30_2021_source_mosaic.vrt"
    vrt_path.parent.mkdir(parents=True, exist_ok=True)
    vrt = gdal.BuildVRT(str(vrt_path), [str(p) for p in paths], resolution="highest")
    clipped = crop_native(vrt, TERRAIN / "derived" / "dongshan_envelope_glo30_2021_wgs84.tif", {
        "DATASET": "Copernicus GLO-30 Public AWS 2021 release", "HEIGHT_TYPE": "DSM",
        "VERTICAL_DATUM": "EGM2008", "HEIGHT_UNIT": "metre",
        "SOURCE_ATTRIBUTION": "produced using Copernicus WorldDEM-30; see provenance/License-COPDEM-30.pdf",
    })
    vrt = None
    quality_summaries = {}
    for kind in ["EDM", "FLM", "HEM", "WBM"]:
        quality_paths = [TERRAIN / "raw" / tile / "AUXFILES" / (tile[:-3] + kind + ".tif") for tile in TILES]
        if not all(path.exists() for path in quality_paths):
            quality_summaries[kind] = {"available": False, "missing_paths": [str(p.relative_to(ROOT)) for p in quality_paths if not p.exists()]}
            continue
        quality_vrt = gdal.BuildVRT("", [str(p) for p in quality_paths], resolution="highest")
        quality_summaries[kind] = crop_native(quality_vrt, TERRAIN / "derived" / f"dongshan_envelope_glo30_2021_{kind.lower()}_wgs84.tif", {
            "DATASET": "Copernicus GLO-30 Public AWS 2021 release", "QUALITY_LAYER": kind,
            "INTERPRETATION": "See accompanying original product metadata and product handbook",
        })
        quality_summaries[kind]["available"] = True
        quality_vrt = None
        if kind != "HEM":
            import numpy as np
            quality_ds = gdal.Open(str(TERRAIN / "derived" / f"dongshan_envelope_glo30_2021_{kind.lower()}_wgs84.tif"))
            unique, counts = np.unique(quality_ds.ReadAsArray(), return_counts=True)
            quality_summaries[kind]["pixel_value_counts"] = {str(int(v)):int(c) for v,c in zip(unique,counts)}
            quality_ds = None
    write_json(TERRAIN / "terrain_validation.json", {
        "created_utc": utcnow(), "requested_bbox_wgs84": BBOX,
        "extent_role": "采集包络；不是行政边界", "original_tiles": raw_summaries,
        "clipped": clipped, "quality_layers_clipped": quality_summaries,
        "quality_gaps": [
            "Global DSM includes vegetation/buildings; no claim of local bare-earth or street-level accuracy.",
            "EGM2008 heights must not be directly assigned Taihu gauge values in Zhenjiang Wusong datum.",
        ],
    })
    print(json.dumps({"terrain_clip": clipped["path"], "valid_fraction": clipped["valid_fraction"], "range": [clipped["min"],clipped["max"]]}), flush=True)


def collect_landcover():
    from osgeo import gdal
    import numpy as np
    gdal.UseExceptions()
    # Anonymous public COG HTTP ranges only. No credentials or VITO account.
    for key, value in {
        "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR",
        "CPL_VSIL_CURL_ALLOWED_EXTENSIONS": ".tif",
        "GDAL_HTTP_MAX_RETRY": "3", "GDAL_HTTP_RETRY_DELAY": "2",
        "GDAL_HTTP_TIMEOUT": "120", "CPL_VSIL_CURL_CACHE_SIZE": "33554432",
    }.items():
        gdal.SetConfigOption(key, value)
    provenance = LANDCOVER / "provenance"
    records = []
    for name, url in [
        ("worldcover_data_access.html", "https://esa-worldcover.org/en/data-access"),
        ("aws_registry_worldcover.html", "https://registry.opendata.aws/esa-worldcover-vito/index.html"),
        ("WorldCover_PUM_V2.0.pdf", "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/docs/WorldCover_PUM_V2.0.pdf"),
    ]:
        records.append(fetch(url, provenance / name, optional=True))
    with urllib.request.urlopen(urllib.request.Request(WC_URL, method="HEAD", headers=HEADERS), timeout=60) as response:
        source_headers = dict(response.headers.items())
    ds = gdal.Open("/vsicurl/" + WC_URL, gdal.GA_ReadOnly)
    source_metadata = {"url": WC_URL, "width": ds.RasterXSize, "height": ds.RasterYSize,
                       "bands": ds.RasterCount, "geotransform": ds.GetGeoTransform(),
                       "crs_wkt": ds.GetProjection(), "metadata": ds.GetMetadata(), "http_headers": source_headers}
    clip_path = LANDCOVER / "derived" / "dongshan_envelope_worldcover_2021_v200_wgs84.tif"
    clipped = crop_native(ds, clip_path, {"DATASET": "ESA WorldCover 2021 v200", "SOURCE_URL": WC_URL,
                         "LICENSE": "CC BY 4.0", "VERTICAL_DATUM": "Not applicable (categorical land cover)"})
    ds = None
    ds = gdal.Open(str(clip_path))
    arr = ds.ReadAsArray()
    unique, counts = np.unique(arr, return_counts=True)
    histogram = {str(int(v)):int(c) for v,c in zip(unique,counts)}
    color_table = ds.GetRasterBand(1).GetColorTable()
    colormap = {str(i):list(color_table.GetColorEntry(i)) for i in range(color_table.GetCount())} if color_table else {}
    ds = None
    classes = {0:"NoData",10:"Tree cover",20:"Shrubland",30:"Grassland",40:"Cropland",50:"Built-up",60:"Bare / sparse vegetation",70:"Snow and ice",80:"Permanent water bodies",90:"Herbaceous wetland",95:"Mangroves",100:"Moss and lichen"}
    write_json(LANDCOVER / "worldcover_classes.json", {"source": "WorldCover PUM v2.0 Table 3", "classes": classes, "colormap_rgba": colormap})
    write_json(LANDCOVER / "landcover_validation.json", {
        "created_utc": utcnow(), "requested_bbox_wgs84": BBOX,
        "extent_role": "采集包络；不是行政边界", "source": source_metadata,
        "clipped": clipped, "class_pixel_counts": histogram, "provenance_downloads": records,
        "retrieval": "HTTP-range subset of a single public COG; full 3x3 degree tile NOT downloaded",
        "attribution": "© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium",
        "quality_gaps": [
            "InputQuality not obtained: official provider says it is available only through login-required Viewer/Terrascope paths.",
            "11 broad land-cover classes do not distinguish orchards, tea gardens, local forest species, or current-year land use.",
            "Permanent-water classification is not a legal shoreline nor a current-date waterline.",
        ],
    })
    print(json.dumps({"landcover_clip": clipped["path"], "valid_fraction":clipped["valid_fraction"], "classes":histogram}), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("step", choices=["collect", "terrain", "landcover", "all"])
    args = parser.parse_args()
    if args.step in ["collect", "all"]:
        collect()
    if args.step in ["terrain", "all"]:
        process_terrain()
    if args.step in ["landcover", "all"]:
        collect_landcover()
