/**
 * 骨骼动画 Clip 库（原创，全部由代码关键帧定义，无外部动作捕捉数据）
 *
 * 命名规范见 docs/07-接口契约.md：
 *   atk_light / atk_medium / atk_heavy / atk_crouch / atk_air
 *   atk_special_1 / atk_special_2 / throw_start / throw_exec
 *   idle / walk_f / walk_b / crouch / jump_up / jump_fall / land
 *   block_stand / block_crouch / hit_light / hit_heavy / ko / victory / intro
 *
 * 坐标系：角色朝向 +Z（构建后整体绕 Y 轴旋转朝向对手）。
 * 角度单位为度，[rx, ry, rz]，作用于骨骼局部。
 */

export type JointName =
  | 'hips'
  | 'spine'
  | 'chest'
  | 'neck'
  | 'head'
  | 'shoulderL'
  | 'upperArmL'
  | 'forearmL'
  | 'handL'
  | 'shoulderR'
  | 'upperArmR'
  | 'forearmR'
  | 'handR'
  | 'thighL'
  | 'shinL'
  | 'footL'
  | 'thighR'
  | 'shinR'
  | 'footR';

export type Pose = Partial<Record<JointName, [number, number, number]>>;

export interface Key {
  t: number; // 0..1 归一化时间
  pose: Pose;
  /** 关键帧级根部高度：给了就参与插值，没给就沿用 clip.rootY */
  rootY?: number;
}

export interface Clip {
  dur: number; // 秒（归一化时间下为 1）
  loop: boolean;
  normalized: boolean;
  rootY?: number;
  keys: Key[];
}

export const BASE_POSE: Pose = {
  hips: [0, 0, 0],
  spine: [0, 0, 0],
  chest: [-2, 0, 0],
  neck: [2, 0, 0],
  head: [0, 0, 0],
  shoulderL: [0, 0, -4],
  upperArmL: [-6, 0, 12],
  forearmL: [-22, 0, 4],
  handL: [0, 0, 0],
  shoulderR: [0, 0, 4],
  upperArmR: [-6, 0, -12],
  forearmR: [-22, 0, -4],
  handR: [0, 0, 0],
  thighL: [0, 0, 4],
  shinL: [6, 0, 0],
  footL: [-4, 0, 0],
  thighR: [0, 0, -4],
  shinR: [6, 0, 0],
  footR: [-4, 0, 0],
};

/** 站架：左肩在前（朝向 +Z 时左脚略前） */
export const STANCE: Pose = {
  ...BASE_POSE,
  hips: [0, -8, 0],
  chest: [-6, -10, 0],
  head: [0, 16, 0],
  upperArmL: [-38, 0, 16],
  forearmL: [-72, 0, 6],
  upperArmR: [-30, 0, -14],
  forearmR: [-84, 0, -6],
  thighL: [-14, 0, 4],
  shinL: [12, 0, 0],
  thighR: [16, 0, -6],
  shinR: [10, 0, 0],
  footR: [-16, 0, 0],
};

const merge = (a: Pose, b: Pose): Pose => ({ ...a, ...b });

/**
 * 同一套动作数据、按角色站架重新合并一次：
 * 两名角色的站架不同（拳架 vs 持棍侧身），23 个 Clip 由此得到不同剪影，
 * 不是「复制两份动画」，而是同一套关键帧在不同基础姿势上的投影。
 */
const buildClips = (base: Pose): Record<string, Clip> => ({
  idle: {
    dur: 2.4,
    loop: true,
    normalized: false,
    keys: [
      { t: 0, pose: base },
      { t: 0.5, pose: merge(base, { chest: [-8, -10, 0], head: [1, 16, 0], upperArmL: [-41, 0, 16], upperArmR: [-33, 0, -14] }) },
      { t: 1, pose: base },
    ],
  },
  walk_f: {
    dur: 0.62,
    loop: true,
    normalized: false,
    keys: [
      {
        t: 0,
        pose: merge(base, {
          thighL: [-34, 0, 4],
          shinL: [26, 0, 0],
          thighR: [26, 0, -4],
          shinR: [8, 0, 0],
          chest: [-8, -14, 0],
          upperArmL: [-30, 0, 16],
          upperArmR: [-38, 0, -14],
        }),
      },
      { t: 0.5, pose: merge(base, { thighL: [26, 0, 4], shinL: [10, 0, 0], thighR: [-34, 0, -4], shinR: [26, 0, 0] }) },
      { t: 1, pose: merge(base, { thighL: [-34, 0, 4], shinL: [26, 0, 0], thighR: [26, 0, -4], shinR: [8, 0, 0] }) },
    ],
  },
  walk_b: {
    dur: 0.72,
    loop: true,
    normalized: false,
    keys: [
      { t: 0, pose: merge(base, { thighL: [22, 0, 4], shinL: [8, 0, 0], thighR: [-26, 0, -4], shinR: [22, 0, 0], chest: [-4, -10, 0] }) },
      { t: 0.5, pose: merge(base, { thighL: [-26, 0, 4], shinL: [22, 0, 0], thighR: [22, 0, -4], shinR: [8, 0, 0] }) },
      { t: 1, pose: merge(base, { thighL: [22, 0, 4], shinL: [8, 0, 0], thighR: [-26, 0, -4], shinR: [22, 0, 0] }) },
    ],
  },
  crouch: {
    dur: 0.16,
    loop: false,
    normalized: false,
    // 蹲下时根部下沉必须小于腿弯曲抬高的量，否则脚掌会插进地面（实测 -0.071）
    rootY: -0.05,
    keys: [
      { t: 0, pose: base },
      {
        t: 1,
        pose: merge(base, {
          hips: [12, -8, 0],
          chest: [-14, -10, 0],
          thighL: [-46, 0, 6],
          shinL: [72, 0, 0],
          thighR: [12, 0, -8],
          shinR: [86, 0, 0],
          upperArmL: [-52, 0, 18],
          forearmL: [-80, 0, 6],
          upperArmR: [-44, 0, -16],
          forearmR: [-88, 0, -6],
        }),
      },
    ],
  },
  jump_up: {
    dur: 0.3,
    loop: false,
    normalized: false,
    keys: [
      {
        t: 0,
        pose: merge(base, {
          thighL: [-52, 0, 8],
          shinL: [74, 0, 0],
          thighR: [-26, 0, -8],
          shinR: [62, 0, 0],
          upperArmL: [-96, 0, 22],
          upperArmR: [-88, 0, -20],
          chest: [6, -8, 0],
        }),
      },
      { t: 1, pose: merge(base, { thighL: [-40, 0, 8], shinL: [58, 0, 0], thighR: [-18, 0, -8], shinR: [46, 0, 0], upperArmL: [-70, 0, 20], upperArmR: [-64, 0, -18] }) },
    ],
  },
  jump_fall: {
    dur: 0.4,
    loop: false,
    normalized: false,
    keys: [
      { t: 0, pose: merge(base, { thighL: [-24, 0, 6], shinL: [30, 0, 0], thighR: [18, 0, -6], shinR: [24, 0, 0], upperArmL: [-52, 0, 20], upperArmR: [-46, 0, -18] }) },
      { t: 1, pose: merge(base, { thighL: [-14, 0, 6], shinL: [16, 0, 0], thighR: [26, 0, -6], shinR: [14, 0, 0], upperArmL: [-34, 0, 18], upperArmR: [-30, 0, -16] }) },
    ],
  },
  land: {
    dur: 0.22,
    loop: false,
    normalized: false,
    rootY: -0.05,
    keys: [
      { t: 0, pose: merge(base, { thighL: [-46, 0, 6], shinL: [58, 0, 0], thighR: [8, 0, -6], shinR: [62, 0, 0], chest: [-16, -10, 0] }) },
      { t: 1, pose: base },
    ],
  },
  block_stand: {
    dur: 0.14,
    loop: false,
    normalized: false,
    keys: [
      {
        t: 1,
        pose: merge(base, {
          chest: [-14, -18, 0],
          upperArmL: [-76, 0, 30],
          forearmL: [-108, 0, 10],
          upperArmR: [-64, 0, -26],
          forearmR: [-112, 0, -8],
          thighL: [-18, 0, 4],
          thighR: [14, 0, -6],
        }),
      },
    ],
  },
  block_crouch: {
    dur: 0.14,
    loop: false,
    normalized: false,
    rootY: -0.195,
    keys: [
      {
        t: 1,
        pose: merge(base, {
          hips: [14, -8, 0],
          chest: [-20, -16, 0],
          upperArmL: [-84, 0, 32],
          forearmL: [-104, 0, 12],
          upperArmR: [-70, 0, -28],
          forearmR: [-110, 0, -10],
          thighL: [-44, 0, 6],
          shinL: [74, 0, 0],
          thighR: [10, 0, -8],
          shinR: [86, 0, 0],
        }),
      },
    ],
  },
  hit_light: {
    dur: 0.24,
    loop: false,
    normalized: false,
    keys: [
      { t: 0, pose: base },
      { t: 0.25, pose: merge(base, { chest: [10, -2, 0], head: [-18, 6, 0], upperArmL: [-18, 0, 26], upperArmR: [-14, 0, -22], hips: [-6, -4, 0] }) },
      { t: 1, pose: base },
    ],
  },
  hit_heavy: {
    dur: 0.42,
    loop: false,
    normalized: false,
    keys: [
      { t: 0, pose: base },
      {
        t: 0.18,
        pose: merge(base, {
          chest: [22, 6, 0],
          head: [-28, 10, 0],
          hips: [-14, -2, 0],
          upperArmL: [-6, 0, 34],
          upperArmR: [-2, 0, -30],
          thighL: [-30, 0, 8],
          shinL: [40, 0, 0],
        }),
      },
      { t: 1, pose: base },
    ],
  },
  ko: {
    dur: 0.9,
    loop: false,
    normalized: false,
    rootY: -0.62,
    keys: [
      { t: 0, pose: base, rootY: 0 },
      { t: 0.12, pose: base, rootY: -0.04 },
      { t: 0.24, pose: base, rootY: -0.12 },
      {
        rootY: -0.1,
        t: 0.3,
        pose: merge(base, {
          hips: [-24, 0, 0],
          chest: [26, 0, 0],
          head: [-20, 0, 0],
          thighL: [-40, 0, 10],
          shinL: [30, 0, 0],
          upperArmL: [-20, 0, 40],
          upperArmR: [-16, 0, -36],
        }),
      },
      {
        rootY: -0.56,
        t: 1,
        pose: merge(base, {
          hips: [-86, 0, 0],
          chest: [8, 0, 0],
          head: [-14, 0, 0],
          thighL: [-16, 0, 12],
          shinL: [26, 0, 0],
          thighR: [-6, 0, -16],
          shinR: [14, 0, 0],
          upperArmL: [-8, 0, 62],
          upperArmR: [-4, 0, -58],
        }),
      },
    ],
  },
  victory: {
    dur: 1.2,
    loop: true,
    normalized: false,
    keys: [
      { t: 0, pose: merge(base, { chest: [-4, -6, 0], upperArmR: [-150, 0, -18], forearmR: [-40, 0, -10] }) },
      { t: 0.5, pose: merge(base, { chest: [-8, -6, 0], upperArmR: [-160, 0, -22], forearmR: [-30, 0, -10] }) },
      { t: 1, pose: merge(base, { chest: [-4, -6, 0], upperArmR: [-150, 0, -18], forearmR: [-40, 0, -10] }) },
    ],
  },
  intro: {
    dur: 1.0,
    loop: false,
    normalized: false,
    keys: [
      { t: 0, pose: merge(base, { chest: [-2, -4, 0], upperArmL: [-10, 0, 14], upperArmR: [-8, 0, -12] }) },
      { t: 0.5, pose: merge(base, { chest: [-12, -14, 0], upperArmR: [-96, 0, -22], forearmR: [-60, 0, -8] }) },
      { t: 1, pose: base },
    ],
  },

  /* ============ 攻击（归一化 0..1，随招式总帧数推进） ============ */
  atk_light: {
    dur: 1,
    loop: false,
    normalized: true,
    keys: [
      { t: 0, pose: base },
      { t: 0.28, pose: merge(base, { chest: [-4, -22, 0], upperArmR: [-20, 0, -18], forearmR: [-96, 0, -6], hips: [0, -12, 0] }) },
      { t: 0.46, pose: merge(base, { chest: [-8, 16, 0], upperArmR: [-96, 0, -6], forearmR: [-6, 0, -2], hips: [0, 10, 0], head: [0, 4, 0] }) },
      { t: 0.66, pose: merge(base, { chest: [-8, 10, 0], upperArmR: [-88, 0, -8], forearmR: [-18, 0, -2] }) },
      { t: 1, pose: base },
    ],
  },
  atk_medium: {
    dur: 1,
    loop: false,
    normalized: true,
    keys: [
      { t: 0, pose: base },
      { t: 0.32, pose: merge(base, { chest: [-6, -28, 0], hips: [0, -16, 0], upperArmR: [-12, 0, -24], forearmR: [-104, 0, -8], thighR: [18, 0, -6] }) },
      { t: 0.52, pose: merge(base, { chest: [-10, 24, 0], hips: [0, 14, 0], upperArmR: [-102, 0, -4], forearmR: [-4, 0, 0], thighL: [-20, 0, 4] }) },
      { t: 0.72, pose: merge(base, { chest: [-10, 16, 0], upperArmR: [-94, 0, -6], forearmR: [-14, 0, 0] }) },
      { t: 1, pose: base },
    ],
  },
  atk_heavy: {
    dur: 1,
    loop: false,
    normalized: true,
    keys: [
      { t: 0, pose: base },
      {
        t: 0.38,
        pose: merge(base, {
          chest: [2, -34, 0],
          hips: [-4, -20, 0],
          upperArmR: [18, 0, -34],
          forearmR: [-116, 0, -10],
          thighR: [22, 0, -8],
          shinR: [16, 0, 0],
        }),
      },
      {
        t: 0.56,
        pose: merge(base, {
          chest: [-12, 34, 0],
          hips: [2, 20, 0],
          upperArmR: [-108, 0, 2],
          forearmR: [-2, 0, 0],
          thighL: [-34, 0, 4],
          shinL: [26, 0, 0],
          head: [0, 2, 0],
        }),
      },
      { t: 0.74, pose: merge(base, { chest: [-12, 24, 0], upperArmR: [-96, 0, 0], forearmR: [-16, 0, 0] }) },
      { t: 1, pose: base },
    ],
  },
  atk_crouch: {
    dur: 1,
    loop: false,
    normalized: true,
    rootY: -0.11,
    keys: [
      { t: 0, pose: merge(base, { thighL: [-40, 0, 8], shinL: [62, 0, 0], thighR: [10, 0, -8], shinR: [70, 0, 0], chest: [-12, -10, 0] }) },
      {
        t: 0.35,
        pose: merge(base, {
          thighL: [-44, 0, 8],
          shinL: [66, 0, 0],
          thighR: [-76, 0, -12],
          shinR: [16, 0, 0],
          hips: [10, -14, 0],
          chest: [-16, -12, 0],
          upperArmL: [-40, 0, 30],
          upperArmR: [-36, 0, -26],
        }),
      },
      {
        t: 0.55,
        pose: merge(base, {
          thighL: [-42, 0, 8],
          shinL: [58, 0, 0],
          thighR: [-96, 0, -10],
          shinR: [6, 0, 0],
          hips: [8, 12, 0],
          chest: [-10, 6, 0],
        }),
      },
      { t: 1, pose: merge(base, { thighL: [-40, 0, 8], shinL: [62, 0, 0], thighR: [10, 0, -8], shinR: [70, 0, 0] }) },
    ],
  },
  atk_air: {
    dur: 1,
    loop: false,
    normalized: true,
    keys: [
      { t: 0, pose: merge(base, { thighL: [-30, 0, 6], shinL: [40, 0, 0], thighR: [20, 0, -6], shinR: [30, 0, 0], upperArmR: [-60, 0, -20] }) },
      {
        t: 0.4,
        pose: merge(base, {
          thighL: [-40, 0, 6],
          shinL: [30, 0, 0],
          thighR: [26, 0, -6],
          shinR: [36, 0, 0],
          upperArmR: [-40, 0, -16],
          forearmR: [-120, 0, -6],
          chest: [4, -16, 0],
        }),
      },
      {
        t: 0.6,
        pose: merge(base, {
          thighL: [-24, 0, 6],
          shinL: [24, 0, 0],
          thighR: [12, 0, -6],
          shinR: [30, 0, 0],
          upperArmR: [-128, 0, -8],
          forearmR: [-10, 0, 0],
          chest: [-12, 14, 0],
        }),
      },
      { t: 1, pose: merge(base, { thighL: [-28, 0, 6], shinL: [34, 0, 0], thighR: [18, 0, -6], shinR: [28, 0, 0] }) },
    ],
  },
  atk_special_1: {
    dur: 1,
    loop: false,
    normalized: true,
    keys: [
      { t: 0, pose: base },
      {
        t: 0.22,
        pose: merge(base, {
          chest: [4, -30, 0],
          hips: [-6, -16, 0],
          upperArmL: [10, 0, 26],
          forearmL: [-100, 0, 8],
          upperArmR: [14, 0, -28],
          forearmR: [-104, 0, -8],
          thighR: [24, 0, -8],
        }),
      },
      {
        t: 0.34,
        pose: merge(base, {
          chest: [-14, 18, 0],
          hips: [0, 12, 0],
          upperArmR: [-112, 0, 0],
          forearmR: [-2, 0, 0],
          upperArmL: [-70, 0, 20],
          forearmL: [-90, 0, 6],
          thighL: [-30, 0, 4],
        }),
      },
      {
        t: 0.5,
        pose: merge(base, {
          chest: [-12, 6, 0],
          upperArmL: [-116, 0, 4],
          forearmL: [-4, 0, 0],
          upperArmR: [-52, 0, -16],
          forearmR: [-96, 0, -6],
        }),
      },
      {
        t: 0.66,
        pose: merge(base, {
          chest: [-14, 22, 0],
          upperArmR: [-124, 0, 2],
          forearmR: [-2, 0, 0],
          upperArmL: [-40, 0, 18],
          forearmL: [-80, 0, 6],
        }),
      },
      { t: 1, pose: base },
    ],
  },
  atk_special_2: {
    dur: 1,
    loop: false,
    normalized: true,
    rootY: -0.06,
    keys: [
      { t: 0, pose: base },
      {
        t: 0.42,
        pose: merge(base, {
          chest: [14, -10, 0],
          hips: [-10, -8, 0],
          upperArmL: [-160, 0, 14],
          upperArmR: [-156, 0, -14],
          forearmL: [-20, 0, 0],
          forearmR: [-20, 0, 0],
          head: [-14, 6, 0],
        }),
      },
      {
        t: 0.52,
        pose: merge(base, {
          chest: [-20, -6, 0],
          hips: [16, -6, 0],
          upperArmL: [-24, 0, 22],
          upperArmR: [-20, 0, -20],
          forearmL: [-30, 0, 4],
          forearmR: [-26, 0, -4],
          thighL: [-56, 0, 8],
          shinL: [78, 0, 0],
          thighR: [4, 0, -10],
          shinR: [84, 0, 0],
          head: [-8, 6, 0],
        }),
      },
      {
        t: 0.7,
        pose: merge(base, {
          chest: [-16, -8, 0],
          hips: [12, -6, 0],
          upperArmL: [-30, 0, 24],
          upperArmR: [-26, 0, -22],
          thighL: [-48, 0, 8],
          shinL: [70, 0, 0],
          thighR: [8, 0, -10],
          shinR: [76, 0, 0],
        }),
      },
      { t: 1, pose: base },
    ],
  },
  throw_start: {
    dur: 1,
    loop: false,
    normalized: true,
    keys: [
      { t: 0, pose: base },
      {
        t: 0.3,
        pose: merge(base, {
          chest: [-16, -20, 0],
          upperArmL: [-96, 0, 20],
          forearmL: [-40, 0, 6],
          upperArmR: [-92, 0, -18],
          forearmR: [-40, 0, -6],
        }),
      },
      {
        t: 0.55,
        pose: merge(base, {
          chest: [-4, 10, 0],
          upperArmL: [-70, 0, 14],
          upperArmR: [-66, 0, -12],
          hips: [0, 8, 0],
        }),
      },
      { t: 1, pose: base },
    ],
  },
  throw_exec: {
    dur: 1,
    loop: false,
    normalized: true,
    keys: [
      { t: 0, pose: base },
      {
        t: 0.2,
        pose: merge(base, {
          chest: [-18, -24, 0],
          upperArmL: [-100, 0, 22],
          upperArmR: [-96, 0, -20],
          hips: [-8, -12, 0],
        }),
      },
      {
        t: 0.45,
        pose: merge(base, {
          chest: [-26, 24, 0],
          hips: [6, 16, 0],
          upperArmL: [-130, 0, 12],
          upperArmR: [-126, 0, -10],
          forearmL: [-20, 0, 0],
          forearmR: [-18, 0, 0],
          thighL: [-36, 0, 6],
        }),
      },
      { t: 1, pose: base },
    ],
  },
});

export const CLIPS: Record<string, Clip> = buildClips(STANCE);

/** 筄山：持棍侧身架。重心更低、肩线更侧、右手把棍收在体侧 */
export const YAOSHAN_STANCE: Pose = merge(STANCE, {
  chest: [-4, 14, 0],
  hips: [0, 10, 0],
  head: [2, -8, 0],
  upperArmR: [-26, 0, -24],
  forearmR: [-58, 0, -6],
  upperArmL: [-20, 0, 26],
  forearmL: [-66, 0, 10],
  thighL: [-18, 0, 10],
  shinL: [16, 0, 0],
  thighR: [18, 0, -10],
  shinR: [14, 0, 0],
  footR: [-18, 0, 0],
});

export const CLIPS_YAOSHAN: Record<string, Clip> = buildClips(YAOSHAN_STANCE);


