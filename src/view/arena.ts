/**
 * 「霜庭」场景构建
 * 手工设计：核心战斗区、地面分段、边界、碰撞体、关键可破坏物、破坏触发点
 * 程序化生成：远景山脊、院墙外树影、地面苔痕、灯笼分布、碎片外观、落叶
 * 数据来源：scene/output/decor.json（固定种子可复现）
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { sceneData as decor, SCENE_ID } from '../scene/sceneData';
import type { Tier, Budget } from '../core/perf';
import { mulberry32, hashString } from '../core/math';
import { wrapGLBProp, DECOR_DESTROY_MODELS } from './glbProps';
import { mountStageDecor } from './stageDecor';
import { mountStageScenery, updateScenery, setFrostVisible } from './stageScenery';
import { mountStoneProps, updateStoneProps } from './stoneProps';
import { mountColliders, restoreColliders } from './colliders';
import * as decorMotion from './decorMotion';

export interface DestroyableSpec {
  id: string;
  tier: 1 | 2 | 3;
  hp: number;
  stages: number;
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  preset: string;
  chainRadius: number;
  opensPassage: boolean;
  collapseZone?: { id: string; fromX: number; toX: number; depth: number };
  sfx: string;
}

interface SceneDecor {
  seed: number;
  palette: Record<string, string>;
  fogDensity: number;
  layers: {
    ridges: { layer: number; z: number; color: string; segments: { x: number; y: number }[] }[];
    foliage: { id: string; x: number; z: number; scale: number; rot: number; kind: string; color: string }[];
    groundPatches: { id: string; x: number; z: number; w: number; d: number; rot: number; tone: string; alpha: number }[];
    lanterns: { id: string; x: number; y: number; z: number; scale: number; swayPhase: number; color: string; tier: number; hp: number }[];
    leaves: { x: number; y: number; z: number; phase: number; speed: number; size: number }[];
  };
  manual: {
    arena: {
      width: number;
      depth: number;
      groundY: number;
      fightBounds: { minX: number; maxX: number };
      floorSegments: { id: string; minX: number; maxX: number; destroyable: boolean }[];
    };
    keyDestroyables: {
      id: string;
      tier: 1 | 2 | 3;
      maxHp: number;
      stages: number;
      position: { x: number; y: number; z: number };
      size: { w: number; h: number; d: number };
      fragmentsPreset: string;
      chainRadius: number;
      opensPassage: boolean;
      collapseZone?: { id: string; fromX: number; toX: number; depth: number };
      sfx: string;
    }[];
    lighting: {
      ambient: { color: string; intensity: number };
      key: { color: string; intensity: number; position: { x: number; y: number; z: number } };
      fill: { color: string; intensity: number; position: { x: number; y: number; z: number } };
      rim: { color: string; intensity: number; position: { x: number; y: number; z: number } };
    };
  };
}

const D = decor as unknown as SceneDecor;

/** v2.0.8 新增的 6 件可破坏 id：buildArchitecture 跳过、交给 buildDecorDestroyables 处理。 */
const DECOR_DESTROY_IDS: ReadonlySet<string> = new Set<string>(DECOR_DESTROY_MODELS);

/**
 * 院墙顶与灯笼挂点的世界 Y（两处共用，避免调墙高时吊杆脱节）。
 * v2.0.4：由 5.2 降到 3.6，让默认视角能越过墙顶看到远景山脊与树影，
 * 恢复「远景—院墙—近景」纵深（美术审核第 4 条）。
 */
const WALL_TOP_Y = 3.6;
const LANTERN_HANG_Y = WALL_TOP_Y + 0.2;


/** 把多个几何体按顶点色合并成一个 Mesh，显著降低绘制批次（移动端关键优化） */
function coloredMerge(parts: { geo: THREE.BufferGeometry; color: number; matrix?: THREE.Matrix4 }[]): THREE.BufferGeometry {
  // 统一成「非索引 + 仅 position/normal/color」：
  // mergeGeometries 要求所有几何体的属性集与索引状态完全一致，
  // 而 mix 用到的 Extrude/Icosahedron 等几何体是非索引的，混进来会让整组合并失败（表现为该层整体消失）
  const geos = parts.map((p) => {
    let src = p.geo;
    if (src.index) {
      const flat = src.toNonIndexed();
      src = flat;
    } else {
      src = src.clone();
    }
    if (p.matrix) src.applyMatrix4(p.matrix);
    if (!src.getAttribute('normal')) src.computeVertexNormals();

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', (src.getAttribute('position') as THREE.BufferAttribute).clone());
    g.setAttribute('normal', (src.getAttribute('normal') as THREE.BufferAttribute).clone());

    const c = new THREE.Color(p.color);
    const count = g.getAttribute('position').count;
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3] = c.r;
      arr[i * 3 + 1] = c.g;
      arr[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return g;
  });
  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  if (!merged) console.warn('[arena] coloredMerge 失败：', parts.length, '部件');
  return merged ?? new THREE.BufferGeometry();
}

function makeTileTexture(seed: number, base: string, line: string, cols: number, rows: number): THREE.Texture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const rng = mulberry32(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  const cw = size / cols;
  const ch = size / rows;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const v = 0.88 + rng() * 0.24;
      ctx.fillStyle = `rgba(255,255,255,${(v - 1) * 0.5 + 0.06})`;
      ctx.globalAlpha = 0.1 + rng() * 0.14;
      ctx.fillRect(x * cw, y * ch, cw, ch);
      ctx.globalAlpha = 1;
    }
  }
  ctx.strokeStyle = line;
  ctx.lineWidth = 2;
  for (let y = 0; y <= rows; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * ch);
    ctx.lineTo(size, y * ch);
    ctx.stroke();
  }
  for (let x = 0; x <= cols; x++) {
    ctx.beginPath();
    ctx.moveTo(x * cw, 0);
    ctx.lineTo(x * cw, size);
    ctx.stroke();
  }
  // 苔痕噪点
  for (let i = 0; i < 180; i++) {
    ctx.fillStyle = `rgba(70,90,70,${0.02 + rng() * 0.05})`;
    ctx.beginPath();
    ctx.arc(rng() * size, rng() * size, rng() * 6, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

/* ---------------- v2.1.0 参考图地板：暗冷灰错缝大石板 + 白色薄霜 ---------------- */

/**
 * 地板纹理在地板 plane（BoxGeometry 顶面 0..1 UV）上的重复次数。
 * 纹理内为 2×2 块错缝石板（奇数行横移半格），故每块物理尺寸 ≈ (w/repeat.x/2, depth/repeat.y/2)：
 * repeat(1,2) → 中段 floor-b 约 1.9×1.75、两侧约 2.35×1.75 世界单位（近方形，不拉成细条）。
 * 地板与沿口 apron 共用这两个常量，保证世界 UV 缩放/相位一致。
 */
const FLOOR_REPEAT_X = 1;
const FLOOR_REPEAT_Y = 2;

interface StoneSlab {
  poly: [number, number][];
  base: string;
  cracks: [number, number][][];
  scuffs: { x: number; y: number; rx: number; ry: number; rot: number; light: boolean }[];
  frost: { x: number; y: number; rx: number; ry: number; rot: number }[];
  chips: number[];
}

function shadeHex(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * k));
  const b = Math.min(255, Math.round((n & 255) * k));
  return `rgb(${r},${g},${b})`;
}

/**
 * 确定性生成冷灰大石板地面：albedo + 同布局灰度 roughnessMap。
 * 角点抖动按 (i%COLS, j%ROWS) 取周期值 → 纹理四边 RepeatWrapping 平铺无缝；
 * 所有随机来自 mulberry32(seed)，绘制阶段零随机，故两纹理布局严格对齐、每次刷新不变。
 * makeTileTexture 保留给墙板砌砖复用（避免改动墙板外观），地板专用本函数。
 */
function makeStoneFloorTextures(seed: number): { map: THREE.CanvasTexture; roughnessMap: THREE.CanvasTexture } {
  const size = 512;
  const COLS = 2;
  const ROWS = 2; // 偶数：j=0 与 j=ROWS 行偏移一致 → 上下边界 RepeatWrapping 无缝
  const cw = size / COLS;
  const ch = size / ROWS;
  const rng = mulberry32(seed);
  // 暗冷灰蓝石板（霜夜基调）：比首版明显压暗，避免截图里偏亮发白像瓷砖
  const BASES = ['#454b55', '#414750', '#4a5059', '#3f454e', '#484e58', '#3d434c'];

  // 周期抖动表：i 取模 COLS、j 取模 ROWS 命中同一槽 → 四边平铺无缝。
  // 幅度 0.26（原 0.18）：缝隙不再横平竖直，读作不规则大石板而非规则方格。
  const jit = new Float32Array(COLS * ROWS * 2);
  for (let k = 0; k < COLS * ROWS; k++) {
    jit[k * 2] = (rng() - 0.5) * cw * 0.26;
    jit[k * 2 + 1] = (rng() - 0.5) * ch * 0.26;
  }
  // 奇数行整体横移半格 → 相邻行竖缝交错（错缝砌石），ROWS 为偶数保证上下边界周期一致。
  const rowShift = (j: number) => (((j % 2) + 2) % 2) * cw * 0.5;
  const node = (i: number, j: number): [number, number] => {
    const ii = ((i % COLS) + COLS) % COLS;
    const jj = ((j % ROWS) + ROWS) % ROWS;
    const k = (jj * COLS + ii) * 2;
    return [i * cw + rowShift(j) + jit[k], j * ch + jit[k + 1]];
  };

  const slabs: StoneSlab[] = [];
  // 多画一圈（r/c = -1..ROWS/COLS）：奇数行横移后越界的石板由周期副本补齐，
  // canvas 裁掉画布外部分，RepeatWrapping 平铺时与邻块严丝合缝。
  // 关键：周期副本必须**复用同一份内部细节**（base / 裂纹 / 磨损 / 霜斑 / 缺角）。
  // 若每个 (c,r) 各自 rng 生成细节，c 与 c+COLS 的石板几何相同但内部纹理各随机，
  // repeat.y=2 把平铺缝放在地板中线，跨缝石板两半细节会断裂成一条细接缝（审查修正）。
  type SlabDetail = {
    base: string;
    cracks: [number, number][][];
    scuffs: StoneSlab['scuffs'];
    frost: StoneSlab['frost'];
    chips: number[];
    cx: number; cy: number;
  };
  const detailCache = new Map<string, SlabDetail>();
  for (let r = -1; r <= ROWS; r++) {
    for (let c = -1; c <= COLS; c++) {
      const corners: [number, number][] = [node(c, r), node(c + 1, r), node(c + 1, r + 1), node(c, r + 1)];
      const cx = corners.reduce((s, p) => s + p[0], 0) / 4;
      const cy = corners.reduce((s, p) => s + p[1], 0) / 4;
      const inset = 0.952; // 朝质心收缩，留出更明显的不规则拼缝（露出深冷灰底色）
      const poly: [number, number][] = corners.map(([x, y]) => [cx + (x - cx) * inset, cy + (y - cy) * inset]);

      const key = `${((c % COLS) + COLS) % COLS}:${((r % ROWS) + ROWS) % ROWS}`;
      let d = detailCache.get(key);
      if (!d) {
        const cracks: [number, number][][] = [];
        const nc = rng() < 0.6 ? 1 + (rng() < 0.4 ? 1 : 0) : 0;
        for (let i = 0; i < nc; i++) {
          let x = cx + (rng() - 0.5) * cw * 0.7;
          let y = cy + (rng() - 0.5) * ch * 0.7;
          const pts: [number, number][] = [[x, y]];
          const seg = 2 + Math.floor(rng() * 3);
          for (let s = 0; s < seg; s++) {
            x += (rng() - 0.5) * cw * 0.44;
            y += (rng() - 0.5) * ch * 0.44;
            x = Math.max(cx - cw * 0.42, Math.min(cx + cw * 0.42, x));
            y = Math.max(cy - ch * 0.42, Math.min(cy + ch * 0.42, y));
            pts.push([x, y]);
          }
          cracks.push(pts);
        }

        // 磨损/霜斑收少收细：旧版每块 3~5 个大椭圆叠 2~4 个大霜斑，
        // 截图里读作「成团花瓣印花瓷砖」；参考图是暗石板 + 细碎薄霜。
        const scuffs: StoneSlab['scuffs'] = [];
        for (let i = 0; i < 2 + Math.floor(rng() * 2); i++) {
          scuffs.push({
            x: cx + (rng() - 0.5) * cw * 0.7,
            y: cy + (rng() - 0.5) * ch * 0.7,
            rx: cw * (0.04 + rng() * 0.10),
            ry: ch * (0.035 + rng() * 0.09),
            rot: rng() * Math.PI,
            light: rng() < 0.5,
          });
        }

        const frost: StoneSlab['frost'] = [];
        for (let i = 0; i < 1 + Math.floor(rng() * 2); i++) {
          frost.push({
            x: cx + (rng() - 0.5) * cw * 0.8,
            y: cy + (rng() - 0.5) * ch * 0.8,
            rx: cw * (0.05 + rng() * 0.11),
            ry: ch * (0.04 + rng() * 0.09),
            rot: rng() * Math.PI,
          });
        }

        const chips: number[] = [];
        for (let i = 0; i < 4; i++) if (rng() < 0.32) chips.push(i);

        d = {
          base: shadeHex(BASES[Math.floor(rng() * BASES.length)], 0.9 + rng() * 0.2),
          cracks, scuffs, frost, chips, cx, cy,
        };
        detailCache.set(key, d);
      }
      // 复用：把缓存槽的细节坐标平移到当前块中心（差值恒为 size 的整数倍）。
      const ox = cx - d.cx, oy = cy - d.cy;
      slabs.push({
        poly,
        base: d.base,
        cracks: d.cracks.map((pts) => pts.map(([x, y]) => [x + ox, y + oy] as [number, number])),
        scuffs: d.scuffs.map((sc) => ({ ...sc, x: sc.x + ox, y: sc.y + oy })),
        frost: d.frost.map((f) => ({ ...f, x: f.x + ox, y: f.y + oy })),
        chips: d.chips,
      });
    }
  }

  const makeCanvas = () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    return canvas;
  };
  const albedoCanvas = makeCanvas();
  const roughCanvas = makeCanvas();

  const paint = (ctx: CanvasRenderingContext2D, albedo: boolean) => {
    const path = (poly: [number, number][]) => {
      ctx.beginPath();
      ctx.moveTo(poly[0][0], poly[0][1]);
      for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
      ctx.closePath();
    };
    // 缝隙底色：albedo 深冷灰蓝 / roughness 最高（最粗糙）
    ctx.fillStyle = albedo ? '#2b323b' : 'rgb(250,250,250)';
    ctx.fillRect(0, 0, size, size);

    for (const s of slabs) {
      const xs = s.poly.map((p) => p[0]);
      const ys = s.poly.map((p) => p[1]);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minY = Math.min(...ys), maxY = Math.max(...ys);
      ctx.save();
      path(s.poly);
      ctx.clip();

      if (albedo) {
        ctx.fillStyle = s.base;
        ctx.fillRect(minX, minY, maxX - minX, maxY - minY);
        const g = ctx.createLinearGradient(0, minY, 0, maxY); // 上亮下暗的受光层次
        g.addColorStop(0, 'rgba(228,236,246,0.03)');
        g.addColorStop(1, 'rgba(10,14,20,0.18)');
        ctx.fillStyle = g;
        ctx.fillRect(minX, minY, maxX - minX, maxY - minY);
        ctx.fillStyle = 'rgba(206,220,236,0.035)'; // 整体极薄冷霜
        ctx.fillRect(minX, minY, maxX - minX, maxY - minY);
      } else {
        ctx.fillStyle = 'rgb(214,214,214)'; // 石板面略光滑
        ctx.fillRect(minX, minY, maxX - minX, maxY - minY);
      }

      // 磨损 / 污渍斑
      for (const sc of s.scuffs) {
        ctx.beginPath();
        ctx.ellipse(sc.x, sc.y, sc.rx, sc.ry, sc.rot, 0, Math.PI * 2);
        ctx.fillStyle = albedo
          ? (sc.light ? 'rgba(190,202,216,0.05)' : 'rgba(26,32,40,0.09)')
          : (sc.light ? 'rgb(190,190,190)' : 'rgb(246,246,246)');
        ctx.fill();
      }
      // 白色薄霜斑
      for (const f of s.frost) {
        ctx.beginPath();
        ctx.ellipse(f.x, f.y, f.rx, f.ry, f.rot, 0, Math.PI * 2);
        ctx.fillStyle = albedo ? 'rgba(220,232,244,0.075)' : 'rgb(252,252,252)';
        ctx.fill();
      }
      // 细裂纹（折线）
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const pts of s.cracks) {
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.strokeStyle = albedo ? 'rgba(28,34,42,0.45)' : 'rgb(250,250,250)';
        ctx.lineWidth = albedo ? 1.4 : 2.2;
        ctx.stroke();
      }
      // 缺角：用缝隙色削掉角部，读作边缘破损
      for (const ci of s.chips) {
        const p = s.poly[ci];
        const q1 = s.poly[(ci + 3) % 4];
        const q2 = s.poly[(ci + 1) % 4];
        const a: [number, number] = [p[0] + (q1[0] - p[0]) * 0.16, p[1] + (q1[1] - p[1]) * 0.16];
        const b: [number, number] = [p[0] + (q2[0] - p[0]) * 0.16, p[1] + (q2[1] - p[1]) * 0.16];
        ctx.beginPath();
        ctx.moveTo(p[0], p[1]);
        ctx.lineTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.closePath();
        ctx.fillStyle = albedo ? '#2b323b' : 'rgb(252,252,252)';
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.strokeStyle = albedo ? 'rgba(16,20,26,0.55)' : 'rgb(255,255,255)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
      // 石板内缘积霜 / 粗糙边：粗描边被 clip 裁成一圈内缘
      path(s.poly);
      ctx.strokeStyle = albedo ? 'rgba(216,228,242,0.11)' : 'rgb(250,250,250)';
      ctx.lineWidth = 7;
      ctx.stroke();
      ctx.restore();

      // 边缘碎裂暗边（压出石板轮廓，强化不规则拼缝）
      path(s.poly);
      ctx.strokeStyle = albedo ? 'rgba(24,29,37,0.5)' : 'rgb(248,248,248)';
      ctx.lineWidth = albedo ? 2.2 : 3;
      ctx.stroke();
    }
  };

  paint(albedoCanvas.getContext('2d')!, true);
  paint(roughCanvas.getContext('2d')!, false);

  // albedo 是 sRGB 颜色数据，必须标记 SRGBColorSpace：renderer 为 SRGB + ACES tone mapping，
  // 旧写法未标记 → 颜色被当线性反射率、输出时 gamma 提亮，导致「BASE 压暗了画面仍偏白」。
  // roughnessMap 是线性灰度数据，保持默认线性色彩空间不动。
  const toTex = (canvas: HTMLCanvasElement, srgb: boolean): THREE.CanvasTexture => {
    const t = new THREE.CanvasTexture(canvas);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    t.repeat.set(FLOOR_REPEAT_X, FLOOR_REPEAT_Y);
    return t;
  };
  return { map: toTex(albedoCanvas, true), roughnessMap: toTex(roughCanvas, false) };
}

/** 苔痕软边遮罩：中心到边缘的径向灰度渐变，替代硬边色块（美术审核第 5 条）。
 *  alphaMap 采样的是纹理**绿色通道**而非 alpha 通道，所以渐变必须落在灰度值上。 */
function makeSoftPatchTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.06, size / 2, size / 2, size * 0.5);
  g.addColorStop(0, 'rgb(217,217,217)');
  g.addColorStop(0.5, 'rgb(104,104,104)');
  g.addColorStop(1, 'rgb(0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

/** 灯笼暖色光晕：加法混合的 billboard，不改灯光数量、不触发着色器重编译 */
function makeGlowTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size * 0.5);
  g.addColorStop(0, 'rgba(255,224,160,0.95)');
  g.addColorStop(0.28, 'rgba(255,190,110,0.38)');
  g.addColorStop(1, 'rgba(255,170,90,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

export class Arena {
  readonly scene = new THREE.Scene();
  readonly props = new Map<string, THREE.Object3D>();
  readonly specs: DestroyableSpec[] = [];
  readonly bounds: { minX: number; maxX: number };
  readonly decorGroup = new THREE.Group();
  readonly sceneryGroup = new THREE.Group();
  private lanternGroup = new THREE.Group();
  private foliageGroup = new THREE.Group();
  private patchGroup = new THREE.Group();
  private leafPoints: THREE.Points | null = null;
  private leafData: { x: number; y: number; z: number; phase: number; speed: number; size: number }[] = [];
  private keyLight: THREE.DirectionalLight;
  private fillLight: THREE.PointLight;
  private rimLight: THREE.PointLight;
  private collapsed = new Set<string>();
  private pitGroup = new THREE.Group();
  private pitLight: THREE.PointLight;
  private floorMat: THREE.MeshStandardMaterial | null = null;
  private apronTex: THREE.Texture | null = null;
  private apronRoughTex: THREE.Texture | null = null;
  private floorMeshes = new Map<string, THREE.Mesh>();
  private patchMesh: THREE.InstancedMesh | null = null;
  private patchData: { x: number; z: number }[] = [];
  /** 苔痕实例构造时的原始矩阵快照：塌陷会把坑内实例缩放归零，回合重置据此完整还原 */
  private patchBase: THREE.Matrix4[] = [];
  private glowTex: THREE.CanvasTexture | null = null;
  private rng = mulberry32(D.seed ?? 0x51ab);
  private elapsed = 0;
  private tier: Tier = 'high';

  constructor(private budget: Budget) {
    this.bounds = { ...D.manual.arena.fightBounds };
    this.scene.fog = new THREE.FogExp2(new THREE.Color(D.palette.skyBottom), D.fogDensity);
    this.scene.background = new THREE.Color(D.palette.skyBottom);
    this.scene.add(this.decorGroup, this.lanternGroup, this.foliageGroup, this.patchGroup, this.pitGroup, this.sceneryGroup);

    this.scene.add(new THREE.HemisphereLight(0x93aac6, 0x23262c, 0.52));
    // 预建坑底补光（强度为 0）：避免塌陷瞬间因灯光数量变化触发全场景着色器重编译
    this.pitLight = new THREE.PointLight(0xffd9a8, 0, 5.6, 2);
    this.pitLight.position.set(0, -0.4, 0.5);
    this.scene.add(this.pitLight);
    const amb = new THREE.AmbientLight(new THREE.Color(D.manual.lighting.ambient.color), D.manual.lighting.ambient.intensity);
    this.scene.add(amb);

    this.keyLight = new THREE.DirectionalLight(
      new THREE.Color(D.manual.lighting.key.color),
      D.manual.lighting.key.intensity
    );
    this.keyLight.position.set(
      D.manual.lighting.key.position.x,
      D.manual.lighting.key.position.y,
      D.manual.lighting.key.position.z
    );
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(budget.shadowMapSize, budget.shadowMapSize);
    this.keyLight.shadow.camera.left = -12;
    this.keyLight.shadow.camera.right = 12;
    this.keyLight.shadow.camera.top = 10;
    this.keyLight.shadow.camera.bottom = -6;
    this.keyLight.shadow.bias = -0.0015;
    this.keyLight.shadow.normalBias = 0.02;
    // 柔化主光阴影：地面上的柱子投影原本是纯黑硬边（场景审核「柱影」条）
    this.keyLight.shadow.intensity = 0.85;
    this.scene.add(this.keyLight);

    this.fillLight = new THREE.PointLight(
      new THREE.Color(D.manual.lighting.fill.color),
      D.manual.lighting.fill.intensity * 6,
      26,
      2
    );
    this.fillLight.position.set(
      D.manual.lighting.fill.position.x,
      D.manual.lighting.fill.position.y,
      D.manual.lighting.fill.position.z
    );
    this.scene.add(this.fillLight);

    this.rimLight = new THREE.PointLight(
      new THREE.Color(D.manual.lighting.rim.color),
      D.manual.lighting.rim.intensity * 5,
      30,
      2
    );
    this.rimLight.position.set(0, 4, -8);
    this.scene.add(this.rimLight);

    this.buildFloor();
    this.buildArchitecture();
    this.buildDecorDestroyables();
    // v2.2.0：程序化 3 层山脊扁片退役。远景层改由 skyBackdrop 的「远山背景」图（L0 天幕 + L1 剪影）
    // 与三层实体雪岭 GLB 共同承担；buildRidges() 的 ShapeGeometry 扁片正是「山峰小尖角」的来源。
    this.buildFoliage();
    this.buildPatches();
    this.buildLanterns();
    this.buildLeaves();
    this.collectSpecs();
    this.setTier('high');
    mountStageDecor(this);
    mountStageScenery(this);
    // v2.3.0：参考图 10 类拆件里仓库无 GLB 的四件（石狮 / 抱鼓石门墩 / 经幡红幡 / 匾额）
    // 用程序化几何补齐，另附灯架落地立柱；全部只挂 decorGroup，不进 props/specs。
    mountStoneProps(this);
    // v2.3.0：把「紫色方块 = 实体碰撞」落地成运行时数据（静态 colliders + 逐道具派生 AABB）。
    // 必须在 collectSpecs() 之后挂载，派生 collider 要读 arena.specs。
    mountColliders(this);
    decorMotion.attach(this.scene);
  }

  /* ---------------- 地面（手工分段，中间可塌陷） ---------------- */
  private buildFloor(): void {
    // v2.1.0：冷灰不规则大石板地板（含 roughnessMap），替代原暖棕 25×15 小网格。
    // 三段共享同一 mat/tex；每段 BoxGeometry 顶面 UV 为 0..1，配合 repeat(1,2)：
    // 纹理内 2×2 块石板 → 单块约 1.75~2.35 世界单位，近方形、不拉成细条。
    const { map, roughnessMap } = makeStoneFloorTextures(hashString('floor'));
    // v2.5.0（竹海古径）：同一套石板纹理乘一层薄苔色（浅灰绿），与霜庭的冷蓝石板区分场景，
    // 不换贴图、不改几何，破坏/塌陷与碰撞完全沿用。
    const mat = new THREE.MeshStandardMaterial({
      color: SCENE_ID === 'zhuhai' ? 0xd3dcc6 : 0xffffff,
      map,
      roughnessMap,
      roughness: 0.94,
      metalness: 0,
    });
    this.floorMat = mat;

    for (const seg of D.manual.arena.floorSegments) {
      const w = seg.maxX - seg.minX;
      const geo = new THREE.BoxGeometry(w, 0.36, D.manual.arena.depth);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set((seg.minX + seg.maxX) / 2, -0.18, 0);
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.floorMeshes.set(seg.id, mesh);
      if (seg.destroyable) this.props.set(seg.id, mesh);
    }

    // 前沿石阶：同步冷灰调，避免暖棕块与霜夜石板产生明显色差
    const stepMat = new THREE.MeshStandardMaterial({
      color: SCENE_ID === 'zhuhai' ? 0x5b6352 : 0x565c66,
      roughness: 0.92,
      metalness: 0,
    });
    const step = new THREE.Mesh(new THREE.BoxGeometry(D.manual.arena.width + 1.2, 0.3, 0.9), stepMat);
    step.position.set(0, -0.45, 2.15);
    step.receiveShadow = true;
    this.scene.add(step);
  }

  /* ---------------- 建筑：v2.0.9.1 拆除山门框（瓦檐/门柱/门楣），改为一根横贯灯杆 ---------------- */
  private buildArchitecture(): void {
    // v2.0.9.1：拆除散柱/横梁/瓦檐（截图实测遮挡牌坊与月盘，概念图无散柱），
    // 改为一根横贯灯杆：灯笼吊杆（LANTERN_HANG_Y）仍精确挂到杆上，画面干净。
    const barMat = new THREE.MeshStandardMaterial({ color: 0x3a2c1e, roughness: 0.88, metalness: 0 });
    // v2.3.0：横杆收窄到 ±5.6 并在两端落地（立柱在 stoneProps 里建，x=±5.6、z=-1.95）。
    // 原长度 width+1.2=14.2（±7.1）远超相机可见半宽（≈5.9），两端整根出画、且整条悬空无支撑，
    // 读作「一根横贯画面却不知挂在哪的棍子」。
    const lampBar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 11.2, 6),
      barMat
    );
    lampBar.rotation.z = Math.PI / 2;
    lampBar.position.set(0, WALL_TOP_Y + 0.2, -1.95);
    lampBar.castShadow = true;
    this.scene.add(lampBar);

    // 关键可破坏物：立柱、墙板、地面
    for (const k of D.manual.keyDestroyables) {
      if (k.id === 'floor-mid') continue;
      // v2.0.8 新增的 6 件不在本循环造 CylinderGeometry + pillar 占位，
      // 交给 buildDecorDestroyables() 用「模型名 = id」的 GLB 包装。
      if (DECOR_DESTROY_IDS.has(k.id)) continue;
      let geo: THREE.BufferGeometry;
      // v2.4.3：`pillar`（深棕木柱）挪到牌坊边柱位后必须读作石柱 —— 木柱贴灰石牌坊是最刺眼的不协调。
      // 占位盒与 GLB 子树统一染青灰石色；碎块改用 stone_pillar 预设，保持「柱碎成石块」的因果一致。
      const color = 0x7a8088;
      if (k.id.startsWith('wall-panel')) {
        // v2.2.0：`wall-panel-east` 按参考图（e0 正面 / 69 概念图：左右各一面大红鼓带木架，
        // 全部参考图**无砖墙**）换皮成大鼓，与西侧 `temple-drum` 共用同一 GLB，镜像对称。
        // 兜底占位用规格盒 + 木棕色（GLB 到位即隐藏），不再用砌砖贴图——它已经不是墙。
        geo = new THREE.BoxGeometry(k.size.w, k.size.h, k.size.d);
        const mesh = new THREE.Mesh(
          geo,
          new THREE.MeshStandardMaterial({ color: 0x6b3f26, roughness: 0.86, metalness: 0 })
        );
        mesh.position.set(k.position.x, k.position.y + k.size.h / 2, k.position.z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.destroyableId = k.id;
        // v2.4.6：按用户「侧转朝角色 + 以本轮为准」把鼓身绕竖直轴转 90°，木架保持立着。
        // 用 displayRotY（缩放测量完成后才施加）而非 MODEL_ROTATE_Y（会触发尺寸重算而变形）。
        // 西鼓 +π/2 → 鼓面法线 +z 转到 +x（朝场地中心/右）；东鼓 −π/2 → 转到 −x（朝中心/左）。
        // 两鼓面相对，玩家在各自鼓前侧身对战时可见鼓面。占位盒不转（GLB 到位即隐藏）。
        const wrapped = wrapGLBProp(k.id, 'temple-drum', mesh, undefined, -Math.PI / 2);
        this.scene.add(wrapped);
        this.props.set(k.id, wrapped);
        continue;
      }
      geo = new THREE.CylinderGeometry(k.size.w / 2, k.size.w / 2 + 0.03, k.size.h, 8);
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0 }));
      mesh.position.set(k.position.x, k.position.y + k.size.h / 2, k.position.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.destroyableId = k.id;
      const wrapped = wrapGLBProp(k.id, 'pillar', mesh, 0x7a8088);
      // v2.4.3：`pillar.glb` 是等径细圆柱，顶面平切、柱身直接插进地面，读作「杆」不像「柱」。
      // 补方形柱础 + 压顶石（同石料），挂进 wrapped 后随破坏一并隐藏、回合重置恢复，
      // 不额外增加破坏链分支。局部 y 以 group 原点（= 盒中心 y+h/2）为基准换算。
      const capMat = new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0 });
      const capW = k.size.w * 1.38;
      const midY = k.position.y + k.size.h / 2;
      for (const cy of [0.11, k.size.h - 0.11]) {
        const cap = new THREE.Mesh(new THREE.BoxGeometry(capW, 0.22, capW), capMat);
        cap.position.set(0, cy - midY, 0);
        cap.castShadow = true;
        cap.receiveShadow = true;
        wrapped.add(cap);
      }
      this.scene.add(wrapped);
      this.props.set(k.id, wrapped);
    }
  }

  /**
   * v2.0.8：6 件新增可破坏件。占位盒尺寸/坐标取自 spec，模型名 = id（绝不复用 pillar），
   * 经 wrapGLBProp 的常驻根 group 下发 GLB 子树；props.set 注册后 destruction.ts 零改即自动纳管
   * （collectSpecs 已把新 spec 收录，destruction 构造遍历 arena.specs 取 arena.props.get(id)）。
   */
  private buildDecorDestroyables(): void {
    for (const k of D.manual.keyDestroyables) {
      if (!DECOR_DESTROY_IDS.has(k.id)) continue;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(k.size.w, k.size.h, k.size.d),
        new THREE.MeshStandardMaterial({ color: 0x6b4a30, roughness: 0.9, metalness: 0 })
      );
      mesh.position.set(k.position.x, k.position.y + k.size.h / 2, k.position.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.destroyableId = k.id;
      // v2.4.6：西鼓（temple-drum）在此通用路径构建，需与东鼓一样侧转。
      // +π/2 → 鼓面法线由 +z 转到 +x（朝场地中心/右），与东鼓 −π/2 相对。
      const drumRotY = k.id === 'temple-drum' ? Math.PI / 2 : undefined;
      const wrapped = wrapGLBProp(k.id, k.id, mesh, undefined, drumRotY);
      this.scene.add(wrapped);
      this.props.set(k.id, wrapped);
    }
  }

  /* ---------------- 远景山脊：v2.2.0 已退役 ---------------- */
  // 原 buildRidges() 用 3 层 ShapeGeometry 扁片模拟远山，峰顶 4.2/6.31/7.73 再 ×1.25 纵向放大，
  // 实际远超可见带 y∈[0,4.5]，在画面上沿戳出一排「山峰小尖角」，还挡住月盘下缘。
  // 参考图（e0/3f）对远景层的要求是「一张画」——已改由 skyBackdrop.ts 的远山背景承担：
  //   L0 = scene.background 天幕（渐变 + 极淡最远山影 + 地平冷光）
  //   L1 = z=-26 的山脊剪影 Plane（带真实 z，与三层实体雪岭 GLB 形成纵深）
  // decor.json 的 layers.ridges 数据**保留不动**（LAYERS_HASH / RIDGE_ANCHOR 门禁依赖它做快照），
  // 只是不再有任何视觉消费方；如需回滚，恢复本函数并在构造函数里重新调用即可。

  /* ---------------- 院墙外树影（程序化） ---------------- */
  /** 树影统一合并为少量网格：竹 / 松 / 灌木三种外观，各一个 draw call */
  private buildFoliage(): void {
    const parts: { geo: THREE.BufferGeometry; color: number; matrix?: THREE.Matrix4 }[] = [];
    const m4 = new THREE.Matrix4();
    const stalkGeo = new THREE.CylinderGeometry(0.11, 0.14, 1, 5);
    const leafGeo = new THREE.ConeGeometry(0.28, 0.9, 4);
    const trunkGeo = new THREE.CylinderGeometry(0.15, 0.26, 2.6, 6);
    const coneGeo = [0, 1, 2].map((i) => new THREE.ConeGeometry(1.5 - i * 0.34, 1.35, 7));
    const shrubGeo = new THREE.IcosahedronGeometry(0.5, 0);

    for (const f of D.layers.foliage) {
      // v2.2.0：pine（三角松）与 shrub（二十面体灌木）一并退役。
      // - 9 株 pine 分布在 z≈-8~-12、x≈6.15/8.43 一带，压在月盘与远景交界上，
      //   是「军绿三角远山 / 月亮被啃缺」的直接来源；
      // - shrub 是 IcosahedronGeometry 低模碎块，落在院内近景（z>-3.4），
      //   在大鼓与竹丛之间读作「贴图错误的石头」，参考图近景只有石板与道具、没有灌木。
      // 只保留 bamboo（参考图两侧竹丛是明确元素）。decor.json 数据保留不动，只是不再渲染这两类。
      if (f.kind === 'pine' || f.kind === 'shrub') continue;
      // v2.4.5：bamboo 一并退役，树影层全部停渲染。
      // 依据是实测包围盒而非观感：foliageGroup 合并网格 y∈[0.91, 8.08]，即院内存在 8 米高的
      // 程序化竹影（单株 h 2.8~4.6 再叠 scale），而牌坊屋面只到 4.2 —— 实景就是「暗绿竹竿
      // 从山门瓦顶后面长出来、一直戳到画面顶部」。先只过滤中轴 3 丛（x=0.69 / -1.24 / -1.34），
      // 截图后左右两侧仍有两丛竹竿穿屋脊，逐丛过滤等于拿参数试错，不如按建筑逻辑处理：
      // 山门院内是石板场地，近景植被在参考图里本就不存在（v2.2.0 已据此退役 pine/shrub）；
      // 竹的视觉需求由 decor 的两丛近景竹（±6.9/6.62）+ scenery 的 bamboo-grove（±13）承担。
      // 数据仍留在 decor.json（layers 指纹不变），只是渲染层跳过 —— 与 pine/shrub 同策略。
      if (f.kind === 'bamboo') continue;
      const color = new THREE.Color(f.color).getHex();
      // 院内近景（z 靠前）一律降为低矮灌木：高竹站在院内会挡住角色且像悬空图形，
      // 挡在院墙后的才留作高树剪影。
      // v2.2.0：改为「直接跳过」而不是降级成 shrub —— 两者效果都是不渲染近景植被。
      const inner = f.z > -3.4;
      const kind = inner ? 'shrub' : f.kind;
      if (kind === 'shrub') continue;
      const base = new THREE.Matrix4().compose(
        new THREE.Vector3(f.x, 0, f.z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, f.rot, 0)),
        // v2.4.5：竹影纵向压到 0.62 倍。中轴那 3 丛已在上面跳过，但两侧 -4.47/-4.87 的
        // 竹丛单株 2.8~4.6m × scale 1.13 仍高 3.2~5.2m，越过牌坊屋面（檐口 3.55）——
        // 实景读作「竹从瓦顶后面长出来」。压到 1.96~3.2m 后落在檐口以下，成为墙外竹林剪影。
        new THREE.Vector3(f.scale * (inner ? 0.85 : 1), f.scale * 0.62, f.scale * (inner ? 0.85 : 1))
      );
      if (kind === 'bamboo') {
        for (let i = 0; i < 5; i++) {
          const h = 2.8 + this.rng() * 1.8;
          m4.makeTranslation((this.rng() - 0.5) * 0.5, h / 2, (this.rng() - 0.5) * 0.5);
          m4.premultiply(new THREE.Matrix4().makeScale(1, h, 1));
          parts.push({ geo: stalkGeo, color: 0x4d6040, matrix: new THREE.Matrix4().multiplyMatrices(base, m4) });
        }
        for (let i = 0; i < 7; i++) {
          const local = new THREE.Matrix4().compose(
            new THREE.Vector3((this.rng() - 0.5) * 1.0, 1.9 + this.rng() * 1.7, (this.rng() - 0.5) * 0.9),
            new THREE.Quaternion().setFromEuler(
              new THREE.Euler(this.rng() * 0.7 - 0.2, this.rng() * Math.PI, this.rng() * 0.6)
            ),
            new THREE.Vector3(1, 1, 1)
          );
          parts.push({ geo: leafGeo, color, matrix: new THREE.Matrix4().multiplyMatrices(base, local) });
        }
      } else if (kind === 'pine') {
        const local = new THREE.Matrix4().makeTranslation(0, 1.3, 0);
        parts.push({ geo: trunkGeo, color: 0x6d5033, matrix: new THREE.Matrix4().multiplyMatrices(base, local) });
        for (let i = 0; i < 3; i++) {
          const l = new THREE.Matrix4().makeTranslation(0, 2.2 + i * 0.85, 0);
          parts.push({ geo: coneGeo[i], color, matrix: new THREE.Matrix4().multiplyMatrices(base, l) });
        }
      } else {
        for (let i = 0; i < 3; i++) {
          const local = new THREE.Matrix4().compose(
            new THREE.Vector3((this.rng() - 0.5) * 0.8, 0.34 + this.rng() * 0.2, (this.rng() - 0.5) * 0.6),
            new THREE.Quaternion(),
            new THREE.Vector3(1, 1, 1)
          );
          parts.push({ geo: shrubGeo, color, matrix: new THREE.Matrix4().multiplyMatrices(base, local) });
        }
      }
    }

    // 全部树影类型退役时（极端配置）不建空网格，避免空 BufferGeometry 产生渲染告警
    if (parts.length === 0) return;
    const geo = coloredMerge(parts);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.foliageGroup.add(mesh);
    for (const g of [stalkGeo, leafGeo, trunkGeo, shrubGeo, ...coneGeo]) g.dispose();
  }

  /* ---------------- 地面苔痕贴花（程序化，纯视觉） ---------------- */
  private buildPatches(): void {
    const list = D.layers.groundPatches;
    // 软边贴花：径向 alpha 渐变的 alphaMap 取代原来的硬边色块（美术审核第 5 条）。
    // InstancedMesh 合并成一个 draw call，并保留 uv 供 alphaMap 采样。
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.42,
      alphaMap: makeSoftPatchTexture(),
      depthWrite: false,
      color: 0xffffff,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    this.patchBase = [];
    list.forEach((p, i) => {
      m.compose(
        new THREE.Vector3(p.x, 0.012, p.z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, p.rot)),
        new THREE.Vector3(p.w, p.d, 1)
      );
      mesh.setMatrixAt(i, m);
      this.patchBase.push(m.clone());
      mesh.setColorAt(i, col.set(p.tone));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.renderOrder = 1;
    this.patchGroup.add(mesh);
    this.patchMesh = mesh;
    this.patchData = list.map((p) => ({ x: p.x, z: p.z }));
  }

  /* ---------------- 灯笼（程序化布局 + 可破坏） ---------------- */
  private buildLanterns(): void {
    const paperColor = new THREE.Color(D.palette.lanternPaper).multiplyScalar(0.72).getHex();
    const rodColor = 0x3b2c20;
    // 圆鼓形纸灯轮廓（Lathe 旋转面），替代原来的 8 棱柱方块感（美术审核第 5 条）
    const profile = [
      new THREE.Vector2(0.0, -0.2),
      new THREE.Vector2(0.14, -0.19),
      new THREE.Vector2(0.23, -0.1),
      new THREE.Vector2(0.24, 0),
      new THREE.Vector2(0.23, 0.1),
      new THREE.Vector2(0.14, 0.19),
      new THREE.Vector2(0.0, 0.2),
    ];
    const bodyGeo = new THREE.LatheGeometry(profile, 10);
    const capGeo = new THREE.CylinderGeometry(0.11, 0.14, 0.07, 8);
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.82,
      metalness: 0,
      emissive: new THREE.Color(D.palette.lanternPaper),
      emissiveIntensity: 0.38,
    });
    // 吊杆独立成 Mesh 并标记 glbKeep：GLB 灯身就位后只隐藏灯身占位，
    // 吊杆与光晕保留可见（否则灯身 GLB 会悬空、且细长吊杆会撑高 glbProps 的目标盒）。
    const rodMat = new THREE.MeshStandardMaterial({ color: rodColor, roughness: 0.85, metalness: 0 });
    this.glowTex = makeGlowTexture();
    const glowMat = new THREE.SpriteMaterial({
      map: this.glowTex,
      color: 0xffc178,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.72,
    });
    for (const l of D.layers.lanterns) {
      // 吊杆长度按 group.scale 反算，使世界坐标下顶端精确落在 LANTERN_HANG_Y，
      // 消除此前 l.scale≠1 时吊杆尾端出现的 0.239m 断头（场景审核条）。
      const rodLen = Math.max(0.35, (LANTERN_HANG_Y - l.y) / l.scale);
      // 灯身占位只含鼓形灯体 + 上下盖（不含吊杆），供 glbProps 测量目标盒
      const parts = [
        { geo: bodyGeo, color: paperColor, matrix: new THREE.Matrix4().makeTranslation(0, 0, 0) },
        { geo: capGeo, color: rodColor, matrix: new THREE.Matrix4().makeTranslation(0, 0.2, 0) },
        { geo: capGeo, color: rodColor, matrix: new THREE.Matrix4().makeTranslation(0, -0.2, 0) },
      ];
      const g = new THREE.Group();
      const mesh = new THREE.Mesh(coloredMerge(parts), mat);
      mesh.userData.destroyableId = l.id;
      g.add(mesh);
      // 吊杆：独立 Mesh，glbKeep=true → GLB 就位后仍保留可见
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, rodLen, 4), rodMat);
      rod.position.set(0, rodLen / 2, 0);
      rod.userData.glbKeep = true;
      g.add(rod);
      // 暖色光晕：加法混合 billboard，跟随灯笼一起摇摆/隐藏，破坏时自动消失
      const glow = new THREE.Sprite(glowMat);
      glow.scale.set(1.5, 1.5, 1);
      g.add(glow);
      g.position.set(l.x, l.y, l.z);
      g.scale.setScalar(l.scale);
      g.userData.destroyableId = l.id;
      // 写实 PBR 灯身 GLB 包装（加载失败自动回退到上面的程序化占位）
      const wrapped = wrapGLBProp(
        l.id,
        l.id === 'lantern-03' || l.id === 'lantern-04' || l.id === 'lantern-06' ? 'lantern-hex' : 'lantern',
        g
      );
      this.lanternGroup.add(wrapped);
      this.props.set(l.id, wrapped);
    }
    for (const g of [bodyGeo, capGeo]) g.dispose();
  }

  /* ---------------- 落叶粒子（程序化） ---------------- */
  private buildLeaves(): void {
    this.leafData = D.layers.leaves;
    const count = this.leafData.length;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = this.leafData[i].x;
      pos[i * 3 + 1] = this.leafData[i].y;
      pos[i * 3 + 2] = this.leafData[i].z;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xc8a45c,
      size: 0.09,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.leafPoints = new THREE.Points(geo, mat);
    this.leafPoints.frustumCulled = false;
    this.scene.add(this.leafPoints);
  }

  private collectSpecs(): void {
    for (const k of D.manual.keyDestroyables) {
      this.specs.push({
        id: k.id,
        tier: k.tier,
        hp: k.maxHp,
        stages: k.stages,
        x: k.position.x,
        y: k.position.y,
        z: k.position.z,
        w: k.size.w,
        h: k.size.h,
        d: k.size.d,
        preset: k.fragmentsPreset,
        chainRadius: k.chainRadius,
        opensPassage: k.opensPassage,
        collapseZone: k.collapseZone,
        sfx: k.sfx,
      });
    }
    for (const l of D.layers.lanterns) {
      // 灯笼无 l.h 字段：spec 盒高由 scale 推得 0.5*l.scale。灯身 mesh 居中于 group 原点(l.y)，
      // 故 l.y 是「灯身中心」而非盒底。全场景统一 spec.y = 盒底：y = l.y - h/2，
      // 使 destruction.ts 的 s.y + s.h*0.5 恰好回到灯身中心，消除 0.25*scale 命中上浮。
      const h = 0.5 * l.scale;
      this.specs.push({
        id: l.id,
        tier: 1,
        hp: l.hp,
        stages: 1,
        x: l.x,
        y: l.y - h * 0.5,
        z: l.z,
        w: 0.5 * l.scale,
        h,
        d: 0.5 * l.scale,
        preset: 'paper_lantern',
        chainRadius: 1.5,
        opensPassage: false,
        sfx: 'shatter',
      });
    }
  }

  setTier(tier: Tier): void {
    this.tier = tier;
    this.keyLight.castShadow = this.budget.shadows;
    this.keyLight.shadow.mapSize.set(this.budget.shadowMapSize, this.budget.shadowMapSize);
    this.foliageGroup.visible = true;
    let i = 0;
    for (const child of this.foliageGroup.children) {
      child.visible = i / Math.max(1, this.foliageGroup.children.length) < this.budget.decorScale + 0.15;
      i++;
    }
    if (this.leafPoints) this.leafPoints.visible = this.budget.dust;
    this.patchGroup.visible = tier !== 'low';
    this.fillLight.visible = tier !== 'low';
  }

  applyBudget(budget: Budget): void {
    this.budget = budget;
    this.setTier(this.tier);
  }

  getFloorY(x: number): number {
    // v2.1.0：groundY 配置落地（此前为死字段）。decor.json 中默认 groundY=0，
    // 与历史返回值完全一致；塌陷深度改为相对基准地面下探，语义统一。
    const g = D.manual.arena.groundY;
    const base = typeof g === 'number' && Number.isFinite(g) ? g : 0;
    for (const zone of this.collapsed) {
      const z = JSON.parse(zone) as { fromX: number; toX: number; depth: number };
      if (x > z.fromX && x < z.toX) return base - z.depth;
    }
    return base;
  }

  activePit(): { fromX: number; toX: number } | null {
    for (const zone of this.collapsed) {
      const z = JSON.parse(zone) as { fromX: number; toX: number; depth: number };
      return { fromX: z.fromX, toX: z.toX };
    }
    return null;
  }

  /** 回合重置：修复地形（坑填回、地面恢复可见），并释放坑体网格 */
  resetTerrain(): void {
    this.collapsed.clear();
    this.pitLight.intensity = 0;
    for (const [, mesh] of this.floorMeshes) mesh.visible = true;
    // 塌陷把坑内苔痕实例缩放归零，重置时按构造快照完整还原（否则苔痕永久消失）
    if (this.patchMesh) {
      this.patchBase.forEach((m, i) => this.patchMesh!.setMatrixAt(i, m));
      this.patchMesh.instanceMatrix.needsUpdate = true;
    }
    // 地面薄霜随中段地板一起隐藏，回合重置恢复（修薄霜残留）
    setFrostVisible(true);
    // v2.3.0：逐道具派生 collider 全部复原（破坏时 dropCollider 会把它们置为 dead）
    restoreColliders();
    for (const child of [...this.pitGroup.children]) {
      this.pitGroup.remove(child);
      const m = child as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    }
  }

  isInPit(x: number): boolean {
    for (const zone of this.collapsed) {
      const z = JSON.parse(zone) as { fromX: number; toX: number; depth: number };
      if (x > z.fromX && x < z.toX) return true;
    }
    return false;
  }

  collapse(zone: { id: string; fromX: number; toX: number; depth: number }): void {
    if (this.collapsed.has(JSON.stringify(zone))) return;
    this.collapsed.add(JSON.stringify(zone));

    const mid = this.floorMeshes.get('floor-b');
    if (mid) mid.visible = false;
    // 中段地板塌陷后，覆盖其上的地面薄霜会悬空在坑口，随地板一起隐藏
    setFrostVisible(false);

    // 坑区内的苔痕贴花原本钉在 y=0.012，中段地板塌陷后会悬空 0.75m（场景审核条）。
    // 把落在坑 x 范围内的实例缩放归零，等同随地板一起消失。
    if (this.patchMesh) {
      const m = new THREE.Matrix4();
      this.patchData.forEach((p, i) => {
        if (p.x > zone.fromX - 0.15 && p.x < zone.toX + 0.15) {
          this.patchMesh!.setMatrixAt(i, m.makeScale(0, 0, 0));
        }
      });
      this.patchMesh.instanceMatrix.needsUpdate = true;
    }

    // 塌陷坑：四壁 + 底
    const w = zone.toX - zone.fromX;
    const depth = zone.depth;
    const floorDepth = D.manual.arena.depth;
    const pitMat = new THREE.MeshStandardMaterial({ color: 0x2c2419, emissive: 0x0d0a06, roughness: 0.95, metalness: 0 });
    // 坑体纵深只做到台前 2.0：铺满 7 米会让坑底一直顶到镜头下方，读作一个黑色台座
    const pitZ = 5.5;
    const pitZCenter = -0.75;
    const bottom = new THREE.Mesh(new THREE.BoxGeometry(w, 0.2, pitZ), pitMat);
    bottom.position.set((zone.fromX + zone.toX) / 2, -depth - 0.1, pitZCenter);
    bottom.receiveShadow = true;
    this.pitGroup.add(bottom);

    const wallMat = new THREE.MeshStandardMaterial({ color: 0x3a3126, emissive: 0x090705, roughness: 0.95, metalness: 0 });
    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.2, depth, pitZ), wallMat);
      wall.position.set(side < 0 ? zone.fromX : zone.toX, -depth / 2, pitZCenter);
      wall.castShadow = true;
      this.pitGroup.add(wall);
    }
    const farWall = new THREE.Mesh(new THREE.BoxGeometry(w, depth, 0.2), wallMat);
    farWall.position.set((zone.fromX + zone.toX) / 2, -depth / 2, -(floorDepth / 2));
    this.pitGroup.add(farWall);
    // 近侧不加整面墙：镜头在前方，这面墙会以「抬高的黑色台座」形态挡住整个坑（实测比不加更糟）。
    // 换成一条贴地的暗色断口条，只负责压住地砖剖切面的高光。
    const lip = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, 0.16), wallMat);
    lip.position.set((zone.fromX + zone.toX) / 2, -0.05, pitZCenter + pitZ / 2 - 0.08);
    this.pitGroup.add(lip);

    // 坑口近沿到台前还差 1.5 米：整块中段地板被隐藏后，这一段会直接看穿到场景外。
    // 补一块与地面同厚度的沿口地板把缝填死（颜色略深，读作被碎石压住的断面）。
    const nearEdge = pitZCenter + pitZ / 2;
    const frontEdge = floorDepth / 2;
    if (frontEdge - nearEdge > 0.02) {
      if (!this.apronTex && this.floorMat?.map) {
        const t = this.floorMat.map.clone();
        t.needsUpdate = true;
        // 主地面 repeat(FLOOR_REPEAT_X,FLOOR_REPEAT_Y) 铺满整块中段地板；沿口只有 1.5 米深，
        // 纵向按比例缩，石板才一样大。offset 把拼缝相位对齐到近沿，避免接缝错位（场景审核条）。
        t.repeat.set(FLOOR_REPEAT_X, FLOOR_REPEAT_Y * (frontEdge - nearEdge) / floorDepth);
        t.offset.set(0, FLOOR_REPEAT_Y * (nearEdge + floorDepth / 2) / floorDepth);
        this.apronTex = t;
        // roughnessMap 与 map 同布局同相位，保证沿口与主地面质感一致
        if (this.floorMat.roughnessMap) {
          const rt = this.floorMat.roughnessMap.clone();
          rt.needsUpdate = true;
          rt.repeat.copy(t.repeat);
          rt.offset.copy(t.offset);
          this.apronRoughTex = rt;
        }
      }
      // 沿口读作「被碎石压住的断面」：冷灰白略深一档，与主地面同色系、无明显色差
      const apronMat = new THREE.MeshStandardMaterial({
        color: 0xdfe3ea,
        map: this.apronTex ?? null,
        roughnessMap: this.apronRoughTex ?? null,
        roughness: this.floorMat?.roughness ?? 0.94,
        metalness: 0,
      });
      const apron = new THREE.Mesh(new THREE.BoxGeometry(w, 0.36, frontEdge - nearEdge), apronMat);
      apron.position.set((zone.fromX + zone.toX) / 2, -0.18, (nearEdge + frontEdge) / 2);
      apron.receiveShadow = true;
      this.pitGroup.add(apron);
    }

    // 坑底补光：避免塌陷后变成纯黑空洞，同时给出深度层次
    this.pitLight.position.set((zone.fromX + zone.toX) / 2, -depth + 0.6, 0.5);
    this.pitLight.distance = Math.max(4, depth * 5);
    this.pitLight.intensity = 1.8;

    // 坑沿断裂地砖：打断生硬的直角轮廓，让塌陷读起来像被砸穿而不是挖了个水池
    const slabGeo = new THREE.BoxGeometry(1, 1, 1);
    const parts: { geo: THREE.BufferGeometry; color: number; matrix: THREE.Matrix4 }[] = [];
    for (let i = 0; i < 12; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const edge = side < 0 ? zone.fromX : zone.toX;
      const w = 0.32 + this.rng() * 0.5;
      const h = 0.1 + this.rng() * 0.1;
      const d = 0.3 + this.rng() * 0.45;
      const px = edge + side * (0.16 + this.rng() * 0.34);
      const py = -h * 0.5 - this.rng() * 0.06;
      const pz = -floorDepth / 2 + 0.5 + this.rng() * (floorDepth - 1);
      const m = new THREE.Matrix4()
        .makeRotationFromEuler(
          new THREE.Euler((this.rng() - 0.5) * 0.35, (this.rng() - 0.5) * 0.8, side * (0.08 + this.rng() * 0.3))
        )
        .setPosition(px, py, pz)
        .multiply(new THREE.Matrix4().makeScale(w, h, d));
      parts.push({ geo: slabGeo, color: i % 3 === 0 ? 0x8d8172 : 0x6f6559, matrix: m });
    }
    const slabMesh = new THREE.Mesh(
      coloredMerge(parts),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0 })
    );
    slabMesh.castShadow = true;
    slabMesh.receiveShadow = true;
    this.pitGroup.add(slabMesh);
    slabGeo.dispose();
  }

  /* v2.2.0：`openPassage()` 随 `opensPassage` 通道链一并退役（a′ 档）。
   * 原实现只是 `props.get(id).visible = false`，唯一调用方是 `destruction.ts` 打碎 `wall-panel-east` 时；
   * 该墙已换皮成大鼓、参考图亦无「下一区域」，故方法删除。破坏可见性由 `breakObject()`
   * 自身的 `obj.mesh.visible = false` 负责，行为不变。 */

  update(dt: number): void {
    this.elapsed += dt;
    if (this.leafPoints) {
      const attr = this.leafPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      for (let i = 0; i < this.leafData.length; i++) {
        const d = this.leafData[i];
        const t = this.elapsed * d.speed + d.phase;
        arr[i * 3] = d.x + Math.sin(t * 0.8) * 0.9;
        arr[i * 3 + 1] = d.y - ((this.elapsed * d.speed * 0.42) % 5.2);
        arr[i * 3 + 2] = d.z + Math.cos(t * 0.6) * 0.5;
        if (arr[i * 3 + 1] < 0.05) arr[i * 3 + 1] = 5.2;
      }
      attr.needsUpdate = true;
    }
    // 灯笼轻摆
    let idx = 0;
    for (const l of D.layers.lanterns) {
      const obj = this.props.get(l.id);
      if (obj) obj.rotation.z = Math.sin(this.elapsed * 0.9 + l.swayPhase) * 0.06;
      idx++;
    }
    void idx;
    // 复用现成主循环与 elapsed 驱动装饰氛围（不新增 rAF）
    decorMotion.tick(dt);
    // v2.0.9 风景天幕动态：云带缓移 / 雾带微呼吸 / 月晕轻脉动
    updateScenery(this.elapsed);
    // v2.3.0 经幡波动（顶部固定、底部摆幅最大）
    updateStoneProps(this.elapsed);
  }

  dispose(): void {
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
    this.scene.clear();
  }
}
