# 米制矢量工作包

[dongshan_sources_utm51n.gpkg](dongshan_sources_utm51n.gpkg) 可用 QGIS、ArcGIS Pro 等 GIS 打开。水平坐标为 WGS 84 / UTM zone 51N（EPSG:32651，米），与本批地形米制副本一致。

OSM 与 Overture 分层保存；建筑不可将两层直接相加。所有来源属性逐条比较通过；嵌套 tags、sources、数组等可能以 JSON 文本保存，原始 GeoJSON/GeoParquet 另存。没有做简化、建筑聚合、几何修复、去重或高度推断。

| 图层 | 来源要素数 | 转换状态 |
|---|---:|---|
| osm_boundaries | 72 | verified |
| osm_buildings | 330 | verified |
| osm_landuse_natural | 2,678 | verified |
| osm_other_tagged | 0 | empty source not exported |
| osm_places_admin_poi | 366 | verified |
| osm_road_points | 28 | verified |
| osm_roads | 3,446 | verified |
| osm_water_polygons | 2,162 | verified |
| osm_waterways | 381 | verified |
| overture_buildings | 60,873 | verified |

图层可能含混合几何类型；源数据的道路面、建筑点、关系几何按源保留。专题层有交叉，不能相加作为独立对象总数。行政相关图层只代表 OSM 返回的候选关系，不代表已核准东山镇行政边界。

逐图层计数、字段、几何检查和文件 SHA-256 见 [qa.json](qa.json)。许可和署名沿用各来源目录，工作包不改变源数据许可。
