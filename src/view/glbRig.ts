/**
 * GLB 角色渲染器：消费 Lux3D 生成的带骨 + 重定向动画 GLB（`public/models/{id}_animated.glb`）。
 *
 * 设计要点：
 * - 构造时**同步**建一个程序化 `CharacterRig` 作为占位（降级回退），并立即异步 `GLTFLoader.load` GLB；
 *   加载失败/超时游戏永不崩，一直用拼接模型。
 * - 加载完成后：按 `def.height` 缩放并接地对齐 → 建 `THREE.AnimationMixer` → 隐藏占位、显示 GLB；
 *   若 `def.weapon==='staff'`，把同款长棍挂到 GLB 右手骨 `mixamorigRightHand`（运行时挂棍，零额外花费）。
 * - 对外保持与 `CharacterRig` 完全一致的 `Rig` 契约：`play/setPhase/update/setFacing/setTier/group/staffObject/dispose`，
 *   对 `fighter.ts` / `match.ts` 完全透明。
 * - 接地交给 `fighter.ts` 的 `group.position.y = f.y` 物理与 GLB 动画自身（脚已在 group 原点 y≈0），
 *   不再做 8 角探测兜底；KO/倒地由 `Death01` 等动作表现。
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { CharacterDef } from '../data/moves';
import { CharacterRig, type Rig } from './rig';
import { resolveClip } from './clipMap';
import type { Tier } from '../core/perf';

const MODEL_DIR = 'models/';

/** 若 GLB 默认朝向是 -Z（背对镜头），置 true 让模型绕 Y 翻转 180° 面向 +Z。经探针验证后确认。 */
const FORWARD_FLIP = false;

function modelUrl(def: CharacterDef): string {
  return new URL(MODEL_DIR + def.id + '_animated.glb', document.baseURI).href;
}

/** 复用 rig.ts 同款长棍（含两端铜箍），挂到 GLB 右手骨。 */
function buildStaff(): THREE.Group {
  const group = new THREE.Group();
  const staffMat = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.8, metalness: 0 });
  const capMat = new THREE.MeshStandardMaterial({ color: 0xc8a45c, roughness: 0.4, metalness: 0.6 });
  const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.36, 6), staffMat);
  staff.castShadow = true;
  staff.position.set(0, -0.18, 0.02);
  staff.rotation.set(0.12, 0, 0.18);
  group.add(staff);
  const capGeo = new THREE.CylinderGeometry(0.026, 0.026, 0.06, 6);
  for (const s of [-1, 1]) {
    const cap = new THREE.Mesh(capGeo, capMat);
    cap.position.set(0, s * 0.68, 0);
    staff.add(cap);
  }
  return group;
}

export class GLBRig implements Rig {
  readonly group = new THREE.Group();
  private readonly inner: CharacterRig; // 程序化占位（降级回退）
  private mixer: THREE.AnimationMixer | null = null;
  private gltfScene: THREE.Object3D | null = null;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private activeAction: THREE.AnimationAction | null = null;
  private activeClipName = '';
  private loaded = false;
  private phaseDriven = false;
  private currentName = 'idle';
  private staff: THREE.Object3D | null = null;

  constructor(readonly def: CharacterDef) {
    this.inner = new CharacterRig(def);
    this.group.add(this.inner.group);
    new GLTFLoader().load(
      modelUrl(def),
      (gltf) => this.onLoaded(gltf),
      undefined,
      (err) => {
        console.warn('[glbRig] 加载失败，回退程序化 rig：', err);
      }
    );
  }

  private onLoaded(gltf: GLTF): void {
    const scene = gltf.scene;
    scene.traverse((o: THREE.Object3D) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });

    // 缩放 + 居中 + 接地：让角色高 ≈ def.height、脚对齐 group 原点 y≈0、X/Z 居中
    const box = new THREE.Box3().setFromObject(scene);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const scale = this.def.height / Math.max(0.0001, size.y);
    scene.scale.setScalar(scale);
    scene.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);

    if (FORWARD_FLIP) scene.rotation.y = Math.PI;

    this.gltfScene = scene;
    this.mixer = new THREE.AnimationMixer(scene);
    for (const clip of gltf.animations) {
      const action = this.mixer.clipAction(clip);
      action.enabled = true;
      this.actions.set(clip.name, action);
    }

    // 筄山：GLB 不含长棍 → 运行时程序化挂到右手骨
    if (this.def.weapon === 'staff') {
      const hand = scene.getObjectByName('mixamorigRightHand');
      if (hand) {
        const staff = buildStaff();
        hand.add(staff);
        this.staff = staff;
      } else {
        console.warn('[glbRig] 未找到 mixamorigRightHand，长棍未挂载');
      }
    }

    // 切换到 GLB 视觉
    this.inner.group.visible = false;
    this.group.add(scene);
    this.loaded = true;

    // 重放当前 clip（加载前 fighter 已 play 过 intro/idle 等）
    this.play(this.currentName, this.phaseDriven, 1, true);
  }

  play(name: string, phaseDriven: boolean, blend = 18, force = false): void {
    this.currentName = name;
    this.phaseDriven = phaseDriven;
    if (!this.loaded || !this.mixer) {
      this.inner.play(name, phaseDriven, blend, force);
      return;
    }
    const clipName = resolveClip(name, this.def);
    if (!this.actions.has(clipName)) {
      console.warn(`[glbRig] clip "${name}" → "${clipName}" 不存在，回退 Idle_Loop`);
      this.transitionTo('Idle_Loop', blend, false);
      return;
    }
    if (!force && this.activeClipName === clipName && this.phaseDriven === phaseDriven) return;
    this.transitionTo(clipName, force ? Math.min(blend, 4) : blend, phaseDriven);
  }

  private transitionTo(clipName: string, blend: number, phaseDriven: boolean): void {
    const next = this.actions.get(clipName);
    if (!next) return;
    const dur = Math.max(0.001, blend / 60);
    if (this.activeAction && this.activeAction !== next) {
      this.activeAction.fadeOut(dur);
    }
    next.enabled = true;
    next.paused = phaseDriven;
    next.setEffectiveWeight(1);
    next.reset();
    next.fadeIn(dur);
    next.play();
    this.activeAction = next;
    this.activeClipName = clipName;
  }

  setPhase(t: number): void {
    if (!this.loaded || !this.mixer) {
      this.inner.setPhase(t);
      return;
    }
    if (this.phaseDriven && this.activeAction) {
      const clip = this.activeAction.getClip();
      this.activeAction.time = THREE.MathUtils.clamp(t, 0, 1) * clip.duration;
    }
  }

  update(dt: number): void {
    if (!this.loaded || !this.mixer) {
      this.inner.update(dt);
      return;
    }
    this.mixer.update(dt);
  }

  setFacing(dir: 1 | -1): void {
    this.group.rotation.y = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
  }

  setTier(tier: Tier): void {
    this.inner.setTier(tier);
  }

  get staffObject(): THREE.Object3D | null {
    return this.staff;
  }

  /** 调试/探针用：GLB 加载与动画播放状态。 */
  debug(): {
    id: string;
    loaded: boolean;
    activeClip: string;
    clipCount: number;
    skinnedMeshes: number;
    staffAttached: boolean;
    fallbackVisible: boolean;
  } {
    let skinned = 0;
    this.gltfScene?.traverse((o) => {
      if (o instanceof THREE.SkinnedMesh) skinned++;
    });
    return {
      id: this.def.id,
      loaded: this.loaded,
      activeClip: this.activeClipName,
      clipCount: this.actions.size,
      skinnedMeshes: skinned,
      staffAttached: !!this.staff,
      fallbackVisible: this.inner.group.visible,
    };
  }

  dispose(): void {
    this.inner.dispose();
    this.group.parent?.remove(this.group);
    this.mixer?.stopAllAction();
    if (this.gltfScene) {
      this.gltfScene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          const m = o.material;
          if (Array.isArray(m)) m.forEach((x) => x.dispose());
          else m.dispose();
        }
      });
    }
    this.actions.clear();
  }
}

/** 角色渲染器工厂：默认返回 GLB 驱动 rig（内置程序化降级）。 */
export function createRig(def: CharacterDef): Rig {
  return new GLBRig(def);
}
