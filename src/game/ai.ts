/**
 * 对战 AI：状态机 + 反应延迟 + 难度分层
 * 决策直接读取对手状态与技能参数（射程来自实际判定框数据，不使用魔法数字）。
 */

import type { Btn, InputState } from '../core/input';
import type { Fighter } from './fighter';
import type { MoveDef } from '../data/moves';
import { mulberry32 } from '../core/math';

export type Difficulty = 'easy' | 'normal' | 'hard';

interface Profile {
  reaction: number;
  blockChance: number;
  aggression: number;
  specialChance: number;
  jumpChance: number;
  throwChance: number;
  pokeChance: number;
  mistakeChance: number;
}

const PROFILES: Record<Difficulty, Profile> = {
  easy: {
    reaction: 16,
    blockChance: 0.24,
    aggression: 0.56,
    specialChance: 0.1,
    jumpChance: 0.04,
    throwChance: 0.06,
    pokeChance: 0.55,
    mistakeChance: 0.16,
  },
  normal: {
    reaction: 11,
    blockChance: 0.55,
    aggression: 0.65,
    specialChance: 0.28,
    jumpChance: 0.08,
    throwChance: 0.14,
    pokeChance: 0.62,
    mistakeChance: 0.09,
  },
  hard: {
    reaction: 5,
    blockChance: 0.82,
    aggression: 0.82,
    specialChance: 0.5,
    jumpChance: 0.11,
    throwChance: 0.2,
    pokeChance: 0.78,
    mistakeChance: 0.03,
  },
};

type Plan =
  | { kind: 'idle'; frames: number }
  | { kind: 'walk'; dir: 1 | -1; frames: number }
  | { kind: 'block'; frames: number }
  | { kind: 'attack'; btn: Btn; crouch: boolean; frames: number }
  | { kind: 'jump'; dir: 1 | -1; frames: number }
  | { kind: 'special'; frames: number };

export class AIController {
  private profile: Profile;
  private plan: Plan = { kind: 'idle', frames: 6 };
  private timer = 0;
  private thinkTimer = 0;
  private rng = mulberry32(0xb17a1c);
  private state: InputState = {
    held: new Set(),
    pressed: new Set(),
    axisX: 0,
    axisY: 0,
    analog: false,
  };
  private prevHeld = new Set<Btn>();

  constructor(
    readonly difficulty: Difficulty,
    private self: Fighter,
    private opponent: Fighter
  ) {
    this.profile = PROFILES[difficulty];
  }

  /** 普通技的最远打击点：决定「近身/中距」分界，不能把长判定必杀算进来，否则 AI 会隔空挥空 */
  private maxRange(): number {
    let max = 0.9;
    for (const m of this.self.def.moves) {
      if (m.kind !== 'normal') continue;
      for (const h of m.hits) {
        max = Math.max(max, h.box.x + h.box.w / 2 + 0.42);
      }
    }
    return max;
  }

  /** 单招能否够到当前距离。
   *  hit 框与受击框都用「中心 + 半宽」语义（rectsOverlap 比的是中心距），
   *  所以可及距离 = 判定框中心偏移 + 判定框半宽 + 受击框半宽(0.42)。
   *  之前按「左边缘 + 全宽」算，把 3.17 米的劈山棍误判成 4.4 米，AI 才会隔空挥空。 */
  private canReach(m: MoveDef, dist: number): boolean {
    return m.hits.some((h) => h.box.x + h.box.w / 2 + 0.42 >= dist);
  }

  /** 从指定按键里挑一个真正够得着的普通技；够不着就返回 null，让 AI 走位而不是挥空 */
  private pickNormal(dist: number, buttons: Btn[]): Btn | null {
    const candidates = this.self.def.moves.filter(
      (m) => m.kind === 'normal' && !m.airOk && buttons.includes(m.button) && this.canReach(m, dist)
    );
    if (candidates.length === 0) return null;
    return candidates[Math.floor(this.rng() * candidates.length)].button;
  }

  private specialReady(): MoveDef | null {
    const specials = this.self.def.moves.filter((m) => m.kind === 'special');
    for (const s of specials) {
      if (this.self.meter >= s.meterCost && (this.self.cooldowns.get(s.id) ?? 0) <= 0) return s;
    }
    return null;
  }

  private decide(): void {
    const dist = Math.abs(this.opponent.x - this.self.x);
    const dir: 1 | -1 = this.opponent.x > this.self.x ? 1 : -1;
    const p = this.profile;
    const r = this.rng();
    const reach = this.maxRange();

    // 对手正在攻击且在射程内 → 防御
    if (this.opponent.isAttacking && dist < 2.4 && r < p.blockChance) {
      this.plan = { kind: 'block', frames: 12 + Math.floor(this.rng() * 8) };
      return;
    }
    // 对手空中 → 对空
    if (this.opponent.isAirborne && dist < 2.6 && r < 0.75) {
      this.plan = { kind: 'attack', btn: 'heavy', crouch: false, frames: 18 };
      return;
    }
    // 血量低 + 有气 → 用必杀翻盘
    if (this.self.hp < 320 && this.specialReady() && r < p.specialChance + 0.2) {
      this.plan = { kind: 'special', frames: 24 };
      return;
    }
    if (dist <= reach) {
      if (r < p.throwChance) {
        this.plan = { kind: 'attack', btn: 'throw', crouch: false, frames: 14 };
      } else if (r < p.throwChance + 0.42) {
        const btn = this.pickNormal(dist, ['light']) ?? this.pickNormal(dist, ['medium', 'heavy']);
        this.plan = btn
          ? { kind: 'attack', btn, crouch: this.rng() < 0.35, frames: 12 }
          : { kind: 'walk', dir, frames: 10 };
      } else if (r < p.throwChance + 0.66) {
        const btn = this.pickNormal(dist, ['medium', 'light']);
        this.plan = btn
          ? { kind: 'attack', btn, crouch: this.rng() < 0.3, frames: 16 }
          : { kind: 'walk', dir, frames: 10 };
      } else if (r < p.throwChance + 0.78 && this.specialReady()) {
        this.plan = { kind: 'special', frames: 26 };
      } else {
        this.plan = { kind: 'block', frames: 10 + Math.floor(this.rng() * 8) };
      }
      return;
    }
    if (dist <= reach + 1.5) {
      if (r < p.pokeChance * 0.5 && this.specialReady()) {
        this.plan = { kind: 'special', frames: 28 };
      } else if (r < p.pokeChance) {
        // 中距挥空率高的根因：用全体普通技的最大射程 +1.5 拍板，挑了够不着的重/中攻
        const btn = this.pickNormal(dist, ['medium', 'heavy']);
        this.plan = btn
          ? { kind: 'attack', btn, crouch: false, frames: 18 }
          : { kind: 'walk', dir, frames: 10 };
      } else if (r < p.pokeChance + p.aggression * 0.2) {
        this.plan = { kind: 'walk', dir, frames: 10 };
      } else {
        this.plan = { kind: 'block', frames: 8 };
      }
      return;
    }
    // 远距
    if (r < p.aggression) {
      if (r < p.jumpChance && dist > 3.4) {
        this.plan = { kind: 'jump', dir, frames: 22 };
      } else {
        this.plan = { kind: 'walk', dir, frames: 16 + Math.floor(this.rng() * 10) };
      }
    } else if (r < p.aggression + p.specialChance) {
      this.plan = { kind: 'special', frames: 26 };
    } else {
      this.plan = { kind: 'idle', frames: 8 };
    }
  }

  sample(): InputState {
    const held = this.state.held;
    held.clear();
    this.state.pressed.clear();
    this.state.axisX = 0;
    this.state.axisY = 0;

    this.timer--;
    this.thinkTimer--;
    if (this.timer <= 0) {
      // 动作结束后的空窗，避免 AI 变成无间隔连打
      const gap = 8 + Math.floor(this.rng() * (this.profile.reaction + 8));
      this.plan = { kind: 'idle', frames: gap };
      this.timer = gap;
    }
    if (this.thinkTimer <= 0) {
      this.thinkTimer = this.profile.reaction;
      if (this.plan.kind === 'idle') {
        if (this.rng() < this.profile.mistakeChance) {
          this.plan = { kind: 'idle', frames: 10 };
          this.timer = 10;
        } else {
          this.decide();
          this.timer = this.plan.frames;
        }
      }
    }

    const dirToOpponent: 1 | -1 = this.opponent.x > this.self.x ? 1 : -1;
    switch (this.plan.kind) {
      case 'walk':
        held.add(this.plan.dir > 0 ? 'right' : 'left');
        this.state.axisX = this.plan.dir;
        break;
      case 'jump':
        held.add('up');
        held.add(this.plan.dir > 0 ? 'right' : 'left');
        this.state.axisX = this.plan.dir;
        this.state.axisY = 1;
        break;
      case 'block':
        held.add(dirToOpponent > 0 ? 'left' : 'right');
        break;
      case 'attack':
        // 方向必须按对手位置换算，写死 'right' 会让「对手在左」时变成背身，攻击被防御分支吞掉
        held.add(this.plan.crouch ? 'down' : dirToOpponent > 0 ? 'right' : 'left');
        if (!this.prevHeld.has(this.plan.btn)) this.state.pressed.add(this.plan.btn);
        held.add(this.plan.btn);
        break;
      case 'special':
        held.add('special');
        if (!this.prevHeld.has('special')) this.state.pressed.add('special');
        // 摇杆方向：让指令识别通过（下 → 前）
        this.state.axisY = this.timer > (this.plan.frames ?? 20) - 6 ? -1 : 0;
        if (this.state.axisY < 0) held.add('down');
        else {
          held.add(dirToOpponent > 0 ? 'right' : 'left');
          this.state.axisX = dirToOpponent;
        }
        break;
      default:
        break;
    }

    this.prevHeld = new Set(held);
    return this.state;
  }
}

export function difficultyLabel(d: Difficulty): string {
  return d === 'easy' ? '新手' : d === 'normal' ? '普通' : '高手';
}
