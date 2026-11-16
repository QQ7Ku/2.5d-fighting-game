/**
 * v2.0.9 风景天幕：把 Lux3D 生成的实体风景 GLB（三层雪岭 / 远景殿宇 / 石台基 / 竹林天幕）
 * 用占位盒驱动逐轴缩放接入，并补齐纯氛围层（天空渐变、冷月+月晕+星点、云带、山腰雾带、地面薄霜）。
 *
 * 设计要点：
 * - 实体风景件走与道具一致的 wrapGLBProp（常驻根 + 占位 + GLB 子树），占位盒尺寸即目标尺寸；
 *   月亮 GLB 文生3D 返回尺度荒谬（约 3.47e6 单位），无法作为模型使用，故冷月改用代码发光圆盘 + 月晕。
 * - 氛围层（天空/月晕/云/雾/霜）本质是着色与贴图效果，做成 GLB 既贵又不自然，统一程序化。
 * - 全部挂在 arena.sceneryGroup，不进 props/specs/破坏链；单件 404 静默降级（占位盒保留淡剪影）。
 */
import * as THREE from 'three';
import decor from '../../scene/output/decor.json';
import { wrapGLBProp, template } from './glbProps';
import { makeSkyDomeTexture, buildRidgePlane } from './skyBackdrop';
import { mulberry32, hashString } from '../core/math';
import type { Arena } from './arena';

interface ScnBox { id: string; model: string; x: number; y: number; z: number; w: number; h: number; d: number; }

// 全部实体风景件严格置于战斗平面之后（play-area: z∈[-3.5,3.5]），避免穿模/挡住角色。
// 摄像机为「俯视竞技场地面」的 2.5D 机位（cam (0,2.9,7.6) 看向 (0,1.15,0)），
// 背景可视带经投影标定是屏幕上方约 1/3：基准面 z=-13 处世界 y∈[0,4.5] 才落在画幅内，
// y 再高即没入画面上沿。故雪岭/殿宇/竹林整体压低成「横向剪影带」，群山由远及近、殿宇居中、
// 冷月自远岭后探出，构成概念图所求的多层纵深天幕，而非悬在画面上沿之外的孤立高峰。
// 占位盒只决定 GLB 缩放与落点（wrapGLBProp 按局部盒测量后逐轴对齐），仅移动坐标不触发重新生成。
// v2.0.9.1：山体收窄加厚立体化（w 收窄、h≤8、d=3 出峰形），殿宇缩小让位牌坊，
// 石台基前移至牌坊正后 (z=-3.8) 作台基，竹林推远至 x=±13 两翼。
const SCENERY: ScnBox[] = [
  { id: 'mountain-far',  model: 'mountain-far',  x: 0,  y: 2.2, z: -24, w: 56, h: 7,   d: 3 },
  { id: 'mountain-mid',  model: 'mountain-mid',  x: 0,  y: 2.0, z: -19, w: 48, h: 7.5, d: 3 },
  { id: 'mountain-near', model: 'mountain-near', x: 0,  y: 1.8, z: -14, w: 40, h: 8,   d: 3 },
  // v2.2.0：殿宇后撤 + 收小 + 压暗。远景层已由「远山背景」图画承担山/天/雾，
  // 殿宇保留为实体（资产板把它归入中景「山门建筑」一侧的纵深，且 scenery 7/7 基线不能动），
  // 但拉远到 z=-15、压到 h=5.0，读作门洞后的远处殿宇剪影，不与牌坊抢中轴。
  { id: 'temple-hall',   model: 'temple-hall',   x: 0,  y: 1.5, z: -15, w: 7.2, h: 5.0, d: 6 },
  { id: 'stone-terrace', model: 'stone-terrace', x: 0,  y: -0.2, z: -3.8, w: 9, h: 1.4, d: 2.5 },
  { id: 'bamboo-L',      model: 'bamboo-grove',  x: -13, y: 1.6, z: -10, w: 8,  h: 5,  d: 8 },
  { id: 'bamboo-R',      model: 'bamboo-grove',  x: 13,  y: 1.6, z: -10, w: 8,  h: 5,  d: 8 },
];

let clouds: THREE.Sprite[] = [];
let mist: THREE.Mesh[] = [];
let moonHalo: THREE.Sprite | null = null;
let frostMesh: THREE.Mesh | null = null;

/** 远景层天幕：v2.2.0 起由 skyBackdrop 程序化合成（渐变 + 最远山影 + 地平冷光），不再是 4×256 纯渐变。 */
function buildSky(arena: Arena): void {
  arena.scene.background = makeSkyDomeTexture();
}

function radialTex(inner: string, outer: string): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, inner); grad.addColorStop(1, outer);
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function buildMoon(arena: Arena): void {
  // 冷月：收成参考图那种完整小满月（r=0.68），并右移到 x=7.2 / 上移到 y=3.35。
  // v2.3.0 修正两件事：
  //  ① 原 (5.6, 3.2, -7.2) 与 7 盏灯笼的吊杆（x≤6.0、吊杆从灯顶 y≈3.35 拉到挂点 y≈3.6）重叠，
  //     月盘下缘被细杆反复划过，读作「月面裂纹」；
  //  ② z=-7.2 处相机可见半宽约 9.6（不是 z≈-2 处的 5.9），月盘右移到 7.2 仍完整在画内，
  //     且已让开全部灯笼（x≤6.0）与竹林（x≥9，月亮 7.2+0.68=7.88 < 9）。
  // y=3.35 + r=0.68 → 顶 4.03 ≤ 4.5，不溢出画面上沿（投影标定可见带）。
  const moon = new THREE.Mesh(
    new THREE.CircleGeometry(0.60, 32),
    new THREE.MeshBasicMaterial({ color: 0xeef2ff, fog: false })
  );
  // v2.4.5：抬到 y=3.78。原 3.35 时月盘被右侧灯笼（lantern-05 x=5.15 / z=-1.9）压住中心 ——
  // 灯笼更近（距相机 11.24 vs 月亮 16.54），透视把它的投影放大到盖住月盘。
  // 纯横向让开会把月亮推到 x≥8.55（贴右缘 93%），故改用纵向让开：
  // 灯笼顶 (2.94-2.25)/11.24 = 0.061，月盘底 (3.10-2.25)/16.54 = 0.051，已分离；
  // 月盘顶 4.46 ≤ 4.5（投影标定的画面上沿），不溢出。
  // v2.4.5 二次修正：y=3.78 仍不够 —— 月盘下缘 3.10 还在吊杆区间（灯顶 2.94 ～ 横杆 3.6）内，
  // 实景里两根吊杆把月面切成三块。横杆高度带（2.94~3.6）横向被 6 盏灯笼占满，无空隙可钻，
  // 只能整体抬到吊杆之上：r 收到 0.60、y 抬到 4.28 → 月盘底 3.68 > 横杆 3.6，顶 4.88。
  moon.position.set(7.2, 4.28, -7.2);
  arena.sceneryGroup.add(moon);

  moonHalo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: radialTex('rgba(200,216,255,0.55)', 'rgba(200,216,255,0)'),
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  moonHalo.scale.set(4.0, 4.0, 1);
  moonHalo.position.copy(moon.position);
  arena.sceneryGroup.add(moonHalo);

  // 星点：v2.3.0 改固定种子（原来是 Math.random，每次刷新星位都变，无法做视觉回归比对）
  const rng = mulberry32(hashString('stars-v230'));
  const N = 120; const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (rng() - 0.5) * 70;
    pos[i * 3 + 1] = 1.8 + rng() * 2.6;
    pos[i * 3 + 2] = -28 - rng() * 8;
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const stars = new THREE.Points(sg, new THREE.PointsMaterial({
    color: 0xcdd8ee, size: 0.25, sizeAttenuation: true, transparent: true, opacity: 0.8, fog: false,
  }));
  arena.sceneryGroup.add(stars);
}

function buildCloudsMist(arena: Arena): void {
  const rng = mulberry32(hashString('clouds-mist-v230'));
  // ---- 云：v2.3.0 改「4 团不规则柔光斑」。
  // 原实现是 3 个 56×3.6 的横向长条 Sprite，即使 opacity 压到 0.16，在深色夜空上
  // 仍会读成「三道水波纹横条」（Multiple 场景截图反复被指出）。改成近方形小云团、
  // 位置由固定种子决定、彼此错开高度，不再构成横向线。
  const cloudTex = radialTex('rgba(202,214,230,0.5)', 'rgba(202,214,230,0)');
  for (let i = 0; i < 4; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: cloudTex, transparent: true, opacity: 0.10, depthWrite: false, fog: false,
    }));
    s.scale.set(13 + rng() * 9, 4.2 + rng() * 2.4, 1);
    s.position.set(-30 + i * 15 + rng() * 5, 2.3 + rng() * 1.2, -21 - rng() * 5);
    arena.sceneryGroup.add(s); clouds.push(s);
  }

  // ---- 山脚雾：v2.3.0 改「椭圆柔化雾团」，不再是全屏宽的横条。
  // 原实现 3 层 90×4 的 PlaneGeometry + 线性渐变，横向贯穿整幅画面，是横纹的主要来源。
  // 现在用径向渐变贴图（中心浓、四周透明），只做 2 层、宽度收敛到 120/150 并推到 z=-17/-23，
  // 视觉上读作「山脚一层流动的雾」，与背景图的山影叠加也不会形成直线。
  const mistTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(64, 78, 4, 64, 78, 62);
    grad.addColorStop(0, 'rgba(214,224,236,0.62)');
    grad.addColorStop(0.45, 'rgba(214,224,236,0.28)');
    grad.addColorStop(1, 'rgba(214,224,236,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();
  const mistSpecs = [
    { w: 120, h: 8.5, y: 1.0, z: -17, op: 0.38 },
    { w: 150, h: 10, y: 1.9, z: -23, op: 0.26 },
  ];
  for (const m of mistSpecs) {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(m.w, m.h),
      new THREE.MeshBasicMaterial({ map: mistTex, transparent: true, opacity: m.op, depthWrite: false, fog: false, side: THREE.DoubleSide })
    );
    mesh.position.set(0, m.y, m.z);
    arena.sceneryGroup.add(mesh); mist.push(mesh);
  }
}

function buildFrost(arena: Arena): void {
  // 地面薄霜：大面片叠细微白噪点，极低不透明
  // v2.3.0：霜点位置/透明度改固定种子（原来用 Math.random，每次刷新霜纹都不同）
  const rng = mulberry32(hashString('frost-v230'));
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(196,214,238,0.0)'; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 900; i++) {
    const a = rng() * 0.12;
    // v2.4.2：霜点由暖白 (232,230,222) 改冷蓝白 (196,214,238)。
    // 暖白在冷蓝夜景光下会被读成「淡紫斑/污渍」，换成 B>G>R 的冷蓝白后与地面调性一致。
    g.fillStyle = `rgba(196,214,238,${a})`;
    g.fillRect(rng() * 128, rng() * 128, 1, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  const w = (decor as unknown as { manual: { arena: { width: number } } }).manual.arena.width;
  const frost = new THREE.Mesh(
    new THREE.PlaneGeometry(w + 4, w + 4),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.55, depthWrite: false, fog: true })
  );
  frost.rotation.x = -Math.PI / 2;
  frost.position.set(0, 0.03, 0.6);
  arena.sceneryGroup.add(frost);
  frostMesh = frost;
}

/** 霜面显隐：供地面塌陷 / 回合重置调用，随中段地板一起隐藏、reset 时恢复（修薄霜残留）。 */
export function setFrostVisible(visible: boolean): void {
  if (frostMesh) frostMesh.visible = visible;
}

/** 挂载全部风景（实体 GLB + 代码氛围层）。在 arena 构造末尾调用。 */
export function mountStageScenery(arena: Arena): void {
  for (const s of SCENERY) {
    const ph = new THREE.Mesh(
      new THREE.BoxGeometry(s.w, s.h, s.d),
      new THREE.MeshBasicMaterial({ color: 0x1a2026, transparent: true, opacity: 0.6 })
    );
    ph.position.set(s.x, s.y, s.z);
    arena.sceneryGroup.add(wrapGLBProp(s.id, s.model, ph));
    // 远景空气透视着色：雪山 GLB 原材质偏亮偏青（截图实测呈"蓝绿波纹带"），
    // 模板 clone(true) 共享材质实例，对共享模板 tint 一次即全实例生效，读作蓝灰雪脊剪影。
    // v2.2.0 追加 temple-hall：后撤后仍需压暗降对比，否则白墙瓦顶在远景里过亮、抢牌坊。
    // v2.4.1（审查修复）：bamboo-grove 原先走 null 分支，从未着色 —— 远景竹丛（x=±13 / z=-10 / 高 5m）
    // 保持 GLB 原亮黄绿，在冷蓝夜色里像「白天拍的竹子」，是左右缘最抢眼的植被。
    // 现补暗冷绿 0x2f3e34，读作夜色竹影；近景竹（stageDecor ±7.8）另有 0x304438 + ×0.88 压暗。
    const farTint = s.model.startsWith('mountain')
      ? 0x46525f
      : s.model === 'temple-hall'
        ? 0x5c6774
        : s.model === 'bamboo-grove'
          ? 0x2f3e34
          : null;
    if (farTint !== null) {
      void template(s.model).then((tpl) => {
        tpl.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const m of mats) {
            const mm = m as THREE.MeshStandardMaterial;
            if (mm && mm.color) mm.color.set(farTint);
          }
        });
      });
    }
  }
  buildSky(arena);
  // v2.2.0 远景层分层：L0 天幕（scene.background）+ L1 带 z 的山脊剪影（z=-26）。
  // 补这一层是为了落实「层级示意要求远/中/近分离」——单张 background 会把远景拍平成一堵墙色。
  arena.sceneryGroup.add(buildRidgePlane());
  buildMoon(arena);
  buildCloudsMist(arena);
  buildFrost(arena);
}

/** 氛围动态：云团缓移、雾团微呼吸、月晕轻脉动。由 arena.update 驱动（elapsed 秒）。 */
export function updateScenery(elapsed: number): void {
  for (let i = 0; i < clouds.length; i++) {
    clouds[i].position.x = (clouds[i].position.x + 0.0032 + Math.sin(elapsed * 0.05 + i) * 0.0016);
    if (clouds[i].position.x > 42) clouds[i].position.x = -42;
  }
  for (let i = 0; i < mist.length; i++) {
    const m = mist[i].material as THREE.MeshBasicMaterial;
    // 缓存各自基准不透明度：两层雾的原值不同（0.38 / 0.26），统一写死会让远层雾变亮
    if (m.userData.base === undefined) m.userData.base = m.opacity;
    m.opacity = (m.userData.base as number) * (0.88 + 0.2 * Math.sin(elapsed * 0.3 + i * 1.7));
  }
  if (moonHalo) moonHalo.scale.setScalar(3.9 + Math.sin(elapsed * 0.4) * 0.3);
}
