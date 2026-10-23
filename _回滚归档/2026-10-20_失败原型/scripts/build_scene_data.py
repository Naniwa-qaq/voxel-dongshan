"""Real geography -> explicitly generalized scene payload. No rendering or ArcPy.

Raw sources stay read-only. Coordinates are local metres (x east, z south),
terrain/height values are metres before any renderer vertical exaggeration.
"""
from __future__ import annotations

from collections import Counter, defaultdict
import datetime as dt
import hashlib
import json
import math
from pathlib import Path

import numpy as np
from scipy import ndimage
from osgeo import gdal, ogr, osr

gdal.UseExceptions(); ogr.UseExceptions()
ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "东山镇_数据"
OUT = ROOT / "东山镇_原型" / "data"
DISPLAY_BBOX = [120.280, 31.008, 120.449, 31.138]
TERRAIN_STEP = 100.0
BARRIER_STEP = 20.0
DENSITY_CELL = 160.0
MIN_WATER_AREA = 3000.0


def load_json(path):
    return json.loads(path.read_text("utf-8"))


def json_text(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def sha256(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(8*1024*1024), b""):
            h.update(chunk)
    return h.hexdigest()


def srs(code):
    ref = osr.SpatialReference(); ref.ImportFromEPSG(code)
    ref.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    return ref


WGS = srs(4326); UTM = srs(32651)
TO_UTM = osr.CoordinateTransformation(WGS, UTM)


def feature_id(feature):
    p = feature.get("properties") or {}
    return str(feature.get("id") or p.get("id") or f"{p.get('_osm_type', 'unknown')}/{p.get('_osm_id', 'unknown')}")


def project_geom(feature):
    geom = ogr.CreateGeometryFromJson(json_text(feature["geometry"]))
    if geom is None or geom.IsEmpty():
        return None
    geom.Transform(TO_UTM)
    return geom


def polygon_box(bounds):
    xmin, ymin, xmax, ymax = bounds
    ring = ogr.Geometry(ogr.wkbLinearRing)
    for point in [(xmin,ymin),(xmax,ymin),(xmax,ymax),(xmin,ymax),(xmin,ymin)]:
        ring.AddPoint_2D(*point)
    geom = ogr.Geometry(ogr.wkbPolygon); geom.AddGeometry(ring)
    return geom


def transform_bbox(bbox, step):
    west,south,east,north = bbox
    points = []
    for t in np.linspace(0,1,101):
        x,y = west+t*(east-west),south+t*(north-south)
        points.extend([TO_UTM.TransformPoint(x,south),TO_UTM.TransformPoint(x,north),TO_UTM.TransformPoint(west,y),TO_UTM.TransformPoint(east,y)])
    return [math.floor(min(p[0] for p in points)/step)*step,math.floor(min(p[1] for p in points)/step)*step,
            math.ceil(max(p[0] for p in points)/step)*step,math.ceil(max(p[1] for p in points)/step)*step]


def geom_parts(geom, kind):
    if geom is None or geom.IsEmpty():
        return
    name = geom.GetGeometryName()
    if name == kind:
        yield geom
    elif name.startswith("MULTI") or name == "GEOMETRYCOLLECTION":
        for i in range(geom.GetGeometryCount()):
            yield from geom_parts(geom.GetGeometryRef(i),kind)


def clip_geom(geom, clip):
    if geom is None or not geom.Intersects(clip):
        return None
    if clip.Contains(geom):
        return geom.Clone()
    return geom.Intersection(clip)


def rasterize(geometries, bounds, step):
    xmin,ymin,xmax,ymax = bounds
    nx,nz = round((xmax-xmin)/step),round((ymax-ymin)/step)
    raster = gdal.GetDriverByName("MEM").Create("",nx,nz,1,gdal.GDT_Byte)
    raster.SetGeoTransform((xmin,step,0,ymax,0,-step)); raster.SetProjection(UTM.ExportToWkt())
    vector = ogr.GetDriverByName("Memory").CreateDataSource("")
    layer = vector.CreateLayer("mask",UTM,geom_type=ogr.wkbUnknown)
    for geom in geometries:
        if geom is None or geom.IsEmpty():
            continue
        f = ogr.Feature(layer.GetLayerDefn()); f.SetGeometry(geom); layer.CreateFeature(f)
    gdal.RasterizeLayer(raster,[1],layer,burn_values=[1],options=["ALL_TOUCHED=TRUE"])
    array = raster.ReadAsArray().astype(bool)
    raster = None; vector = None
    return array


def warp_array(path,bounds,step,algorithm="near",dtype=gdal.GDT_Float32):
    ds = gdal.Warp("",str(path),format="MEM",srcSRS="EPSG:4326",dstSRS="EPSG:32651",outputBounds=bounds,xRes=step,yRes=step,
                   resampleAlg=algorithm,outputType=dtype,dstNodata=-9999 if dtype==gdal.GDT_Float32 else 0)
    array=ds.ReadAsArray(); ds=None
    return array


def local_point(e,n,origin):
    return [round(e-origin[0],1),round(origin[1]-n,1)]


def line_points(line):
    return [(line.GetX(i),line.GetY(i)) for i in range(line.GetPointCount())]


def shared_nodes(lines):
    return Counter((round(x,2),round(y,2)) for _,geom in lines for line in geom_parts(geom,"LINESTRING") for x,y in line_points(line))


def simplify_line(line,counts,tolerance):
    pts=line_points(line)
    if len(pts)<3:
        return pts
    protected=[0]+[i for i in range(1,len(pts)-1) if counts[(round(pts[i][0],2),round(pts[i][1],2))]>1]+[len(pts)-1]
    result=[]
    for first,last in zip(protected,protected[1:]):
        segment=ogr.Geometry(ogr.wkbLineString)
        for point in pts[first:last+1]: segment.AddPoint_2D(*point)
        reduced=segment.Simplify(tolerance)
        out=line_points(reduced)
        result.extend(out if not result else out[1:])
    return result


def polygon_rings(poly,origin,tolerance):
    simple=poly.SimplifyPreserveTopology(tolerance)
    if simple is None or simple.IsEmpty() or simple.GetGeometryName()!="POLYGON":
        simple=poly
    return [[local_point(ring.GetX(j),ring.GetY(j),origin) for j in range(ring.GetPointCount())]
            for ring in (simple.GetGeometryRef(i) for i in range(simple.GetGeometryCount()))]


def make_network(features,focus,clip,kind,origin):
    selected=[]; excluded=Counter()
    for f in features:
        p=f.get("properties") or {}
        cls=p.get("highway") if kind=="road" else p.get("waterway")
        if kind=="road":
            if cls in ["proposed","construction","raceway","steps"] or not cls:
                excluded[str(cls)]+=1; continue
        elif cls not in ["river","canal","stream"]:
            excluded[str(cls)]+=1; continue
        geom=clip_geom(project_geom(f),clip)
        geom=clip_geom(geom,focus)
        if geom is None: continue
        length=sum(part.Length() for part in geom_parts(geom,"LINESTRING"))
        if length==0: continue
        if kind=="road" and cls in ["service","track","path","footway","cycleway","pedestrian"] and length<120 and not p.get("name"):
            excluded["short_minor_road"]+=1; continue
        if kind=="water" and cls=="stream" and length<220 and not p.get("name"):
            excluded["short_unnamed_stream"]+=1; continue
        selected.append((f,geom))
    counts=shared_nodes(selected)
    output=[]; before=after=0
    for f,geom in selected:
        p=f.get("properties") or {}
        for i,line in enumerate(geom_parts(geom,"LINESTRING")):
            if line.Length()<12: continue
            reduced=simplify_line(line,counts,10 if kind=="road" else 12)
            if len(reduced)<2: continue
            before+=line.GetPointCount(); after+=len(reduced)
            output.append({"id":feature_id(f)+f":{i}","name":p.get("name") or "","kind":p.get("highway") if kind=="road" else p.get("waterway"),
                           "bridge":str(p.get("bridge","")).lower() not in ["","no","false","0"],"layer":p.get("layer","0"),
                           "points":[local_point(x,y,origin) for x,y in reduced]})
    return output,selected,{"input_features":len(features),"selected_features":len(selected),"display_parts":len(output),"source_vertices":before,"display_vertices":after,"omitted_by_rule":dict(excluded),
                            "junction_policy":"Shared source vertices and part endpoints retained; bridge/layer attributes retained; no arbitrary network snapping or claim of complete topology"}


def make_pois(features,focus,clip,origin):
    output=[]
    for f in features:
        p=f.get("properties") or {}
        name=p.get("name") or ""
        category=None
        if p.get("amenity")=="school": category="school"
        elif p.get("historic"): category="heritage"
        elif p.get("amenity")=="place_of_worship": category="temple"
        elif p.get("amenity")=="ferry_terminal": category="port"
        elif p.get("natural")=="peak": category="peak"
        elif p.get("place") in ["town","village","hamlet","neighbourhood"] and name: category=p.get("place")
        elif p.get("tourism")=="attraction" and name: category="attraction"
        elif p.get("tourism")=="viewpoint" and name: category="viewpoint"
        elif p.get("leisure")=="park" and name=="雕花楼": category="cultural_site"
        if not category: continue
        geom=project_geom(f)
        if geom is None: continue
        point=geom if geom.GetGeometryName()=="POINT" else geom.PointOnSurface() if geom.GetDimension()==2 else geom.Centroid()
        if not point.Intersects(focus) or not point.Intersects(clip): continue
        x,z=local_point(point.GetX(),point.GetY(),origin)
        item={"id":feature_id(f),"name":name,"x":x,"z":z,"category":category,
              "evidence":{"source":"OpenStreetMap","osmId":feature_id(f),"geometryType":geom.GetGeometryName(),
                          "tags":{k:p[k] for k in ["name","amenity","historic","tourism","place","natural","religion","denomination","ele","leisure"] if k in p}},
              "geometryType":"source_point" if geom.GetGeometryName()=="POINT" else "source_polygon_anchor",
              "heightType":"symbolic_placeholder_not_measured"}
        if category=="cultural_site":
            item["name"]="雕花楼园区"
            item["siteInterpretation"]="OSM leisure=park site boundary, not the measured footprint of Chunzai Lou or its main hall; no architectural reconstruction claimed"
        if geom.GetDimension()==2:
            clipped=clip_geom(geom,clip)
            item["outlines"]=[polygon_rings(poly,origin,8) for poly in geom_parts(clipped,"POLYGON")]
            item["rings"]=item["outlines"][0] if item["outlines"] else []
            item["sourceAreaM2"]=round(geom.Area(),1)
        output.append(item)
    return output


def prepare_buildings(path,focus,bbox,origin,barrier,land,focus_grid,bounds,report):
    # A coarse constrained partition is used instead of a town-wide sub-metre grid.
    xmin,ymin,xmax,ymax=bounds
    rows,cols=barrier.shape
    free=(~barrier)&land&focus_grid
    ratio=round(DENSITY_CELL/BARRIER_STEP)
    block=np.zeros(free.shape,dtype=np.int32)
    next_id=1
    for row in range(0,rows,ratio):
        for col in range(0,cols,ratio):
            tile,count=ndimage.label(free[row:row+ratio,col:col+ratio])
            nonzero=tile>0; tile[nonzero]+=next_id-1
            block[row:row+ratio,col:col+ratio]=tile
            next_id+=count
    distance,nearest=ndimage.distance_transform_edt(~free,return_indices=True)
    margin=ndimage.distance_transform_edt(free)*BARRIER_STEP
    data=load_json(path)
    fs=data["features"]; source_feature_count=len(fs); groups=defaultdict(list); stats=Counter()
    west,south,east,north=bbox
    for f in fs:
        coords=f.get("geometry",{}).get("coordinates",[])
        if not coords: stats["missing_geometry"]+=1; continue
        # GeoJSON polygon envelope prefilter avoids unnecessary projection of the full bbox collection.
        geom=ogr.CreateGeometryFromJson(json_text(f["geometry"]))
        cx=geom.Centroid().GetX(); cy=geom.Centroid().GetY()
        if not(west<=cx<=east and south<=cy<=north): stats["outside_display_bbox"]+=1; continue
        geom.Transform(TO_UTM)
        point=geom.PointOnSurface()
        if not focus.Intersects(point): stats["outside_focus"]+=1; continue
        area=geom.Area()
        if area<12 or area>250000: stats["implausible_area"]+=1; continue
        e,n=point.GetX(),point.GetY()
        col,row=int((e-xmin)/BARRIER_STEP),int((ymax-n)/BARRIER_STEP)
        if not(0<=row<rows and 0<=col<cols): stats["outside_raster"]+=1; continue
        if not land[row,col]: stats["source_centroid_water_masked"]+=1; continue
        assignment_shift=0.0
        if not free[row,col]:
            if distance[row,col]>2.1: stats["on_barrier_no_free_cell_within42m"]+=1; continue
            rr,cc=int(nearest[0,row,col]),int(nearest[1,row,col])
            assignment_shift=float(distance[row,col]*BARRIER_STEP)
            row,col=rr,cc
        block_id=int(block[row,col])
        if not block_id: stats["unassigned"]+=1; continue
        rings=[poly.GetGeometryRef(0) for poly in geom_parts(geom,"POLYGON")]
        best_angle=0; best_length=0
        for ring in rings:
            for i in range(ring.GetPointCount()-1):
                dx=ring.GetX(i+1)-ring.GetX(i); dz=ring.GetY(i)-ring.GetY(i+1)
                length=math.hypot(dx,dz)
                if length>best_length:
                    best_length=length; best_angle=math.atan2(dz,dx)
        props=f.get("properties") or {}
        height=props.get("height")
        groups[block_id].append({"e":e,"n":n,"row":row,"col":col,"area":area,"angle":best_angle,"id":str(props.get("id") or f.get("id")),"source_height":height,"assignment_shift":assignment_shift})
        stats["eligible_source_buildings"]+=1
    del data,fs
    result=[]
    for block_id,items in sorted(groups.items()):
        # Anchor to an actual footprint instead of moving a group mean across a road/pond.
        centre=np.median(np.array([[p["e"],p["n"]] for p in items]),axis=0)
        anchor=min(items,key=lambda p:(p["e"]-centre[0])**2+(p["n"]-centre[1])**2)
        row,col=anchor["row"],anchor["col"]
        # Groups assigned from a barrier pixel are placed at their selected free cell centre.
        if anchor["assignment_shift"]:
            e=xmin+(col+.5)*BARRIER_STEP; n=ymax-(row+.5)*BARRIER_STEP
        else: e,n=anchor["e"],anchor["n"]
        count=len(items); area_sum=sum(p["area"] for p in items)
        angle=.5*math.atan2(sum(math.sin(2*p["angle"])*p["area"] for p in items),sum(math.cos(2*p["angle"])*p["area"] for p in items))
        area=max(70,min(1700,area_sum*.52))
        aspect=min(2.3,max(1.1,math.sqrt(max(p["area"] for p in items)/max(1,np.median([p["area"] for p in items])))))
        width=math.sqrt(area*aspect); depth=math.sqrt(area/aspect)
        safe_radius=max(5,min(44,float(margin[row,col])*.70))
        scale=min(1,(safe_radius*2)/math.hypot(width,depth))
        width=max(6,width*scale); depth=max(5,depth*scale)
        inferred_height=round(6.5+min(5,math.log2(count+1)*1.2),1)
        x,z=local_point(e,n,origin)
        result.append({"id":f"roofgroup/{block_id}","x":x,"z":z,"width":round(width,1),"depth":round(depth,1),"angle":round(angle,4),
                       "height":inferred_height,"heightType":"inferred_lowrise_typology_not_measured","heightSource":"typological","sourceCount":count,"blockId":block_id,
                       "sourceAreaM2":round(area_sum,1),"density":round(min(1,area_sum/(DENSITY_CELL*DENSITY_CELL)),3),
                       "source":"Overture Maps buildings 2026-09-23.1","sourceExampleIds":[p["id"] for p in items[:3]],
                       "sourceHeightsAvailable":sum(p["source_height"] is not None for p in items),"maxAssignmentShiftM":round(max(p["assignment_shift"] for p in items),1)})
    report.update({"source_file_features":source_feature_count,"selection_counts":dict(stats),"representative_roof_groups":len(result),"sum_represented_source_count":sum(p["sourceCount"] for p in result),
                   "density_cell_m":DENSITY_CELL,"barrier_grid_m":BARRIER_STEP,"barriers":f"Roads excluding path/track/footway/cycleway, waterways and water polygons; four-neighbour connected regions within each {DENSITY_CELL:g} m density cell",
                   "anchor_policy":"Actual source footprint anchor, moved only to nearest free 20 m cell when its centroid lies on the coarse barrier raster; maximum eligible assignment distance 42 m",
                   "height_policy":"All displayed roof-group heights inferred from a low-rise typology/density formula. Not a height measurement; source heights not substituted.",
                   "limitations":["Not one-to-one building reproduction; groups are cartographic symbols, not parcel/building claims.","Coarse road/water barriers constrain grouping but are not a certified street-block topology.","Footprint angle is an area-weighted axial mean; dimensions are reduced symbols and do not preserve total built area."]})
    return result


def validate_scene(scene,building_report):
    t=scene["terrain"]; expected=t["nx"]*t["nz"]
    lengths={key:len(t[key]) for key in ["heights","heightValidMask","landcover","landMask","focusMask"]}
    if any(n!=expected for n in lengths.values()):
        raise RuntimeError("Terrain array length mismatch")
    if not np.all(np.isfinite(t["heights"])):
        raise RuntimeError("Non-finite scene height")
    if any(l and not v for l,v in zip(t["landMask"],t["heightValidMask"])):
        raise RuntimeError("Land without a valid source height")
    west,north,east,south=scene["meta"]["bounds"]
    outside=[]
    for category in ["roads","waterways"]:
        for item in scene[category]:
            if any(not(west-.2<=p[0]<=east+.2 and north-.2<=p[1]<=south+.2) for p in item["points"]): outside.append(item["id"])
    if outside: raise RuntimeError("Network geometry outside scene bounds")
    roofs=scene["settlements"]
    if len({r["id"] for r in roofs})!=len(roofs): raise RuntimeError("Duplicate roof-group ID")
    represented=sum(r["sourceCount"] for r in roofs)
    if represented!=building_report["selection_counts"]["eligible_source_buildings"]:
        raise RuntimeError("Source building count not preserved in aggregation")
    for name in ["陆巷村","三山村","莫厘峰","紫金庵"]:
        if not any(p["name"]==name for p in scene["pois"]): raise RuntimeError("Required source landmark missing: "+name)
    schools=[p for p in scene["pois"] if p["category"]=="school"]
    if len(schools)!=4 or not all(p.get("rings") for p in schools): raise RuntimeError("School source outlines missing")
    if not all(r.get("heightSource")=="typological" for r in roofs): raise RuntimeError("Roof height inference label missing")
    return {"passed":True,"terrainArrayLengths":lengths,"finiteHeightValues":True,"landRequiresSourceHeight":True,"networkWithinBounds":True,
            "uniqueRoofGroupIds":True,"roofSourceCountConserved":True,"representedSourceBuildings":represented,
            "requiredSourceLandmarksPresent":True,"schoolPolygonsPreserved":len(schools),"allRoofHeightsExplicitlyTypological":True}


def main():
    OUT.mkdir(parents=True,exist_ok=True)
    started=dt.datetime.now(dt.timezone.utc).isoformat()
    osm={name:load_json(DATA/"osm"/"layers"/f"{name}.geojson")["features"] for name in ["boundaries","roads","waterways","water_polygons","places_admin_poi","landuse_natural"]}
    focus_feature=next(f for f in osm["boundaries"] if f["properties"].get("name")=="东山镇" and f["properties"].get("admin_level")=="8")
    focus=project_geom(focus_feature)
    bounds=transform_bbox(DISPLAY_BBOX,TERRAIN_STEP); clip=polygon_box(bounds)
    origin=[round((bounds[0]+bounds[2])/200)*100,round((bounds[1]+bounds[3])/200)*100]
    nx,nz=round((bounds[2]-bounds[0])/TERRAIN_STEP),round((bounds[3]-bounds[1])/TERRAIN_STEP)
    dsm_path=DATA/"terrain"/"derived"/"dongshan_envelope_glo30_2021_wgs84.tif"
    lc_path=DATA/"landcover"/"derived"/"dongshan_envelope_worldcover_2021_v200_wgs84.tif"
    heights=warp_array(dsm_path,bounds,TERRAIN_STEP)
    lc=warp_array(lc_path,bounds,TERRAIN_STEP,dtype=gdal.GDT_Byte)
    water_geoms=[]; water_polygons=[]
    for f in osm["water_polygons"]:
        geom=clip_geom(project_geom(f),clip)
        if geom is None or geom.GetDimension()!=2: continue
        water_geoms.append(geom)
        for i,poly in enumerate(geom_parts(geom,"POLYGON")):
            if poly.Area()<MIN_WATER_AREA: continue
            p=f.get("properties") or {}
            if p.get("name")!="太湖" and not poly.Intersects(focus): continue
            water_polygons.append({"id":feature_id(f)+f":{i}","name":p.get("name") or "","kind":p.get("water") or p.get("natural") or "water",
                                   "rings":polygon_rings(poly,origin,12),"sourceAreaM2":round(poly.Area(),1)})
    water_mask=rasterize(water_geoms,bounds,TERRAIN_STEP)
    focus_mask=rasterize([focus],bounds,TERRAIN_STEP)
    land=(lc!=80)&(lc!=0)&(~water_mask)
    fine_lc=warp_array(lc_path,bounds,BARRIER_STEP,dtype=gdal.GDT_Byte)
    fine_water=rasterize(water_geoms,bounds,BARRIER_STEP)
    fine_focus=rasterize([focus],bounds,BARRIER_STEP)
    fine_land=(fine_lc!=80)&(fine_lc!=0)&(~fine_water)
    roads,road_selected,road_report=make_network(osm["roads"],focus,clip,"road",origin)
    waterways,water_selected,water_report=make_network(osm["waterways"],focus,clip,"water",origin)
    barriers=[]
    for f,g in road_selected:
        if f["properties"].get("highway") not in ["path","track","footway","cycleway","pedestrian"]:
            barriers.append(g.Buffer(4))
    for _,g in water_selected: barriers.append(g.Buffer(5))
    barrier=rasterize(barriers,bounds,BARRIER_STEP)|fine_water
    building_report={}
    settlements=prepare_buildings(DATA/"overture"/"buildings_bbox_2026-09-23.1.geojson",focus,DISPLAY_BBOX,origin,barrier,fine_land,fine_focus,bounds,building_report)
    poi_features={feature_id(f):f for f in osm["places_admin_poi"]+osm["landuse_natural"] if f.get("geometry")}
    pois=make_pois(list(poi_features.values()),focus,clip,origin)
    campuses=[]
    for f in osm["places_admin_poi"]:
        if f.get("properties",{}).get("amenity")=="school":
            geom=project_geom(f)
            if geom is not None and geom.GetDimension()==2 and geom.Intersects(focus): campuses.append((feature_id(f),geom))
    for group in settlements:
        point=ogr.Geometry(ogr.wkbPoint);point.AddPoint_2D(origin[0]+group["x"],origin[1]-group["z"])
        for campus_id,campus in campuses:
            if campus.Intersects(point): group.update(semanticType="campus",campusId=campus_id);break
    # Keep source surface elevations, including water pixels, for transparent provenance.
    # Rendering should use landMask/focusMask instead of mistaking omitted context for water.
    valid_heights=np.isfinite(heights)&(heights!=-9999)
    terrain={"nx":nx,"nz":nz,"x0":round(bounds[0]+TERRAIN_STEP/2-origin[0],1),"z0":round(origin[1]-(bounds[3]-TERRAIN_STEP/2),1),"dx":TERRAIN_STEP,"dz":TERRAIN_STEP,
             "heights":np.round(np.where(valid_heights,heights,0).astype(float),2).ravel().tolist(),"heightValidMask":valid_heights.astype(int).ravel().tolist(),
             "landcover":lc.astype(int).ravel().tolist(),"landMask":land.astype(int).ravel().tolist(),"focusMask":focus_mask.astype(int).ravel().tolist()}
    local_bounds=[bounds[0]-origin[0],origin[1]-bounds[3],bounds[2]-origin[0],origin[1]-bounds[1]]
    focus_land=land&focus_mask&valid_heights
    focus_rows,focus_cols=np.where(focus_land)
    focus_x=terrain["x0"]+focus_cols*TERRAIN_STEP
    focus_z=terrain["z0"]+focus_rows*TERRAIN_STEP
    land_bounds=[float(focus_x.min()-TERRAIN_STEP/2),float(focus_z.min()-TERRAIN_STEP/2),float(focus_x.max()+TERRAIN_STEP/2),float(focus_z.max()+TERRAIN_STEP/2)]
    water_values,water_counts=np.unique(heights[water_mask&valid_heights],return_counts=True)
    prevalent_water_height=float(water_values[np.argmax(water_counts)])
    scene={"meta":{"schemaVersion":1,"title":"太湖东山 · 制图综合三维原型","crs":"EPSG:32651","origin":origin,"bounds":local_bounds,"displayBboxWgs84":DISPLAY_BBOX,
                   "focusCenter":[round(float(focus_x.mean()),1),round(float(focus_z.mean()),1)],"landBounds":land_bounds,
                   "minHeight":round(float(heights[focus_land].min()),2),"maxHeight":round(float(heights[focus_land].max()),2),
                   "coordinateConvention":"x=easting-originE; z=originN-northing; y=source height metres; terrain rows advance south (+z)",
                   "verticalDatum":"EGM2008 (EPSG:3855), metres","terrainType":"DSM includes roofs and vegetation; not bare-earth DTM","verticalExaggerationApplied":False,
                   "focusBoundary":{"osmId":feature_id(focus_feature),"name":"东山镇","role":"display selection using OSM boundary, not authoritative cadastral/legal boundary"},
                   "focusMaskPolicy":"landMask is actual source-derived land/water classification. focusMask separately flags Dongshan display focus. Hide or fade land outside focusMask without changing it to water.",
                   "waterLevelHint":{"value":prevalent_water_height,"datum":"EGM2008","type":"static visual reference from prevalent source DSM mapped-water pixel height; not current observed lake level"},
                   "sources":{"terrain":"Copernicus GLO30 AWS 2021 release; underlying tile acquisitions 2011–2014","landcover":"ESA WorldCover 2021 v200","roadsWaterPois":"OSM snapshot 2026-10-19","buildings":"Overture Maps release 2026-09-23.1"},
                   "attribution":["© OpenStreetMap contributors (ODbL 1.0)","Overture Maps Foundation; see source per-feature attribution and local data ledger","Copernicus DEM: produced using Copernicus WorldDEM-30","© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium"],
                   "limitations":["Roof groups and inferred heights are display symbols, not measured buildings.","Water/road network completeness and full topology are not certified.","No missing historic landmark or playground geometry has been invented.","Land cover and DSM reflect older source periods, not a 2026 ground survey."]},
           "terrain":terrain,"roads":roads,"waterways":waterways,"waterPolygons":water_polygons,"settlements":settlements,"pois":pois}
    validation=validate_scene(scene,building_report)
    text=json_text(scene)
    (OUT/"scene-data.json").write_text(text,encoding="utf-8")
    (OUT/"scene-data.js").write_text("// Generated from real source data by scripts/build_scene_data.py\nwindow.DONGSHAN_SCENE="+text+";\n",encoding="utf-8")
    input_paths=[dsm_path,lc_path,DATA/"overture"/"buildings_bbox_2026-09-23.1.geojson"]+[DATA/"osm"/"layers"/f"{name}.geojson" for name in osm]
    report={"createdUtc":started,"script":"scripts/build_scene_data.py","displayBboxWgs84":DISPLAY_BBOX,"selectionReason":"Covers Dongshan peninsula and Sanshan islands; OSM Dongshan display mask excludes Xishan and neighbouring-town land within the rectangular viewport.",
            "focusBoundarySource":feature_id(focus_feature),"focusBoundaryReview":"OSM polygon geometry validated by independent review; 13 unavailable relation members are subarea children rather than outer boundary segments; display selection only, not a legal boundary assertion",
            "validation":validation,"projectedBounds":bounds,"originEastingNorthing":origin,"terrain":{"dimensions":[nx,nz],"stepM":TERRAIN_STEP,"sampling":"nearest original DSM pixel, rounded to 0.01 m for payload; no vertical datum conversion or exaggeration",
            "landMaskRule":"land iff WorldCover class is nonzero and not 80 AND not within any OSM water polygon; conservative union of water evidence. Coarse ALL_TOUCHED polygon rasterization can omit thin shore strips; no created land.",
            "landPixels":int(land.sum()),"focusLandPixels":int((land&focus_mask).sum()),"heightValidPixels":int(valid_heights.sum()),"heightNoDataPixels":int((~valid_heights).sum()),
            "heightNoDataPolicy":"Source NoData stored as 0 only as numeric placeholder, flagged by heightValidMask=0 and not land; never treat as a measured zero height",
            "prevalentMappedWaterHeightM":prevalent_water_height,"prevalentMappedWaterPixelCount":int(water_counts.max()),
            "sourceHeightRangeM":[float(heights[valid_heights].min()),float(heights[valid_heights].max())],"focusLandHeightRangeM":[float(heights[land&focus_mask&valid_heights].min()),float(heights[land&focus_mask&valid_heights].max())]},
            "roads":road_report,"waterways":water_report,"waterPolygons":{"sourceFeatures":len(osm["water_polygons"]),"displayParts":len(water_polygons),"minimumAreaM2":MIN_WATER_AREA,"simplificationM":12,"holesRetained":True},
            "settlements":building_report,"pois":{"count":len(pois),"byCategory":dict(Counter(p["category"] for p in pois)),"source":"Only source OSM positions/polygons within display focus; no geocoded guesses"},
            "inputs":[{"path":str(p.relative_to(ROOT)),"bytes":p.stat().st_size,"sha256":sha256(p)} for p in input_paths],
            "outputs":[{"path":str((OUT/name).relative_to(ROOT)),"bytes":(OUT/name).stat().st_size,"sha256":sha256(OUT/name)} for name in ["scene-data.json","scene-data.js"]]}
    (OUT/"processing-report.json").write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps({"terrain":[nx,nz],"roads":len(roads),"waterways":len(waterways),"waterPolygons":len(water_polygons),"roofGroups":len(settlements),"sourceBuildingsRepresented":sum(p["sourceCount"] for p in settlements),"pois":len(pois),"payloadBytes":len(text.encode("utf-8"))},ensure_ascii=False),flush=True)


if __name__=="__main__":
    main()
