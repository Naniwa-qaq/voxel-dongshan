/* Independent geometry and ecological-rule checks; no browser or source-data writes.
   Run: node scripts/verify_ecology_assets.cjs
   Only generated output: 东山镇_重制版/qa/ecology-assets.json. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.resolve(__dirname, '..');
const source = path.join(root, '东山镇_重制版/js/vegetation.js');
require(source);
const V = global.DSVegetation;
const failures = [];
const check = (ok, name, detail) => {if (!ok) failures.push({name, detail});};
const close = (a, b) => Math.abs(a - b) < 1e-7;
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const templateSeeds = [137, 208, 279];
const scales = [1, 1.2];
const newTypes = ['camphor', 'evergreen', 'deciduous', 'loquat', 'waxberry', 'metasequoia'];

function collect(build, spec) {
  const boxes = [];
  const asset = build({box(...v) {boxes.push(v);}}, spec);
  return {boxes, asset};
}
function areConnected(boxes) {
  const seen = new Set([0]), queue = [0];
  while (queue.length) {
    const index = queue.pop(), a = boxes[index];
    for (let j = 0; j < boxes.length; j++) {
      if (seen.has(j)) continue;
      const b = boxes[j];
      // Volumes connect when their closed axis-aligned intervals overlap on
      // all axes. Shared voxel faces are accepted, floating blocks are not.
      if ([0, 1, 2].every(k => Math.abs(a[k] - b[k]) <= (a[k + 3] + b[k + 3]) / 2 + 1e-8)) {
        seen.add(j); queue.push(j);
      }
    }
  }
  return seen.size === boxes.length;
}
function validateBoxes(boxes, name) {
  for (const b of boxes) {
    check(b.every(Number.isFinite), 'finite-box', name);
    check(b.slice(3, 6).every(n => n >= V.GRID - 1e-7), 'positive-voxel-size', name);
    for (let k = 0; k < 3; k++) {
      for (const face of [b[k] - b[k + 3] / 2, b[k] + b[k + 3] / 2]) {
        check(close(face / V.GRID, Math.round(face / V.GRID)), 'quantised-faces', name);
      }
    }
    check(b[1] - b[4] / 2 >= -1e-7, 'grounded-positive-height', name);
  }
}

const trees = [];
for (const type of Object.keys(V.types)) {
  const variants = [];
  for (const seed of templateSeeds) for (const scale of scales) {
    const spec = {type, seed, scale}, name = `${type}:${seed}:${scale}`;
    const built = collect(V.build, spec);
    validateBoxes(built.boxes, name);
    check(areConnected(built.boxes), 'connected-woody-asset', name);
    check(hash(built.boxes) === hash(collect(V.build, spec).boxes), 'deterministic-tree-template', name);
    check(built.asset.type === type, 'tree-type-preserved', name);
    if (newTypes.includes(type)) check(built.boxes.length <= 450, 'new-tree-template-budget', name);
    variants.push({seed, scale, boxes: built.boxes.length, height: built.asset.height,
      radius: built.asset.radius, connected: true, sha256: hash(built.boxes)});
  }
  check(new Set(variants.filter(v => v.scale === 1).map(v => v.sha256)).size > 1,
    'seed-varies-tree-geometry', type);
  trees.push({type, label: V.types[type].label, maximumBoxes: Math.max(...variants.map(v => v.boxes)), variants});
}

const ground = [];
for (const kind of Object.keys(V.groundPalettes)) {
  const variants = [];
  for (const seed of templateSeeds) {
    const spec = {kind, seed, scale: 1}, name = `${kind}:${seed}`;
    const built = collect(V.buildGround, spec);
    validateBoxes(built.boxes, name);
    check(built.boxes.length <= 10, 'ground-template-budget', name);
    if (!['litter', 'bare'].includes(kind)) check(areConnected(built.boxes), 'connected-ground-stool', name);
    check(hash(built.boxes) === hash(collect(V.buildGround, spec).boxes), 'deterministic-ground-template', name);
    variants.push({seed, boxes: built.boxes.length, height: built.asset.height,
      radius: built.asset.radius, sha256: hash(built.boxes)});
  }
  ground.push({kind, maximumBoxes: Math.max(...variants.map(v => v.boxes)), variants});
}

const examples = [
  {name: 'sunlit-grassland', cover: 30, elevation: 20, slope: .1, wetness: .1, canopy: 0},
  {name: 'closed-forest-floor', cover: 10, elevation: 160, slope: .35, wetness: .4, canopy: .85},
  {name: 'moist-low-shore', cover: 30, elevation: 4, slope: .05, wetness: .9, canopy: 0},
  {name: 'very-steep-exposed-slope', cover: 10, elevation: 250, slope: 1.6, wetness: 0, canopy: 0}
].map(s => ({...s, x: 12, z: 18, seed: 137})).map(input => ({input, output: V.sampleGround(input)}));
check(examples[0].output.kind === 'grass', 'sunlit-grassland-selects-grass');
check(examples[2].output.kind === 'sedge', 'moist-low-shore-selects-sedge');
check(examples[3].output.density === 0, 'very-steep-slope-bare');
for (const cover of [70, 80]) check(V.sampleGround({cover, seed: 137}).density === 0, 'water-snow-excluded', cover);
check(V.sampleGround({cover: 30, blocked: true}).density === 0, 'caller-hard-mask-honoured');
const shadeKinds = new Set(), forestTreeTypes = new Set(), cropTreeTypes = new Set(), orchardTypes = new Set();
for (let seed = 1; seed <= 200; seed++) {
  const under = V.sampleGround({cover: 10, elevation: 140, slope: .3, wetness: .5, canopy: .9, x: 42, z: 17, seed});
  shadeKinds.add(under.kind);
  check(under.kind !== 'grass', 'closed-canopy-suppresses-grass', seed);
  check(under.density >= 0 && under.density <= 1, 'ground-probability-range', seed);
  forestTreeTypes.add(V.selectType({cover: 10, elevation: 140, slope: .4, seed}));
  cropTreeTypes.add(V.selectType({cover: 40, elevation: 45, slope: .2, seed}));
  orchardTypes.add(V.selectType({type: 'orchard', seed}));
}
check(![...forestTreeTypes, ...cropTreeTypes].some(t => ['loquat', 'waxberry', 'orchard'].includes(t)),
  'landcover-never-asserts-fruit-species');
check(orchardTypes.size === 2 && [...orchardTypes].every(t => ['loquat', 'waxberry'].includes(t)),
  'explicit-orchard-art-selects-two-fruit-types');
for (const type of ['willow', 'pine', 'bamboo']) check(V.selectType({type, seed: 137}) === type, 'explicit-tree-type-preserved', type);

const audit = {
  version: '2026-10-23-ecology-assets-1', passed: failures.length === 0,
  source: '东山镇_重制版/js/vegetation.js', sourceSha256: crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex'),
  command: 'node scripts/verify_ecology_assets.cjs',
  policy: V.ecologyPolicy,
  constraints: {gridMetres: V.GRID, treeTemplateSeeds: templateSeeds, treeScales: scales,
    newTreeTemplateMaximumBoxes: 450, groundTemplateMaximumBoxes: 10,
    sampledTreeTemplates: trees.reduce((n, t) => n + t.variants.length, 0),
    sampledGroundTemplates: ground.reduce((n, t) => n + t.variants.length, 0)},
  regionalEvidence: [
    {title: '苏州市农业农村局：我市“东山白沙枇杷”获农业农村部颁农产品地理标志',
      url: 'https://nyncj.suzhou.gov.cn/nlj/ywdt/202005/888f8efe37c84f59bc02783fd6d64f1a.shtml',
      supports: '东山丘陵果园及陆巷、莫厘等产区的枇杷地域依据；不支持单株树位或树种判断'},
    {title: '苏州市农业农村局：今年第一波开采，本周末大量上市！',
      url: 'https://nyncj.suzhou.gov.cn/nlj/tpxw/202506/cbc7f975d4744fd18e4bdd256af9b601.shtml',
      supports: '杨梅传统产区和山区村分布的地域依据；不支持当前场景某一格网的果园判断'},
    {title: '苏州市园林和绿化管理局：东山景区',
      url: 'https://ylj.suzhou.gov.cn/szsylj/fjmsq/201912/ac947bc93b954ecd9f7fe59f441f3329.shtml',
      supports: '东山花果与山水景区的地域背景；不支持树种比例或地被群落调查'}
  ],
  artInferences: ['冠型比例及村落、校园、山林分配', '坡度、冠层和水岸的地被密度阈值',
    '所有生成树位和地被实例均为美术推断，源覆被仅约束大类'],
  ruleChecks: {shadeKinds: [...shadeKinds].sort(), forestTreeTypes: [...forestTreeTypes].sort(),
    cropCoverDoesNotAssertFruitTypes: [...cropTreeTypes].sort(), explicitOrchardArtTypes: [...orchardTypes].sort()},
  trees, ground, examples, failures
};
const out = path.join(root, '东山镇_重制版/qa/ecology-assets.json');
fs.mkdirSync(path.dirname(out), {recursive: true});
fs.writeFileSync(out, JSON.stringify(audit, null, 2));
console.log(JSON.stringify({passed: audit.passed, output: path.relative(root, out),
  treeTemplates: audit.constraints.sampledTreeTemplates, groundTemplates: audit.constraints.sampledGroundTemplates,
  newTrees: trees.filter(t => newTypes.includes(t.type)).map(t => ({type: t.type, maximumBoxes: t.maximumBoxes})),
  ground: ground.map(t => ({kind: t.kind, maximumBoxes: t.maximumBoxes})), failures}, null, 2));
if (failures.length) process.exitCode = 1;
