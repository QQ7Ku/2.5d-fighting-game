/**
 * Web Audio 音效合成器
 * 全部音效由振荡器 + 噪声 + 滤波包络实时合成，不含任何外部音频文件，
 * 因此不涉及第三方音源授权。浏览器自动播放策略通过 ensure() 在首次用户手势时解锁。
 */

import { bus } from './bus';
import { mulberry32 } from './math';

type Ctx = AudioContext & { _unlocked?: boolean };

export class AudioEngine {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private comp: DynamicsCompressorNode | null = null;
  private noise: AudioBuffer | null = null;
  private ambience: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private rng = mulberry32(0x9e3779b9);
  private volume = 0.8;
  private muted = false;

  constructor() {
    bus.on('sfx:play', ({ tag, gain, detune }) => this.play(tag, gain, detune));
  }

  get ready(): boolean {
    return this.ctx !== null;
  }

  /** 必须在用户手势中调用 */
  async ensure(): Promise<void> {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => undefined);
      return;
    }
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor({ latencyHint: 'interactive' }) as Ctx;
    this.ctx = ctx;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 22;
    comp.ratio.value = 6;
    comp.attack.value = 0.004;
    comp.release.value = 0.22;

    const master = ctx.createGain();
    master.gain.value = this.volume;

    master.connect(comp);
    comp.connect(ctx.destination);
    this.master = master;
    this.comp = comp;

    this.noise = this.makeNoise(ctx, 2.0);
    if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined);
    this.startAmbience();
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.05);
    }
  }

  getVolume(): number {
    return this.volume;
  }

  mute(on: boolean): void {
    this.muted = on;
    this.setVolume(this.volume);
  }

  private makeNoise(ctx: AudioContext, seconds: number): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = this.rng() * 2 - 1;
    return buf;
  }

  private now(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  private noiseSource(): AudioBufferSourceNode | null {
    if (!this.ctx || !this.noise) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = 0.9 + this.rng() * 0.2;
    return src;
  }

  private env(gain: GainNode, t0: number, attack: number, decay: number, peak: number): void {
    gain.gain.cancelScheduledValues(t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  }

  private tone(
    type: OscillatorType,
    freq: number,
    endFreq: number,
    dur: number,
    peak: number,
    delay = 0
  ): void {
    if (!this.ctx || !this.master) return;
    const t0 = this.now() + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t0 + dur);
    this.env(g, t0, Math.min(0.012, dur * 0.2), dur, peak);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  private noiseHit(
    filterType: BiquadFilterType,
    freq: number,
    q: number,
    dur: number,
    peak: number,
    delay = 0
  ): void {
    if (!this.ctx || !this.master) return;
    const src = this.noiseSource();
    if (!src) return;
    const t0 = this.now() + delay;
    const filt = this.ctx.createBiquadFilter();
    filt.type = filterType;
    filt.frequency.setValueAtTime(freq, t0);
    filt.Q.value = q;
    const g = this.ctx.createGain();
    this.env(g, t0, 0.004, dur, peak);
    src.connect(filt);
    filt.connect(g);
    g.connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.1);
  }

  play(tag: string, gain = 1, detune = 0): void {
    if (!this.ctx || !this.master) return;
    const p = Math.pow(2, detune / 1200);
    switch (tag) {
      case 'whoosh_light':
        this.noiseHit('bandpass', 2400 * p, 1.2, 0.12, 0.1 * gain);
        break;
      case 'whoosh_medium':
        this.noiseHit('bandpass', 1700 * p, 1.4, 0.17, 0.13 * gain);
        break;
      case 'whoosh_heavy':
        this.noiseHit('bandpass', 1100 * p, 1.1, 0.24, 0.17 * gain);
        break;
      case 'impact_light':
        this.noiseHit('lowpass', 1200 * p, 0.7, 0.09, 0.32 * gain);
        this.tone('triangle', 320 * p, 120, 0.09, 0.16 * gain);
        break;
      case 'impact_medium':
        this.noiseHit('lowpass', 900 * p, 0.8, 0.14, 0.4 * gain);
        this.tone('square', 220 * p, 70, 0.13, 0.14 * gain);
        break;
      case 'impact_heavy':
        this.noiseHit('lowpass', 620 * p, 0.9, 0.22, 0.5 * gain);
        this.tone('sine', 150 * p, 44, 0.28, 0.4 * gain);
        this.tone('square', 90 * p, 40, 0.2, 0.12 * gain);
        break;
      case 'block':
        this.noiseHit('bandpass', 3200 * p, 3.5, 0.1, 0.24 * gain);
        this.tone('triangle', 900 * p, 520, 0.07, 0.1 * gain);
        break;
      case 'hit_light':
        this.tone('sawtooth', 500 * p, 260, 0.09, 0.1 * gain);
        break;
      case 'hit_heavy':
        this.tone('sawtooth', 340 * p, 120, 0.18, 0.14 * gain);
        break;
      case 'jump':
        this.tone('sine', 300 * p, 560, 0.1, 0.09 * gain);
        break;
      case 'land':
        this.noiseHit('lowpass', 420 * p, 0.8, 0.1, 0.22 * gain);
        break;
      case 'special_hum':
        this.tone('sawtooth', 130 * p, 420, 0.34, 0.11 * gain);
        this.noiseHit('bandpass', 800 * p, 2, 0.32, 0.08 * gain);
        break;
      case 'throw':
        this.noiseHit('bandpass', 700 * p, 1.6, 0.2, 0.16 * gain);
        break;
      case 'shatter':
        for (let i = 0; i < 4; i++) {
          this.noiseHit('highpass', (2600 + i * 900) * p, 2.4, 0.16, 0.1 * gain, i * 0.03);
        }
        break;
      case 'collapse':
        this.noiseHit('lowpass', 300 * p, 0.6, 0.9, 0.5 * gain);
        this.tone('sine', 70 * p, 28, 1.1, 0.32 * gain);
        this.noiseHit('bandpass', 1400 * p, 0.9, 0.7, 0.16 * gain, 0.12);
        break;
      case 'ko':
        this.tone('sine', 220 * p, 60, 0.9, 0.3 * gain);
        this.tone('triangle', 110 * p, 40, 1.2, 0.22 * gain, 0.05);
        this.noiseHit('lowpass', 500 * p, 0.7, 0.5, 0.24 * gain);
        break;
      case 'bell': {
        // 钟声：五度叠置，模拟石钟余韵
        const base = 320 * p;
        this.tone('sine', base, base * 0.98, 1.6, 0.14 * gain);
        this.tone('sine', base * 1.5, base * 1.47, 1.2, 0.08 * gain, 0.01);
        this.tone('sine', base * 2.02, base * 1.98, 0.8, 0.05 * gain, 0.02);
        break;
      }
      case 'ui_click':
        this.tone('triangle', 720 * p, 640, 0.05, 0.07 * gain);
        break;
      case 'ui_confirm':
        this.tone('triangle', 620 * p, 940, 0.09, 0.08 * gain);
        this.tone('triangle', 940 * p, 1180, 0.1, 0.05 * gain, 0.06);
        break;
      case 'countdown':
        this.tone('square', 880 * p, 860, 0.08, 0.08 * gain);
        break;
      default:
        this.tone('sine', 440 * p, 440, 0.06, 0.05 * gain);
    }
  }

  /** 庭院环境声：低频风声 + 稀疏落叶，随画质档位可关 */
  private startAmbience(): void {
    if (!this.ctx || !this.master || this.ambience) return;
    const src = this.noiseSource();
    if (!src) return;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 480;
    const g = this.ctx.createGain();
    g.gain.value = 0.035;
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.frequency.value = 0.11;
    lfoGain.gain.value = 0.018;
    lfo.connect(lfoGain);
    lfoGain.connect(g.gain);
    src.connect(lp);
    lp.connect(g);
    g.connect(this.master);
    src.start();
    lfo.start();
    this.ambience = { src, gain: g };
  }

  setAmbience(on: boolean): void {
    if (!this.ambience || !this.ctx) return;
    this.ambience.gain.gain.setTargetAtTime(on ? 0.035 : 0, this.ctx.currentTime, 0.3);
  }

  dispose(): void {
    try {
      this.ambience?.src.stop();
      void this.ctx?.close();
    } catch {
      /* 忽略关闭异常 */
    }
    this.ctx = null;
    this.master = null;
    this.ambience = null;
  }
}

export const audio = new AudioEngine();
