"""Render a QA overview from acquired geographic data, never a designed map.

Run with a Python containing GDAL, numpy and matplotlib. Source rasters remain
unchanged; the in-memory resampling below is for this preview image only.
"""
from pathlib import Path
import argparse
import collections
import json
import math

import numpy as np
from osgeo import gdal, ogr
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import colors, font_manager
from matplotlib.collections import LineCollection, PolyCollection
from matplotlib.patches import Patch

gdal.UseExceptions()
ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "东山镇_数据"
BBOX = (120.28, 30.98, 120.50, 31.22)


def raster_preview(path, categorical=False):
    ds = gdal.Warp("", str(path), format="MEM", dstSRS="EPSG:4326",
                   outputBounds=BBOX, width=880, height=960,
                   resampleAlg="near" if categorical else "bilinear")
    a = ds.ReadAsArray()
    return a, ds.GetRasterBand(1).GetNoDataValue()


def geometry_parts(g):
    """Return polygon exteriors and line strings in longitude/latitude."""
    typ = ogr.GT_Flatten(g.GetGeometryType())
    if typ == ogr.wkbPolygon:
        ring = g.GetGeometryRef(0)
        if ring:
            yield "polygon", np.asarray(ring.GetPoints())[:, :2]
    elif typ in (ogr.wkbLineString, ogr.wkbLinearRing):
        yield "line", np.asarray(g.GetPoints())[:, :2]
    elif typ in (ogr.wkbMultiPolygon, ogr.wkbMultiLineString, ogr.wkbGeometryCollection):
        for i in range(g.GetGeometryCount()):
            yield from geometry_parts(g.GetGeometryRef(i))


def vector_overlay(ax, files):
    shown = collections.Counter()
    for p in files:
        ds = ogr.Open(str(p))
        if not ds:
            continue
        for layer in ds:
            name = (p.stem + " " + layer.GetName()).lower()
            if any(s in name for s in ("building", "建筑")):
                role = "buildings"
            elif any(s in name for s in ("road", "highway", "道路")):
                role = "roads"
            elif any(s in name for s in ("water", "水系", "水体")):
                role = "water"
            else:
                continue
            polys, lines = [], []
            layer.SetSpatialFilterRect(*BBOX)
            for f in layer:
                g = f.GetGeometryRef()
                if not g:
                    continue
                for kind, xy in geometry_parts(g):
                    if len(xy) < 2:
                        continue
                    (polys if kind == "polygon" else lines).append(xy)
                shown[role] += 1
            if role == "buildings":
                if polys:
                    ax.add_collection(PolyCollection(polys, facecolors="#744b3e", edgecolors="none", alpha=.65, zorder=4))
            elif role == "roads":
                if lines:
                    ax.add_collection(LineCollection(lines, colors="#946436", linewidths=.4, alpha=.8, zorder=5))
            elif role == "water":
                if polys:
                    # GDAL rasterization preserves lake islands / polygon holes.
                    mask_ds = gdal.Rasterize("", str(p), format="MEM", outputBounds=BBOX,
                                            width=880, height=960, burnValues=[1],
                                            initValues=[0], outputType=gdal.GDT_Byte,
                                            layers=[layer.GetName()])
                    mask = mask_ds.ReadAsArray() > 0
                    water_rgba = np.zeros((*mask.shape, 4))
                    water_rgba[mask, :3] = colors.to_rgb("#9dc4d3")
                    water_rgba[mask, 3] = .6
                    ax.imshow(water_rgba, extent=[BBOX[0], BBOX[2], BBOX[1], BBOX[3]],
                              origin="upper", interpolation="nearest", zorder=3)
                if lines:
                    ax.add_collection(LineCollection(lines, colors="#4d8ba5", linewidths=.6, alpha=.85, zorder=6))
    return dict(shown)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dsm", type=Path, required=True)
    ap.add_argument("--vectors", nargs="*", type=Path, default=[])
    args = ap.parse_args()
    qa = DATA / "qa"
    qa.mkdir(exist_ok=True)
    font = Path("C:/Windows/Fonts/msyh.ttc")
    if font.exists():
        font_manager.fontManager.addfont(str(font))
        plt.rcParams["font.family"] = font_manager.FontProperties(fname=str(font)).get_name()
    plt.rcParams["axes.unicode_minus"] = False

    lcpath = DATA / "landcover/derived/dongshan_envelope_worldcover_2021_v200_wgs84.tif"
    lc, _ = raster_preview(lcpath, True)
    dsm, nd = raster_preview(args.dsm)
    dsm = np.where((dsm == nd) | ~np.isfinite(dsm), np.nan, dsm)
    extent = [BBOX[0], BBOX[2], BBOX[1], BBOX[3]]
    fig, axes = plt.subplots(1, 2, figsize=(13.6, 8.5), dpi=160)
    fig.patch.set_facecolor("#f7f5ef")
    terrain = colors.LinearSegmentedColormap.from_list(
        "land_elevation", ["#dfd8bc", "#b9c29a", "#85a17f", "#87977a", "#c4bdaa", "#ede7d8"])
    hi = max(50, math.ceil(float(np.nanmax(dsm)) / 50) * 50)
    rgba = terrain(colors.Normalize(0, hi)(dsm))
    # Native ~30m DSM gradients are used for display relief only.
    north_grad, east_grad = np.gradient(np.nan_to_num(dsm), 27.0, 24.0)
    hill = np.clip(.82 - east_grad * .6 + north_grad * .7, .4, 1.1)
    rgba[:, :, :3] = np.clip(rgba[:, :, :3] * hill[:, :, None], 0, 1)
    rgba[lc == 80, :3] = colors.to_rgb("#b5d0dc")
    axes[0].imshow(rgba, extent=extent, origin="upper", interpolation="nearest")
    shown = vector_overlay(axes[0], args.vectors)
    axes[0].set_title("地形与已取得的矢量骨架", loc="left", fontsize=13, pad=12)
    handles = [Patch(color="#b5d0dc", label="WorldCover 水面")]
    if shown.get("roads"):
        handles.append(Patch(color="#946436", label="OSM 道路"))
    if shown.get("water"):
        handles.append(Patch(color="#4d8ba5", label="OSM 水系（含航道）"))
    if shown.get("buildings"):
        is_overture = any("overture" in str(p).lower() for p in args.vectors)
        handles.append(Patch(color="#744b3e", label="Overture 建筑轮廓" if is_overture else "OSM 建筑轮廓"))
    axes[0].legend(handles=handles, loc="lower left", fontsize=8, framealpha=.9)
    cbax = axes[0].inset_axes([.045, .91, .34, .014])
    cb = fig.colorbar(plt.cm.ScalarMappable(norm=colors.Normalize(0, hi), cmap=terrain),
                      cax=cbax, orientation="horizontal", ticks=[0, hi / 2, hi])
    cb.ax.tick_params(labelsize=7, length=2, pad=1)
    cb.ax.set_title("DSM 海拔 / m（EGM2008）", fontsize=8, loc="left", pad=5)

    classes = [(10, "林木", "#287e4b"), (20, "灌丛", "#d8a148"),
               (30, "草地", "#cbd577"), (40, "耕地", "#e8c756"),
               (50, "建成区", "#c16252"), (60, "裸地/稀疏植被", "#b8afa3"),
               (70, "冰雪", "#e8e8ec"), (80, "常年水体", "#a8c8db"),
               (90, "草本湿地", "#54a8ac"), (95, "红树林", "#417f75"),
               (100, "苔藓地衣", "#d8cc9e")]
    rgb = np.ones((*lc.shape, 3))
    present = []
    for value, label, color in classes:
        rgb[lc == value] = colors.to_rgb(color)
        if np.any(lc == value):
            present.append(Patch(color=color, label=label))
    axes[1].imshow(rgb, extent=extent, origin="upper", interpolation="nearest")
    axes[1].set_title("土地覆盖 · ESA WorldCover 2021 v200", loc="left", fontsize=13, pad=12)
    axes[1].legend(handles=present, loc="lower left", fontsize=8, ncol=2, framealpha=.92)
    for ax in axes:
        ax.set_xlim(BBOX[0], BBOX[2]); ax.set_ylim(BBOX[1], BBOX[3])
        ax.set_aspect(1 / math.cos(math.radians(31.1)))
        ax.tick_params(labelsize=8)
        ax.set_xlabel("经度 / WGS 84", fontsize=9)
        ax.set_ylabel("纬度 / WGS 84", fontsize=9)
        ax.grid(alpha=.13, linewidth=.5)
        ax.annotate("N ↑", xy=(.95, .95), xycoords="axes fraction", ha="right", fontsize=11)
        # Approximate east-west scale at the center latitude, appropriate to QA preview.
        dx = 5000 / (111320 * math.cos(math.radians(31.1)))
        x, y = 120.425, 30.992
        ax.plot([x, x + dx], [y, y], color="#252d32", linewidth=2)
        ax.text(x + dx / 2, y + .004, "约 5 km", ha="center", fontsize=8)
    fig.suptitle("东山镇首批数据 · 采集范围核验", x=.065, ha="left", y=.97, fontsize=20, weight="bold")
    fig.text(.065, .925, "工作包络 120.28–120.50°E / 30.98–31.22°N；包含周边区域，尚未按行政区裁剪。", fontsize=10, color="#4f5558")
    fig.text(.065, .065, "来源：Copernicus GLO-30 DSM（AWS 2021 发布版）；ESA WorldCover 2021；矢量按图例标注。", fontsize=8, color="#555")
    fig.text(.065, .042, "核验日期：2026-10-19。此图仅检视已取得资料；非作品方案、非现势精测地图。预览重采样不改变原始数据。", fontsize=8, color="#555")
    fig.subplots_adjust(left=.065, right=.965, bottom=.12, top=.87, wspace=.20)
    out = qa / "collection-overview.png"
    fig.savefig(out, facecolor=fig.get_facecolor())
    plt.close(fig)
    (qa / "overview-provenance.json").write_text(json.dumps({
        "dsm": str(args.dsm.relative_to(ROOT) if args.dsm.is_relative_to(ROOT) else args.dsm),
        "landcover": str(lcpath.relative_to(ROOT)),
        "vectors": [str(p.relative_to(ROOT) if p.is_relative_to(ROOT) else p) for p in args.vectors],
        "overlay_feature_counts": shown, "bbox_wgs84": BBOX,
        "purpose": "Actual-data QA preview; not cartographic generalization or reconstruction",
        "preview_resampling": {"dsm": "bilinear", "landcover": "nearest"},
        "dsm_display_upper_limit_m": hi,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(out)


if __name__ == "__main__":
    main()
