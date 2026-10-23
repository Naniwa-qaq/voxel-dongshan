# 陆巷重制样区数据

`design.js` 在上级 `js/`，可直接以 `<script>` 加载，定义 `window.DSDesign`。`design.json` 是同内容数据副本。生成脚本为工作区 `scripts/build_remake_design.py`；只读已审计源数据，无网络请求。

- `source-design-comparison.html`：源地理图与综合设计图。
- `source-plan.svg`、`design-plan.svg`：源/设计米制图。源房屋图用足迹方位与矩形参数概括，详细原足迹保留于原数据，不冒充实测立面。
- `design-plan.png`：设计地块、路水和树位检查图。
- `cartographic-groups.json`：352 个源足迹与 113 个完整建筑项的关系、源岸线横断点、道路源/设计长度。
- `design-independent-qa.json`：从生成文件重新检查归组跨路水和构件网格。

所有坐标/单位/变换记录见 `design.json.geographic`。建筑宽深和所有构件以米重新构造；分段坐标变换只作用于地理锚点及网络。113 个建筑项包括原 56 普通民居、4 院落组、6 现代民居及同街坊源足迹展开的 42 完整单层附屋、5 临街小屋。9 个完整围合多屋组团另提供院墙与通行门洞；房屋细部、楼层与树位是类型设计。惠和堂、紫石街、寒山港未定位，不冒名落位。

来源：OSM 2026-10-19（© OpenStreetMap contributors，ODbL 1.0）；Overture buildings 2026-09-23.1（底层 East Asian Buildings/OSM 各自来源保留，请参照原数据 ATTRIBUTION）；Copernicus GLO-30 源 DSM（许可参照原 terrain 目录）。地方图文只用于本地学习建筑形制，没有被转为贴图或公开传播素材。

地形 `values` 为减去当地源湖面 0.5 米 DSM 基准后的设计控制高度，已经减过基准。15 米控制网格和渲染 1–2 米方柱均不代表新增实测精度。

第二轮新增 `designTerraces` 连片村落整地 mask 与水道岸带：在完整房院范围采用约 1.2–3.8 米向东缓升的共享地坪，水道岸带约 1.1–2.1 米，区外衔接原宏观高程。源 `terrain.grid` 不动，整地身份在字段中明示。

`designForestMask` 为同一 C 网格反变换至 G 后读取 ESA WorldCover 2021 v200 10 米原生类别；class 10 树木覆盖可支持背景连续冠层，class 40 仅是作物覆盖。该 mask 是 2021 土地覆盖参考，不是当前逐树或树种调查。ESA WorldCover 2021 v200 使用 CC BY 4.0。
