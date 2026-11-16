/** 战斗 HUD：血条、气条、计时、连击、破坏提示、帧率 */

import { bus } from '../core/bus';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

interface PlayerHud {
  health: HTMLElement;
  damage: HTMLElement;
  meter: HTMLElement;
  combo: HTMLElement;
  lag: number;
  comboTimer: number;
}

export class Hud {
  private players: [PlayerHud, PlayerHud];
  private timer: HTMLElement;
  private callout: HTMLElement;
  private fps: HTMLElement;
  private roundDots: HTMLElement;
  private calloutTimer = 0;
  private fpsAccum = 0;
  private fpsFrames = 0;
  private root: HTMLElement;

  constructor() {
    this.root = $('hud');
    const mk = (i: number): PlayerHud => ({
      health: $(`p${i}-health`),
      damage: $(`p${i}-damage`),
      meter: $(`p${i}-meter`),
      combo: $(`p${i}-combo`),
      lag: 100,
      comboTimer: 0,
    });
    this.players = [mk(0), mk(1)];
    this.timer = $('timer');
    this.callout = $('callout');
    this.fps = $('fps');
    this.roundDots = $('round-dots');
    this.roundDots.innerHTML = '<i></i><i></i><i></i>';

    bus.on('hud:health', ({ player, hp, max }) => {
      const p = this.players[player];
      const pct = Math.max(0, (hp / max) * 100);
      p.health.style.width = `${pct}%`;
      p.lag = pct;
      p.health.classList.toggle('low', pct < 25);
    });
    bus.on('hud:meter', ({ player, value }) => {
      const p = this.players[player];
      p.meter.style.width = `${Math.min(100, value)}%`;
      p.meter.classList.toggle('full', value >= 100);
    });
    bus.on('hud:timer', ({ seconds }) => {
      this.timer.textContent = String(seconds).padStart(2, '0');
      this.timer.classList.toggle('urgent', seconds <= 10);
    });
    bus.on('hud:combo', ({ player, count, damage }) => {
      const p = this.players[player];
      if (count <= 1) return;
      p.combo.textContent = `${count} 连击 · ${damage}`;
      p.combo.classList.add('show');
      p.comboTimer = 90;
    });
    bus.on('hud:rounds', ({ p0, p1 }) => {
      const dots = this.roundDots.querySelectorAll('i');
      dots.forEach((d, i) => {
        d.className = '';
        if (i < p0) d.classList.add('win');
        else if (i >= 3 - p1) d.classList.add('win');
      });
    });
    bus.on('hud:callout', ({ text, ms }) => {
      this.callout.textContent = text;
      this.callout.classList.add('show');
      this.calloutTimer = Math.round(((ms ?? 1100) / 1000) * 60);
    });
    bus.on('perf:fps', ({ fps }) => {
      this.fps.textContent = `${fps.toFixed(0)} FPS`;
    });
  }

  show(): void {
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  update(): void {
    if (this.calloutTimer > 0) {
      this.calloutTimer--;
      if (this.calloutTimer === 0) this.callout.classList.remove('show');
    }
    for (const p of this.players) {
      if (p.comboTimer > 0) {
        p.comboTimer--;
        if (p.comboTimer === 0) p.combo.classList.remove('show');
      }
      // 伤害残影缓慢追上
      const target = parseFloat(p.health.style.width || '100');
      if (p.lag > target) {
        p.lag = Math.max(target, p.lag - 0.55);
        p.damage.style.width = `${p.lag}%`;
      } else {
        p.damage.style.width = `${target}%`;
      }
    }
  }

  reset(): void {
    for (const p of this.players) {
      p.health.style.width = '100%';
      p.damage.style.width = '100%';
      p.meter.style.width = '0%';
      p.combo.classList.remove('show');
    }
    this.timer.textContent = '99';
    this.callout.classList.remove('show');
  }
}
