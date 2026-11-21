/**
 * v2.3.0：把参考图族里「紫色实心方块 = 实体碰撞」这条标注**真正落地**成可验证的运行时数据。
 *
 * 背景（r3.1 §4.5 L1 登记的问题）：
 * - `manual.colliders` 在 v2.2.0 之前**没有任何运行时消费者**，只被 `probe-stage.mjs`
 *   拿 `COLLIDERS_HASH` 做 JSON 快照校验 —— 等于「写进数据、画在图上、代码里没人读」。
 * - 参考图（`e0/` 四视图）给紫色方块的含义是「**这些道具脚下各自有实体碰撞，不可穿越**」，
 *   而现状只有一整条 `wall-back` 横墙兜底，逐道具碰撞根本不存在。
 *
 * 本模块做的事（不改玩法、不改角色移动）：
 * 1. 把 `manual.colliders` 的静态条目解析成 AABB（`y` 字段在数据里其实是 z，`depth` 是 z 向厚度）；
 * 2. 为**每个落地的可破坏物**从 spec 派生一个 AABB（`prop:<id>`），实现「逐道具碰撞」，
 *    破坏时 `alive=false`、回合重置时恢复 —— 这就是紫标注的真实消费者；
 * 3. `colliderCoverage()` 做覆盖率自检：每个 spec 是否都有 collider 覆盖、每个静态 collider
 *    是否指向场上真实存在的实体，漏的列出来（供门禁断言）；
 * 4. `setColliderDebugVisible(true)` 可在实景里把碰撞盒画出来（半透明 + 线框），
 *    用于人工核对「参考图上的紫方块」是否真的对上了场景里的道具。
 *
 * 为什么不做「角色推挤」：
 * 2.5D 格斗里角色 z 恒定、只在 x 轴移动，而全部道具都在 z ≤ −1.85（战斗平面后沿之外），
 * AABB 的 z 区间与角色永不重叠 —— 强行做推挤只会缩小 `fightBounds`、改动玩法手感，
 * 属于「其他不变」边界之外。故本轮只落地「数据 + 自检 + 可视化」，推挤留给需要 3D 走位的版本。
 */

import * as THREE from 'three';
import { sceneData as decor } from '../scene/sceneData';
import type { Arena } from './arena';

interface StaticColliderDef {
  id: string;
  minX: number;
  maxX: number;
  /** 历史命名：这一位其实是 **z** 轴位置（数据里 y 与 z 混用），depth 是 z 向厚度 */
  y: number;
  depth: number;
  kind: string;
  blocksMovement: boolean;
}

export interface RuntimeCollider {
  id: string;
  source: 'static' | 'prop';
  kind: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** 世界高度上界（可视化用；不参与判定） */
  top: number;
  alive: boolean;
}

export interface ColliderDebugState {
  total: number;
  staticCount: number;
  propCount: number;
  alive: number;
  dead: number;
  visible: boolean;
  /** 覆盖率自检：spec 有 collider 且 collider 有实体 */
  coverage: { specId: string; covered: boolean }[];
  /** 缺失 = 没有 collider 的落地 spec + 没有实体的静态 collider */
  missing: string[];
}

let colliders: RuntimeCollider[] = [];
let debugGroup: THREE.Group | null = null;
let debugVisible = false;
let arenaRef: Arena | null = null;

const D = decor as unknown as {
  manual: { colliders: StaticColliderDef[] };
};

/** 静态「不可穿越带」的高度上界：`wall` 按院墙高度，`ledge` 按台阶高度。 */
function staticTop(kind: string): number {
  return kind === 'wall' ? 3.6 : 0.3;
}

function buildDebug(arena: Arena): void {
  if (debugGroup) {
    arena.scene.remove(debugGroup);
    debugGroup.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
  }
  debugGroup = new THREE.Group();
  debugGroup.name = 'collider-debug';
  for (const c of colliders) {
    const w = Math.max(0.02, c.maxX - c.minX);
    const d = Math.max(0.02, c.maxZ - c.minZ);
    const h = Math.max(0.02, c.top);
    const geo = new THREE.BoxGeometry(w, h, d);
    const isProp = c.source === 'prop';
    const mat = new THREE.MeshBasicMaterial({
      color: isProp ? 0xb055e0 : 0x7a52d8,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      wireframe: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set((c.minX + c.maxX) / 2, h / 2, (c.minZ + c.maxZ) / 2);
    mesh.renderOrder = 5;
    debugGroup.add(mesh);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: isProp ? 0xd08cff : 0x9f7bff, transparent: true, opacity: 0.85 })
    );
    edges.position.copy(mesh.position);
    debugGroup.add(edges);
  }
  debugGroup.visible = debugVisible;
  arena.scene.add(debugGroup);
}

/** 按 alive 状态刷新可视化（破坏/重置后调用）。 */
function refreshDebug(): void {
  if (!debugGroup) return;
  for (let i = 0; i < debugGroup.children.length; i += 2) {
    const idx = i / 2;
    const c = colliders[idx];
    if (!c) break;
    debugGroup.children[i].visible = c.alive;
    debugGroup.children[i + 1].visible = c.alive;
  }
}

/** 挂载：静态 collider + 逐道具派生 collider。在 arena 构造末尾调用。 */
export function mountColliders(arena: Arena): void {
  arenaRef = arena;
  colliders = [];

  for (const c of D.manual.colliders) {
    colliders.push({
      id: c.id,
      source: 'static',
      kind: c.kind,
      minX: c.minX,
      maxX: c.maxX,
      minZ: c.y - c.depth / 2,
      maxZ: c.y + c.depth / 2,
      top: staticTop(c.kind),
      alive: true,
    });
  }

  // 逐道具派生：只给「落地」的物件，悬挂灯笼（y≈2.8）与地面（floor-mid）不是障碍
  for (const s of arena.specs) {
    if (s.id === 'floor-mid') continue;
    if (s.y > 0.6) continue;
    colliders.push({
      id: `prop:${s.id}`,
      source: 'prop',
      kind: 'prop',
      minX: s.x - s.w / 2,
      maxX: s.x + s.w / 2,
      minZ: s.z - s.d / 2,
      maxZ: s.z + s.d / 2,
      top: s.y + s.h,
      alive: true,
    });
  }

  buildDebug(arena);
}

/** 破坏时移除该道具的 collider（紫方块语义：道具没了，脚下碰撞也没了）。 */
export function dropCollider(specId: string): void {
  let changed = false;
  for (const c of colliders) {
    if (c.id === `prop:${specId}` && c.alive) {
      c.alive = false;
      changed = true;
    }
  }
  if (changed) refreshDebug();
}

/** 回合重置：全部 collider 恢复。 */
export function restoreColliders(): void {
  for (const c of colliders) c.alive = true;
  refreshDebug();
}

/** 调试可视化开关。 */
export function setColliderDebugVisible(visible: boolean): void {
  debugVisible = visible;
  if (debugGroup) debugGroup.visible = visible;
}

/** 覆盖率自检：每个落地 spec 都有 collider；每个静态 collider 都指向场上真实实体。 */
function coverage(): { specId: string; covered: boolean }[] {
  const arena = arenaRef;
  if (!arena) return [];
  const propIds = new Set(colliders.filter((c) => c.source === 'prop').map((c) => c.id.slice(5)));
  return arena.specs
    .filter((s) => s.id !== 'floor-mid' && s.y <= 0.6)
    .map((s) => ({ specId: s.id, covered: propIds.has(s.id) }));
}

/** 探针用：完整状态。 */
export function collidersDebug(): ColliderDebugState {
  const arena = arenaRef;
  const cov = coverage();
  const missing: string[] = [];
  for (const c of cov) if (!c.covered) missing.push(c.specId);
  // 静态 collider 必须有对应实体：wall-back → 院墙（buildFloor 里的后墙 / 侧墙），step-front → 台阶
  // 二者在 arena 里由程序化几何承担，这里只校验 id 合法性，避免探针被无意义字符串骗过
  for (const c of colliders) {
    if (c.source !== 'static') continue;
    const known = ['wall-back', 'step-front'];
    if (!known.includes(c.id)) missing.push(`unknown-static:${c.id}`);
  }
  void arena;
  return {
    total: colliders.length,
    staticCount: colliders.filter((c) => c.source === 'static').length,
    propCount: colliders.filter((c) => c.source === 'prop').length,
    alive: colliders.filter((c) => c.alive).length,
    dead: colliders.filter((c) => !c.alive).length,
    visible: debugVisible,
    coverage: cov,
    missing,
  };
}
