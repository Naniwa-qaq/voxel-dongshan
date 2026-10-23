# 东山原型 UI 接口

UI 文件位于 `东山镇_原型/index.html`、`ui.css`、`ui.js`，只使用本地字体、CSS 和 SVG 图标，无远程字体、图片或插件请求。three.js 与 scene-data.js 由场景模块提供。

## 脚本与场景容器

HTML 以非 module 顺序加载：`./vendor/three.min.js` → `./data/scene-data.js` → `./ui.js` → `./scene.js`，可用于 `file://`。画布 ID 为 `world`，主容器为 `scene-shell`。

场景可自行创建 `id="map-labels"` 的全屏标签层。CSS 已预留该 ID（z-index 3，pointer-events none），以及 `.map-label` 按钮样式（pointer-events auto）。UI 本身在 z-index 5，加载/失败层为 30。

## 根模块 API

UI 等待 **window** 上 `ds:ready`，收到后才启用调用场景的控件。此时 `window.DSApp` 应已存在：

```js
window.DSApp = {
  setView(name),       // 'pano' | 'top' | 'luxiang'
  setOption(key, val), // relief, time, buildings, roads, water, trees, labels
  toggleTour(),        // 可返回当前 touring:boolean
  screenshot(),       // 可同步或返回 Promise
  reset(),
  getState()          // 建议格式见下
};
window.dispatchEvent(new CustomEvent('ds:ready'));
```

建议 `getState()` 返回 `{ options: {relief:2.4,time:.52,buildings:true,roads:true,water:true,trees:true,labels:true}, touring:false, view:'pano' }`。也接受 options 直接平铺的返回结构。默认起伏 2.4，时刻 .52；UI 时刻 0—1 代表晨至暮，.28/.72 仅用于文字“晨/午/暮”切换。

控件 ID：

| 控件 | ID / data | 行为 |
|---|---|---|
| 三视角 | `[data-view="pano/top/luxiang"]` | setView |
| 起伏 | `relief-range` / data-option=relief | input 时传 number（1—4，step .1） |
| 时刻 | `time-range` / data-option=time | input 时传 number（0—1，step .01） |
| 五个景物开关 | `toggle-buildings/roads/water/trees/labels` | change 时传 boolean |
| 环游 | `tour-button` | toggleTour |
| 截图 | `screenshot-button` | screenshot |
| 复位 | `reset-button` | reset 后同步 getState |
| 设置收合 | `settings-toggle` / `scene-controls` | 纯 UI |
| 资料抽屉 | `sources-toggle` / `sources-drawer` | 纯 UI |
| 地点介绍 | `pick-card` / `pick-close` | ds:pick 渲染，使用 textContent |

## 场景事件

全部在 window 派发与监听：

```js
window.dispatchEvent(new CustomEvent('ds:stats', {detail:{
  renderBuildings, sourceBuildings, roads, triangles, fps, mode
}}));
window.dispatchEvent(new CustomEvent('ds:pick', {detail:{
  title, category, description, evidence, status
}}));
```

stats 全部放在资料抽屉折叠项，不遮挡主体。mode 支持视角名或 tour/orbit/free。evidence 可为文字、文字数组、或含 title/name/source 与 date/year 的对象。传空 title 可关闭地点卡。打开地点卡时自动收起设置面板，避免窄屏遮挡；不用图片。

## 加载与失败

- 成功：派发 `ds:ready`，UI 让加载层淡出并启用控件。
- 错误：优先 `window.DSUI.showError('用户可读的原因')`；也可派发 `ds:error` detail.message。
- UI 捕获 canvas 的 webglcontextlost、scene.js 的未捕获错误及脚本资源未加载；不依据等待时长宣判失败。
- `window.DSUI.syncState()` 可在场景主动更改选项后同步 UI；`DSUI.toast(text)` 用于轻量状态反馈。

资料抽屉链接到已经存在的 `../东山镇_数据/references/index.html`。HTML 中关于“概括表达”的文字为展示方法说明；不在 UI 中声称精确比例、实时测绘、完整历史复原或开放许可。

## 无障碍与适配

原生 button/range/checkbox 支持 Tab、Space、方向键。控件有标签与可见键盘焦点，读屏状态分别用 aria-pressed/expanded/live。Escape 依次关闭资料抽屉、地点卡、设置。移动端初始收起设置，面板限制高度且可滚动，尊重安全区与 reduced-motion。相机移动键盘由场景模块实现；UI 不声明尚未提供的相机快捷键。

## 静态验证

已通过 node --check；53个DOM ID无重复，ui.js引用的32个ID均存在，label/aria-controls/aria-labelledby目标均存在。4个外部脚本的顺序符合接口约定，7个data-option键齐全，CSS括号平衡，未发现远程图片/字体/脚本依赖。实际场景联调与桌面/移动端浏览器画面由根任务统一QA。
