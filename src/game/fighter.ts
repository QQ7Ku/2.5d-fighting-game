/**
 * 战斗角色：状态机 + 输入缓冲 + 连招取消 + 判定框 + 受击硬直
 * 所有技能参数来自 MoveDef（必杀来自已审核 Skill JSON），状态机与动画状态保持一致。
 */

import { bus } from '../core/bus';
import { clamp, rectsOverlap, type Rect } from '../core/math';
import type { Btn, InputState } from '../core/input';
import type { CharacterDef, MoveDef } from '../data/moves';
import type { Rig } from '../view/rig';

export type FighterState = 'idle' | 'walk' | 'crouch' | 'jump' | 'attack' | 'hit' | 'block' | 'ko' | 'intro' | 'win' | 'down';

export const MAX_HP = 1000;
const HURT_W = 0.84;
const STAND_H = 1.86;
const CROUCH_H = 1.24;

interface Buffered {
  btn: Btn;
  frame: number;
}

interface DirSample {
  frame: number;
  dx: -1 | 0 | 1;
  dy: -1 | 0 | 1;
}

export interface HitEvent {
  attacker: Fighter;
  defender: Fighter;
  move: MoveDef;
  hit: MoveDef['hits'][number];
  damage: number;
  blocked: boolean;
  point: { x: number; y: number; z: number };
  wallSplat: boolean;
}

export class Fighter {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  facing: 1 | -1 = 1;
  hp = MAX_HP;
  meter = 0;
  state: FighterState = 'idle';
  stateFrame = 0;
  move: MoveDef | null = null;
  moveFrame = 0;
  hitFlags = new Set<string>();
  hitstop = 0;
  stunFrames = 0;
  comboCount = 0;
  comboDamage = 0;
  comboDecay = 0;
  cooldowns = new Map<string, number>();
  private buffer: Buffered[] = [];
  private dirHistory: DirSample[] = [];
  private frame = 0;
  private landed = true;
  private blockBuffer = 0;
  private lastHitBy: number | null = null;
  private invuln = 0;
  private pendingCancel: MoveDef | null = null;
  private landLock = 0;
  private jumpHeld = false;
  whiffed = false;
  /** 是否正处在塌陷坑里（由 Match 维护，避免与 down/int 状态互相覆盖成死循环） */
  inPit = false;

  constructor(
    readonly index: 0 | 1,
    readonly def: CharacterDef,
    readonly rig: Rig
  ) {}

  get isAirborne(): boolean {
    // 起跳那一帧 y 还是 0，靠 vy 判定，否则 jump 会在同一帧被物理与移动分支撤销
    return this.vy !== 0 || this.y > 0.001;
  }

  get crouching(): boolean {
    return this.state === 'crouch' || (this.state === 'block' && this.blockLow);
  }

  private blockLow = false;
  /** 当前招式是否低位判定：Match 在掉坑/重置时需要从外部清掉，故不设 private */
  moveLow = false;

  get hurtbox(): Rect {
    const h = this.crouching || this.moveLow ? CROUCH_H : STAND_H;
    return { x: this.x, y: this.y + h / 2, w: HURT_W, h };
  }

  reset(x: number, facing: 1 | -1): void {
    this.x = x;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.facing = facing;
    this.hp = MAX_HP;
    this.meter = 35;
    this.state = 'idle';
    this.stateFrame = 0;
    this.move = null;
    this.moveFrame = 0;
    this.stunFrames = 0;
    this.hitstop = 0;
    this.hitFlags.clear();
    this.buffer.length = 0;
    this.dirHistory.length = 0;
    this.cooldowns.clear();
    this.comboCount = 0;
    this.comboDamage = 0;
    this.blockBuffer = 0;
    this.moveLow = false;
    this.invuln = 0;
    this.landed = true;
    this.inPit = false;
    this.jumpHeld = false;
    this.rig.play('intro', false, 20, true);
    this.rig.setFacing(facing);
    this.rig.group.position.set(x, 0, 0);
  }

  private canAct(): boolean {
    return (
      this.state !== 'attack' &&
      this.state !== 'hit' &&
      this.state !== 'ko' &&
      this.state !== 'intro' &&
      this.state !== 'win' &&
      this.state !== 'down' &&
      this.hitstop === 0
    );
  }

  private pushBuffer(input: InputState): void {
    for (const btn of input.pressed) {
      this.buffer.push({ btn, frame: this.frame });
    }
    this.buffer = this.buffer.filter((b) => this.frame - b.frame <= 8);
    const dx = input.axisX > 0.35 ? 1 : input.axisX < -0.35 ? -1 : 0;
    const dy = input.axisY > 0.35 ? 1 : input.axisY < -0.35 ? -1 : 0;
    this.dirHistory.push({ frame: this.frame, dx, dy });
    this.dirHistory = this.dirHistory.filter((d) => this.frame - d.frame <= 20);
  }

  private dirCode(d: DirSample): number {
    const f = d.dx * this.facing;
    if (d.dy > 0) return f > 0 ? 9 : f < 0 ? 7 : 8;
    if (d.dy < 0) return f > 0 ? 3 : f < 0 ? 1 : 2;
    return f > 0 ? 6 : f < 0 ? 4 : 5;
  }

  /** 指令技识别：qcf = 2→3→6，qcb = 2→1→4 */
  private motionOk(motion: MoveDef['motion']): boolean {
    if (motion === 'none') return true;
    const codes = this.dirHistory.map((d) => this.dirCode(d));
    const patterns: number[][] =
      motion === 'qcf'
        ? [
            [2, 3, 6],
            [2, 6],
          ]
        : motion === 'qcb'
          ? [
              [2, 1, 4],
              [2, 4],
            ]
          : motion === 'dp'
            ? [[6, 2, 3]]
            : [];
    if (!patterns.length) return true;
    for (const need of patterns) {
      let idx = 0;
      for (const c of codes) {
        if (c === need[idx]) idx++;
        if (idx === need.length) return true;
      }
    }
    return false;
  }

  private consume(btn: Btn): void {
    this.buffer = this.buffer.filter((b) => b.btn !== btn);
  }

  private buffered(btn: Btn): boolean {
    return this.buffer.some((b) => b.btn === btn);
  }

  private findMove(button: Btn, crouch: boolean, air: boolean): MoveDef | null {
    const moves = this.def.moves;
    if (air) {
      // airOk 的必杀原先永远取不到：空中分支写死只找 normal
      if (button === 'special') {
        const airSpecial = moves.find(
          (m) => m.airOk && m.kind === 'special' && (this.cooldowns.get(m.id) ?? 0) <= 0 && this.meter >= m.meterCost
        );
        if (airSpecial) return airSpecial;
      }
      const airMove = moves.find((m) => m.airOk && m.kind === 'normal');
      return airMove ?? null;
    }
    if (button === 'special') {
      const specials = moves.filter((m) => m.kind === 'special');
      // 优先匹配真实指令
      for (const m of specials) {
        if (m.motion !== 'none' && this.motionOk(m.motion) && (this.cooldowns.get(m.id) ?? 0) <= 0 && this.meter >= m.meterCost) {
          return m;
        }
      }
      // 触屏简版：按住下 → 后绕必杀（qcb），否则 → 前绕必杀（qcf）
      const preferred = crouch ? 'qcb' : 'qcf';
      const pick = specials.find(
        (m) => m.motion === preferred && (this.cooldowns.get(m.id) ?? 0) <= 0 && this.meter >= m.meterCost
      );
      if (pick) return pick;
      for (const m of specials) {
        if ((this.cooldowns.get(m.id) ?? 0) <= 0 && this.meter >= m.meterCost) return m;
      }
      return null;
    }
    if (button === 'throw') {
      return moves.find((m) => m.kind === 'throw') ?? null;
    }
    const normals = moves.filter((m) => m.kind === 'normal' && !m.airOk);
    const byBtn = normals.filter((m) => m.button === button);
    if (crouch) {
      const c = byBtn.find((m) => m.clip === 'atk_crouch');
      if (c) return c;
    } else {
      const s = byBtn.find((m) => m.clip !== 'atk_crouch');
      if (s) return s;
    }
    return byBtn[0] ?? null;
  }

  private canCancelInto(next: MoveDef): boolean {
    if (!this.move) return true;
    if (next.id === this.move.id) return false;
    const rank = (m: MoveDef): number => (m.kind === 'special' ? 2 : m.kind === 'throw' ? 1 : 0);
    // 只能向「更重」的一级取消：必杀不能再取消回普通技，否则 normal→special→normal 可以无限循环
    if (rank(next) < rank(this.move)) return false;
    if (this.hitFlags.size === 0 && !this.whiffed) return false;
    const [a, b] = this.move.cancelWindow;
    if (b === 0) return false;
    if (this.moveFrame < a || this.moveFrame > b) return false;
    return this.move.cancelInto.includes(next.id);
  }

  private startMove(move: MoveDef): void {
    this.state = 'attack';
    this.move = move;
    this.moveFrame = 0;
    this.stateFrame = 0;
    this.hitFlags.clear();
    this.whiffed = false;
    this.moveLow = move.clip === 'atk_crouch';
    this.blockBuffer = 0;
    this.rig.play(move.clip, true, 26, true);
    if (move.meterCost) this.meter = Math.max(0, this.meter - move.meterCost);
    if (move.cooldown) this.cooldowns.set(move.id, move.cooldown);
    if (move.whoosh) bus.emit('sfx:play', { tag: move.whoosh, gain: 0.7 });
    if (move.kind === 'special') bus.emit('sfx:play', { tag: 'special_hum', gain: 0.6 });
    if (move.invuln) this.invuln = move.invuln[1];
  }

  private tryStart(input: InputState, opponent: Fighter): boolean {
    const crouch = input.held.has('down') && !this.isAirborne;
    const air = this.isAirborne;
    const order: Btn[] = ['special', 'throw', 'heavy', 'medium', 'light'];
    for (const btn of order) {
      if (!this.buffered(btn)) continue;
      const move = this.findMove(btn, crouch, air);
      if (!move) continue;
      if (move.kind === 'special' && this.meter < move.meterCost) continue;
      if ((this.cooldowns.get(move.id) ?? 0) > 0) continue;
      if (move.requiresGround && air) continue;
      if (move.isThrow) {
        const dist = Math.abs(opponent.x - this.x);
        if (dist > move.throwRange || opponent.isAirborne || opponent.state === 'ko') continue;
      }
      if (this.state === 'attack') {
        if (!this.canCancelInto(move)) continue;
        this.pendingCancel = move;
        this.consume(btn);
        return true;
      }
      this.consume(btn);
      this.startMove(move);
      return true;
    }
    return false;
  }

  update(input: InputState, opponent: Fighter, arenaBounds: { minX: number; maxX: number }, floorY: number): HitEvent | null {
    this.frame++;
    for (const [id, cd] of this.cooldowns) {
      if (cd > 0) this.cooldowns.set(id, cd - 1);
    }
    if (this.invuln > 0) this.invuln--;
    if (this.landLock > 0) this.landLock--;
    if (this.blockBuffer > 0) this.blockBuffer--;
    if (this.comboDecay > 0) {
      this.comboDecay--;
      if (this.comboDecay === 0) {
        this.comboCount = 0;
        this.comboDamage = 0;
      }
    }
    // 缓冲必须在顿帧之前：命中顿帧里按下的取消键原先直接被丢掉，等于取消窗口形同虚设
    this.pushBuffer(input);
    if (this.hitstop > 0) {
      this.hitstop--;
      this.rig.update(1 / 60);
      return null;
    }

    this.stateFrame++;

    // 面向：非攻击状态自动转向对手
    if (this.state !== 'attack' && this.state !== 'hit' && this.state !== 'ko') {
      const want: 1 | -1 = opponent.x >= this.x ? 1 : -1;
      if (want !== this.facing) {
        this.facing = want;
        this.rig.setFacing(want);
      }
    }

    if (this.state === 'intro') {
      if (this.stateFrame > 60) this.state = 'idle';
      this.physics(arenaBounds, floorY);
      this.rig.update(1 / 60);
      return null;
    }
    if (this.state === 'ko') {
      this.physics(arenaBounds, floorY);
      this.rig.update(1 / 60);
      return null;
    }
    if (this.state === 'win') {
      this.rig.update(1 / 60);
      return null;
    }

    if (this.state === 'hit' || this.state === 'down') {
      this.stunFrames--;
      this.physics(arenaBounds, floorY);
      if (this.isAirborne) this.rig.play('hit_heavy', false, 16);
      if (this.stunFrames <= 0 && !this.isAirborne) {
        this.state = 'idle';
        this.stateFrame = 0;
      }
      this.rig.update(1 / 60);
      return null;
    }

    // 防御：按住后方或防御键
    const away = opponent.x >= this.x ? 'left' : 'right';
    const holdingBack = input.held.has(away as Btn);
    const guardHeld = input.held.has('guard');
    // 远离对手时「按住后」应该是后退走位，不是举着架势原地不动。
    // 只有「明确按防御键」或「对手近到能打到我 / 正在出招」才把后方向解释成防御。
    const threatRange = 2.9;
    const threatened = Math.abs(opponent.x - this.x) <= threatRange || opponent.isAttacking;
    const shouldBlock = guardHeld || (holdingBack && threatened);
    const canBlock = !this.isAirborne && this.state !== 'attack' && this.hitstop === 0;

    if (this.state === 'attack' && this.move) {
      // 必须先读取消意图再推进招式：原先 tryStart 在本分支之后，取消系统整体断路
      this.tryStart(input, opponent);
      const evt = this.advanceMove(opponent, arenaBounds, floorY);
      this.physics(arenaBounds, floorY);
      this.updateView();
      this.rig.update(1 / 60);
      return evt;
    }

    // 跳跃必须早于防御分支：按住后退时防御分支每帧 return，
    // 原来写在移动段里的起跳永远执行不到，等于「按住后退就不能跳」。
    if (this.tryJump(input)) {
      this.physics(arenaBounds, floorY);
      this.updateView();
      this.rig.update(1 / 60);
      return null;
    }

    this.blockLow = input.held.has('down') && canBlock;
    if (canBlock && shouldBlock && (this.state === 'idle' || this.state === 'walk' || this.state === 'crouch' || this.state === 'block')) {
      // 按住后退时也要能出招：先尝试起手，起来就不进防御（原先防御分支直接 return，吞掉按键）
      if (this.tryStart(input, opponent)) {
        this.advanceMove(opponent, arenaBounds, floorY);
        this.physics(arenaBounds, floorY);
        this.updateView();
        this.rig.update(1 / 60);
        return null;
      }
      this.state = 'block';
      this.blockBuffer = 4;
      this.vx *= 0.6;
      this.physics(arenaBounds, floorY);
      this.updateView();
      this.rig.update(1 / 60);
      return null;
    }
    if (this.state === 'block') {
      if (this.blockBuffer > 0) this.blockBuffer--;
      if (!shouldBlock && this.blockBuffer <= 0) this.state = 'idle';
    }

    if (this.canAct() || this.state === 'attack') {
      if (this.tryStart(input, opponent)) {
        this.advanceMove(opponent, arenaBounds, floorY);
        this.physics(arenaBounds, floorY);
        this.updateView();
        this.rig.update(1 / 60);
        return null;
      }
    }

    if (this.state === 'attack') {
      this.physics(arenaBounds, floorY);
      this.updateView();
      this.rig.update(1 / 60);
      return null;
    }

    // 移动
    if (!this.isAirborne) {
      if (input.held.has('down')) {
        this.state = 'crouch';
        this.vx *= 0.5;
      } else if (Math.abs(input.axisX) > 0.2) {
        const dir = input.axisX > 0 ? 1 : -1;
        const forward = dir === this.facing;
        // 前后移动要乘朝向，否则面向左时会朝反方向走
        this.vx = (forward ? this.def.walkSpeed : -this.def.backSpeed) * this.facing * Math.min(1, Math.abs(input.axisX));
        this.state = 'walk';
      } else {
        this.vx *= 0.6;
        if (this.state !== 'block') this.state = 'idle';
      }
    }

    this.physics(arenaBounds, floorY);
    this.updateView();
    this.rig.update(1 / 60);
    return null;
  }

  /** 起跳：单点「上」或摇杆上推。按住不重复起跳，落地后需重新触发。 */
  private tryJump(input: InputState): boolean {
    if (this.isAirborne) return false;
    const pushUp = input.axisY > 0.6;
    if (!pushUp) this.jumpHeld = false;
    if (this.jumpHeld) return false;
    if (!input.pressed.has('up') && !(pushUp && this.landed)) return false;
    this.jumpHeld = true;
    this.vy = this.def.jumpVelocity;
    this.vx = input.axisX * this.def.walkSpeed * 1.1;
    this.state = 'jump';
    this.landed = false;
    bus.emit('sfx:play', { tag: 'jump', gain: 0.5 });
    return true;
  }

  private advanceMove(
    opponent: Fighter,
    arenaBounds: { minX: number; maxX: number },
    floorY: number
  ): HitEvent | null {
    const move = this.move!;
    this.moveFrame++;
    for (const m of move.moveX) {
      if (m.frame === this.moveFrame) {
        this.vx = m.vx * this.facing;
        if (m.vy) this.vy = m.vy;
      }
    }
    if (this.moveFrame >= move.startup && this.moveFrame <= move.startup + move.active) {
      for (const hit of move.hits) {
        if (this.hitFlags.has(hit.id)) continue;
        if (this.moveFrame < hit.start || this.moveFrame > hit.end) continue;
        const box: Rect = {
          x: this.x + hit.box.x * this.facing,
          y: this.y + hit.box.y,
          w: hit.box.w,
          h: hit.box.h,
        };
        if (rectsOverlap(box, opponent.hurtbox)) {
          this.hitFlags.add(hit.id);
          const evt = this.resolveHit(hit, opponent, move, arenaBounds);
          if (evt) return evt;
        }
      }
    }
    if (this.moveFrame >= move.total) {
      this.move = null;
      this.moveLow = false;
      this.blockBuffer = 0;
      this.state = this.isAirborne ? 'jump' : 'idle';
      this.stateFrame = 0;
      if (this.hitFlags.size === 0) this.whiffed = true;
      this.pendingCancel = null;
    } else if (this.pendingCancel) {
      const next = this.pendingCancel;
      this.pendingCancel = null;
      this.startMove(next);
    }
    if (this.moveFrame > 0 && this.move) {
      this.rig.setPhase((this.moveFrame - 1) / Math.max(1, this.move.total));
    }
    return null;
  }

  private resolveHit(
    hit: MoveDef['hits'][number],
    opponent: Fighter,
    move: MoveDef,
    arenaBounds: { minX: number; maxX: number }
  ): HitEvent | null {
    if (opponent.invuln > 0 || opponent.state === 'ko') return null;
    const towardOpponent = (opponent.x - this.x) * this.facing >= 0;

    // 防御判定
    const blocking = opponent.state === 'block' || opponent.blockBuffer > 0;
    let blocked = false;
    if (blocking && hit.guard !== 'unblockable' && towardOpponent) {
      const lowOk = hit.guard !== 'low' || opponent.blockLow;
      const highOk = hit.guard !== 'overhead' || !opponent.blockLow;
      blocked = lowOk && highOk;
    }

    const point = {
      x: this.x + (hit.box.x + hit.box.w * 0.3) * this.facing,
      // 取判定框中心而不是底边：底边会把拳峰的高度低估半个框（跳跃重击底边 1.6 米，
      // 中心 2.1 米），导致头顶灯笼这类高处物件「怎么打都够不着」。
      y: this.y + hit.box.y + hit.box.h * 0.5,
      z: 0,
    };

    if (blocked) {
      const chip = Math.round(hit.damage * (move.kind === 'special' ? 0.09 : 0));
      opponent.hp = Math.max(0, opponent.hp - chip);
      opponent.stunFrames = hit.blockstun;
      opponent.state = 'block';
      opponent.blockBuffer = hit.blockstun;
      opponent.vx = hit.knockback.x * 0.4 * 0.16 * this.facing;
      opponent.meter = Math.min(100, opponent.meter + 3);
      this.hitstop = Math.max(this.hitstop, Math.min(8, hit.hitstop - 1));
      opponent.hitstop = this.hitstop;
      this.meter = Math.min(100, this.meter + Math.round(hit.meterGain * 0.5));
      bus.emit('combat:block', { defender: opponent.index, moveId: move.id, chip });
      bus.emit('sfx:play', { tag: 'block', gain: 0.8 });
      bus.emit('fx:impact', { x: point.x, y: point.y, kind: 'block' });
      return {
        attacker: this,
        defender: opponent,
        move,
        hit,
        damage: chip,
        blocked: true,
        point,
        wallSplat: false,
      };
    }

    if (opponent.stunFrames <= 0 && opponent.state !== 'hit') {
      this.comboCount = 0;
      this.comboDamage = 0;
    }
    const scaling = Math.max(0.45, 1 - this.comboCount * 0.09);
    const damage = Math.round(hit.damage * scaling);
    opponent.hp = Math.max(0, opponent.hp - damage);
    opponent.stunFrames = hit.hitstun;
    opponent.move = null;
    opponent.moveLow = false;
    opponent.pendingCancel = null;
    opponent.state = 'hit';
    opponent.stateFrame = 0;
    opponent.hitstop = hit.hitstop;
    this.hitstop = hit.hitstop;
    // 击退按「总位移」语义换算成初速度：摩擦力每帧 0.78，位移 ≈ v0 / 0.22
    opponent.vx = hit.knockback.x * 0.16 * this.facing;
    if (hit.knockback.y > 0.01) {
      opponent.vy = hit.knockback.y;
      opponent.landed = false;
    }
    opponent.rig.play(damage >= 55 ? 'hit_heavy' : 'hit_light', false, 24, true);
    opponent.rig.setFacing(opponent.x >= this.x ? -1 : 1);
    this.meter = Math.min(100, this.meter + hit.meterGain);
    opponent.meter = Math.min(100, opponent.meter + Math.round(hit.meterGain * 0.6));
    this.comboCount++;
    this.comboDamage += damage;
    this.comboDecay = 60;
    bus.emit('hud:combo', { player: this.index, count: this.comboCount, damage: this.comboDamage });
    bus.emit('combat:hit', {
      attacker: this.index,
      defender: opponent.index,
      moveId: move.id,
      damage,
      destroyLevel: hit.destroy,
      point,
    });
    bus.emit('sfx:play', { tag: hit.sfx, gain: damage > 60 ? 1 : 0.8 });
    bus.emit('fx:hit', { x: point.x, y: point.y, z: 0, level: hit.destroy as 0 | 1 | 2 | 3 });
    if (move.vfx.shake > 0.15) {
      bus.emit('fx:shake', { strength: move.vfx.shake * (damage / 60), frames: Math.round(hit.hitstop * 1.5) });
    }

    const wallSplat =
      (opponent.x <= arenaBounds.minX + 0.35 && hit.knockback.x * this.facing < 0) ||
      (opponent.x >= arenaBounds.maxX - 0.35 && hit.knockback.x * this.facing > 0);

    return { attacker: this, defender: opponent, move, hit, damage, blocked: false, point, wallSplat };
  }

  private physics(arenaBounds: { minX: number; maxX: number }, floorY: number): void {
    this.x += this.vx;
    this.vx *= this.landed ? 0.78 : 0.985;

    if (this.vy !== 0 || this.y > floorY) {
      this.vy -= this.def.gravity;
      this.y += this.vy;
      if (this.y <= floorY) {
        this.y = floorY;
        this.vy = 0;
        if (!this.landed) {
          this.landed = true;
          if (this.state === 'jump') {
            this.state = 'idle';
            this.landLock = 13;
            this.rig.play('land', false, 22, false);
          }
          bus.emit('sfx:play', { tag: 'land', gain: 0.5 });
        }
      } else {
        this.landed = false;
      }
    } else {
      this.y = floorY;
    }

    const minX = arenaBounds.minX + 0.45;
    const maxX = arenaBounds.maxX - 0.45;
    if (this.x < minX) {
      this.x = minX;
      if (this.state === 'hit' && Math.abs(this.vx) > 2) this.wallImpact();
    }
    if (this.x > maxX) {
      this.x = maxX;
      if (this.state === 'hit' && Math.abs(this.vx) > 2) this.wallImpact();
    }
    if (this.vx !== 0 && Math.abs(this.vx) < 0.002) this.vx = 0;
  }

  private wallImpact(): void {
    bus.emit('destroy:chain', { objectId: '__wall__', from: 'knockback' });
  }

  private updateView(): void {
    const rig = this.rig;
    // 落地缓冲优先于 idle/walk/crouch/block：否则落地瞬间按方向键或按住后退，land 一帧就被顶掉
    if (this.landLock > 0 && (this.state === 'idle' || this.state === 'walk' || this.state === 'crouch' || this.state === 'block')) {
      rig.play('land', false, 18);
      return;
    }
    switch (this.state) {
      case 'idle':
        rig.play('idle', false, 12);
        break;
      case 'walk':
        rig.play(this.vx * this.facing > 0 ? 'walk_f' : 'walk_b', false, 12);
        break;
      case 'crouch':
        rig.play('crouch', false, 20);
        break;
      case 'block':
        rig.play(this.blockLow ? 'block_crouch' : 'block_stand', false, 24);
        break;
      case 'jump':
        rig.play(this.vy > 0 ? 'jump_up' : 'jump_fall', false, 16);
        break;
      case 'hit':
        break;
      case 'ko':
        rig.play('ko', false, 14);
        break;
      case 'win':
        rig.play('victory', false, 12);
        break;
      default:
        break;
    }
  }

  setKo(): void {
    this.state = 'ko';
    this.rig.play('ko', false, 12, true);
  }

  setWin(): void {
    this.state = 'win';
    this.rig.play('victory', false, 12, true);
  }

  get isAttacking(): boolean {
    return this.state === 'attack';
  }

  get lastHit(): number | null {
    return this.lastHitBy;
  }
}
