/**
 * Lux3D 写实 PBR 场景件接入（`public/models/scene/*.glb`）。
 *
 * 设计要点（与 `destruction.ts` 的契约强绑定）：
 * - 「常驻根节点 + 占位子节点 + GLB 子节点」三层：`props` 注册的是常驻 `group`，
 *   它继承原程序化物件的 position/scale/quaternion，因此 `destruction.ts:81` 的
 *   `baseScale = props.get(id).scale.x` 快照恒等改造前（灯笼 l.scale、其余 1）。
 * - `destruction.ts` 只写 `visible / scale / rotation.z`（Object3D 通用属性），
 *   作用于常驻根节点会自动下发到 GLB 子树：破坏隐藏、受损缩小抖动、reset 复原全部生效。
 *   判定 / 碎片数 / 回归数字完全不变。
 * - 占位盒与 GLB 盒都在「加入父节点之前」按局部坐标系测量，避免父级 l.scale 二次缩放。
 * - 灯笼目标盒只统计灯身主体：排除 `userData.glbKeep` 的吊杆与 Sprite 光晕，
 *   否则细长吊杆会把灯笼 GLB 拉高错位。光晕/吊杆在 GLB 就位后仍保留可见。
 * - 写实 PBR：GLB 原材质完整保留（GLTFLoader 产出 MeshStandardMaterial），不做 toonize。
 * - 加载失败 / 404 → 占位常显（原程序化几何），控制台留痕，游戏永不崩。
 * - 10 个实例共享 4 个模板：每模型只 parse 一次，`clone(true)` 共享 geometry/material。
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

const MODEL_DIR = 'models/scene/';
const v3 = (): THREE.Vector3 => new THREE.Vector3();

/**
 * 模型级朝向修正。Lux3D 写实模型一律「正面 +Z、X 宽 Z 薄」，
 * 而侧向墙板的 spec 曾是 X 薄 / Z 宽，需绕 Y 转 90° 才能让砖面朝 ±X。
 *
 * v2.2.0：`wall-panel-east` 已按参考图换皮成大鼓（模型改为 `temple-drum`），
 * 场景里**不再有任何 prop 使用 `wall-panel` 模型**，本条目因此不再命中。
 * 保留映射是为了「将来若真做侧向隔断墙」时不至于朝向错 90°，不改变现有行为。
 */
const MODEL_ROTATE_Y: Record<string, number> = {
  'wall-panel': Math.PI / 2,
};

/** 场景件 GLB 的 URL（与 glbRig.ts 一致，用 document.baseURI 解析，兼容 base './'）。 */
export function sceneModelUrl(model: string): string {
  return new URL(MODEL_DIR + model + '.glb', document.baseURI).href;
}

/** 4 个模型的加载模板缓存。 */
const templates = new Map<string, Promise<THREE.Object3D>>();
export function template(model: string): Promise<THREE.Object3D> {
  let p = templates.get(model);
  if (!p) {
    p = new Promise<THREE.Object3D>((resolve, reject) => {
      new GLTFLoader().load(
        sceneModelUrl(model),
        (gltf: GLTF) => resolve(gltf.scene),
        undefined,
        reject
      );
    });
    templates.set(model, p);
  }
  return p;
}

export interface GLBPropDebug {
  id: string;
  model: string;
  loaded: boolean;
  fallbackVisible: boolean;
  baseScale: number;
  targetSize: [number, number, number];
  glbChildren: number;
  /** v2.4.6：显示层绕 Y 轴旋转（弧度），0 表示模型默认朝向 */
  displayRotY: number;
}

/** 全部已注册的场景件（供 `__WS.glbProps()` 探针与总回退开关使用）。 */
export const GLB_PROPS = new Map<string, GLBProp>();

export class GLBProp {
  readonly group = new THREE.Group();
  loaded = false;
  fallbackVisible = true;
  private readonly ph: THREE.Object3D;
  private readonly tb: THREE.Box3;
  private glbRoot: THREE.Object3D | null = null;

  constructor(
    readonly id: string,
    readonly model: string,
    ph: THREE.Object3D,
    /** v2.4.3：可选统一染色。用于让同一 GLB 在不同位置读作不同材质
     * （例：`pillar` 是深棕木柱，`pillar-*` 要贴灰石牌坊当石柱）。
     * 只作用于 GLB 子树、且克隆材质，不影响同模型的其它实例。 */
    private readonly tint?: number,
    /** v2.4.6：显示层绕 Y 轴旋转（弧度）。与 MODEL_ROTATE_Y 的区别：
     * MODEL_ROTATE_Y 在「测量包围盒之前」施加，会改变 bs 从而触发逐轴重新拉伸；
     * displayRotY 在「缩放/位移全部算完之后」才叠加到 inner，只改朝向、不改尺寸与命中盒。
     * 用途：鼓身+木架一体网格，须在缩放固定后整体转 90° 才能侧放而不变形。 */
    private readonly displayRotY?: number
  ) {
    this.ph = ph;

    // ① 常驻根节点继承原物件变换 → baseScale 快照不变
    this.group.position.copy(ph.position);
    this.group.scale.copy(ph.scale);
    this.group.quaternion.copy(ph.quaternion);
    this.group.userData.destroyableId = id;

    // ② 摘下父节点并归零，用「局部坐标系」测占位盒（父级 scale 尚未作用）
    ph.parent?.remove(ph);
    ph.position.set(0, 0, 0);
    ph.scale.setScalar(1);
    ph.quaternion.identity();
    ph.updateMatrixWorld(true);

    // 只统计主体 Mesh：排除 glbKeep（吊杆）与 Sprite（光晕）
    this.tb = new THREE.Box3();
    ph.traverse((o) => {
      if (o instanceof THREE.Mesh && !o.userData.glbKeep) {
        this.tb.union(new THREE.Box3().setFromObject(o));
      }
    });
    if (this.tb.isEmpty()) this.tb = new THREE.Box3().setFromObject(ph);

    this.group.add(ph);
    GLB_PROPS.set(id, this);

    template(model)
      .then((tpl) => this.onLoaded(tpl))
      .catch((err: unknown) => {
        console.warn(`[glbProp] ${model} 加载失败，保留程序化占位：`, err);
      });
  }

  private onLoaded(tpl: THREE.Object3D): void {
    // 两层容器：inner 只做朝向旋转，root 只做逐轴缩放 + 位移。
    // 若旋转与缩放放同一节点，Three.js 的 scale→rotation 顺序会让 X/Z 缩放互换（墙板会错位）。
    const inner = new THREE.Group();
    inner.add(tpl.clone(true));
    const rotY = MODEL_ROTATE_Y[this.model];
    if (rotY) inner.rotation.y = rotY;
    const root = new THREE.Group();
    root.add(inner);
    root.updateMatrixWorld(true);
    // 此时 root 为单位变换，b 是「旋转后、缩放前」的盒，bs 反映真实朝向
    const b = new THREE.Box3().setFromObject(root);

    const ts = this.tb.getSize(v3());
    const tc = this.tb.getCenter(v3());
    const bs = b.getSize(v3());
    const bc = b.getCenter(v3());
    // 逐轴对齐到占位盒：Lux3D 模型的长宽比常与 spec 不符（立柱偏矮胖、墙板朝向差 90°），
    // 等比缩放会让立柱只剩 1.45 高、墙板只剩 0.52 高。逐轴拉伸后世界包围盒与 spec 完全一致，
    // 命中窗口 / 碎片散布零偏差；轻微形变换取尺寸与玩法对齐。
    const sx = ts.x / Math.max(1e-4, bs.x);
    const sy = ts.y / Math.max(1e-4, bs.y);
    const sz = ts.z / Math.max(1e-4, bs.z);
    root.scale.set(sx, sy, sz);
    // 逐轴缩放后 GLB 盒尺寸对齐 ts；x/z 仍按盒中心对齐占位盒中心（bc 已含旋转）。
    // y 按「占位盒自身盒底」对齐：root 局部下 GLB 盒底 = (bc.y - bs.y/2)*sy，经常驻 group
    // 的世界变换 (Y + g*local) 后得到目标世界盒底 = Y + g*(tc.y - ts.y/2)。
    // 旧写法 tc.y - bc.y*sy 把「盒中心」钉在锚点：调用方以「盒底 y=0」放置占位盒时，
    // GLB 盒中心落在 0、盒底沉到 -h/2，整族可破坏件离地 h/2~h（即 2.5~8m）。
    // 统一 anchor：目标世界盒底 = 占位盒世界盒底，不做 max(0,…) 截断。
    // 可破坏件 / 悬挂灯笼的占位盒底本就 ≥0（调用方用 y+h/2 摆好），截断与否恒等；
    // 但风景天幕 SCENERY.y 是「盒中心」，盒底本就为负（半埋地下做剪影带）——
    // 截断会把整族风景抬高 0.9~2.2m，破坏投影标定的 y∈[0,4.5] 可见带（v2.1.0 审查回归修正）。
    const Y = this.group.position.y;
    const g = this.group.scale.y || 1;
    const targetBottom = Y + g * (tc.y - ts.y / 2);
    root.position.set(
      tc.x - bc.x * sx,
      (targetBottom - Y) / g - (bc.y - bs.y / 2) * sy,
      tc.z - bc.z * sz
    );
    root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
    if (this.tint !== undefined) this.applyTint(root);
    // v2.4.6：显示层旋转放在包围盒测量 + 逐轴缩放 + 位移全部算完之后，
    // 只叠加在 inner 的朝向上，不再触发尺寸重算 —— 鼓侧转 90° 后木架仍立、鼓身不变形。
    if (this.displayRotY) inner.rotation.y += this.displayRotY;

    // 只隐藏主体占位，保留光晕 Sprite 与 glbKeep 吊杆
    this.ph.traverse((o) => {
      if (o instanceof THREE.Mesh && !o.userData.glbKeep) o.visible = false;
    });
    this.fallbackVisible = false;
    this.glbRoot = root;
    this.group.add(root);
    this.loaded = true;
  }

  /** v2.4.3：把 GLB 子树整体换成单一石料材质。
   * 不能用「原材质 × 颜色」——`pillar.glb` 带深棕木纹贴图，乘青灰后塌成近纯黑（实测 #020608，
   * 牌坊石柱 #5c656c），在夜景里读作一个黑洞，比原木柱更突兀。
   * 故直接替换材质：丢弃木纹贴图，只保留纯色 + 粗糙度，与程序化石件同族。 */
  private applyTint(root: THREE.Object3D): void {
    const hex = this.tint;
    if (hex === undefined) return;
    const mat = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.92, metalness: 0 });
    root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.material = mat;
    });
  }

  debug(): GLBPropDebug {
    const s = this.tb.getSize(v3());
    return {
      id: this.id,
      model: this.model,
      loaded: this.loaded,
      fallbackVisible: this.fallbackVisible,
      baseScale: this.group.scale.x,
      targetSize: [s.x, s.y, s.z],
      glbChildren: this.glbRoot ? this.glbRoot.children.length : 0,
      displayRotY: this.displayRotY ?? 0,
    };
  }
}

/** 把程序化物件包装成 GLB 驱动的可破坏物件，返回注册进 `arena.props` 的常驻根节点。
 * `tint` 可选：把 GLB 子树统一染色（见 `GLBProp.applyTint`）。 */
export function wrapGLBProp(
  id: string,
  model: string,
  ph: THREE.Object3D,
  tint?: number,
  displayRotY?: number
): THREE.Object3D {
  return new GLBProp(id, model, ph, tint, displayRotY).group;
}

/** 探针用：全部场景件的加载状态。 */
export function glbPropsDebug(): GLBPropDebug[] {
  return [...GLB_PROPS.values()].map((p) => p.debug());
}

/** 预热用：v2.0.7 保留的场景件模型。
 * v2.3.0：移除 `wall-panel`（3.6MB）。该模型自 v2.2.0 起已无任何 prop 消费者
 * （`wall-panel-east` 换皮成 `temple-drum`），继续预热只是白付一次 3.6MB 请求。
 * 文件保留在 `public/models/scene/` 下不删（回滚时需要），只是不再预加载。 */
export const SCENE_MODELS = ['lantern', 'lantern-hex', 'pillar'] as const;

/** v2.0.8 新增：6 件纯装饰（只挂 decorGroup，不进 props/specs/破坏链，供 stageDecor.ts / 预热用）。 */
export const DECOR_MODELS = [
  'gate-stone',
  'stone-steps',
  'bamboo',
  'eave-tile',
  'stone-lamp-tall',
  'water-vat',
] as const;

/** v2.0.8 新增：6 件可破坏（注册进 props/specs，供 buildDecorDestroyables / 预热用）。 */
export const DECOR_DESTROY_MODELS = [
  'incense-burner',
  'temple-drum',
  'stone-lantern',
  'gate-pier',
  'hitching-post',
  'sutra-pole',
] as const;

/** 预热总表 = 原 4 + 可破坏 6 + 纯装饰 6 = 16 件。 */
export const ALL_SCENE_MODELS = [...SCENE_MODELS, ...DECOR_DESTROY_MODELS, ...DECOR_MODELS] as const;

/** v2.0.9 新增：风景天幕 6 件（三层雪岭 / 远景殿宇 / 石台基 / 竹林天幕）。
 * 月亮因文生3D 返回尺度荒谬，改代码发光圆盘实现，不在此列。单独成表以免扰动 16 件预热/探针断言。 */
export const SCENERY_MODELS = [
  'mountain-far', 'mountain-mid', 'mountain-near', 'temple-hall', 'stone-terrace', 'bamboo-grove',
] as const;
