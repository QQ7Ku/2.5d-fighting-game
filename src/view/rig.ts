/**
 * 原创低多边形角色：程序化建模 + 程序化骨骼 + 关键帧姿势混合
 * 不使用任何外部模型或动作数据；同一套骨架通过比例与配色区分两名角色。
 */

import * as THREE from 'three';
import { BASE_POSE, CLIPS, CLIPS_YAOSHAN, type Clip, type JointName } from './clips';
import type { CharacterDef } from '../data/moves';
import { clamp, damp } from '../core/math';
import type { Tier } from '../core/perf';

/**
 * 角色渲染器统一契约：程序化 `CharacterRig` 与 GLB 驱动的 `GLBRig` 都实现它，
 * 让 `fighter.ts` / `match.ts` 无需关心底层是拼接模型还是 Lux3D GLB。
 */
export interface Rig {
  readonly group: THREE.Group;
  play(name: string, phaseDriven: boolean, blend?: number, force?: boolean): void;
  setPhase(t: number): void;
  update(dt: number): void;
  setFacing(dir: 1 | -1): void;
  setTier(tier: Tier): void;
  readonly staffObject: THREE.Object3D | null;
  dispose(): void;
}

const JOINTS: JointName[] = [
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'shoulderL',
  'upperArmL',
  'forearmL',
  'handL',
  'shoulderR',
  'upperArmR',
  'forearmR',
  'handR',
  'thighL',
  'shinL',
  'footL',
  'thighR',
  'shinR',
  'footR',
];

let gradient: THREE.DataTexture | null = null;
function toonGradient(): THREE.DataTexture {
  if (gradient) return gradient;
  const data = new Uint8Array([70, 150, 235]);
  const tex = new THREE.DataTexture(data, 3, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  gradient = tex;
  return tex;
}

function toon(color: number): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color, gradientMap: toonGradient() });
}

interface PartSpec {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
  pos: [number, number, number];
  rot?: [number, number, number];
  bone: JointName;
  detail?: boolean;
}

/**
 * 参与「接地兜底」的骨骼，与审核探针口径一致：
 * - footL/footR 上的脚掌盒体：站立/蹲防/攻击时的真实最低点（蹲防 pitch≈-40° 会插地）；
 * - hips 上的裙摆/髋盒体：KO 躺姿时的最低点（脚翘起，裙摆才贴地）。
 * 不含小腿/大腿胶囊（其 AABB 角点会高估穿地）与手臂/棍（挥低时不能把人顶起来）。
 */
const GROUND_PROBE_BONES = new Set<JointName>(['footL', 'footR', 'hips']);

export class CharacterRig implements Rig {
  readonly group = new THREE.Group();
  readonly body = new THREE.Group();
  readonly bones = {} as Record<JointName, THREE.Object3D>;
  private meshes: THREE.Mesh[] = [];
  private groundProbeMeshes: THREE.Mesh[] = [];
  private static readonly probeVec = new THREE.Vector3();
  private mats: THREE.Material[] = [];
  private detailMeshes: THREE.Mesh[] = [];
  private animTime = 0;
  private currentPose: Record<JointName, [number, number, number]>;
  private targetPose: Record<JointName, [number, number, number]>;
  private currentRootY = 0;
  private targetRootY = 0;
  private groundLift = 0;
  private blendRate = 18;
  private warnedClips = new Set<string>();
  clip: Clip | null = null;
  /** 本角色的动作库：按站架合并过，拳架与持棍架会得到不同剪影 */
  private readonly clips: Record<string, Clip>;
  clipName = '';
  clipTime = 0;
  private phaseDriven = false;
  private staff: THREE.Object3D | null = null;

  constructor(readonly def: CharacterDef) {
    const scale = def.height / 1.72;
    this.clips = def.weapon === 'staff' ? CLIPS_YAOSHAN : CLIPS;
    this.group.add(this.body);
    this.body.scale.setScalar(scale);

    this.currentPose = {} as Record<JointName, [number, number, number]>;
    this.targetPose = {} as Record<JointName, [number, number, number]>;
    for (const j of JOINTS) {
      this.currentPose[j] = [0, 0, 0];
      this.targetPose[j] = [0, 0, 0];
    }
    this.buildSkeleton();
    this.buildMeshes();
    this.play('idle', false);
    this.snapToTarget();
  }

  private bone(name: JointName, parent: THREE.Object3D, x: number, y: number, z: number): void {
    const o = new THREE.Object3D();
    o.name = name;
    o.position.set(x, y, z);
    parent.add(o);
    this.bones[name] = o;
  }

  private buildSkeleton(): void {
    this.bone('hips', this.body, 0, 0.92, 0);
    this.bone('spine', this.bones.hips, 0, 0.16, 0);
    this.bone('chest', this.bones.spine, 0, 0.19, 0);
    this.bone('neck', this.bones.chest, 0, 0.2, 0);
    this.bone('head', this.bones.neck, 0, 0.09, 0);

    this.bone('shoulderL', this.bones.chest, 0.17, 0.13, 0);
    this.bone('upperArmL', this.bones.shoulderL, 0, -0.04, 0);
    this.bone('forearmL', this.bones.upperArmL, 0, -0.24, 0);
    this.bone('handL', this.bones.forearmL, 0, -0.22, 0);

    this.bone('shoulderR', this.bones.chest, -0.17, 0.13, 0);
    this.bone('upperArmR', this.bones.shoulderR, 0, -0.04, 0);
    this.bone('forearmR', this.bones.upperArmR, 0, -0.24, 0);
    this.bone('handR', this.bones.forearmR, 0, -0.22, 0);

    this.bone('thighL', this.bones.hips, 0.09, -0.05, 0);
    this.bone('shinL', this.bones.thighL, 0, -0.4, 0);
    this.bone('footL', this.bones.shinL, 0, -0.38, 0);

    this.bone('thighR', this.bones.hips, -0.09, -0.05, 0);
    this.bone('shinR', this.bones.thighR, 0, -0.4, 0);
    this.bone('footR', this.bones.shinR, 0, -0.38, 0);
  }

  private addPart(spec: PartSpec): void {
    const mesh = new THREE.Mesh(spec.geo, spec.mat);
    mesh.position.set(...spec.pos);
    if (spec.rot) mesh.rotation.set(...spec.rot);
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    this.bones[spec.bone].add(mesh);
    this.meshes.push(mesh);
    if (GROUND_PROBE_BONES.has(spec.bone)) {
      if (!spec.geo.boundingBox) spec.geo.computeBoundingBox();
      this.groundProbeMeshes.push(mesh);
    }
    if (spec.detail) this.detailMeshes.push(mesh);
  }

  private buildMeshes(): void {
    const p = this.def.palette;
    const skin = toon(p.skin);
    const cloth = toon(p.cloth);
    const trim = toon(p.trim);
    const accent = toon(p.accent);
    const hair = toon(p.hair);
    this.mats.push(skin, cloth, trim, accent, hair);

    // 躯干
    const chestGeo = new THREE.BoxGeometry(0.36, 0.4, 0.24);
    this.addPart({ geo: chestGeo, mat: cloth, pos: [0, 0.06, 0], bone: 'chest' });
    const abGeo = new THREE.BoxGeometry(0.3, 0.18, 0.2);
    this.addPart({ geo: abGeo, mat: cloth, pos: [0, 0.02, 0], bone: 'spine' });
    const hipGeo = new THREE.BoxGeometry(0.32, 0.2, 0.22);
    this.addPart({ geo: hipGeo, mat: trim, pos: [0, 0.02, 0], bone: 'hips' });

    // 腰带
    const sashGeo = new THREE.BoxGeometry(0.34, 0.07, 0.24);
    this.addPart({ geo: sashGeo, mat: accent, pos: [0, 0.09, 0], bone: 'spine' });

    // 下摆（外衣）
    const skirtGeo = new THREE.CylinderGeometry(0.2, 0.3, 0.42, 7, 1, true);
    this.addPart({
      geo: skirtGeo,
      mat: cloth,
      pos: [0, -0.18, 0],
      bone: 'hips',
    });

    // 颈 / 头
    const neckGeo = new THREE.CylinderGeometry(0.055, 0.06, 0.1, 6);
    this.addPart({ geo: neckGeo, mat: skin, pos: [0, 0.03, 0], bone: 'neck' });
    const headGeo = new THREE.IcosahedronGeometry(0.152, 1);
    this.addPart({ geo: headGeo, mat: skin, pos: [0, 0.1, 0.005], bone: 'head' });
    // 发帽（细节层，低画质可隐藏）
    const capGeo = new THREE.SphereGeometry(0.158, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.55);
    this.addPart({ geo: capGeo, mat: hair, pos: [0, 0.095, -0.005], bone: 'head', detail: true });
    const browGeo = new THREE.BoxGeometry(0.15, 0.028, 0.05);
    this.addPart({ geo: browGeo, mat: hair, pos: [0, 0.135, 0.13], bone: 'head', detail: true });
    const beardGeo = new THREE.BoxGeometry(0.07, 0.04, 0.03);
    this.addPart({ geo: beardGeo, mat: hair, pos: [0, 0.045, 0.135], bone: 'head', detail: true });
    // 护肩
    const pauldronGeo = new THREE.BoxGeometry(0.14, 0.11, 0.20);
    this.addPart({ geo: pauldronGeo, mat: trim, pos: [0.02, 0.02, 0], bone: 'shoulderL', detail: true });
    this.addPart({ geo: pauldronGeo, mat: trim, pos: [-0.02, 0.02, 0], bone: 'shoulderR', detail: true });

    // 手臂
    const upperGeo = new THREE.CapsuleGeometry(0.055, 0.2, 2, 6);
    const foreGeo = new THREE.CapsuleGeometry(0.048, 0.18, 2, 6);
    const handGeo = new THREE.BoxGeometry(0.095, 0.115, 0.095);
    for (const side of ['L', 'R'] as const) {
      const up = `upperArm${side}` as JointName;
      const fo = `forearm${side}` as JointName;
      const ha = `hand${side}` as JointName;
      this.addPart({ geo: upperGeo, mat: cloth, pos: [0, -0.12, 0], bone: up });
      this.addPart({ geo: foreGeo, mat: skin, pos: [0, -0.11, 0], bone: fo });
      this.addPart({ geo: handGeo, mat: skin, pos: [0, -0.06, 0], bone: ha });
    }

    // 腿
    const thighGeo = new THREE.CapsuleGeometry(0.075, 0.3, 2, 6);
    const shinGeo = new THREE.CapsuleGeometry(0.06, 0.28, 2, 6);
    const footGeo = new THREE.BoxGeometry(0.11, 0.07, 0.22);
    for (const side of ['L', 'R'] as const) {
      const th = `thigh${side}` as JointName;
      const sh = `shin${side}` as JointName;
      const ft = `foot${side}` as JointName;
      this.addPart({ geo: thighGeo, mat: trim, pos: [0, -0.2, 0], bone: th });
      this.addPart({ geo: shinGeo, mat: skin, pos: [0, -0.19, 0], bone: sh });
      this.addPart({ geo: footGeo, mat: toon(0x2e2622), pos: [0, -0.02, 0.05], bone: ft });
    }

    if (this.def.weapon === 'staff') {
      const staffGeo = new THREE.CylinderGeometry(0.02, 0.02, 1.36, 6);
      const staffMat = toon(0x8a5a2b);
      this.mats.push(staffMat);
      const staff = new THREE.Mesh(staffGeo, staffMat);
      staff.castShadow = true;
      staff.position.set(0, -0.18, 0.02);
      staff.rotation.set(0.12, 0, 0.18);
      this.bones.handR.add(staff);
      this.meshes.push(staff);
      this.staff = staff;
      // 棍两端铜箍
      const capGeo = new THREE.CylinderGeometry(0.026, 0.026, 0.06, 6);
      const capMat = toon(0xc8a45c);
      this.mats.push(capMat);
      for (const s of [-1, 1]) {
        const cap = new THREE.Mesh(capGeo, capMat);
        cap.position.set(0, s * 0.68, 0);
        staff.add(cap);
        this.meshes.push(cap);
        this.detailMeshes.push(cap);
      }
    }
  }

  setTier(tier: Tier): void {
    const showDetail = tier !== 'low';
    for (const m of this.detailMeshes) m.visible = showDetail;
    for (const m of this.meshes) {
      m.castShadow = tier !== 'low';
    }
  }

  setFacing(dir: 1 | -1): void {
    this.group.rotation.y = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
  }

  /** 播放动画：normalized=true 的 Clip 由外部按招式进度驱动 */
  play(name: string, phaseDriven: boolean, blend = 18, force = false): void {
    // 缺 Clip 时回退 idle，但必须留痕：静默回退会让「动画缺失」在成品里变成了「动作不对」
    let clip = this.clips[name];
    if (!clip) {
      if (!this.warnedClips.has(name)) {
        this.warnedClips.add(name);
        console.warn(`[rig] 缺少 Clip "${name}"，已回退 idle`);
      }
      // 回退后 clipName 必须记成真实在播的 idle：否则 docs/03「clipName===move.clip」自检恒真，
      // 且 force 分支的 snapToTarget 会拿错名 Clip 的姿势（动画审核第 4 条）。
      clip = this.clips.idle;
      name = 'idle';
    }
    if (!force && this.clipName === name && phaseDriven === this.phaseDriven) return;
    this.clip = clip;
    this.clipName = name;
    this.clipTime = 0;
    this.phaseDriven = phaseDriven;
    this.blendRate = blend;
    if (force && !phaseDriven) this.snapToTarget();
  }

  /** 招式类动画：按 0..1 进度直接取样 */
  setPhase(t: number): void {
    if (!this.clip) return;
    this.clipTime = clamp(t, 0, 1);
  }

  private evaluate(time: number): { pose: Record<JointName, [number, number, number]>; rootY: number } {
    const clip = this.clip ?? this.clips.idle;
    const keys = clip.keys;
    // 统一到 0..1 的归一化进度
    let tn: number;
    if (clip.normalized) {
      tn = clamp(time, 0, 1);
    } else if (clip.loop) {
      const dur = Math.max(0.0001, clip.dur);
      tn = (((time % dur) + dur) % dur) / dur;
    } else {
      tn = clamp(time / Math.max(0.0001, clip.dur), 0, 1);
    }

    let a = keys[0];
    let b = keys[keys.length - 1];
    for (let i = 0; i < keys.length - 1; i++) {
      if (tn >= keys[i].t && tn <= keys[i + 1].t) {
        a = keys[i];
        b = keys[i + 1];
        break;
      }
    }
    const span = Math.max(0.0001, b.t - a.t);
    const raw = clamp((tn - a.t) / span, 0, 1);
    const k = raw * raw * (3 - 2 * raw);

    const pose = {} as Record<JointName, [number, number, number]>;
    for (const joint of JOINTS) {
      const pa = a.pose[joint] ?? BASE_POSE[joint] ?? [0, 0, 0];
      const pb = b.pose[joint] ?? BASE_POSE[joint] ?? [0, 0, 0];
      pose[joint] = [
        pa[0] + (pb[0] - pa[0]) * k,
        pa[1] + (pb[1] - pa[1]) * k,
        pa[2] + (pb[2] - pa[2]) * k,
      ];
    }
    // 根部高度也要按关键帧插值：整段常量会让 KO 第一帧就沉到地里
    const baseY = clip.rootY !== undefined ? clip.rootY : 0;
    const ya = a.rootY !== undefined ? a.rootY : baseY;
    const yb = b.rootY !== undefined ? b.rootY : baseY;
    const rootY = ya + (yb - ya) * k;
    return { pose, rootY };
  }

  private snapToTarget(): void {
    const { pose, rootY } = this.evaluate(this.clipTime);
    for (const j of JOINTS) {
      this.currentPose[j] = [...pose[j]];
      this.targetPose[j] = [...pose[j]];
    }
    this.currentRootY = rootY;
    this.targetRootY = rootY;
    this.apply();
  }

  update(dt: number): void {
    if (!this.clip) return;
    if (!this.phaseDriven) {
      this.clipTime += dt;
      if (!this.clip.loop && this.clip.normalized) this.clipTime = Math.min(1, this.clipTime);
      if (!this.clip.loop && !this.clip.normalized) {
        this.clipTime = Math.min(this.clip.dur, this.clipTime);
      }
    }
    const { pose, rootY } = this.evaluate(this.clipTime);
    for (const j of JOINTS) {
      const c = this.currentPose[j];
      this.currentPose[j] = [
        damp(c[0], pose[j][0], this.blendRate, dt),
        damp(c[1], pose[j][1], this.blendRate, dt),
        damp(c[2], pose[j][2], this.blendRate, dt),
      ];
    }
    this.currentRootY = damp(this.currentRootY, rootY, 14, dt);
    this.apply();
  }

  private apply(): void {
    const d = Math.PI / 180;
    for (const j of JOINTS) {
      const b = this.bones[j];
      const p = this.currentPose[j];
      b.rotation.set(p[0] * d, p[1] * d, p[2] * d);
    }
    this.body.position.y = this.currentRootY + this.groundLift;
    // 接地兜底：取腿/脚/髋部网格**包围盒 8 角**在世界坐标里的最低点，而不是脚踝关节原点。
    // 旧版只盯脚踝原点、且只抬不压，两处穿帮都兜不住：蹲防脚掌 pitch≈-40° 插地 9cm
    // （脚踝仍够高，lift 恒 0），KO 躺姿脚翘起、裙摆离地 10cm（只抬不压，无法下沉）。
    // 现在按真实最低点反解，lift 可以为负（下压），把躺尸压回地面。
    this.group.updateMatrixWorld(true);
    // 相对 group 世界 Y 取最低点：角色跳跃时 group 被整体抬高，两者同步变化会抵消，
    // 兜底只负责「角色自身骨架相对脚下地面」的姿态，不会把空中角色拽回地面。
    const baseY = this.group.matrixWorld.elements[13];
    const v = CharacterRig.probeVec;
    let low = Infinity;
    for (const mesh of this.groundProbeMeshes) {
      const bb = mesh.geometry.boundingBox;
      if (!bb) continue;
      for (let c = 0; c < 8; c++) {
        v.set(
          c & 1 ? bb.max.x : bb.min.x,
          c & 2 ? bb.max.y : bb.min.y,
          c & 4 ? bb.max.z : bb.min.z
        ).applyMatrix4(mesh.matrixWorld);
        const rel = v.y - baseY;
        if (rel < low) low = rel;
      }
    }
    // 先用「未抬升时」的基准高度算需要多少位移，再一次性赋值：
    // 直接对含抬升的高度做增量修正会在两帧之间来回震荡（抬起后不再穿地，于是又被清零）。
    const baseLow = low - this.groundLift;
    // 目标是脚掌网格底边贴近地面（留 1cm 余量避 z-fighting）；脚掌本身在脚踝下方，
    // 因此这里不再像旧版那样把「脚踝原点」顶到 0.05，而是直接对齐真实最低点。
    const want = 0.01 * this.body.scale.x - baseLow;
    // 下压只在明显倒地时启用：KO 后段 rootY≈-0.56/-0.62，脚翘起、裙摆离地 10cm，
    // 此时才需要把躺姿压回地面。站立/跳跃/普通蹲姿腿部收起会让整体最低点偏高，
    // 若也允许下压会把空中角色往下拽，故这些情形维持「只抬不压」。
    const minLift = this.currentRootY < -0.3 ? -0.15 : 0;
    const lift = clamp(want, minLift, 0.35);
    if (Math.abs(lift - this.groundLift) > 0.0005) {
      this.groundLift = lift;
      this.body.position.y = this.currentRootY + this.groundLift;
    }
  }

  get staffObject(): THREE.Object3D | null {
    return this.staff;
  }

  dispose(): void {
    this.group.parent?.remove(this.group);
    for (const m of this.meshes) {
      m.geometry.dispose();
    }
    for (const mat of this.mats) mat.dispose();
    this.meshes.length = 0;
    this.mats.length = 0;
  }
}

