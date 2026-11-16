/**
 * 触屏操控：虚拟摇杆 + 六键，支持多点触控、布局预设、大小/透明度调节
 * 所有触屏输入统一进入 InputManager，与键盘共用输入缓冲与连招判定。
 */

import { input, type Btn } from '../core/input';

const TOUCH_SETTINGS_KEY = 'washangshuang.touch.v2';

interface TouchSettings {
  size: number;
  opacity: number;
  layout: 'standard' | 'compact' | 'lefty';
}

export class TouchControls {
  private root: HTMLElement | null = $('touch');
  private zone: HTMLElement | null = $('stick-zone');
  private knob: HTMLElement | null = $('stick-knob');
  private actionsRoot: HTMLElement | null = $('touch-actions');
  private enabled = false;
  private stickPointer: number | null = null;
  private stickCenter = { x: 0, y: 0 };
  private buttonPointers = new Map<number, Btn>();
  settings: TouchSettings = { size: 1, opacity: 0.72, layout: 'standard' };

  constructor() {
    this.load();
    this.applySettings();
    this.bindStick();
    this.bindButtons();
    this.bindPause();
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(TOUCH_SETTINGS_KEY);
      if (raw) this.settings = { ...this.settings, ...(JSON.parse(raw) as Partial<TouchSettings>) };
    } catch {
      /* 使用默认 */
    }
  }

  save(): void {
    localStorage.setItem(TOUCH_SETTINGS_KEY, JSON.stringify(this.settings));
  }

  applySettings(): void {
    document.documentElement.style.setProperty('--btn-scale', String(this.settings.size));
    document.documentElement.style.setProperty('--btn-opacity', String(this.settings.opacity));
    document.body.dataset.layout = this.settings.layout;
    if (this.actionsRoot) this.actionsRoot.dataset.layout = this.settings.layout;
  }

  setSize(v: number): void {
    this.settings.size = v;
    this.applySettings();
    this.save();
  }

  setOpacity(v: number): void {
    this.settings.opacity = v;
    this.applySettings();
    this.save();
  }

  setLayout(v: TouchSettings['layout']): void {
    this.settings.layout = v;
    this.applySettings();
    this.save();
  }

  enable(): void {
    this.enabled = true;
    this.root?.classList.remove('hidden');
    document.body.classList.add('touch-active');
    input.setTouchActive(true);
  }

  disable(): void {
    this.enabled = false;
    this.root?.classList.add('hidden');
    document.body.classList.remove('touch-active');
    input.setTouchActive(false);
    this.stickPointer = null;
    this.buttonPointers.clear();
    if (this.knob) this.knob.style.transform = 'translate(0px, 0px)';
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  private bindPause(): void {
    const btn = document.getElementById('touch-pause');
    btn?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      document.dispatchEvent(new CustomEvent('game:pause-request'));
    });
  }

  private bindStick(): void {
    const zone = this.zone;
    if (!zone) return;
    zone.style.touchAction = 'none';

    zone.addEventListener('pointerdown', (e) => {
      if (!this.enabled || this.stickPointer !== null) return;
      const rect = zone.getBoundingClientRect();
      const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      // 热区 260×260 而可见底盘只有 161×161：原来在底盘外一落指就按「离中心多远」给满幅方向
      // （左下角 = 蹲防、左侧 = 防御）。可见底盘之外不接管，落指必须落在盘内才开始跟踪。
      const visibleRadius = rect.width * 0.31;
      if (Math.hypot(e.clientX - center.x, e.clientY - center.y) > visibleRadius) return;
      e.preventDefault();
      this.stickPointer = e.pointerId;
      zone.setPointerCapture(e.pointerId);
      this.stickCenter = center;
      this.moveStick(e.clientX, e.clientY);
    });

    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stickPointer) return;
      e.preventDefault();
      this.moveStick(e.clientX, e.clientY);
    });

    const end = (e: PointerEvent): void => {
      if (e.pointerId !== this.stickPointer) return;
      this.stickPointer = null;
      input.setTouchAxis(0, 0);
      if (this.knob) this.knob.style.transform = 'translate(0px, 0px)';
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
    zone.addEventListener('lostpointercapture', end);
  }

  private moveStick(cx: number, cy: number): void {
    const zone = this.zone!;
    const rect = zone.getBoundingClientRect();
    const radius = rect.width * 0.34;
    let dx = cx - this.stickCenter.x;
    let dy = cy - this.stickCenter.y;
    const len = Math.hypot(dx, dy);
    if (len > radius) {
      dx = (dx / len) * radius;
      dy = (dy / len) * radius;
    }
    if (this.knob) this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const nx = Math.abs(dx) < radius * 0.18 ? 0 : dx / radius;
    const ny = Math.abs(dy) < radius * 0.22 ? 0 : dy / radius;
    input.setTouchAxis(Math.max(-1, Math.min(1, nx)), Math.max(-1, Math.min(1, ny)));
  }

  private bindButtons(): void {
    const buttons = document.querySelectorAll<HTMLElement>('.tbtn[data-action]');
    buttons.forEach((btn) => {
      const action = btn.dataset.action as Btn;
      btn.style.touchAction = 'none';
      btn.addEventListener('pointerdown', (e) => {
        if (!this.enabled) return;
        e.preventDefault();
        e.stopPropagation();
        // 先入队再捕获：setPointerCapture 在某些合成事件下会抛错，
        // 抛在入队之前会让整次按下丢失（包括这一个按键）
        this.buttonPointers.set(e.pointerId, action);
        input.setTouchButton(action, true);
        btn.classList.add('active');
        try {
          btn.setPointerCapture(e.pointerId);
        } catch {
          /* 捕获失败不影响按键本身，靠 pointerup/cancel 兜底 */
        }
      });
      const release = (e: PointerEvent): void => {
        const stored = this.buttonPointers.get(e.pointerId);
        if (!stored) return;
        this.buttonPointers.delete(e.pointerId);
        // 同一按钮可能被多根手指按住，全部松开才释放
        const stillHeld = Array.from(this.buttonPointers.values()).includes(stored);
        if (!stillHeld) {
          input.setTouchButton(stored, false);
          btn.classList.remove('active');
        }
      };
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointercancel', release);
      btn.addEventListener('lostpointercapture', release);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    });
  }
}

function $<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}
