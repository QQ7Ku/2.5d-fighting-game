/**
 * v2.0.8 场景氛围动效（纯装饰，不进 props/specs/破坏链）：
 * 经幡飘动、香炉青烟、飞鸟剪影，以及破坏事件分派（香炉碎后青烟 / 经幡杆碎后落幡）。
 *
 * - 模块内 `bus.on('destroy:break', ...)` 订阅；全库原无消费方，`destruction.ts` 判定逻辑零改。
 * - 只操作自建 Sprite（非 Mesh，不进 arena.props、不影响 PBR 材质统计、不新增 rAF）。
 * - 灯笼轻摆 / 落叶沿用 arena.ts 现有逻辑，这里不重复实现。
 * - `attach(scene)` 由 Arena 构造注入场景；`tick(dt)` 由 Arena.update 用现成主循环驱动。
 */

import * as THREE from 'three';
import { bus } from '../core/bus';

type MoteKind = 'smoke' | 'bird';

interface Mote {
  s: THREE.Sprite;
  vx: number;
  life: number;
  scale: number;
  opacity: number;
  home: [number, number, number];
  kind: MoteKind;
}

/** 香炉口 / 经幡杆顶的世界坐标（与 shuangting.json 的 spec 对齐）：
 *  BURNER.x 收进炉口半宽内（原 0.9 飘出炉体），POLE.x 对齐经幡杆 spec.x=-6.3。 */
const BURNER: [number, number, number] = [0.15, 0.9, 0];
const POLE: [number, number, number] = [-6.3, 2.4, -1.7];

let scene: THREE.Scene | null = null;
let t = 0;
let smokeBoost = 0;
let bannerBroken = false;
let banner: THREE.Sprite | null = null;
const motes: Mote[] = [];

function softTex(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function makeSprite(tex: THREE.Texture, color: number, opacity: number): THREE.Sprite {
  const mat = new THREE.SpriteMaterial({
    map: tex,
    color,
    transparent: true,
    opacity,
    depthWrite: false,
  });
  return new THREE.Sprite(mat);
}

/** 注入场景引用并创建常驻氛围对象（幂等）。冻结接口未列，属驱动氛围对象的必要补充。 */
export function attach(s: THREE.Scene): void {
  if (scene) return;
  scene = s;
  const tex = softTex();

  // 飞鸟剪影：4 只，高空远处横向巡飞（深色细长 Sprite）
  for (let i = 0; i < 4; i++) {
    const sp = makeSprite(tex, 0x1b2630, 0.4);
    const home: [number, number, number] = [-10 + i * 5, 4.2 + (i % 2) * 0.9, -9 - (i % 2)];
    sp.position.set(home[0], home[1], home[2]);
    sp.scale.set(0.5, 0.16, 1);
    s.add(sp);
    motes.push({ s: sp, vx: 0.6 + i * 0.15, life: 0, scale: 0.5, opacity: 0.4, home, kind: 'bird' });
  }

  // 香炉青烟：6 缕，从炉口循环上升、随高度淡出
  for (let i = 0; i < 6; i++) {
    const sp = makeSprite(tex, 0x9aa7a2, 0.3);
    const home: [number, number, number] = [BURNER[0] + (i - 2.5) * 0.08, BURNER[1], BURNER[2]];
    sp.position.set(home[0], home[1] + (i / 6) * 1.4, home[2]);
    sp.scale.setScalar(0.35);
    s.add(sp);
    motes.push({ s: sp, vx: 0, life: i / 6, scale: 0.35, opacity: 0.3, home, kind: 'smoke' });
  }

  // 经幡：杆顶一片朱红布，随 tick 轻摆；破坏后落幡
  banner = makeSprite(tex, 0xb3402f, 0.55);
  banner.position.set(POLE[0], POLE[1], POLE[2]);
  banner.scale.set(0.9, 0.5, 1);
  s.add(banner);
}

export function tick(dt: number): void {
  if (!scene) return;
  t += dt;
  smokeBoost = Math.max(0, smokeBoost - dt * 0.35);

  for (const m of motes) {
    const mat = m.s.material as THREE.SpriteMaterial;
    if (m.kind === 'bird') {
      m.s.position.x += m.vx * dt;
      if (m.s.position.x > 12) m.s.position.x = -12;
      m.s.position.y = m.home[1] + Math.sin(t * 1.6 + m.home[0]) * 0.12;
      mat.opacity = m.opacity;
    } else {
      m.life += dt * (0.55 + smokeBoost * 0.5);
      if (m.life >= 1) m.life -= 1;
      const k = m.life;
      m.s.position.set(
        m.home[0] + Math.sin(t * 0.8 + m.home[0] * 5) * 0.18 * k,
        m.home[1] + k * 1.5,
        m.home[2]
      );
      m.s.scale.setScalar(m.scale * (0.6 + k * 1.2) * (1 + smokeBoost * 0.4));
      mat.opacity = Math.min(1, m.opacity * (1 - k) * 0.9 * (1 + smokeBoost * 1.5));
    }
  }

  if (banner) {
    const bm = banner.material as THREE.SpriteMaterial;
    if (bannerBroken) {
      banner.position.y = Math.max(POLE[1] - 1.8, banner.position.y - dt * 1.2);
      bm.opacity = Math.max(0, bm.opacity - dt * 0.6);
    } else {
      bm.rotation = Math.sin(t * 1.8) * 0.08;
      banner.position.x = POLE[0] + Math.sin(t * 1.1) * 0.06;
    }
  }
}

/** 破坏特效分派：香炉碎 → 青烟爆发；经幡杆碎 → 落幡。其余 id 不处理。 */
export function onBreak(objectId: string): void {
  if (!scene) return;
  if (objectId === 'incense-burner') smokeBoost = 1;
  else if (objectId === 'sutra-pole') bannerBroken = true;
}

bus.on('destroy:break', ({ objectId }) => onBreak(objectId));
bus.on('round:start', () => {
  bannerBroken = false;
  smokeBoost = 0;
  if (banner) {
    banner.position.set(POLE[0], POLE[1], POLE[2]);
    const bm = banner.material as THREE.SpriteMaterial;
    bm.opacity = 0.55;
    bm.rotation = 0;
  }
});
