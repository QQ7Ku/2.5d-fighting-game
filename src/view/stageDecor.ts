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
const DECOR_PLACEMENTS: DecorPlacement[] = [
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
  // v2.4.2（摆位重排）：左石灯由 -5.95/-3.15 移到台阶左前方 -2.75/-1.7，读作「照台阶的门前灯」；
  // 原先贴在鼓背后，屏幕被鼓挡掉 88%，等于看不见。
  // v2.4.5：加 0.18 rad 的歪斜——门前的灯被风/人撞过，轴对齐是「没摆过」的痕迹。
  { id: 'stone-lamp-tall', position: [-2.15, 0, -1.7], size: [0.7, 2.2, 0.7], rotY: 0.18 },
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
          tintCold(root, 0x33483c);
          dim(root, 0.88);
        } else if (p.id === 'stone-lamp-tall' || p.id === 'water-vat') {
          // v2.4.0：后景第二层件统一压暗到 0.85，降低左右缘背景层的视觉重量
          dim(root, 0.85);
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
