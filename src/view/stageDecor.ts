/**
 * v2.0.8 纯装饰场景件挂载（6 个模型 / 9 处摆放）。
 *
 * 与破坏链隔离：这些件只挂在 `arena.decorGroup`，绝不进 `arena.props` / `arena.specs`，
 * 因此 `destruction.ts` 不会把它们纳入判定、碎片或回归数字。
 * 用 `template()` 共享 GLB 模板（同模型只 parse 一次），逐轴包围盒对齐到目标尺寸并接地。
 * 单件 404 / 空模型 → 静默跳过并 warn，不崩、不影响对局。
 * `import type { Arena }` 避免 arena.ts → stageDecor.ts 的运行时循环依赖。
 */

import * as THREE from 'three';
import { template, DECOR_MODELS } from './glbProps';
import type { Arena } from './arena';
import { SCENE_ID } from '../scene/sceneData';

interface DecorPlacement {
  /** 模型 id（= public/models/scene/<id>.glb） */
  id: string;
  /** 摆放锚点：盒底中心世界坐标 [x, y, z] */
  position: [number, number, number];
  /** 目标包围盒尺寸 [w, h, d] */
  size: [number, number, number];
  /** 可选绕 Y 朝向（弧度） */
  rotY?: number;
}

/** 纯装饰的坐标 / 朝向 / 目标尺寸（权威源不收录，直接写在代码里）。 */
// v2.0.9.1 按概念图重排：牌坊居中镇场、台阶垫正前、瓦檐贴门楼、竹丛退两翼远景、石灯成对、水缸缩居殿旁角落。
// v2.2.0（P0-4）：配合 10 件可破坏物「左右镜像配对」后的新占位，补齐参考图里缺的近景设施。
//   可破坏件现占（前排 z∈[-2.0,-1.85]，全部落在命中容差 zTol=2.1 内、实战可打碎）：
//     立柱 ±3.2 / 门墩 -4.0 / 石灯 +4.0 / 经幡柱 -5.0 / 拴马柱 +5.0 / 大鼓 ±6.0。
//   装饰池在 |x|=5.15、z=-2.7 的**后排**补「石灯 + 门墩」各一件，x 完全镜像：
//     西 -5.15 石灯 / 东 +5.15 门墩。后排与杆(z-1.95)、鼓(z-2.0) 靠 z 错开，x 不抢位。
//   全部 z≤-2.7 或 z=-1.85，不进 coreArea 净空（z∈[-1.35,2.4]）、不挡角色（fightBounds ±5.6）。
//   水缸退到 8.4（大鼓之外）：参考图无水缸，但 DECOR_MODELS 断言要求 6 件全部 loaded，故只挪不删。
const SHUANGTING_PLACEMENTS: DecorPlacement[] = [
  // 牌坊组（中轴，概念图正面视图）：牌坊镇场放大保持居中；台阶退到牌坊门洞下、后沿搭住
  // stone-terrace 台基（z=-3.8），前沿 z=-2.35 连台基、不插战斗平面(z≈0)。
  // v2.4.9：香炉已移到战斗层 z=0（中轴可破坏物），台阶前沿 z=-2.35 与香炉拉开，不再贴脸。
  { id: 'gate-stone', position: [0, 0, -2.6], size: [5.2, 4.2, 1.0] },
  { id: 'stone-steps', position: [0, 0, -2.75], size: [3.4, 0.35, 0.8] },
  // 瓦檐贴到牌坊顶部两侧作门楼翼檐（不再悬空半空）
  { id: 'eave-tile', position: [-2.4, 3.55, -2.6], size: [2.4, 0.3, 1.0] },
  { id: 'eave-tile', position: [2.4, 3.55, -2.6], size: [2.4, 0.3, 1.0] },
  // 竹丛退到两翼远景（战斗平面 z∈[-3.5,3.5]、角色 x∈[-5.6,5.6]，竹不得侵入）
  // v2.3.0：竹丛原 1.2×2.2 太高大、颜色偏亮黄绿，在冷蓝夜色里抢过牌坊。收到 1.0×1.9 并外移到 ±7.8。
  // v2.4.2（摆位重排）：竹从 ±7.0/-2.85 再退到 ±6.8/-3.4，让整丛落在取景内。
  // v2.4.5：两侧不再「同尺寸 + 同 z + 反向等角」——那是最显眼的镜像痕迹。
  // 左丛更高更靠后、右丛矮一档并前移，角度也不同（±0.3 与 −0.13 不是反号关系）。
  { id: 'bamboo', position: [-6.9, 0, -3.55], size: [1.0, 1.85, 0.9], rotY: 0.31 },
  { id: 'bamboo', position: [6.62, 0, -3.18], size: [0.86, 1.62, 0.82], rotY: -0.13 },
  // v2.4.10（遗留项·石灯造型）：台阶左右原本是「左 2.2m 蓝顶柱灯（装饰）/ 右 1.1m 灰石塔灯（可破坏）」，
  // 两种器型 + 高度 2:1 并排，被读成「没配成对」。改法：
  //   ① 台阶两侧统一为**同一器型** stone-lantern（右侧可破坏件本来就是它），左装饰件同步换用；
  //      高度取 1.12（右件 1.10），只留 1cm 差与反向小角度，避免呆板镜像。
  //   ② 2.2m 柱灯不删（DECOR_MODELS 断言要求 loaded），改放左缘院角 -6.6/-3.2，读作「补左侧没有灯柱的暗角」；
  //      右侧院角本来就有灯架立柱(+5.6)与水缸，不再重复一件 2m 柱灯（该 GLB 单件 ≈8.7 万三角，避免翻倍）。
  { id: 'stone-lantern', position: [-2.15, 0, -1.7], size: [0.52, 1.12, 0.52], rotY: -0.12 },
  { id: 'stone-lamp-tall', position: [-6.6, 0, -3.2], size: [0.7, 2.05, 0.7], rotY: 0.24 },
  // v2.4.2：右装饰鼎由 5.05/-3.6 移到香炉右侧 +1.55/-2.4，与可破坏鼎配成「香炉配双鼎」。
  // v2.4.5：z 退后 0.06、微转 0.22 rad，避免与可破坏鼎读作「一对复制的摆件」。
  { id: 'gate-pier', position: [1.62, 0, -2.34], size: [0.6, 0.7, 0.5], rotY: 0.22 },
  // v2.3.0：水缸原在 x=8.4，而 z=-2.9 处相机可见半宽只有约 6.8 —— 整件长期出画（等于白加载）。
  // v2.4.0：救回时放到左 −6.55，造成左缘 8 件 / 右缘 5 件的密度失衡（Round 14 归因）。
  // v2.4.2：搬到右侧 +6.85 / z=-4.65（外带）。
  // v2.4.5：+6.85/−4.65 是"场地中央隔 6.8m 孤零零一个缸"，读作被遗弃的物件。
  // 收到牌坊次间外侧 +5.35 / z=-2.95，贴住建筑边缘（有依附关系），并转 0.26 rad 让缸口略朝内院。
  // v2.4.5 修正：首版放到 +5.35 后与拴马桩(+4.75,z=-1.55) 屏幕重叠，缸被拴马桩整根插穿（截图实测）。
  // 再外移到 +5.95 / z=-3.4，落在落地灯柱(+5.6) 的右后方，读作「灯柱旁存水的缸」。
  { id: 'water-vat', position: [5.95, 0, -3.4], size: [0.7, 0.65, 0.7], rotY: 0.26 },
];

/**
 * 竹海古径（zhuhai）装饰摆位（v2.5.0 / Round 32）
 *
 * 与霜庭的差别只在中景—后景：不摆山门牌坊，改为「石阶古径 + 密竹夹道 + 径尽头残门」。
 * 战斗层（arena / colliders / keyDestroyables）与霜庭完全一致，所以：
 *   - 台阶沿中轴向 z 后退三级（-2.6 / -3.35 / -4.1），读作「从场地往里走上山」；
 *   - 残门退到 z=-6.4，靠雾压成剪影，只留一层门形轮廓（不是第二座牌坊）；
 *   - 两侧竹 8 丛、由近及远三层，尺寸/角度互不相同，避免镜像复制感；
 *   - 石灯柱仍成对（±2.5/-2.5），左缘留一件 2m 柱灯作暗角照明。
 * `DECOR_MODELS` 断言要求的 6 件（gate-stone / stone-steps / bamboo / eave-tile /
 * stone-lamp-tall / water-vat）全部有落点，loaded 基线可继续成立。
 */
const ZHUHAI_PLACEMENTS: DecorPlacement[] = [
  // 残门：缩到 4.4×3.4，退到 z=-6.4；雾下只剩轮廓
  { id: 'gate-stone', position: [0, 0, -6.4], size: [4.4, 3.4, 0.9], rotY: 0.04 },
  // 三级石阶：沿中轴后退，尺寸递减，读作上坡
  { id: 'stone-steps', position: [0, 0, -2.6], size: [3.6, 0.35, 0.8] },
  { id: 'stone-steps', position: [0, 0.28, -3.35], size: [3.2, 0.35, 0.8] },
  { id: 'stone-steps', position: [0, 0.56, -4.1], size: [2.8, 0.35, 0.8] },
  // 残门瓦檐：只留一侧断檐（另一侧缺失 = 荒废感，不做镜像）
  { id: 'eave-tile', position: [-2.0, 3.05, -6.4], size: [2.2, 0.3, 0.95] },
  // 夹道竹（近景细株）：只留两株贴住画缘，提供"竿 + 叶"的近处尺度参照。
  // bamboo.glb 单株 ≈15.0 万三角，密摆 8 株要多付 90 万三角（实测 304 万），故近景只留 2 株；
  // "竹海"的体量交给 bamboo-grove（整丛 ≈3.7 万三角，单位面积成本只有 bamboo 的 1/4）。
  { id: 'bamboo', position: [-6.35, 0, -2.45], size: [1.1, 2.45, 0.95], rotY: 0.42 },
  { id: 'bamboo', position: [6.45, 0, -2.35], size: [1.02, 2.28, 0.9], rotY: -0.36 },
  // 竹丛墙：中景左右各三层，不等距、不镜像（-8.4/-5.6 与 +8.2/-5.9 …），把古径夹成一条走廊。
  // 尺寸只取模型自然比例的"段"（宽>高>深），避免拉成绿墙贴片。
  { id: 'bamboo-grove', position: [-8.45, 0, -5.55], size: [3.6, 4.5, 2.4], rotY: 0.12 },
  { id: 'bamboo-grove', position: [-7.0, 0, -7.7], size: [3.0, 4.1, 2.2], rotY: -0.28 },
  { id: 'bamboo-grove', position: [-9.35, 0, -3.55], size: [3.2, 4.2, 2.3], rotY: 0.55 },
  { id: 'bamboo-grove', position: [8.25, 0, -5.85], size: [3.7, 4.6, 2.5], rotY: -0.15 },
  { id: 'bamboo-grove', position: [6.85, 0, -7.9], size: [3.1, 4.15, 2.2], rotY: 0.34 },
  { id: 'bamboo-grove', position: [9.2, 0, -3.35], size: [3.15, 4.05, 2.25], rotY: -0.62 },
  // 径尾远景两丛：填住山门两侧的纯黑空档，让竹林读作"继续绕到山门之后"
  { id: 'bamboo-grove', position: [-4.8, 0, -9.6], size: [2.8, 3.8, 2.0], rotY: 0.18 },
  { id: 'bamboo-grove', position: [4.75, 0, -9.9], size: [2.7, 3.7, 2.0], rotY: -0.4 },
  // 石灯：径口成对（右侧 +2.5 处是同一件装饰，可破坏石灯在 specs 的 +2.15/-1.7）
  { id: 'stone-lantern', position: [-2.5, 0, -2.5], size: [0.52, 1.16, 0.52], rotY: 0.14 },
  { id: 'stone-lamp-tall', position: [-6.6, 0, -3.4], size: [0.7, 2.05, 0.7], rotY: 0.3 },
  // 水缸：径侧存水，贴着竹根
  { id: 'water-vat', position: [-4.9, 0, -3.1], size: [0.7, 0.65, 0.7], rotY: -0.3 },
];

/** 当前场景的装饰摆位表 */
const DECOR_PLACEMENTS: DecorPlacement[] =
  SCENE_ID === 'zhuhai' ? ZHUHAI_PLACEMENTS : SHUANGTING_PLACEMENTS;

interface DecorRecord {
  id: string;
  root: THREE.Group | null;
  loaded: boolean;
}

const records: DecorRecord[] = [];
let arenaRef: Arena | null = null;

/** 把 GLB 模板逐轴缩放到目标盒尺寸，并让盒底落在锚点 y、盒中心落在 x/z。 */
function buildRoot(tpl: THREE.Object3D, p: DecorPlacement): THREE.Group | null {
  const inner = new THREE.Group();
  inner.add(tpl.clone(true));
  if (p.rotY) inner.rotation.y = p.rotY;
  inner.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(inner);
  if (b.isEmpty()) {
    console.warn(`[stageDecor] ${p.id} GLB 无可用包围盒，跳过`);
    return null;
  }
  const bs = b.getSize(new THREE.Vector3());
  const bc = b.getCenter(new THREE.Vector3());
  const [w, h, d] = p.size;
  const sx = w / Math.max(1e-4, bs.x);
  const sy = h / Math.max(1e-4, bs.y);
  const sz = d / Math.max(1e-4, bs.z);

  const root = new THREE.Group();
  root.add(inner);
  root.scale.set(sx, sy, sz);
  // 缩放后盒底 = (bc.y - bs.y/2)*sy，令其等于锚点 y；水平中心对齐 x/z。
  root.position.set(
    p.position[0] - bc.x * sx,
    p.position[1] - (bc.y - bs.y / 2) * sy,
    p.position[2] - bc.z * sz
  );
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });
  root.userData.decorId = p.id;
  return root;
}

/** 近景竹丛冷色化：GLB 原材质是亮黄绿，在冷蓝夜色里像「白天拍的竹子」，与远景雪岭/月光不搭。
 *  `tpl.clone(true)` 共享材质实例，对任一实例改色即全实例生效（bamboo 仅 2 个装饰实例，符合预期）。 */
function tintCold(root: THREE.Object3D, hex: number): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const mm = m as THREE.MeshStandardMaterial;
      if (mm && mm.color) mm.color.set(hex);
    }
  });
}

/** 后景压暗：保留原色相，只把明度乘 factor，让后排件退到背景层（v2.4.0 左缘密度疏解）。 */
function dim(root: THREE.Object3D, factor: number): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const mm = m as THREE.MeshStandardMaterial;
      if (mm && mm.color) mm.color.multiplyScalar(factor);
    }
  });
}

/** 深拷贝材质：bamboo-grove 的模板同时被 stageScenery 用作远景竹林并统一染 0x2f3e34，
 *  而 `tpl.clone(true)` 共享材质实例 —— 直接改色会连带把远景竹墙也改成近景色。
 *  近景竹丛先克隆出独立材质再染，两个用途互不影响。 */
function cloneMaterials(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map((m) => m.clone())
      : mesh.material.clone();
  });
}

export function mountStageDecor(arena: Arena): void {
  arenaRef = arena;
  records.length = 0;
  for (const p of DECOR_PLACEMENTS) {
    const rec: DecorRecord = { id: p.id, root: null, loaded: false };
    records.push(rec);
    template(p.id)
      .then((tpl) => {
        const root = buildRoot(tpl, p);
        if (!root) return;
        if (p.id === 'bamboo') {
          // 竹海：竹是主体，压暗少一点，让夹道读得出层次而不是一团黑
          tintCold(root, SCENE_ID === 'zhuhai' ? 0x46614c : 0x33483c);
          dim(root, SCENE_ID === 'zhuhai' ? 1.0 : 0.88);
          if (SCENE_ID === 'zhuhai') {
            // 画缘那两株正好逆光（主光在左前上），纯漫反射会读成枯枝剪影；
            // 给一点青绿自发光当"月光透叶"，保住近景竹的辨识度。
            root.traverse((o) => {
              const mesh = o as THREE.Mesh;
              if (!mesh.isMesh) return;
              const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
              for (const m of mats) {
                const mm = m as THREE.MeshStandardMaterial;
                if (mm.emissive) {
                  mm.emissive.set(0x243d2a);
                  mm.emissiveIntensity = 0.55;
                }
              }
            });
          }
        } else if (p.id === 'bamboo-grove') {
          // 近景整丛竹：克隆材质后乘青绿色；亮度略高于远景竹墙，拉开"近-中-远"三层
          cloneMaterials(root);
          tintCold(root, 0x5d7a5a);
          dim(root, 0.95);
        } else if (SCENE_ID === 'zhuhai' && p.id === 'gate-stone') {
          // 山门退到雾里：压暗一档，不与前景石板/石阶抢亮度，读作"径尽头的一道门"
          dim(root, 0.86);
        } else if (p.id === 'stone-lamp-tall' || p.id === 'water-vat') {
          // v2.4.0：后景第二层件统一压暗到 0.85，降低左右缘背景层的视觉重量
          dim(root, SCENE_ID === 'zhuhai' ? 0.92 : 0.85);
        }
        arena.decorGroup.add(root);
        rec.root = root;
        rec.loaded = true;
      })
      .catch((err: unknown) => {
        console.warn(`[stageDecor] ${p.id} GLB 加载失败，静默跳过：`, err);
      });
  }
}

export interface StageDecorState {
  id: string;
  loaded: boolean;
  inProps: boolean;
  group: boolean;
}

/** 探针用：6 件纯装饰的挂载状态（inProps 恒 false、group 挂载成功恒 true）。 */
export function stageDecorDebug(): StageDecorState[] {
  const arena = arenaRef;
  return DECOR_MODELS.map((id) => {
    const own = records.filter((r) => r.id === id);
    return {
      id,
      loaded: own.some((r) => r.loaded),
      inProps: arena ? arena.props.has(id) : false,
      group: !!arena && own.some((r) => r.root !== null && r.root.parent === arena.decorGroup),
    };
  });
}
