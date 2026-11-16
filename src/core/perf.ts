/**
 * 性能档位管理：高 / 中 / 低，可自动也可手动。
 * 低档会同时降低：阴影、像素比、碎片上限、装饰密度、粒子数量、后处理。
 */

import { bus } from './bus';

export type Tier = 'high' | 'medium' | 'low';
export type TierMode = 'auto' | Tier;

export interface Budget {
  pixelRatio: number;
  shadows: boolean;
  shadowMapSize: number;
  fragmentCap: number;
  particleScale: number;
  decorScale: number;
  maxLights: number;
  antialias: boolean;
  ambience: boolean;
  dust: boolean;
}

const BUDGETS: Record<Tier, Budget> = {
  high: {
    pixelRatio: 2,
    shadows: true,
    shadowMapSize: 1024,
    fragmentCap: 200,
    particleScale: 1,
    decorScale: 1,
    maxLights: 4,
    antialias: true,
    ambience: true,
    dust: true,
  },
  medium: {
    pixelRatio: 1.5,
    shadows: true,
    shadowMapSize: 512,
    fragmentCap: 150,
    particleScale: 0.65,
    decorScale: 0.7,
    maxLights: 3,
    antialias: true,
    ambience: true,
    dust: true,
  },
  low: {
    pixelRatio: 1,
    shadows: false,
    shadowMapSize: 256,
    fragmentCap: 100,
    particleScale: 0.4,
    decorScale: 0.42,
    maxLights: 2,
    antialias: false,
    ambience: false,
    dust: false,
  },
};

export const isMobileDevice = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  return /Android|iPhone|iPad|iPod|Mobile|HarmonyOS/i.test(ua) || (coarse && window.innerWidth < 1100);
};

export class QualityManager {
  mode: TierMode = 'auto';
  tier: Tier = 'medium';
  private fpsSamples: number[] = [];
  private lowStreak = 0;
  private highStreak = 0;
  private settleFrames = 120;
  private listener: ((b: Budget) => void) | null = null;

  constructor() {
    const stored = localStorage.getItem('washangshuang.quality.v2') as TierMode | null;
    if (stored === 'auto' || stored === 'high' || stored === 'medium' || stored === 'low') {
      this.mode = stored;
    }
    this.tier = this.mode === 'auto' ? (isMobileDevice() ? 'low' : 'high') : this.mode;
  }

  get budget(): Budget {
    return BUDGETS[this.tier];
  }

  onApply(fn: (b: Budget) => void): void {
    this.listener = fn;
    fn(this.budget);
  }

  setMode(mode: TierMode): void {
    this.mode = mode;
    localStorage.setItem('washangshuang.quality.v2', mode);
    if (mode !== 'auto') {
      this.tier = mode;
      this.lowStreak = 0;
      this.highStreak = 0;
      this.apply('手动切换');
    } else {
      this.apply('恢复自动');
    }
  }

  private apply(reason: string): void {
    bus.emit('perf:tier', { tier: this.tier, reason });
    this.listener?.(this.budget);
  }

  update(fps: number): void {
    if (this.mode !== 'auto') return;
    if (this.settleFrames > 0) {
      this.settleFrames--;
      return;
    }
    this.fpsSamples.push(fps);
    if (this.fpsSamples.length > 60) this.fpsSamples.shift();
    if (this.fpsSamples.length < 30) return;
    const avg = this.fpsSamples.reduce((a, b) => a + b, 0) / this.fpsSamples.length;

    if (avg < 26) {
      this.lowStreak++;
      this.highStreak = 0;
    } else if (avg > 54) {
      this.highStreak++;
      this.lowStreak = 0;
    } else {
      this.lowStreak = 0;
      this.highStreak = 0;
    }

    if (this.lowStreak > 4) {
      this.lowStreak = 0;
      this.fpsSamples.length = 0;
      this.settleFrames = 90;
      if (this.tier === 'high') {
        this.tier = 'medium';
        this.apply('帧率偏低自动降档');
      } else if (this.tier === 'medium') {
        this.tier = 'low';
        this.apply('帧率偏低自动降档');
      }
    } else if (this.highStreak > 10 && this.tier !== 'high') {
      this.highStreak = 0;
      this.fpsSamples.length = 0;
      this.settleFrames = 180;
      this.tier = this.tier === 'low' ? 'medium' : 'high';
      this.apply('帧率富余自动升档');
    }
  }
}

export const quality = new QualityManager();
