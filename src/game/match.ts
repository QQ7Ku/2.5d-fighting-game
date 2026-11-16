/**
 * 对局管理：回合、计时、胜负、KO 演出、破坏联动
 * 逻辑固定 60Hz（step），渲染与镜头在 render(dt) 中按真实帧率更新。
 */

import * as THREE from 'three';
import { bus } from '../core/bus';
import { clamp } from '../core/math';
import type { InputState } from '../core/input';
import { input } from '../core/input';
import { CHARACTERS, type CharacterDef } from '../data/moves';
import { type Rig } from '../view/rig';
import { createRig } from '../view/glbRig';
import { Fighter } from './fighter';
import { AIController, type Difficulty } from './ai';
import type { Arena } from '../view/arena';
import type { DestructionSystem } from './destruction';
import type { FxSystem } from '../view/fx';
import type { CameraRig } from '../view/camera';
import { audio } from '../core/audio';

export type MatchMode = 'ai' | 'local';
export type MatchPhase = 'intro' | 'fight' | 'ko' | 'roundEnd' | 'matchEnd';

export interface MatchOptions {
  mode: MatchMode;
  difficulty: Difficulty;
  rounds: number;
}

interface Controller {
  sample(): InputState;
}

class HumanController implements Controller {
  constructor(private player: 0 | 1) {}
  sample(): InputState {
    return input.get(this.player);
  }
}

export class Match {
  phase: MatchPhase = 'intro';
  aiPaused = false;
  round = 1;
  wins: [number, number] = [0, 0];
  timerFrames = 99 * 60;
  fighters: [Fighter, Fighter];
  private rigs: [Rig, Rig];
  private controllers: [Controller, Controller];
  private ai: AIController | null = null;
  private phaseFrames = 0;
  private koWinner: 0 | 1 | -1 = -1;
  private roundEndHandled = true;

  constructor(
    private scene: THREE.Scene,
    private arena: Arena,
    private destruction: DestructionSystem,
    private fx: FxSystem,
    private camera: CameraRig,
    private opts: MatchOptions,
    private defs: [CharacterDef, CharacterDef] = [CHARACTERS.libin, CHARACTERS.yaoshan]
  ) {
    const rig0 = createRig(defs[0]);
    const rig1 = createRig(defs[1]);
    this.rigs = [rig0, rig1];
    scene.add(rig0.group, rig1.group);

    const f0 = new Fighter(0, defs[0], rig0);
    const f1 = new Fighter(1, defs[1], rig1);
    this.fighters = [f0, f1];

    if (opts.mode === 'ai') {
      this.ai = new AIController(opts.difficulty, f1, f0);
      this.controllers = [new HumanController(0), { sample: () => this.ai!.sample() }];
    } else {
      this.controllers = [new HumanController(0), new HumanController(1)];
    }

    this.resetRound(true);
  }

  private resetRound(first: boolean): void {
    this.fighters[0].reset(-3.1, 1);
    this.fighters[1].reset(3.1, -1);
    this.timerFrames = 99 * 60;
    this.phase = 'intro';
    this.phaseFrames = 0;
    this.roundEndHandled = false;
    this.koWinner = -1;
    this.destruction.reset();
    this.arena.resetTerrain();
    if (first) {
      bus.emit('hud:rounds', { p0: 0, p1: 0 });
      bus.emit('hud:callout', { text: '第一局', ms: 900 });
    } else {
      bus.emit('hud:callout', { text: `第 ${this.round} 局`, ms: 900 });
    }
    bus.emit('hud:health', { player: 0, hp: this.fighters[0].hp, max: 1000 });
    bus.emit('hud:health', { player: 1, hp: this.fighters[1].hp, max: 1000 });
    bus.emit('hud:meter', { player: 0, value: this.fighters[0].meter });
    bus.emit('hud:meter', { player: 1, value: this.fighters[1].meter });
    bus.emit('sfx:play', { tag: 'bell', gain: 0.7 });
    bus.emit('round:start', { round: this.round });
  }

  private boundsFor(f: Fighter): { minX: number; maxX: number } {
    const b = this.arena.bounds;
    const zone = this.arena.activePit();
    if (!zone) return b;
    if (f.isAirborne) return b;
    if (f.x < zone.fromX) return { minX: b.minX, maxX: zone.fromX };
    if (f.x > zone.toX) return { minX: zone.toX, maxX: b.maxX };
    return b;
  }

  step(): void {
    this.phaseFrames++;
    const [f0, f1] = this.fighters;

    if (this.phase === 'intro') {
      f0.update(this.emptyInput(), f1, this.arena.bounds, this.arena.getFloorY(f0.x));
      f1.update(this.emptyInput(), f0, this.arena.bounds, this.arena.getFloorY(f1.x));
      if (this.phaseFrames > 48) {
        this.phase = 'fight';
        this.phaseFrames = 0;
        bus.emit('hud:callout', { text: '开 战', ms: 800 });
        bus.emit('sfx:play', { tag: 'ui_confirm', gain: 0.8 });
      }
      return;
    }

    if (this.phase === 'ko' || this.phase === 'roundEnd') {
      f0.update(this.emptyInput(), f1, this.arena.bounds, this.arena.getFloorY(f0.x));
      f1.update(this.emptyInput(), f0, this.arena.bounds, this.arena.getFloorY(f1.x));
      if (this.phaseFrames > 110 && !this.roundEndHandled) {
        this.roundEndHandled = true;
        this.finishRound();
      }
      return;
    }

    if (this.phase === 'matchEnd') {
      return;
    }

    // ===== 战斗阶段 =====
    const i0 = this.controllers[0].sample();
    const i1 = this.aiPaused ? this.emptyInput() : this.controllers[1].sample();

    const ev0 = f0.update(i0, f1, this.boundsFor(f0), this.arena.getFloorY(f0.x));
    const ev1 = f1.update(i1, f0, this.boundsFor(f1), this.arena.getFloorY(f1.x));

    for (const evt of [ev0, ev1]) {
      if (!evt) continue;
      this.destruction.impactAt(evt.point.x, evt.point.y, evt.hit.destroy, evt.move.id, evt.point.z);
      if (evt.wallSplat) {
        const wallX = evt.defender.x + (evt.defender.x > 0 ? 0.6 : -0.6);
        this.destruction.impactAt(wallX, 1.4, 2, `${evt.move.id}:wall`);
        bus.emit('fx:shake', { strength: 0.5, frames: 12 });
        bus.emit('hud:callout', { text: '撞墙', ms: 700 });
      }
    }

    // 推箱：两名角色不可完全重叠（否则视觉穿模）
    {
      const dx = f1.x - f0.x;
      const minDist = 0.64;
      if (Math.abs(dx) < minDist && f0.state !== 'ko' && f1.state !== 'ko') {
        const push = ((minDist - Math.abs(dx)) / 2) * Math.sign(dx || 1);
        f0.x -= push;
        f1.x += push;
        const b = this.arena.bounds;
        f0.x = clamp(f0.x, b.minX + 0.45, b.maxX - 0.45);
        f1.x = clamp(f1.x, b.minX + 0.45, b.maxX - 0.45);
      }
    }

    // 塌陷区域：落入坑内。用 inPit 标志而不是 state==='down' 记账，
    // 否则 Fighter 自己把 down 翻回 idle 后、这里又判成「刚掉进去」，形成 42 帧一轮的永久循环。
    for (const f of this.fighters) {
      if (f.state === 'ko') continue;
      const inPitNow = !f.isAirborne && this.arena.isInPit(f.x);
      if (inPitNow && !f.inPit) {
        f.inPit = true;
        f.state = 'down';
        f.stunFrames = 42;
        f.vx = 0;
        f.move = null;
        f.moveLow = false;
        bus.emit('hud:callout', { text: '坠落', ms: 700 });
      }
      if (f.inPit) {
        if (inPitNow && f.state === 'hit' && f.stunFrames > 0) f.state = 'down';
        if (f.stunFrames <= 0) {
          const zone = this.arena.activePit() ?? { fromX: -1.9, toX: 1.9 };
          const mid = (zone.fromX + zone.toX) / 2;
          const b = this.arena.bounds;
          f.x = clamp(f.x < mid ? zone.fromX - 0.55 : zone.toX + 0.55, b.minX + 0.45, b.maxX - 0.45);
          f.y = 0;
          f.vy = 0;
          f.state = 'idle';
          f.stunFrames = 0;
          f.inPit = false;
        }
      }
    }

    this.timerFrames--;
    const seconds = Math.max(0, Math.ceil(this.timerFrames / 60));
    bus.emit('hud:timer', { seconds });
    if (this.timerFrames === 10 * 60) bus.emit('hud:callout', { text: '十秒', ms: 700 });
    for (const f of this.fighters) {
      bus.emit('hud:health', { player: f.index, hp: f.hp, max: 1000 });
      bus.emit('hud:meter', { player: f.index, value: f.meter });
    }

    if (f0.hp <= 0 || f1.hp <= 0) {
      this.beginKo(f0.hp <= 0 && f1.hp <= 0 ? -1 : f0.hp <= 0 ? 1 : 0);
    } else if (this.timerFrames <= 0) {
      this.beginKo(f0.hp === f1.hp ? -1 : f0.hp > f1.hp ? 0 : 1, true);
    }
  }

  private emptyInput(): InputState {
    return { held: new Set(), pressed: new Set(), axisX: 0, axisY: 0, analog: false };
  }

  private beginKo(winner: 0 | 1 | -1, timeOver = false): void {
    if (this.phase !== 'fight') return;
    this.koWinner = winner;
    this.phase = 'ko';
    this.phaseFrames = 0;
    this.wins[winner === 0 ? 0 : winner === 1 ? 1 : 0] += winner === -1 ? 0 : 1;
    if (winner === -1) {
      this.wins[0]++;
      this.wins[1]++;
    }
    if (winner === -1 && !timeOver) {
      // 双 KO：双方都要倒地，否则「双双倒地」却两人站着
      this.fighters[0].setKo();
      this.fighters[1].setKo();
    }
    bus.emit('hud:rounds', { p0: this.wins[0], p1: this.wins[1] });

    if ((winner === 0 || winner === 1) && !timeOver) {
      const loser = this.fighters[winner === 0 ? 1 : 0];
      const win = this.fighters[winner];
      loser.setKo();
      win.setWin();
      this.camera.killCam(loser.x);
      bus.emit('fx:shake', { strength: 1.1, frames: 24 });
    } else if ((winner === 0 || winner === 1) && timeOver) {
      // 时间到：只播胜利，不把还活着的一方按成 KO
      this.fighters[winner].setWin();
    }
    bus.emit('sfx:play', { tag: timeOver ? 'bell' : 'ko', gain: 1 });
    bus.emit('hud:callout', { text: timeOver ? '时间到' : winner === -1 ? '双双倒地' : 'K.O.', ms: 1600 });
    if (winner >= 0) bus.emit('combat:ko', { player: (winner === 0 ? 1 : 0) });
    this.phase = 'ko';
  }

  private finishRound(): void {
    const need = Math.ceil(this.opts.rounds / 2) + (this.opts.rounds % 2 === 0 ? 0 : 0);
    const target = 2;
    void need;
    if (this.wins[0] >= target || this.wins[1] >= target || this.round >= this.opts.rounds) {
      this.phase = 'matchEnd';
      const winner: 0 | 1 | -1 =
        this.wins[0] === this.wins[1] ? -1 : this.wins[0] > this.wins[1] ? 0 : 1;
      bus.emit('match:end', { winner, reason: this.wins[0] === this.wins[1] ? 'double' : 'ko' });
      return;
    }
    this.round++;
    this.resetRound(false);
  }

  render(dt: number): void {
    const [f0, f1] = this.fighters;
    for (const f of this.fighters) {
      f.rig.group.position.x = f.x;
      f.rig.group.position.y = f.y;
    }
    this.arena.update(dt);
    this.camera.update(dt, f0.x, f1.x, f0.y, f1.y, this.phase === 'fight');
    this.fx.update(dt);
    this.destruction.update(dt);
  }

  get winner(): 0 | 1 | -1 {
    return this.wins[0] === this.wins[1] ? -1 : this.wins[0] > this.wins[1] ? 0 : 1;
  }

  dispose(): void {
    for (const r of this.rigs) r.dispose();
    this.scene.remove(this.rigs[0].group, this.rigs[1].group);
  }
}
