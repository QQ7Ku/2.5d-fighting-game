/**
 * v2.2.0 远景层「远山背景」拆件（对应 W.2 资产板 10 类拆件里的「远山背景」一张画）。
 *
 * 为什么要有这一层：
 * - v2.0.9~v2.1.0 的远景层是「纯渐变天幕 + 3 层程序化山脊扁片 + 22 株程序化树影」，
 *   其中 9 株 pine 三角松与 3 层 ShapeGeometry 山脊是「军绿三角远山 / 山峰小尖角 / 啃月」的根源，
 *   本质是「把一张画拆成一堆三角面去做」，越做越脏。
 * - 参考图（e0 四视图 + 3f 层级示意）对远景层的要求是「一张画」：天 + 水墨远山 + 雾，
 *   并且层级示意明确画出远/中/近三档，不能只有一张屏幕空间贴图。
 *
 * 所以本模块产出两层：
 *   L0 `scene.background`  = 天幕（竖直渐变 + 极淡最远山影 + 地平线冷光），屏幕空间固定 = 无穷远；
 *   L1 `sceneryGroup` 内 z=-26 的 Plane = 中远景水墨山脊剪影（带真实 z，与实体雪岭 GLB 形成纵深）。
 * 两层都是**程序化确定性**合成（mulberry32 + 固定种子），不读外部图片、无版权风险、不花点数。
 *
 * 分工边界（避免与实体风景 GLB 重复）：
 * - 本模块**不画月亮**：月由 `stageScenery.buildMoon()` 的 3D 圆盘承担（v2.1.0 已标定 (5.6,3.2,-7.2)），
 *   否则会出现「背景一个满月 + 场景一个圆盘」两个月亮。
 * - 本模块**不画殿宇**：殿宇由 `temple-hall.glb` 实体承担（保持 scenery 7/7 基线）。
 * - 本模块只负责「山 + 天 + 雾」，即资产板上「远山背景」这一件。
 */

import * as THREE from 'three';
import { sceneData as decor } from '../scene/sceneData';

const P = (decor as unknown as { palette: Record<string, string> }).palette;

/** 确定性 PRNG：同一个种子在任何机器 / 任何帧都产出同一张图，便于视觉回归比对。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** #rrggbb → [r,g,b] */
function hex2rgb(hex: string): [number, number, number] {
  const v = parseInt(hex.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** 两色线性混合（t=0 → a，t=1 → b），返回 rgba 字符串。 */
function mix(a: string, b: string, t: number, alpha = 1): string {
  const [ar, ag, ab] = hex2rgb(a);
  const [br, bg, bb] = hex2rgb(b);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `rgba(${r},${g},${bl},${alpha})`;
}

interface RidgeOpt {
  /** 山脊基线（画布像素 y，越大越低） */
  baseY: number;
  /** 峰高振幅（像素） */
  amp: number;
  /** 折线段数（越大越碎） */
  segs: number;
  /** 填充色 */
  color: string;
}

/** 画一条平滑山脊：从画布底部左右封口，中间用二次曲线串起确定性峰谷。 */
function paintRidge(g: CanvasRenderingContext2D, rng: () => number, W: number, H: number, o: RidgeOpt): void {
  const pts: [number, number][] = [];
  for (let i = 0; i <= o.segs; i++) {
    const x = (i / o.segs) * W;
    // 两个不同频率的正弦叠加 + 一点随机，避免"等距锯齿"
    const wave = Math.sin(i * 1.9 + 0.7) * 0.45 + Math.sin(i * 0.63 + 2.1) * 0.35;
    const n = (wave + 1) * 0.5 * 0.75 + rng() * 0.25;
    pts.push([x, o.baseY - n * o.amp]);
  }
  g.beginPath();
  g.moveTo(-2, H);
  g.lineTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    const [px, py] = pts[i - 1];
    const [cx, cy] = pts[i];
    // 控制点抬到两点上方，峰形更像山脊而不是折线
    g.quadraticCurveTo((px + cx) / 2, Math.min(py, cy) - o.amp * 0.18, cx, cy);
  }
  g.lineTo(W + 2, H);
  g.closePath();
  g.fillStyle = o.color;
  g.fill();
}

/** 横向柔光条：远景空气透视用，压住山脚让山"坐进雾里"。 */
function paintHaze(g: CanvasRenderingContext2D, W: number, H: number, y: number, h: number, alpha: number): void {
  const grad = g.createLinearGradient(0, y - h / 2, 0, y + h / 2);
  grad.addColorStop(0, `rgba(150,168,190,0)`);
  grad.addColorStop(0.5, `rgba(150,168,190,${alpha})`);
  grad.addColorStop(1, `rgba(150,168,190,0)`);
  g.fillStyle = grad;
  g.fillRect(0, y - h / 2, W, h);
}

/** L0 天幕：竖直渐变 + 极淡最远山影 + 地平线冷光。用作 `scene.background`。 */
export function makeSkyDomeTexture(): THREE.CanvasTexture {
  const W = 2048;
  const H = 1024;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;

  // ① 竖直渐变（沿用 palette，保证与雾色同族）
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, P.skyTop);
  grad.addColorStop(0.52, mix(P.skyTop, P.skyBottom, 0.6));
  grad.addColorStop(1, P.skyBottom);
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);

  // ② 地平线冷光：把最下方提亮一点点，避免夜空直接压到地面变"死黑"
  const glow = g.createRadialGradient(W * 0.5, H * 0.9, 0, W * 0.5, H * 0.9, W * 0.42);
  glow.addColorStop(0, 'rgba(122,144,170,0.12)');
  glow.addColorStop(1, 'rgba(122,144,170,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, W, H);

  // ③ 极淡最远山影（两层，低对比，只做"天际不是一条直线"）
  const rng = mulberry32(hashString('sky-dome-v220'));
  paintRidge(g, rng, W, H, { baseY: H * 0.815, amp: H * 0.05, segs: 11, color: mix(P.ridgeFar, P.skyBottom, 0.55, 0.5) });
  paintRidge(g, rng, W, H, { baseY: H * 0.862, amp: H * 0.036, segs: 8, color: mix(P.ridgeMid, P.skyBottom, 0.4, 0.55) });

  // ④ 山脚薄雾
  paintHaze(g, W, H, H * 0.875, H * 0.14, 0.1);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/**
 * L1 中远景山脊剪影：透明底画布，挂在 z=-26 的 Plane 上。
 * 比 L0 的对比度高一点、峰形更明确，但仍是纯剪影，不与实体雪岭 GLB 抢质感。
 */
function makeRidgeSilhouetteTexture(): THREE.CanvasTexture {
  const W = 2048;
  const H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, W, H);

  const rng = mulberry32(hashString('ridge-silhouette-v220'));
  // 后层（高、淡）
  paintRidge(g, rng, W, H, { baseY: H * 0.66, amp: H * 0.36, segs: 9, color: mix(P.ridgeNear, P.skyTop, 0.35, 0.65) });
  // 前层（低、实）
  paintRidge(g, rng, W, H, { baseY: H * 0.86, amp: H * 0.28, segs: 12, color: mix(P.ridgeNear, P.skyTop, 0.6, 0.82) });
  // 山脚雾带（把剪影下缘吃掉，避免出现"一块色片贴在半空"）
  paintHaze(g, W, H, H * 0.9, H * 0.26, 0.16);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 中远景剪影层的世界参数：z=-26 落在三层实体雪岭（-14/-19/-24）之后、天幕之前。 */
export const RIDGE_PLANE = { x: 0, y: 6.2, z: -26, w: 150, h: 36 } as const;

/** 把 L1 剪影层挂到 sceneryGroup，返回 mesh 供探针 / 调试。 */
export function buildRidgePlane(): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(RIDGE_PLANE.w, RIDGE_PLANE.h),
    new THREE.MeshBasicMaterial({
      map: makeRidgeSilhouetteTexture(),
      transparent: true,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    })
  );
  mesh.position.set(RIDGE_PLANE.x, RIDGE_PLANE.y, RIDGE_PLANE.z);
  // 压在所有实体风景件之后（透明物体按距离排序，这里显式给一个很小的 renderOrder 兜底）
  mesh.renderOrder = -30;
  mesh.userData.backdropLayer = 'ridge-silhouette';
  return mesh;
}
