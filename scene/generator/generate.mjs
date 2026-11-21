#!/usr/bin/env node
/**
 * 程序化场景装饰生成器 · scene-gen/1.0.0
 *
 * 职责边界（硬约束）：
 *   只生成「非关键装饰」——远景山脊、院墙外树影、地面苔痕、灯笼分布、碎片外观、落叶种子。
 *   绝不生成或修改：核心战斗区、可站立地面、边界、关键可破坏物、碰撞体、破坏触发点。
 *   上述内容以 scene/params/<scene>.json 的 manual 段只读复制，并在输出中标记 source=hand-authored。
 *
 * 可复现：mulberry32(seed)，同一 seed + 同一参数文件 → 逐字节相同输出（generatedAt 除外）。
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

/**
 * 多场景（v2.5.0 / Round 32）：
 *   node scene/generator/generate.mjs                  → shuangting（保持原路径与文件名，门禁 hash 不变）
 *   node scene/generator/generate.mjs --scene=zhuhai   → scene/output/zhuhai.json
 * 未指定 --scene 时行为与旧版逐字节一致（产物仍写 decor.json / generation-record.json）。
 */
const sceneArg = (() => {
  const eq = process.argv.find((a) => a.startsWith('--scene='));
  if (eq) return eq.slice('--scene='.length);
  const i = process.argv.indexOf('--scene');
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return 'shuangting';
})();
const paramsRel = `scene/params/${sceneArg}.json`;
const paramsPath = join(ROOT, paramsRel);
const isDefault = sceneArg === 'shuangting';
const outDecor = join(ROOT, isDefault ? 'scene/output/decor.json' : `scene/output/${sceneArg}.json`);
const outRecord = join(ROOT, isDefault ? 'scene/output/generation-record.json' : `scene/output/generation-record-${sceneArg}.json`);
const paramsText = readFileSync(paramsPath, 'utf8');
const P = JSON.parse(paramsText);

const mulberry32 = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const rng = mulberry32(P.seed);
const rr = (min, max) => min + rng() * (max - min);
const pick = (arr) => arr[Math.floor(rng() * arr.length) % arr.length];
const round = (v, n = 3) => Number(v.toFixed(n));

const pal = P.params.palette;
const C = P.constraints;
const HALF = P.manual.arena.width / 2;

/* ---------- 约束检查：任何装饰不得进入战斗区或遮挡判定框 ---------- */
const violations = [];
const assertClear = (item, label) => {
  const inCoreX = item.x > C.coreArea.minX && item.x < C.coreArea.maxX;
  const inCoreZ = item.z > C.coreArea.minZ;
  if (inCoreX && inCoreZ) violations.push(`${label} 侵入核心战斗区 (x=${item.x}, z=${item.z})`);
  // 判定框通道：x ∈ [-8.6, 8.6]、y ∈ [0, 3]、z ∈ [-1.35, 2.4] 必须净空
  if (inCoreX && item.z > -1.35) violations.push(`${label} 遮挡判定通道`);
};

/* ---------- 远景山脊 ---------- */
const ridges = [];
for (let layer = 0; layer < P.params.ridgeLayers; layer++) {
  const segs = [];
  const z = -26 - layer * 9;
  const baseY = 1.2 + layer * 2.4;
  const color = [pal.ridgeNear, pal.ridgeMid, pal.ridgeFar][layer % 3];
  for (let i = 0; i < P.params.ridgeSegments; i++) {
    const t = i / (P.params.ridgeSegments - 1);
    const x = -HALF * 4 + t * HALF * 8;
    const h = baseY + Math.sin(t * 6.1 + layer * 1.7) * (2.6 - layer * 0.4) + rr(-0.6, 0.6);
    segs.push({ x: round(x, 2), y: round(h, 2) });
  }
  ridges.push({ layer, z, color, segments: segs });
}

/* ---------- 院墙外树影 ---------- */
const foliage = [];
for (let i = 0; i < P.params.foliageCount; i++) {
  const side = rng() < 0.5 ? -1 : 1;
  const x = i < 6 ? side * rr(C.sideBandMinAbsX + 0.2, C.sideBandMinAbsX + 3.2) : rr(-HALF - 4, HALF + 4);
  const z = i < 6 ? rr(-2.4, -1.6) : rr(-13, -4.2);
  const item = {
    id: `foliage-${String(i).padStart(2, '0')}`,
    x: round(x, 2),
    z: round(z, 2),
    scale: round(rr(0.7, 1.55), 2),
    rot: round(rr(0, Math.PI * 2), 3),
    kind: rng() < 0.45 ? 'bamboo' : rng() < 0.6 ? 'pine' : 'shrub',
    color: rng() < 0.5 ? pal.foliage : pal.foliageAlt,
  };
  assertClear(item, item.id);
  foliage.push(item);
}

/* ---------- 地面苔痕 / 水渍（纯贴花，无碰撞） ---------- */
const groundPatches = [];
for (let i = 0; i < P.params.groundPatchCount; i++) {
  const inSide = rng() < 0.62;
  const x = inSide ? (rng() < 0.5 ? rr(-HALF + 0.2, -HALF * 0.55) : rr(HALF * 0.55, HALF - 0.2)) : rr(-HALF + 0.3, HALF - 0.3);
  const z = rr(-2.2, 2.4);
  const item = {
    id: `patch-${String(i).padStart(2, '0')}`,
    x: round(x, 2),
    z: round(z, 2),
    w: round(rr(0.7, 2.3), 2),
    d: round(rr(0.5, 1.5), 2),
    rot: round(rr(0, Math.PI), 3),
    tone: pick([pal.groundPatch, '#453f38', '#4d4a42']),
    alpha: round(rr(0.18, 0.42), 2),
  };
  // 地面贴花不遮挡判定框（y=0 平面），仅受核心区约束
  if (item.x > C.coreArea.minX && item.x < C.coreArea.maxX && item.z > -1.35 && item.z < 2.4) {
    // 允许在战斗地面出现，但必须是纯贴花且 alpha < 0.45
    if (item.alpha >= 0.45) violations.push(`${item.id} 贴花过浓，影响可读性`);
  }
  groundPatches.push(item);
}

/* ---------- 灯笼（非关键可破坏物，仅视觉；碰撞与破坏由运行时统一池管理） ---------- */
// v2.3.0：改为**严格左右镜像**。原实现 `i % 3 === 0 ? -1 : 1` 产出 3 左 4 右、
// 且 x / y / scale 全部独立随机，实景里两排灯笼高低错落、左右数量不等（参考图是一排对称挂灯）。
// 现在按「3 对 + 中心 1 盏」排：同一对共享 y / scale / z，只有 x 取相反号。
const lanterns = [];
const lanternCount = P.params.lanternCount;
// v2.4.5：v2.3.0 的 pairY = 2.62 + pair*0.08 / pairScale = 0.92 + pair*0.04 是**纯数学等差**，
// 真实挂灯不会一根比一根高 8cm、一根比一根大 4% —— 这是「编辑器里批量刷」的机器感来源。
// 保留 x 的对位关系（横杆有固定挂钩点，一排灯的建筑逻辑必须留），
// 只把「绳长 / 灯径 / 前后偏差」加人手功夫；横向允许 ±0.06 的挂钩偏差。
// 用**独立随机源**，不消耗全局 rng 流 —— 否则树影/贴花/落叶会连锁变化，把无关资产一起改掉。
const lj = mulberry32(0x5a17c0de);
const jit = (base, amp) => round(base + (lj() * 2 - 1) * amp, 3);
for (let i = 0; i < lanternCount; i++) {
  const isCenter = lanternCount % 2 === 1 && i === lanternCount - 1;
  const pair = Math.floor(i / 2);
  const side = i % 2 === 0 ? -1 : 1;
  const item = {
    id: `lantern-${String(i).padStart(2, '0')}`,
    x: isCenter ? 0 : round(side * (3.6 + pair * 0.8 + jit(0, 0.06)), 2),
    // z 仍贴着灯杆（杆在 z=-1.95），只留 ±0.045 的前后晃
    z: jit(-1.9, 0.045),
    // y 不再等比递增：绳长各有不同，整体略高于旧值以保证下垂灯身不俯冲地面
    y: isCenter ? jit(2.6, 0.05) : jit(2.72, 0.13),
    scale: isCenter ? jit(0.87, 0.02) : jit(0.95, 0.045),
    swayPhase: round(rr(0, Math.PI * 2), 3),
    color: pal.lanternPaper,
    tier: 1,
    hp: 20,
    fragmentsPreset: 'paper_lantern',
  };
  assertClear({ x: item.x, z: item.z }, item.id);
  lanterns.push(item);
}

/* ---------- 碎片外观调色板 ---------- */
const fragmentPalettes = [];
for (let i = 0; i < P.params.fragmentPaletteCount; i++) {
  fragmentPalettes.push({
    id: `frag-${i}`,
    preset: ['wood_pillar', 'plaster_wall', 'stone_slab', 'paper_lantern', 'bamboo_fence', 'terracotta'][i % 6],
    colors: [
      pick([pal.fragmentA, pal.fragmentB, pal.fragmentC]),
      pick([pal.fragmentA, pal.fragmentB, pal.fragmentC]),
    ],
    roughness: round(rr(0.6, 0.95), 2),
    count: 6 + Math.floor(rng() * 6),
  });
}

/* ---------- 落叶粒子种子 ---------- */
const leaves = [];
for (let i = 0; i < P.params.leafCount; i++) {
  leaves.push({
    x: round(rr(-9, 9), 2),
    y: round(rr(1.2, 5.4), 2),
    z: round(rr(-3.2, 1.6), 2),
    phase: round(rr(0, Math.PI * 2), 3),
    speed: round(rr(0.25, 0.8), 3),
    size: round(rr(0.04, 0.1), 3),
  });
}

const outputs = {
  schemaVersion: '1.0.0',
  sceneId: P.sceneId,
  displayName: P.displayName,
  version: P.version,
  seed: P.seed,
  generator: { name: 'scene-gen', version: P.generatorVersion, paramsFile: paramsRel },
  paramsHash: 'sha256:' + createHash('sha256').update(paramsText, 'utf8').digest('hex'),
  generatedAt: new Date().toISOString().slice(0, 19) + '+08:00',
  palette: pal,
  fogDensity: P.params.fogDensity,
  layers: {
    ridges,
    foliage,
    groundPatches,
    lanterns,
    fragmentPalettes,
    leaves,
  },
  manual: { ...P.manual, source: 'hand-authored' },
  budget: {
    maxDecorTriangles: 42000,
    estimatedDecorTriangles:
      foliage.length * 220 + lanterns.length * 120 + groundPatches.length * 2 + ridges.length * 120,
    maxDrawCalls: 60,
    mobileDecorScale: 0.42,
  },
  validation: {
    passed: violations.length === 0,
    violations,
    checks: [
      '装饰不进入核心战斗区',
      '装饰不遮挡判定框通道',
      '地面贴花透明度 < 0.45 保证可读性',
      'manual 段未被修改（只读复制）',
    ],
  },
};

mkdirSync(join(ROOT, 'scene/output'), { recursive: true });
writeFileSync(outDecor, JSON.stringify(outputs, null, 2) + '\n', 'utf8');

const record = {
  recordId: `scene-gen-${P.seed}`,
  sceneId: P.sceneId,
  seed: P.seed,
  generatorVersion: P.generatorVersion,
  paramsHash: outputs.paramsHash,
  outputsHash: 'sha256:' + createHash('sha256').update(JSON.stringify(outputs.layers)).digest('hex'),
  counts: {
    ridges: ridges.length,
    foliage: foliage.length,
    groundPatches: groundPatches.length,
    lanterns: lanterns.length,
    leaves: leaves.length,
  },
  reproduce: isDefault ? 'node scene/generator/generate.mjs' : `node scene/generator/generate.mjs --scene=${sceneArg}`,
  validation: outputs.validation,
};
writeFileSync(outRecord, JSON.stringify(record, null, 2) + '\n');

console.log(`scene-gen ${P.generatorVersion} · ${P.sceneId} · seed ${P.seed}`);
console.log(
  `  山脊 ${ridges.length} 层 / 树影 ${foliage.length} / 贴花 ${groundPatches.length} / 灯笼 ${lanterns.length} / 落叶 ${leaves.length}`
);
console.log(`  约束校验：${outputs.validation.passed ? '通过' : '失败 ' + violations.length + ' 项'}`);
if (violations.length) {
  for (const v of violations) console.error('  ✗ ' + v);
  process.exit(1);
}
console.log(`  outputsHash ${record.outputsHash.slice(0, 23)}…`);
