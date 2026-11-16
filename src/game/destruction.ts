/**
 * 破坏系统：三级破坏 + 连锁 + 碎片对象池 + 破坏后碰撞/地形更新
 * 规则见 docs/04-破坏系统设计.md
 * 碎片上限：桌面 200 / 移动 100（由性能档位 budget.fragmentCap 决定）
 */

import * as THREE from 'three';
import { bus } from '../core/bus';
import type { Arena, DestroyableSpec } from '../view/arena';
import { dropCollider, restoreColliders } from '../view/colliders';
import { clamp, mulberry32 } from '../core/math';
import type { Budget } from '../core/perf';

interface Destroyable {
  spec: DestroyableSpec;
  hp: number;
  stage: number;
  broken: boolean;
  mesh: THREE.Object3D | null;
  /** 复原用：灯笼是带自身缩放的 Group，重置时写死 1 会把它变回原大 */
  baseScale: number;
  /** 复原用：applyStage 接地补偿会下压 mesh.position.y，重置需还原到构造时的盒中心高度 */
  baseY: number;
  pendingChainFrom: string | null;
  chainDelay: number;
}

interface Fragment {
  /** 所属 InstancedMesh 下标与实例槽位：碎片改为实例化渲染，draw call 与碎片数无关 */
  gi: number;
  slot: number;
  pos: THREE.Vector3;
  rot: THREE.Euler;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  rz: number;
  life: number;
  active: boolean;
  scale: number;
}

const PRESET_COLORS: Record<string, number[]> = {
  wood_pillar: [0x6b4a30, 0x7d5738, 0x513722],
  plaster_wall: [0xa89b86, 0x8d8577, 0xb5a894],
  stone_slab: [0x6f6a60, 0x827a6d, 0x5b554c],
  // v2.4.3：牌坊边柱（原 wood_pillar 木柱换皮为石柱）专用 —— 青灰，与 arena 中 0x6d7178 同族，
  // 避免「石柱碎出木片」的因果断裂。
  stone_pillar: [0x6d7178, 0x7e838a, 0x585d63],
  paper_lantern: [0xd9a35a, 0xc8894a, 0xe8bc7c],
  bamboo_fence: [0x7a7f4a, 0x5f6438],
  terracotta: [0x9c5b3f, 0x7f4730],
  stone_lantern: [0x5a6a68, 0x6d7a76, 0x47524f],
};

export class DestructionSystem {
  private objects = new Map<string, Destroyable>();
  private pool: Fragment[] = [];
  private scene: THREE.Scene;
  private rng = mulberry32(0x2f6e2b1);
  private cap: number;
  /** 实例缓冲按桌面档上限一次性分配，避免切画质时重建 InstancedMesh */
  private readonly capMax = 200;
  private activeCount = 0;
  private geos: THREE.BufferGeometry[] = [];
  private instanced: THREE.InstancedMesh[] = [];
  private dummy = new THREE.Object3D();
  private colorTmp = new THREE.Color();
  private budget: Budget;

  constructor(
    private arena: Arena,
    scene: THREE.Scene,
    budget: Budget
  ) {
    this.scene = scene;
    this.budget = budget;
    this.cap = budget.fragmentCap;
    for (const spec of arena.specs) {
      this.objects.set(spec.id, {
        spec,
        hp: spec.hp,
        stage: 0,
        broken: false,
        mesh: arena.props.get(spec.id) ?? null,
        baseScale: (arena.props.get(spec.id) as THREE.Object3D | undefined)?.scale.x ?? 1,
        baseY: (arena.props.get(spec.id) as THREE.Object3D | undefined)?.position.y ?? 0,
        pendingChainFrom: null,
        chainDelay: 0,
      });
    }
    this.geos = [
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.TetrahedronGeometry(0.62, 0),
      new THREE.BoxGeometry(1, 0.42, 0.7),
    ];
    const perMesh = Math.ceil(this.capMax / this.geos.length);
    for (const geo of this.geos) {
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0 });
      const mesh = new THREE.InstancedMesh(geo, mat, perMesh);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = perMesh;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      // 颜色走 instanceColor：一片一个颜色，不需要为每种色建材质与批次
      const colors = new Float32Array(perMesh * 3).fill(1);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
      this.scene.add(mesh);
      this.instanced.push(mesh);
    }
    this.prewarm();
  }

  private prewarm(): void {
    const perMesh = Math.ceil(this.capMax / this.geos.length);
    for (let i = 0; i < perMesh * this.geos.length; i++) {
      const gi = i % this.geos.length;
      const slot = Math.floor(i / this.geos.length);
      const f: Fragment = {
        gi,
        slot,
        pos: new THREE.Vector3(0, -50, 0),
        rot: new THREE.Euler(0, 0, 0),
        vx: 0,
        vy: 0,
        vz: 0,
        rx: 0,
        ry: 0,
        rz: 0,
        life: 0,
        active: false,
        scale: 1,
      };
      this.pool.push(f);
      this.dummy.position.copy(f.pos);
      this.dummy.scale.setScalar(0.0001);
      this.dummy.updateMatrix();
      this.instanced[gi].setMatrixAt(slot, this.dummy.matrix);
    }
    for (const m of this.instanced) m.instanceMatrix.needsUpdate = true;
  }

  applyBudget(budget: Budget): void {
    this.budget = budget;
    if (budget.fragmentCap < this.cap) {
      this.cap = budget.fragmentCap;
      let removed = 0;
      for (const f of this.pool) {
        if (f.active && this.activeCount >= this.cap) {
          this.recycle(f);
          removed++;
        }
      }
      if (removed) this.activeCount = this.pool.filter((f) => f.active).length;
    } else {
      this.cap = budget.fragmentCap;
    }
  }

  get objectCount(): number {
    return this.objects.size;
  }

  get brokenCount(): number {
    let n = 0;
    for (const o of this.objects.values()) if (o.broken) n++;
    return n;
  }

  get fragmentCount(): number {
    return this.activeCount;
  }

  /** 命中点附近的破坏物受到冲击 */
  impactAt(x: number, y: number, level: 0 | 1 | 2 | 3, source: string, z = 0): void {
    if (level <= 0) return;
    for (const obj of this.objects.values()) {
      if (obj.broken) continue;
      const s = obj.spec;
      // 纵深窗口按物件自身厚度放宽：固定 1.0 会把墙板(1.05)与灯笼(1.4)整类判死，
      // 结果就是 8/11 的可破坏物实战打不碎、撞墙开通道永远失效
      // 固定下限抬到 2.1：覆盖 keyDestroyables 的 z∈[-2.0, 0.2]，
      // 否则 z=-2.0 的薄物件（山门墙板/柱）在默认 z=0 的命中里被永久跳过、打不烂。
      const zTol = Math.max(2.1, (s.d ?? 0.5) * 0.5 + 1.4);
      // 纵向就用常规窗口：灯笼中心在 3.0 米，地面近战 dy 已经够不着，跳打才该够得着。
      // 之前按 "z < -1.4" 给它单独收紧到 0.85，结果跳打最高点 2.03 也打不到，等于永久免疫。
      const yTol = s.h * 0.5 + 1.0;
      if (Math.abs(z - (s.z ?? 0)) > zTol) continue;
      const dx = Math.abs(x - s.x);
      const dy = Math.abs(y - (s.y + s.h * 0.5));
      const reachX = s.w * 0.5 + 0.95;
      const reachY = yTol;
      if (dx > reachX || dy > reachY) continue;
      if (level < s.tier) {
        // 破坏等级不足：只掉少量耐久，不推进阶段
        if (level + 1 >= s.tier) this.damage(obj, 6, source, false);
        continue;
      }
      const dmg = level === 3 ? 120 : level === 2 ? 55 : 24;
      this.damage(obj, dmg, source, true);
    }
  }

  private damage(obj: Destroyable, amount: number, source: string, advance: boolean): void {
    if (obj.broken) return;
    obj.hp = Math.max(0, obj.hp - amount);
    bus.emit('destroy:damage', { objectId: obj.spec.id, stage: obj.stage, hp: obj.hp });

    if (!advance) return;
    const ratio = obj.hp / obj.spec.hp;
    const maxStage = obj.spec.stages;
    const targetStage = obj.hp <= 0 ? maxStage : Math.min(maxStage - 1, Math.floor((1 - ratio) * maxStage));
    if (targetStage > obj.stage) {
      obj.stage = targetStage;
      this.applyStage(obj);
    }
  }

  private applyStage(obj: Destroyable): void {
    const s = obj.spec;
    bus.emit('destroy:stage', { objectId: s.id, stage: obj.stage, maxStage: s.stages });
    if (obj.stage >= s.stages) {
      this.breakObject(obj);
      return;
    }
    // 中间阶段：外观受损 + 碎片预喷
    if (obj.mesh) {
      const scaleBefore = obj.mesh.scale.y;
      // mesh 按「盒底 + h/2」定位且几何居中：绕盒中心缩放会把盒底抬离地面 h/2*(1-0.94)。
      // 先记录缩放前的盒底世界 y，缩放后再把盒底钉回该高度。
      const origBottom = obj.mesh.position.y - (s.h * scaleBefore) / 2;
      obj.mesh.scale.multiplyScalar(0.94);
      obj.mesh.rotation.z += (this.rng() - 0.5) * 0.05;
      const scaleAfter = obj.mesh.scale.y;
      // 贴地件（盒底≈0）跟随当前地面：塌陷后贴坑底；悬挂件（灯笼）保持原盒底高度不被拉到地面。
      const groundBottom = Math.abs(origBottom) < 0.05 ? this.arena.getFloorY(s.x) : origBottom;
      obj.mesh.position.y = groundBottom + (s.h * scaleAfter) / 2;
    }
    this.spawnFragments(s, 4, 0.5);
    bus.emit('sfx:play', { tag: s.sfx, gain: 0.6 });
    bus.emit('fx:shake', { strength: 0.25, frames: 6 });
  }

  private breakObject(obj: Destroyable): void {
    if (obj.broken) return;
    obj.broken = true;
    const s = obj.spec;
    if (obj.mesh) obj.mesh.visible = false;
    // v2.3.0：道具被打碎 → 它脚下派生的碰撞体一并移除（参考图紫方块「实体碰撞」的真实消费者）。
    dropCollider(s.id);

    bus.emit('destroy:break', {
      objectId: s.id,
      tier: s.tier,
      position: { x: s.x, y: s.y + s.h * 0.5, z: s.z },
    });
    bus.emit('sfx:play', { tag: s.sfx, gain: 1 });
    bus.emit('fx:shake', { strength: s.tier === 3 ? 0.9 : 0.45, frames: s.tier === 3 ? 22 : 10 });

    this.spawnFragments(s, s.tier === 3 ? 24 : s.tier === 2 ? 14 : 8, 1);

    if (s.collapseZone) {
      this.arena.collapse(s.collapseZone);
      bus.emit('destroy:collapse', {
        zoneId: s.collapseZone.id,
        fromX: s.collapseZone.fromX,
        toX: s.collapseZone.toX,
      });
      bus.emit('hud:callout', { text: '地面塌陷', ms: 1400 });
    }
    // v2.2.0（a′ 档）：`opensPassage` 通道链退役。
    // 原逻辑：打碎 `wall-panel-east`（右侧那堵砖墙）→ arena.openPassage() 隐藏对象 + HUD 弹「通道开启」。
    // 但参考图全部无砖墙、也无「下一区域」，换皮成大鼓后若保留此分支，
    // 会变成「打碎一面鼓却提示通道开启」——玩法语义断裂（r3.1 §4.5 L2）。
    // 现由数据层 `shuangting.json` 的 `opensPassage:false` + 本处删除分支双重保证：
    // 破坏大鼓只走普通破坏反馈（碎片 / 震屏 / 音效），不再伪造通道事件。
    // 字段 `opensPassage` 仍保留在 spec 类型与 JSON 中（恒 false），便于将来真做多区域时回填。

    // 连锁：把冲击传给邻近低阶物件（延迟 8 帧）
    for (const other of this.objects.values()) {
      if (other === obj || other.broken) continue;
      const d = Math.hypot(other.spec.x - s.x, other.spec.z - s.z);
      if (d < s.chainRadius && other.spec.tier <= s.tier) {
        other.pendingChainFrom = s.id;
        other.chainDelay = 8;
        bus.emit('destroy:chain', { objectId: other.spec.id, from: s.id });
      }
    }
  }

  private spawnFragments(spec: DestroyableSpec, count: number, power: number): void {
    const colors = PRESET_COLORS[spec.preset] ?? [0x6b6357];
    const n = Math.min(count, 26);
    for (let i = 0; i < n; i++) {
      const f = this.acquire();
      if (!f) break;
      const scale = (spec.tier === 3 ? 0.36 : 0.26) * (0.6 + this.rng() * 0.9);
      f.scale = scale;
      const spread = spec.tier === 3 ? 1.6 : 0.9;
      f.pos.set(
        spec.x + (this.rng() - 0.5) * spec.w * 1.2,
        spec.y + this.rng() * spec.h * 0.9,
        spec.z + (this.rng() - 0.5) * spread
      );
      f.rot.set(this.rng() * Math.PI, this.rng() * Math.PI, this.rng() * Math.PI);
      this.colorTmp.setHex(colors[i % colors.length]);
      this.instanced[f.gi].setColorAt(f.slot, this.colorTmp);
      this.instanced[f.gi].instanceColor!.needsUpdate = true;
      f.vx = (this.rng() - 0.5) * 0.22 * power;
      f.vy = (0.08 + this.rng() * 0.24) * power;
      f.vz = (this.rng() - 0.5) * 0.12;
      f.rx = (this.rng() - 0.5) * 0.3;
      f.ry = (this.rng() - 0.5) * 0.3;
      f.rz = (this.rng() - 0.5) * 0.3;
      f.life = 3.2 + this.rng() * 2.4;
      f.active = true;
      this.syncInstance(f);
    }
  }

  private acquire(): Fragment | null {
    if (this.activeCount >= this.cap) {
      // 回收最旧的一个
      const oldest = this.pool.filter((f) => f.active).sort((a, b) => a.life - b.life)[0];
      if (oldest) this.recycle(oldest);
      else return null;
    }
    const free = this.pool.find((f) => !f.active);
    if (!free) return null;
    this.activeCount++;
    return free;
  }

  private recycle(f: Fragment): void {
    f.active = false;
    f.life = 0;
    this.dummy.position.set(0, -50, 0);
    this.dummy.rotation.set(0, 0, 0);
    this.dummy.scale.setScalar(0.0001);
    this.dummy.updateMatrix();
    this.instanced[f.gi].setMatrixAt(f.slot, this.dummy.matrix);
    this.instanced[f.gi].instanceMatrix.needsUpdate = true;
    this.activeCount = Math.max(0, this.activeCount - 1);
  }

  /** 把碎片状态写进实例矩阵 */
  private syncInstance(f: Fragment): void {
    this.dummy.position.copy(f.pos);
    this.dummy.rotation.copy(f.rot);
    this.dummy.scale.setScalar(f.scale);
    this.dummy.updateMatrix();
    this.instanced[f.gi].setMatrixAt(f.slot, this.dummy.matrix);
    this.instanced[f.gi].instanceMatrix.needsUpdate = true;
  }

  update(dt: number): void {
    for (const obj of this.objects.values()) {
      if (obj.chainDelay > 0) {
        obj.chainDelay--;
        if (obj.chainDelay === 0 && obj.pendingChainFrom && !obj.broken) {
          this.damage(obj, 40, obj.pendingChainFrom, true);
          obj.pendingChainFrom = null;
        }
      }
    }

    const g = 0.055;
    const skipFar = this.budget.fragmentCap <= 120;
    // 坑体纵深 z∈[-3.5, 2.0]（arena.collapse: pitZ=5.5 / pitZCenter=-0.75 / depth=7）。
    // getFloorY 只按 x 判坑，碎片的落地高度还需 Z 方向支撑。
    const PIT_Z_MIN = -3.5;
    const PIT_Z_MAX = 2.0;
    const pit = this.arena.activePit();
    for (const f of this.pool) {
      if (!f.active) continue;
      f.life -= dt;
      f.vy -= g;
      f.pos.x += f.vx;
      f.pos.y += f.vy;
      f.pos.z += f.vz;
      if (skipFar) {
        f.rot.x += f.rx * 0.5;
      } else {
        f.rot.x += f.rx;
        f.rot.y += f.ry;
        f.rot.z += f.rz;
      }
      const inPitX = !!pit && f.pos.x > pit.fromX && f.pos.x < pit.toX;
      const inPitZ = f.pos.z > PIT_Z_MIN && f.pos.z < PIT_Z_MAX;
      // 只有同时落在坑 x 与坑 z 内才按坑底判定；越过近沿/远壁的碎片由沿口主地板(y=0)支撑，
      // 否则 getFloorY 只看 x 会把它们判穿到地板下方（塌陷后坑区碎片的 Z 方向支撑）。
      const groundY = (inPitX && inPitZ ? this.arena.getFloorY(f.pos.x) : 0) + 0.03;
      // 实例几何以中心为原点：用碎片自身最低点(半高≈scale*0.5)判定落地而非中心，
      // 避免中心贴地造成的悬浮/半陷入地。
      const halfH = f.scale * 0.5;
      if (f.pos.y - halfH <= groundY) {
        f.pos.y = groundY + halfH;
        f.vy *= -0.32;
        f.vx *= 0.72;
        f.vz *= 0.72;
        f.rx *= 0.6;
        f.rz *= 0.6;
        if (Math.abs(f.vy) < 0.02) f.vy = 0;
        // 坑内碎片夹在坑壁纵深内并回弹，避免沿 Z 穿墙飘到已隐藏的地板外。
        if (inPitX) {
          if (f.pos.z < PIT_Z_MIN) { f.pos.z = PIT_Z_MIN; f.vz = Math.abs(f.vz) * 0.3; }
          else if (f.pos.z > PIT_Z_MAX) { f.pos.z = PIT_Z_MAX; f.vz = -Math.abs(f.vz) * 0.3; }
        }
      }
      if (f.life < 0.6) {
        const k = clamp(f.life / 0.6, 0, 1);
        this.dummy.position.copy(f.pos);
        this.dummy.rotation.copy(f.rot);
        this.dummy.scale.setScalar(f.scale * k);
      } else {
        this.dummy.position.copy(f.pos);
        this.dummy.rotation.copy(f.rot);
        this.dummy.scale.setScalar(f.scale);
      }
      this.dummy.updateMatrix();
      this.instanced[f.gi].setMatrixAt(f.slot, this.dummy.matrix);
      this.instanced[f.gi].instanceMatrix.needsUpdate = true;
      if (f.life <= 0) this.recycle(f);
    }
  }

  reset(): void {
    for (const obj of this.objects.values()) {
      obj.hp = obj.spec.hp;
      obj.stage = 0;
      obj.broken = false;
      obj.chainDelay = 0;
      obj.pendingChainFrom = null;
      if (obj.mesh) {
        obj.mesh.visible = true;
        obj.mesh.scale.setScalar(obj.baseScale);
        obj.mesh.rotation.z = 0;
        // applyStage 的接地补偿改过 position.y，缩放复位后需还原构造时的盒中心高度
        obj.mesh.position.y = obj.baseY;
      }
    }
    for (const f of this.pool) if (f.active) this.recycle(f);
    // v2.3.0：逐道具碰撞体随破坏移除，回合重置时全部恢复
    restoreColliders();
    // 苔痕贴花 / 地面薄霜 decal 的显隐归 Arena 管理：collapse() 隐藏、resetTerrain() 还原，
    // 本系统只保证自身 props 的 visible 已复位为 true。
  }

  dispose(): void {
    for (const m of this.instanced) {
      this.scene.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
      m.dispose();
    }
    this.instanced.length = 0;
    for (const g of this.geos) g.dispose();
    this.pool.length = 0;
  }
}
