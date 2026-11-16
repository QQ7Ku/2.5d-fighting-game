/**
 * 招式与角色数据定义
 * - 普通攻击、投技：策划手写（hand-authored）
 * - 必杀技：来自已审核入库的 Skill JSON（skills/generated → skills.generated.json）
 * 两者在运行时统一转换为 MoveDef，战斗系统只认 MoveDef。
 */

import bundle from './skills.generated.json';
import type { Rect } from '../core/math';

export type GuardType = 'mid' | 'low' | 'overhead' | 'unblockable';
export type Motion = 'none' | 'qcf' | 'qcb' | 'dp' | 'charge';
export type AttackButton = 'light' | 'medium' | 'heavy' | 'special';

export interface HitDef {
  id: string;
  start: number;
  end: number;
  box: Rect;
  damage: number;
  hitstun: number;
  blockstun: number;
  hitstop: number;
  knockback: { x: number; y: number };
  guard: GuardType;
  destroy: 0 | 1 | 2 | 3;
  meterGain: number;
  fx: string;
  sfx: string;
}

export interface MoveDef {
  id: string;
  name: string;
  kind: 'normal' | 'special' | 'throw';
  button: AttackButton | 'throw';
  motion: Motion;
  startup: number;
  active: number;
  recovery: number;
  total: number;
  hits: HitDef[];
  moveX: { frame: number; vx: number; vy?: number }[];
  cancelInto: string[];
  cancelWindow: [number, number];
  clip: string;
  clipSpeed: number;
  meterCost: number;
  cooldown: number;
  vfx: { preset: string; color: string; scale: number; trail: boolean; shake: number };
  voice: string;
  whoosh: string;
  requiresGround: boolean;
  airOk: boolean;
  invuln: [number, number] | null;
  isThrow: boolean;
  throwRange: number;
  knockdown: boolean;
}

export interface CharacterDef {
  id: 'libin' | 'yaoshan';
  name: string;
  title: string;
  height: number;
  weight: number;
  walkSpeed: number;
  backSpeed: number;
  jumpVelocity: number;
  gravity: number;
  weapon: 'none' | 'staff';
  palette: {
    skin: number;
    cloth: number;
    trim: number;
    accent: number;
    hair: number;
  };
  moves: MoveDef[];
}

interface SkillJson {
  skillId: string;
  characterId: string;
  displayName: { zh: string };
  input: { motion: Motion; button: AttackButton; requiresGround: boolean };
  frames: { startup: number; active: number; recovery: number };
  hits: Array<{
    id: string;
    start: number;
    end: number;
    box: Rect;
    damage: number;
    hitstun: number;
    blockstun: number;
    hitstop: number;
    knockback: { x: number; y: number };
    guard: GuardType;
    destructionLevel: 0 | 1 | 2 | 3;
    meterGain: number;
    fx: string;
    sfx: string;
  }>;
  movement: Array<{ frame: number; vx: number; vy?: number }>;
  animation: { clip: string; speed: number; cancelInto: string[]; cancelWindow: number[] };
  vfx3d: { preset: string; colorHex: string; scale: number; trail: boolean; shakeStrength: number };
  audio: { voice: string; impact: string };
  resource: { meterCost: number; cooldownFrames: number };
  compat: { comboFrom: string[]; comboInto: string[]; airOk: boolean; tags: string[] };
}

const skillBundle = bundle as unknown as { skills: SkillJson[] };

function fromSkill(s: SkillJson): MoveDef {
  return {
    id: s.skillId,
    name: s.displayName.zh,
    kind: 'special',
    button: 'special',
    motion: s.input.motion,
    startup: s.frames.startup,
    active: s.frames.active,
    recovery: s.frames.recovery,
    total: s.frames.startup + s.frames.active + s.frames.recovery,
    hits: s.hits.map((h) => ({
      id: `${s.skillId}_${h.id}`,
      start: h.start,
      end: h.end,
      box: h.box,
      damage: h.damage,
      hitstun: h.hitstun,
      blockstun: h.blockstun,
      hitstop: h.hitstop,
      knockback: h.knockback,
      guard: h.guard,
      destroy: h.destructionLevel,
      meterGain: h.meterGain,
      fx: h.fx,
      sfx: h.sfx,
    })),
    moveX: s.movement,
    cancelInto: s.animation.cancelInto,
    cancelWindow: [s.animation.cancelWindow[0], s.animation.cancelWindow[1]],
    clip: s.animation.clip,
    clipSpeed: s.animation.speed,
    meterCost: s.resource.meterCost,
    cooldown: s.resource.cooldownFrames,
    vfx: {
      preset: s.vfx3d.preset,
      color: s.vfx3d.colorHex,
      scale: s.vfx3d.scale,
      trail: s.vfx3d.trail,
      shake: s.vfx3d.shakeStrength,
    },
    voice: s.audio.voice,
    whoosh: s.audio.impact,
    requiresGround: s.input.requiresGround,
    airOk: s.compat.airOk,
    invuln: null,
    isThrow: false,
    throwRange: 0,
    knockdown: s.hits.some((h) => h.knockback.y > 0.25),
  };
}

type NormalSpec = {
  id: string;
  name: string;
  button: AttackButton;
  crouch?: boolean;
  air?: boolean;
  startup: number;
  active: number;
  recovery: number;
  hits: Array<Partial<HitDef> & { box: Rect; damage: number }>;
  moveX?: { frame: number; vx: number }[];
  destroy?: 0 | 1 | 2 | 3;
  knockdown?: boolean;
  knockback?: { x: number; y: number };
  hitstun?: number;
};

function normal(spec: NormalSpec): MoveDef {
  return {
    id: spec.id,
    name: spec.name,
    kind: 'normal',
    button: spec.button,
    motion: 'none',
    startup: spec.startup,
    active: spec.active,
    recovery: spec.recovery,
    total: spec.startup + spec.active + spec.recovery,
    hits: spec.hits.map((h, i) => ({
      id: `${spec.id}_${i}`,
      start: h.start ?? spec.startup,
      end: h.end ?? spec.startup + spec.active - 1,
      box: h.box,
      damage: h.damage,
      hitstun: h.hitstun ?? spec.hitstun ?? 14,
      blockstun: h.blockstun ?? 7,
      hitstop: h.hitstop ?? 4,
      knockback: h.knockback ?? spec.knockback ?? { x: 2, y: 0 },
      guard: h.guard ?? 'mid',
      destroy: (h.destroy ?? spec.destroy ?? 0) as 0 | 1 | 2 | 3,
      meterGain: h.meterGain ?? 4,
      fx: h.fx ?? 'spark_small',
      sfx: h.sfx ?? 'impact_light',
    })),
    moveX: spec.moveX ?? [],
    cancelInto: [],
    cancelWindow: [0, 0],
    clip:
      spec.air
        ? 'atk_air'
        : spec.crouch
          ? 'atk_crouch'
          : spec.button === 'light'
            ? 'atk_light'
            : spec.button === 'medium'
              ? 'atk_medium'
              : 'atk_heavy',
    clipSpeed: 1,
    meterCost: 0,
    cooldown: 0,
    vfx: { preset: 'impact_flash', color: '#efe6d4', scale: 0.8, trail: false, shake: 0.12 },
    voice: '',
    whoosh: spec.button === 'heavy' ? 'whoosh_heavy' : spec.button === 'medium' ? 'whoosh_medium' : 'whoosh_light',
    requiresGround: !spec.air,
    airOk: !!spec.air,
    invuln: null,
    isThrow: false,
    throwRange: 0,
    knockdown: spec.knockdown ?? false,
  };
}

const throwMove = (id: string, name: string, damage: number, clip: string): MoveDef => ({
  id,
  name,
  kind: 'throw',
  button: 'throw',
  motion: 'none',
  startup: 6,
  active: 3,
  recovery: 26,
  total: 35,
  hits: [
    {
      id: `${id}_h1`,
      start: 6,
      end: 8,
      box: { x: 0.75, y: 1.0, w: 1.3, h: 1.4 },
      damage,
      hitstun: 30,
      blockstun: 0,
      hitstop: 10,
      knockback: { x: 4.6, y: 0.24 },
      guard: 'unblockable',
      destroy: 2,
      meterGain: 8,
      fx: 'dust_burst',
      sfx: 'throw',
    },
  ],
  moveX: [],
  cancelInto: [],
  cancelWindow: [0, 0],
  clip,
  clipSpeed: 1,
  meterCost: 0,
  cooldown: 0,
  vfx: { preset: 'dust_burst', color: '#cbbfa6', scale: 1, trail: false, shake: 0.4 },
  voice: '',
  whoosh: 'throw',
  requiresGround: true,
  airOk: false,
  invuln: null,
  isThrow: true,
  throwRange: 1.5,
  knockdown: true,
});

const LIBIN_NORMALS: MoveDef[] = [
  normal({
    id: 'libin_n_l1',
    name: '点掌',
    button: 'light',
    startup: 4,
    active: 3,
    recovery: 8,
    hits: [{ box: { x: 0.72, y: 1.22, w: 0.95, h: 0.62 }, damage: 22, knockback: { x: 1.1, y: 0 } }],
  }),
  normal({
    id: 'libin_n_l2',
    name: '扫腿',
    button: 'light',
    crouch: true,
    startup: 6,
    active: 3,
    recovery: 10,
    hits: [{ box: { x: 0.78, y: 0.3, w: 1.15, h: 0.5 }, damage: 24, guard: 'low' }],
  }),
  normal({
    id: 'libin_n_m1',
    name: '崩拳',
    button: 'medium',
    startup: 8,
    active: 4,
    recovery: 14,
    moveX: [{ frame: 6, vx: 0.05 }],
    hits: [{ box: { x: 0.9, y: 1.2, w: 1.25, h: 0.75 }, damage: 44, hitstun: 16, knockback: { x: 2.2, y: 0 } }],
  }),
  normal({
    id: 'libin_n_m2',
    name: '蹬膝',
    button: 'medium',
    crouch: true,
    startup: 9,
    active: 4,
    recovery: 15,
    hits: [{ box: { x: 0.85, y: 0.55, w: 1.3, h: 0.9 }, damage: 40, guard: 'low', destroy: 1 }],
  }),
  normal({
    id: 'libin_n_h1',
    name: '贯心肘',
    button: 'heavy',
    startup: 14,
    active: 5,
    recovery: 22,
    moveX: [{ frame: 10, vx: 0.09 }],
    hits: [
      {
        box: { x: 1.0, y: 1.18, w: 1.35, h: 0.95 },
        damage: 68,
        hitstun: 20,
        hitstop: 7,
        knockback: { x: 4.2, y: 0 },
        destroy: 2,
        sfx: 'impact_heavy',
      },
    ],
  }),
  normal({
    id: 'libin_n_h2',
    name: '劈山腿',
    button: 'heavy',
    crouch: true,
    startup: 16,
    active: 6,
    recovery: 24,
    hits: [
      {
        box: { x: 0.95, y: 0.72, w: 1.5, h: 1.1 },
        damage: 74,
        hitstun: 22,
        hitstop: 8,
        knockback: { x: 5.2, y: 0.22 },
        destroy: 2,
        guard: 'low',
        sfx: 'impact_heavy',
      },
    ],
    knockdown: true,
  }),
  normal({
    id: 'libin_n_air',
    name: '坠掌',
    button: 'heavy',
    air: true,
    startup: 6,
    active: 5,
    recovery: 10,
    hits: [{ box: { x: 0.7, y: 1.0, w: 1.2, h: 1.0 }, damage: 46, destroy: 1 }],
  }),
];

const YAOSHAN_NORMALS: MoveDef[] = [
  normal({
    id: 'yaoshan_n_l1',
    name: '扫尘',
    button: 'light',
    startup: 6,
    active: 3,
    recovery: 10,
    hits: [{ box: { x: 1.05, y: 1.15, w: 1.7, h: 0.6 }, damage: 24 }],
  }),
  normal({
    id: 'yaoshan_n_l2',
    name: '穿林刺',
    button: 'light',
    crouch: true,
    startup: 8,
    active: 4,
    recovery: 14,
    hits: [{ box: { x: 1.35, y: 0.55, w: 2.0, h: 0.55 }, damage: 28, guard: 'low' }],
  }),
  normal({
    id: 'yaoshan_n_m1',
    name: '横月',
    button: 'medium',
    startup: 10,
    active: 4,
    recovery: 16,
    hits: [
      {
        box: { x: 1.4, y: 1.2, w: 2.2, h: 0.85 },
        damage: 46,
        hitstun: 16,
        knockback: { x: 2.4, y: 0 },
        destroy: 1,
      },
    ],
  }),
  normal({
    id: 'yaoshan_n_m2',
    name: '落钟砸',
    button: 'medium',
    crouch: true,
    startup: 12,
    active: 5,
    recovery: 18,
    hits: [{ box: { x: 1.2, y: 0.6, w: 1.9, h: 0.95 }, damage: 44, guard: 'low', destroy: 1 }],
  }),
  normal({
    id: 'yaoshan_n_h1',
    name: '劈山棍',
    button: 'heavy',
    startup: 18,
    active: 5,
    recovery: 26,
    moveX: [{ frame: 14, vx: 0.07 }],
    hits: [
      {
        box: { x: 1.55, y: 1.25, w: 2.4, h: 1.0 },
        damage: 76,
        hitstun: 22,
        hitstop: 8,
        knockback: { x: 5.0, y: 0 },
        destroy: 2,
        sfx: 'impact_heavy',
      },
    ],
  }),
  normal({
    id: 'yaoshan_n_h2',
    name: '挑梁',
    button: 'heavy',
    crouch: true,
    startup: 15,
    active: 5,
    recovery: 24,
    hits: [
      {
        box: { x: 1.15, y: 0.9, w: 1.7, h: 1.6 },
        damage: 66,
        hitstun: 24,
        knockback: { x: 1.2, y: 0.48 },
        destroy: 2,
        sfx: 'impact_heavy',
      },
    ],
    knockdown: true,
  }),
  normal({
    id: 'yaoshan_n_air',
    name: '压棍',
    button: 'heavy',
    air: true,
    startup: 7,
    active: 6,
    recovery: 12,
    hits: [{ box: { x: 0.95, y: 0.9, w: 1.6, h: 1.2 }, damage: 44, destroy: 1 }],
  }),
];

/**
 * 普通技 → 必杀的取消窗口：文档第 10 节声称「连段以普通技→必杀两段为主」，
 * 但 normal() 把 cancelInto 写法固定为空、窗口 [0,0]，数据层根本不成立。
 * 这里按招式的首个命中帧推出窗口：命中后 1 帧开窗，留 14 帧。
 */
const withCancels = (normals: MoveDef[], specials: MoveDef[]): MoveDef[] =>
  normals.map((m) => {
    if (m.airOk || m.kind !== 'normal') return m;
    const firstHit = m.hits.reduce((min, h) => Math.min(min, h.start), m.total);
    const from = Math.min(firstHit + 1, Math.max(1, m.total - 2));
    const to = Math.min(m.total - 1, from + 14);
    return { ...m, cancelInto: specials.map((s) => s.id), cancelWindow: [from, to] as [number, number] };
  });

const specialsOf = (characterId: string): MoveDef[] =>
  skillBundle.skills.filter((s) => s.characterId === characterId).map(fromSkill);

export const CHARACTERS: Record<'libin' | 'yaoshan', CharacterDef> = {
  libin: {
    id: 'libin',
    name: '李宾',
    title: '拳僧',
    height: 1.72,
    weight: 1.0,
    walkSpeed: 0.052,
    backSpeed: 0.041,
    jumpVelocity: 0.225,
    gravity: 0.0285,
    weapon: 'none',
    palette: { skin: 0xc79a72, cloth: 0xb08340, trim: 0x6d4a2a, accent: 0xc8452f, hair: 0x2a2320 },
    moves: [
      ...withCancels(LIBIN_NORMALS, specialsOf('libin')),
      throwMove('libin_throw', '靠山摔', 86, 'throw_exec'),
      ...specialsOf('libin'),
    ],
  },
  yaoshan: {
    id: 'yaoshan',
    name: '筄山',
    title: '棍衡',
    height: 1.84,
    weight: 1.14,
    walkSpeed: 0.046,
    backSpeed: 0.036,
    jumpVelocity: 0.215,
    gravity: 0.0285,
    weapon: 'staff',
    palette: { skin: 0xb98d63, cloth: 0x3d6b5a, trim: 0x223d33, accent: 0xc8a45c, hair: 0x1d1a18 },
    moves: [
      ...withCancels(YAOSHAN_NORMALS, specialsOf('yaoshan')),
      throwMove('yaoshan_throw', '挑梁式', 92, 'throw_exec'),
      ...specialsOf('yaoshan'),
    ],
  },
};

export function findMove(def: CharacterDef, id: string): MoveDef | undefined {
  return def.moves.find((m) => m.id === id);
}

export const SKILL_BUNDLE_META = {
  bundleVersion: (bundle as { bundleVersion: string }).bundleVersion,
  modelVersion: (bundle as { modelVersion: string }).modelVersion,
  seed: (bundle as { seed: number }).seed,
  promptHash: (bundle as { promptHash: string }).promptHash,
  count: skillBundle.skills.length,
};
