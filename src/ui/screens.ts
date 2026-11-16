/** 界面流程：菜单 / 设置 / 帮助 / 结算 / 暂停 / 横屏提示 */

import { bus } from '../core/bus';
import { input, BTN_LABEL, BTNS, type Btn } from '../core/input';
import { quality, type TierMode, isMobileDevice } from '../core/perf';
import { audio } from '../core/audio';
import type { TouchControls } from './touch';
import type { Difficulty } from '../game/ai';
import type { MatchMode } from '../game/match';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

export interface StartConfig {
  mode: MatchMode;
  difficulty: Difficulty;
}

export class Screens {
  mode: MatchMode = 'ai';
  difficulty: Difficulty = 'normal';
  onStart: ((cfg: StartConfig) => void) | null = null;
  onRestart: (() => void) | null = null;
  onQuit: (() => void) | null = null;
  onPause: (() => void) | null = null;
  onResume: (() => void) | null = null;

  private menu = $('overlay-menu');
  private settings = $('overlay-settings');
  private help = $('overlay-help');
  private result = $('overlay-result');
  private pause = $('overlay-pause');
  private rotate = $('rotate-hint');
  private difficultyGroup = $('difficulty-group');

  constructor(private touch: TouchControls) {
    this.bindMenu();
    this.bindSettings();
    this.bindHelp();
    this.bindResult();
    bus.on('ui:toast', ({ text, ms }) => this.toast(text, ms));
    this.bindPause();
    this.bindRotate();
  }

  private bindMenu(): void {
    // 移动端没有第二套摇杆+六键，2P 无任何触控通道，与其留个点了没反应的选项，不如明说
    if (isMobileDevice()) {
      const localBtn = document.querySelector<HTMLElement>('#mode-seg .seg-btn[data-mode="local"]');
      if (localBtn) {
        localBtn.classList.add('is-disabled');
        localBtn.setAttribute('aria-disabled', 'true');
      }
    }
    $('mode-seg').addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('.seg-btn');
      if (!btn) return;
      if (btn.dataset.mode === 'local' && isMobileDevice()) {
        bus.emit('ui:toast', { text: '移动端暂无 2P 触控，本地双人请用键盘', ms: 1800 });
        return;
      }
      this.mode = btn.dataset.mode as MatchMode;
      document.querySelectorAll('#mode-seg .seg-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      this.difficultyGroup.style.display = this.mode === 'ai' ? '' : 'none';
      bus.emit('sfx:play', { tag: 'ui_click', gain: 0.6 });
    });
    $('diff-seg').addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('.seg-btn');
      if (!btn) return;
      this.difficulty = btn.dataset.diff as Difficulty;
      document.querySelectorAll('#diff-seg .seg-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      bus.emit('sfx:play', { tag: 'ui_click', gain: 0.6 });
    });
    $('quality-seg').addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('.seg-btn');
      if (!btn) return;
      const mode = btn.dataset.quality as TierMode;
      quality.setMode(mode);
      document.querySelectorAll('#quality-seg .seg-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      bus.emit('sfx:play', { tag: 'ui_click', gain: 0.6 });
      bus.emit('ui:toast', { text: `画质：${mode === 'auto' ? '自动' : mode === 'high' ? '高' : mode === 'medium' ? '中' : '低'}`, ms: 1200 });
    });
    $('btn-start').addEventListener('click', () => {
      bus.emit('sfx:play', { tag: 'ui_confirm', gain: 0.9 });
      this.hideMenu();
      this.onStart?.({ mode: this.mode, difficulty: this.difficulty });
    });
    $('btn-help').addEventListener('click', () => {
      this.help.classList.remove('hidden');
      bus.emit('sfx:play', { tag: 'ui_click', gain: 0.6 });
    });
    $('btn-settings').addEventListener('click', () => {
      this.settings.classList.remove('hidden');
      this.renderKeys();
      bus.emit('sfx:play', { tag: 'ui_click', gain: 0.6 });
    });
    $('btn-fullscreen').addEventListener('click', () => {
      const el = document.documentElement;
      if (document.fullscreenElement) void document.exitFullscreen();
      else void el.requestFullscreen?.().catch(() => undefined);
      bus.emit('sfx:play', { tag: 'ui_click', gain: 0.6 });
    });

    const hint = $('device-hint');
    if (isMobileDevice()) {
      hint.textContent = '检测到移动设备：建议横屏并开启全屏；触屏按键会自动启用。';
    } else {
      hint.textContent = '桌面推荐 Chrome / Edge 最新版；支持手柄（可选）。';
    }
  }

  private bindSettings(): void {
    const size = $<HTMLInputElement>('set-btn-size');
    const opacity = $<HTMLInputElement>('set-btn-opacity');
    const volume = $<HTMLInputElement>('set-volume');
    const layout = $<HTMLSelectElement>('set-layout');

    size.value = String(this.touch.settings.size);
    opacity.value = String(this.touch.settings.opacity);
    volume.value = String(audio.getVolume());
    layout.value = this.touch.settings.layout;
    $('val-btn-size').textContent = `${Math.round(this.touch.settings.size * 100)}%`;
    $('val-btn-opacity').textContent = `${Math.round(this.touch.settings.opacity * 100)}%`;
    $('val-volume').textContent = `${Math.round(audio.getVolume() * 100)}%`;

    size.addEventListener('input', () => {
      const v = parseFloat(size.value);
      this.touch.setSize(v);
      $('val-btn-size').textContent = `${Math.round(v * 100)}%`;
    });
    opacity.addEventListener('input', () => {
      const v = parseFloat(opacity.value);
      this.touch.setOpacity(v);
      $('val-btn-opacity').textContent = `${Math.round(v * 100)}%`;
    });
    volume.addEventListener('input', () => {
      const v = parseFloat(volume.value);
      audio.setVolume(v);
      $('val-volume').textContent = `${Math.round(v * 100)}%`;
    });
    layout.addEventListener('change', () => {
      this.touch.setLayout(layout.value as 'standard' | 'compact' | 'lefty');
    });

    // 吸顶头部的 × 与底部「完成」共用同一个关闭语义：长面板在手机上要滚 1.7 屏才到底
    for (const id of ['btn-close-settings', 'btn-close-settings-x']) {
      $(id).addEventListener('click', () => {
        this.settings.classList.add('hidden');
        bus.emit('sfx:play', { tag: 'ui_confirm', gain: 0.6 });
      });
    }
    $('btn-reset-keys').addEventListener('click', () => {
      input.resetBindings();
      this.renderKeys();
      bus.emit('ui:toast', { text: '键位已恢复默认', ms: 1400 });
    });
    bus.on('ui:keys', () => this.renderKeys());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        // document 比 window 先收到键：改键监听期的 Esc 只用于「取消改键」，
        // 不能顺手把整个设置面板关掉（否则要重开面板再滑 1.7 屏）
        if (input.listeningFor) return;
        if (!this.settings.classList.contains('hidden')) this.settings.classList.add('hidden');
        else if (!this.help.classList.contains('hidden')) this.help.classList.add('hidden');
      }
      if (input.listeningFor) this.renderKeys();
    });
  }

  private renderKeys(): void {
    const root = $('key-map');
    root.innerHTML = '';
    for (const player of [0, 1] as const) {
      for (const btn of BTNS) {
        const row = document.createElement('div');
        row.className = 'key-row';
        const label = document.createElement('span');
        label.textContent = `${player === 0 ? '1P' : '2P'} ${BTN_LABEL[btn]}`;
        const chip = document.createElement('div');
        chip.className = 'key-chip';
        const listening = input.listeningFor;
        if (listening && listening.player === player && listening.btn === btn) {
          chip.classList.add('listening');
          chip.textContent = '按键…';
        } else {
          chip.textContent = input.keyLabel(player, btn as Btn);
        }
        chip.addEventListener('click', () => {
          input.beginRebind(player, btn as Btn);
          this.renderKeys();
        });
        row.append(label, chip);
        root.appendChild(row);
      }
    }
  }

  private bindHelp(): void {
    for (const id of ['btn-close-help', 'btn-close-help-x']) {
      $(id).addEventListener('click', () => {
        this.help.classList.add('hidden');
        bus.emit('sfx:play', { tag: 'ui_click', gain: 0.6 });
      });
    }
  }

  private bindResult(): void {
    $('btn-again').addEventListener('click', () => {
      this.result.classList.add('hidden');
      this.onRestart?.();
    });
    $('btn-back-menu').addEventListener('click', () => {
      this.result.classList.add('hidden');
      this.onQuit?.();
      this.showMenu();
    });
  }

  private bindPause(): void {
    $('btn-resume').addEventListener('click', () => {
      this.pause.classList.add('hidden');
      this.onResume?.();
    });
    $('btn-quit').addEventListener('click', () => {
      this.pause.classList.add('hidden');
      this.onQuit?.();
      this.showMenu();
    });
    bus.on('ui:pause', () => {
      if (this.menu.classList.contains('hidden') && this.result.classList.contains('hidden')) {
        this.pause.classList.remove('hidden');
        this.onPause?.();
      }
    });
    document.addEventListener('game:pause-request', () => {
      bus.emit('ui:pause', {});
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) bus.emit('ui:pause', {});
    });
  }

  private bindRotate(): void {
    const check = (): void => {
      const portrait = window.innerHeight > window.innerWidth;
      const touchDevice = isMobileDevice();
      const fighting = !this.menu.classList.contains('hidden') === false;
      if (portrait && touchDevice) this.rotate.classList.remove('hidden');
      else this.rotate.classList.add('hidden');
      void fighting;
    };
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', () => window.setTimeout(check, 220));
    check();
  }

  showMenu(): void {
    this.menu.classList.remove('hidden');
    this.hideResult();
  }

  hideMenu(): void {
    this.menu.classList.add('hidden');
  }

  showResult(winner: 0 | 1 | -1, reason: 'ko' | 'time' | 'double'): void {
    const title = $('result-title');
    const sub = $('result-sub');
    if (winner === 0) {
      title.textContent = this.mode === 'ai' ? '胜' : '1P 胜';
      sub.textContent = reason === 'time' ? '时间到 · 血量领先' : '对手倒地';
    } else if (winner === 1) {
      title.textContent = this.mode === 'ai' ? '败' : '2P 胜';
      sub.textContent = reason === 'time' ? '时间到 · 血量落后' : '你被击倒';
    } else {
      title.textContent = '平';
      sub.textContent = '双双倒地';
    }
    this.result.classList.remove('hidden');
  }

  hideResult(): void {
    this.result.classList.add('hidden');
  }

  showPause(): void {
    this.pause.classList.remove('hidden');
  }

  hidePause(): void {
    this.pause.classList.add('hidden');
  }

  toast(text: string, ms = 1400): void {
    const el = $('toast');
    el.textContent = text;
    el.classList.add('show');
    window.setTimeout(() => el.classList.remove('show'), ms);
  }
}
