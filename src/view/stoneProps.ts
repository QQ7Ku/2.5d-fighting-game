/**
 * v2.3.0：参考图（`e0/` 四视图 + `3f/` W.2 资产板 10 类拆件）里明确列出、
 * 但仓库 24 个 GLB 中**没有对应模型**的四件，用程序化几何补齐。零 Lux3D 点数。
 *
 * 补齐的四件（资产板拆件名 → 本模块实现）：
 *   ① 石狮         → `makeLionGeometry()`     左右各一，近景层两侧（\|x\|=5.0, z=-4.0）
 *   ② 抱鼓石门墩   → `makeDrumStoneGeometry()` 牌坊柱脚左右各一（±2.55, z=-2.42）
 *   ③ 经幡柱红幡   → `makeBanner()`           左侧经幡柱挂 3 面，顶点正弦波动
 *   ④ 匾额         → `makePlaque()`           canvas 文字纹理，"山门"二字
 * 另附：灯架落地立柱（把 v2.0.9.1 的悬空横杆改成两端落地的灯架，不再悬空）。
 *
 * 边界（与破坏链严格隔离）：
 * - 全部只挂 `arena.decorGroup`，**不进 `arena.props` / `arena.specs`**，
 *   因此 `destruction.ts` 不会把它们纳入命中、碎片或回归数字；
 * - 不参与 `impactAt` 判定（石狮/抱鼓石在 z≈-4.0，本就超出 zTol=2.1）；
 * - 单件构建失败静默跳过，不影响对局。
 *
 * 为什么不用 Lux3D：
 * - 石狮/抱鼓石是**强剪影**物件（玩家 720p 下只看到轮廓），程序化低模足够；
 * - 生成一件约 20 点，四件 80 点，且需人工验收；本轮用户要求「补全所有问题」，
 *   走零成本路径先把参考图元素补齐，后续若要写实版再单独立项替换。
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Arena } from './arena';
import { SCENE_ID } from '../scene/sceneData';

/** 探针用：每件程序化补件的落地状态。 */
export interface StonePropState {
  id: string;
  kind: 'lion' | 'drum-stone' | 'banner' | 'plaque' | 'lamp-post';
  position: [number, number, number];
  /** 世界包围盒尺寸，供锚点探针断言「贴地」「不出画」 */
  size: [number, number, number];
  /** v2.4.5：欧拉角（弧度）。Box3 只能反映旋转后的包围盒，看不出「内八 / 歪斜」，故单独暴露。 */
  rotation?: [number, number, number];
  tris: number;
}

const states: StonePropState[] = [];
const bannerMeshes: { mesh: THREE.Mesh; base: Float32Array; phase: number; amp: number; h: number }[] = [];

/** 收集构件：把原始几何按「缩放 → 旋转 → 平移」摆到位后合并成一个 BufferGeometry。 */
function place(
  geo: THREE.BufferGeometry,
  pos: [number, number, number],
  scale: [number, number, number],
  rot: [number, number, number] = [0, 0, 0]
): THREE.BufferGeometry {
  const g = geo.clone();
  g.applyMatrix4(
    new THREE.Matrix4().compose(
      new THREE.Vector3(pos[0], pos[1], pos[2]),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2])),
      new THREE.Vector3(scale[0], scale[1], scale[2])
    )
  );
  return g;
}

/**
 * 石狮（蹲坐姿，脚底 y=0，总高约 1.56，外部再乘 1.1 → 1.72）。
 * 结构：须弥座 → 后躯 → 前胸 → 前腿×2 → 爪×2 → 头 → 吻 → 鬃毛×8 → 耳×2 → 尾 → 绣球。
 * 全部用 Sphere/Box/Cylinder 原语拼，merge 成单网格 = 1 draw call。
 */
function makeLionGeometry(): THREE.BufferGeometry {
  const S = new THREE.SphereGeometry(0.5, 10, 8);
  const B = new THREE.BoxGeometry(1, 1, 1);
  const C = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
  const parts: THREE.BufferGeometry[] = [
    // 须弥座
    place(B, [0, 0.12, 0], [1.02, 0.24, 0.74]),
    place(B, [0, 0.29, 0], [0.86, 0.1, 0.62]),
    // 后躯 / 前胸
    place(S, [0, 0.74, -0.02], [0.66, 0.8, 0.62]),
    place(S, [0, 0.68, 0.16], [0.5, 0.52, 0.4]),
    // 前腿 + 爪（v2.3.0 加粗：首版太细，远看读作四条腿的凳子）
    place(C, [-0.22, 0.5, 0.25], [0.26, 0.54, 0.26]),
    place(C, [0.22, 0.5, 0.25], [0.26, 0.54, 0.26]),
    place(S, [-0.22, 0.16, 0.34], [0.3, 0.16, 0.36]),
    place(S, [0.22, 0.16, 0.34], [0.3, 0.16, 0.36]),
    // 头 / 吻 / 额（头放大到 0.66 宽，远看才认得出是兽首）
    // v2.3.0 二次修正：首版头是正圆 + 两只竖起的大圆耳 → 实景读作「米老鼠」。
    // 现在头压扁（0.70×0.56×0.60）、吻部前伸、额骨压低，耳改成贴头后侧的小扁片。
    place(S, [0, 1.3, 0.05], [0.7, 0.56, 0.6]),
    place(S, [0, 1.16, 0.32], [0.4, 0.26, 0.34]),
    place(B, [0, 1.44, 0.14], [0.44, 0.1, 0.22]),
    // 鬃毛：v2.3.0 二次修正——首版 9 颗 0.22 球绕成直径 0.9 的圈，把整个头包成一团「花椰菜」。
    // 现收敛到 7 颗 0.16 球、半径 0.32、更贴头后侧，读作「项圈鬃」而不是「球堆」。
    ...Array.from({ length: 7 }, (_, i) => {
      const a = Math.PI * (0.1 + (i / 6) * 0.8);
      return place(S, [Math.cos(a) * 0.32, 1.18 + Math.sin(a) * 0.3, -0.13], [0.16, 0.15, 0.15]);
    }),
    // 耳：贴头后侧的小扁片
    place(S, [-0.3, 1.44, -0.04], [0.15, 0.13, 0.1]),
    place(S, [0.3, 1.44, -0.04], [0.15, 0.13, 0.1]),
    // 背脊（三节，强化「蹲坐」而不是「堆叠」）
    place(S, [0, 1.02, -0.3], [0.3, 0.2, 0.26]),
    place(S, [0, 0.86, -0.42], [0.34, 0.22, 0.26]),
    // 尾
    place(S, [0, 0.95, -0.42], [0.18, 0.44, 0.18]),
    // 前爪之间的绣球
    place(S, [0, 0.34, 0.36], [0.24, 0.24, 0.24]),
  ];
  return mergeGeometries(parts, false)!;
}

/**
 * 抱鼓石门墩（脚底 y=0，总高约 1.09）。
 * 抱鼓石的关键识别特征是**正面一个圆鼓面**，所以鼓体用「轴沿 Z 的圆柱」，
 * 从相机（+Z 方向）看过去正好是个正圆，与参考图牌坊柱脚那块圆石一致。
 */
function makeDrumStoneGeometry(): THREE.BufferGeometry {
  const S = new THREE.SphereGeometry(0.5, 10, 8);
  const B = new THREE.BoxGeometry(1, 1, 1);
  const drum = new THREE.CylinderGeometry(0.31, 0.31, 0.17, 16);
  const boss = new THREE.CylinderGeometry(0.23, 0.23, 0.21, 16);
  const pin = new THREE.CylinderGeometry(0.06, 0.06, 0.25, 8);
  return mergeGeometries([
    place(B, [0, 0.08, 0], [0.6, 0.16, 0.68]),
    place(B, [0, 0.23, 0], [0.5, 0.14, 0.58]),
    place(drum, [0, 0.56, 0], [1, 1, 1], [Math.PI / 2, 0, 0]),
    place(boss, [0, 0.56, 0], [1, 1, 1], [Math.PI / 2, 0, 0]),
    place(pin, [0, 0.56, 0], [1, 1, 1], [Math.PI / 2, 0, 0]),
    place(S, [0, 0.92, 0.02], [0.3, 0.34, 0.26]),
  ], false)!;
}

/** 石材材质：冷灰，粗糙无金属；顶点色统一由材质色给出。 */
function stoneMat(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.93, metalness: 0 });
}

/** 把几何挂到 decorGroup 并登记状态（世界包围盒实测，用于锚点探针）。 */
function addMesh(
  arena: Arena,
  id: string,
  kind: StonePropState['kind'],
  geo: THREE.BufferGeometry,
  pos: [number, number, number],
  mat: THREE.Material,
  rotY = 0,
  scale = 1
): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(pos[0], pos[1], pos[2]);
  mesh.rotation.y = rotY;
  mesh.scale.setScalar(scale);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.stonePropId = id;
  arena.decorGroup.add(mesh);
  mesh.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(mesh);
  const s = b.getSize(new THREE.Vector3());
  states.push({
    id,
    kind,
    position: [
      +((b.min.x + b.max.x) / 2).toFixed(3),
      +b.min.y.toFixed(3),
      +((b.min.z + b.max.z) / 2).toFixed(3),
    ],
    size: [+s.x.toFixed(3), +s.y.toFixed(3), +s.z.toFixed(3)],
    // v2.4.5：暴露绕 y 的朝向，供「内八/外八」类摆放断言读取（Box3 只能反映旋转后的包围盒，看不出角度）
    rotation: [+mesh.rotation.x.toFixed(4), +mesh.rotation.y.toFixed(4), +mesh.rotation.z.toFixed(4)],
    tris: geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3,
  });
  return mesh;
}

/* ------------------------------------------------------------------ *
 * 经幡：PlaneGeometry 顶点正弦波动（顶部固定、底部摆幅最大）
 * ------------------------------------------------------------------ */

function makeBanner(
  arena: Arena,
  id: string,
  pos: [number, number, number],
  w: number,
  h: number,
  phase: number
): void {
  const segY = 8;
  // v2.3.0：x 方向分 6 段，供「竖向褶皱」用（首版只有 3 段，布面是平板一片）
  const geo = new THREE.PlaneGeometry(w, h, 6, segY);
  // 顶点按行权重：顶行为 0（钉在杆上）、底行为 1（摆幅最大）
  const base = Float32Array.from(geo.attributes.position.array as Float32Array);
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      color: 0x8e2620,
      roughness: 0.88,
      metalness: 0,
      side: THREE.DoubleSide,
    })
  );
  // 幡布竖直：默认 Plane 朝 +Z，直接立起来即可；顶边抬到 pos 的 y
  mesh.position.set(pos[0], pos[1] - h / 2, pos[2]);
  mesh.castShadow = false;
  mesh.userData.stonePropId = id;
  arena.decorGroup.add(mesh);
  bannerMeshes.push({ mesh, base, phase, amp: 0.055, h });
  // 先推占位再立即用实测世界包围盒覆盖，保证探针拿到的是真实数值
  const idx = states.push({
    id,
    kind: 'banner',
    position: [pos[0], pos[1] - h, pos[2]],
    size: [w, h, 0.01],
    tris: (geo.index ? geo.index.count : 0) / 3,
  }) - 1;
  mesh.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(mesh);
  const s = b.getSize(new THREE.Vector3());
  states[idx].position = [
    +((b.min.x + b.max.x) / 2).toFixed(3),
    +b.min.y.toFixed(3),
    +((b.min.z + b.max.z) / 2).toFixed(3),
  ];
  states[idx].size = [+s.x.toFixed(3), +s.y.toFixed(3), +s.z.toFixed(3)];
}

/* ------------------------------------------------------------------ *
 * 匾额：canvas 文字纹理（「山门」），深木底 + 金边 + 阴刻金字
 * ------------------------------------------------------------------ */

function makePlaque(arena: Arena, pos: [number, number, number]): void {
  const W = 512;
  const H = 168;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  // 底：深木
  g.fillStyle = '#2b1f16';
  g.fillRect(0, 0, W, H);
  // 木纹：确定性细横线（不用 Math.random，避免每次刷新不同）
  for (let i = 0; i < 26; i++) {
    const y = (i / 26) * H;
    g.fillStyle = i % 3 === 0 ? 'rgba(96,68,42,0.28)' : 'rgba(20,14,10,0.22)';
    g.fillRect(0, y, W, 1 + (i % 2));
  }
  // 金边（双线）
  g.strokeStyle = '#b08a4a';
  g.lineWidth = 10;
  g.strokeRect(5, 5, W - 10, H - 10);
  g.strokeStyle = 'rgba(176,138,74,0.55)';
  g.lineWidth = 3;
  g.strokeRect(20, 20, W - 40, H - 40);
  // 字：阴刻金字
  g.font = 'bold 104px "Noto Serif SC", "Songti SC", serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.fillText('山　门', W / 2 + 3, H / 2 + 4);
  g.fillStyle = '#d9b46a';
  g.fillText('山　门', W / 2, H / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;

  const faceMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.82, metalness: 0 });
  const sideMat = new THREE.MeshStandardMaterial({ color: 0x2b1f16, roughness: 0.9, metalness: 0 });
  // Box 材质顺序：+X, -X, +Y, -Y, +Z, -Z → 只有 +Z 面贴字
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1.9, 0.52, 0.1),
    [sideMat, sideMat, sideMat, sideMat, faceMat, sideMat]
  );
  mesh.position.set(pos[0], pos[1], pos[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.stonePropId = 'plaque';
  arena.decorGroup.add(mesh);
  mesh.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(mesh);
  const s = b.getSize(new THREE.Vector3());
  states.push({
    id: 'plaque',
    kind: 'plaque',
    position: [+((b.min.x + b.max.x) / 2).toFixed(3), +b.min.y.toFixed(3), +((b.min.z + b.max.z) / 2).toFixed(3)],
    size: [+s.x.toFixed(3), +s.y.toFixed(3), +s.z.toFixed(3)],
    tris: 12,
  });
}

/* ------------------------------------------------------------------ *
 * 挂载入口
 * ------------------------------------------------------------------ */

/** 参考图缺件与灯架的布置表（世界坐标，盒底 y）。 */
const SHUANGTING_PLACEMENTS = {
  /** 石狮：近景层两侧，站在石台基外侧、牌坊之前；z=-4.0 处相机可见半宽约 7.5，x=5.0 安全 */
  // v2.3.0 三次修正（每次都截图核过）：
  //  ① ±5.2 / z=-4.15 —— 被大鼓(±4.7,z=-2.05)挡掉大半身，只露上半身，读作「一团灰球」；
  //  ② ±3.3 / y=0.48 / z=-3.55（牌坊前石台基）—— 被牌坊立柱(±3.2,z=-1.85)整根挡住；
  //  ③ ±6.5 / z=-4.6 —— 超出战斗相机的实际取景范围（实战相机随角色偏移），左侧整只出画；
  //  ④ ±5.35 / z=-4.25 —— 实战相机随角色左右偏移，左侧整只仍会滑出画外；
  //  ⑤ 现位置 ±5.15 / z=-4.1：与鼓(±4.7,z=-2.05) 靠 z 错开 2.05，狮身半露在鼓外侧，
  //     该深度可见半宽约 7.5，屏幕位置约 169/911（1080 宽）→ 两侧都完整入画。
  // v2.4.2（摆位重排）：石狮原先贴在左右边缘（±5.15），屏幕上被大鼓挡掉 76~90%，
  // 且在鼓后露出半颗头，读作「从鼓后冒出的灰球」。现移到牌坊门洞两侧 ±1.55 / z=-3.0，
  // 回到「守门狮」的本位：被牌坊框住、不被鼓挡、正对观众。
  // v2.4.5：不再「同 z + 零角度」。守门狮必须对称（礼制），但真石狮一定微微内八、间距不绝对相等：
  // 左狮转向院内(+x)、右狮转向院内(−x)，z 错 0.06 —— 这是「石匠现场摆」的痕迹，
  // 而不是建模软件里镜像复制。角度只 ±0.10 rad（5.7°），远小于 AABB 视觉误差可察觉范围。
  lions: [
    { id: 'stone-lion-w', pos: [-1.55, 0, -3.02] as [number, number, number], rotY: 0.10 },
    { id: 'stone-lion-e', pos: [1.55, 0, -2.96] as [number, number, number], rotY: -0.10 },
  ],
  /** 抱鼓石：贴牌坊立柱脚（柱在 ±3.2，牌坊半宽 2.6），放在 ±2.55 正好夹住门洞 */
  // v2.4.5：抱鼓石是同批石料、同一石匠打的，允许 3° 的安装偏差与 0.04 的进深差。
  drumStones: [
    { id: 'drum-stone-w', pos: [-2.55, 0, -2.44] as [number, number, number], rotY: 0.05 },
    { id: 'drum-stone-e', pos: [2.55, 0, -2.39] as [number, number, number], rotY: -0.05 },
  ],
  /** 红幡：挂在左侧经幡柱（x=-4.05, z=-1.95，杆高 2.6）的右前方，两面不同高度 */
  // v2.3.0 首版三面幡全挤在 x≈-3.85 的一条竖线上，实景里叠成一整块红布（截图实测）。
  // 现改为「1 大 + 2 小」按 x 左右错开：大幡正对杆、中幡偏杆左、小幡偏杆右，
  // 顶边高度也拉开，读作经幡柱上挂的多面幡，而不是一块红墙。
  // v2.4.0：左缘密度疏解——撤掉最小的一面（原 banner-3），3→2 面。红色是高显著度色，
  // 减红比减灰石见效大；经幡柱这个视觉单元保留，不属删资产。
  // v2.4.2（摆位重排）：经幡柱由 -4.05/-1.95 外移到 -4.9/-1.3（让开收到角色身后的左鼓 -3.95/-1.35），
  // 两面幡随柱移动，仍保持「一左一右错开、不同高度」。
  banners: [
    // v2.4.2：幡内移到 -4.62/-4.78、略缩短（1.2 / 0.82），不再贴着画面左缘被裁，底部也不至于垂到地面。
    // v2.4.5：再内移 0.17，避开左缘裁切（相机可见半宽在 z≈-1.2 处只有约 5.1，幡右缘已贴线）。
    { id: 'banner-1', pos: [-4.45, 2.45, -1.22] as [number, number, number], w: 0.28, h: 1.2, phase: 0 },
    { id: 'banner-2', pos: [-4.6, 2.05, -1.18] as [number, number, number], w: 0.23, h: 0.82, phase: 1.9 },
  ],
  /** 匾额：牌坊上部正中，贴在牌坊正面（z=-2.1 是牌坊前表面，匾额再前移 0.04 避免 z-fighting） */
  plaque: [0, 3.4, -2.04] as [number, number, number],
  /** 灯架落地立柱：横杆收窄到 ±5.4 并在两端落地（原横杆 ±7.1 两端出画、整根悬空） */
  lampPosts: [-5.6, 5.6],
};

/**
 * 竹海古径（zhuhai）程序化补件表（v2.5.0 / Round 32）
 * 山门专属件（石狮 / 匾额）不摆——古径没有门楼，摆守门狮和匾额会自相矛盾；
 * 抱鼓石改为「径侧石墩」（±3.15 / z=-2.7），经幡与灯架保留（经幡柱在 specs 里，位置不变）。
 */
const ZHUHAI_PLACEMENTS = {
  lions: [] as { id: string; pos: [number, number, number]; rotY: number }[],
  drumStones: [
    { id: 'drum-stone-w', pos: [-3.15, 0, -2.72] as [number, number, number], rotY: 0.18 },
    { id: 'drum-stone-e', pos: [3.15, 0, -2.66] as [number, number, number], rotY: -0.22 },
  ],
  banners: [
    { id: 'banner-1', pos: [-4.45, 2.45, -1.22] as [number, number, number], w: 0.28, h: 1.2, phase: 0 },
    { id: 'banner-2', pos: [-4.6, 2.05, -1.18] as [number, number, number], w: 0.23, h: 0.82, phase: 1.9 },
  ],
  plaque: null as [number, number, number] | null,
  lampPosts: [-5.6, 5.6],
};

/** 当前场景的补件表（竹海没有门楼，故 plaque 为 null、lions 为空） */
const PLACEMENTS = SCENE_ID === 'zhuhai' ? ZHUHAI_PLACEMENTS : SHUANGTING_PLACEMENTS;

export function mountStoneProps(arena: Arena): void {
  states.length = 0;
  bannerMeshes.length = 0;

  // ① 石狮（石灰，v2.4.0 压暗到 0x5d6064 ≈ ×0.85，让后景石狮退到背景层）
  const lionGeo = makeLionGeometry();
  const lionMat = stoneMat(0x5d6064);
  for (const l of PLACEMENTS.lions) addMesh(arena, l.id, 'lion', lionGeo, l.pos, lionMat, l.rotY ?? 0, 1.05);

  // ② 抱鼓石门墩
  const drumGeo = makeDrumStoneGeometry();
  const drumMat = stoneMat(0x777a7e);
  for (const d of PLACEMENTS.drumStones) addMesh(arena, d.id, 'drum-stone', drumGeo, d.pos, drumMat, d.rotY ?? 0);

  // ③ 经幡
  for (const b of PLACEMENTS.banners) makeBanner(arena, b.id, b.pos, b.w, b.h, b.phase);

  // ④ 匾额（竹海无门楼，跳过）
  if (PLACEMENTS.plaque) makePlaque(arena, PLACEMENTS.plaque);

  // ⑤ 灯架落地立柱（横杆本体在 arena.buildArchitecture 里改宽度）
  // v2.3.0 首版立柱半径 0.075/0.095 + 0.3 宽顶帽，实景里读作「两根压过牌坊的粗黑柱」。
  // 现收细到 0.05/0.065、顶帽 0.18，颜色提亮一档，回到「灯架」而不是「承重柱」的存在感。
  const postGeo = new THREE.CylinderGeometry(0.05, 0.065, 3.82, 8);
  const capGeo = new THREE.BoxGeometry(0.18, 0.1, 0.18);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x4a3828, roughness: 0.88, metalness: 0 });
  const baseGeo = new THREE.CylinderGeometry(0.19, 0.23, 0.14, 8);
  const merged = mergeGeometries([
    place(baseGeo, [0, 0.07, 0], [1, 1, 1]),
    place(postGeo, [0, 1.91, 0], [1, 1, 1]),
    place(capGeo, [0, 3.86, 0], [1, 1, 1]),
  ], false)!;
  for (let i = 0; i < PLACEMENTS.lampPosts.length; i++) {
    addMesh(arena, `lamp-post-${i === 0 ? 'w' : 'e'}`, 'lamp-post', merged, [PLACEMENTS.lampPosts[i], 0, -1.95], postMat);
  }
}

/** 幡布波动：由 arena.update 每帧驱动（顶部固定、底部摆幅最大）。 */
export function updateStoneProps(elapsed: number): void {
  for (const b of bannerMeshes) {
    const pos = b.mesh.geometry.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < arr.length; i += 3) {
      const baseY = b.base[i + 1];
      // PlaneGeometry(w,h) 的局部 y ∈ [-h/2, +h/2]：顶边 t=0（钉在杆上不动），底边 t=1（摆幅最大）
      const t = Math.max(0, Math.min(1, 0.5 - baseY / b.h));
      const k = t * t;
      // 竖向褶皱：沿 x 的余弦起伏（不随时间变），让平面布有「被风吹起一条条棱」的体积感
      const fold = Math.cos(b.base[i] * 34 + b.phase) * b.amp * 0.9 * (0.35 + 0.65 * k);
      arr[i] = b.base[i] + Math.sin(elapsed * 2.1 + b.phase + baseY * 3.2) * b.amp * k;
      arr[i + 2] = fold + Math.sin(elapsed * 1.6 + b.phase + baseY * 2.2) * b.amp * 0.6 * k;
    }
    pos.needsUpdate = true;
    b.mesh.geometry.computeVertexNormals();
  }
}

/** 探针用：程序化补件的落地状态。 */
export function stonePropsDebug(): StonePropState[] {
  return states.map((s) => ({ ...s }));
}
