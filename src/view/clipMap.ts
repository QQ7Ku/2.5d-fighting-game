/**
 * 游戏 clip 名 → Lux3D GLB 内 AnimationClip 名的映射表。
 *
 * 这是「游戏动画 ↔ Lux3D 资产」的唯一接驳点：未来要新增动作，只改这里（外加重新 retarget + 合并 GLB）。
 *
 * 已知约束（来自资产实际内容，`public/models/*_animated.glb` 各含 16 个命名 clip）：
 * - 平台只有通用动作，没有长棍招式、没有本作原创必杀（缠丝劲/回澜棍/掷棍归巢），原创必杀复用最近通用动作。
 * - 受击只有 `Hit_Chest` 一个 clip（无 `Hit_Knockback`）。
 * - 无 `victory` clip，胜利复用 `Idle_Loop` / `Sword_Idle`。
 * - 两角色 GLB 都包含全部 16 个 clip，故按 `def.weapon` 分流攻击映射即可。
 */

import type { CharacterDef } from '../data/moves';

/** 基础映射（两角色相同）。`victory` 在 resolveClip 里按武器再细分。 */
const BASE: Record<string, string> = {
  idle: 'Idle_Loop',
  intro: 'Idle_Loop',
  walk_f: 'Walk_Loop',
  walk_b: 'Walk_Loop',
  crouch: 'Crouch_Idle_Loop',
  block_stand: 'Sword_Block',
  block_crouch: 'Sword_Block',
  jump_up: 'Jump_Start',
  jump_fall: 'Jump_Loop',
  land: 'Jump_Land',
  ko: 'Death01',
  hit_light: 'Hit_Chest',
  hit_heavy: 'Hit_Chest',
};

/** 攻击映射，按武器分两套。 */
const ATTACKS: Record<'none' | 'staff', Record<string, string>> = {
  // 李宾：空手，拳/钩类通用动作
  none: {
    atk_light: 'Punch_Jab',
    atk_medium: 'Punch_Cross',
    atk_heavy: 'Melee_Hook',
    atk_crouch: 'Melee_Hook',
    atk_air: 'Punch_Jab',
    throw_exec: 'Melee_Hook',
  },
  // 筄山：长棍，剑/棍类通用动作
  staff: {
    atk_light: 'Sword_Regular_A',
    atk_medium: 'Sword_Attack',
    atk_heavy: 'Sword_Attack',
    atk_crouch: 'Sword_Regular_A',
    atk_air: 'Sword_Attack',
    throw_exec: 'Sword_Attack',
  },
};

/**
 * 把游戏侧 clip 名解析为 GLB 内 AnimationClip 名。
 * 未知 clip（含原创必杀的 `move.clip`）回退到该武器的「重攻击」通用动作，再不行回退 `Idle_Loop`。
 */
export function resolveClip(gameClip: string, def: CharacterDef): string {
  if (gameClip === 'victory') {
    return def.weapon === 'staff' ? 'Sword_Idle' : 'Idle_Loop';
  }
  if (BASE[gameClip]) return BASE[gameClip];
  const atk = ATTACKS[def.weapon][gameClip];
  if (atk) return atk;
  // 必杀 / 未知 → 武器默认重攻击；仍无则 Idle_Loop
  return ATTACKS[def.weapon].atk_heavy ?? 'Idle_Loop';
}
