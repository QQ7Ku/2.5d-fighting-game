/**
 * 统一输入层：键盘 / 手柄 / 触屏 → 同一份 InputState
 * 触屏与键盘共用按键语义，因此输入缓冲、连招判定无需区分设备。
 */

import { bus } from './bus';

export type Btn =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'light'
  | 'medium'
  | 'heavy'
  | 'special'
  | 'throw'
  | 'guard';

export const BTNS: Btn[] = [
  'up',
  'down',
  'left',
  'right',
  'light',
  'medium',
  'heavy',
  'special',
  'throw',
  'guard',
];

export type Binding = Record<Btn, string>;

export const BTN_LABEL: Record<Btn, string> = {
  up: '上 / 跳',
  down: '下 / 蹲',
  left: '左',
  right: '右',
  light: '轻攻击',
  medium: '中攻击',
  heavy: '重攻击',
  special: '必杀',
  throw: '投技',
  guard: '防御',
};

export const DEFAULT_BINDINGS: [Binding, Binding] = [
  {
    up: 'KeyW',
    down: 'KeyS',
    left: 'KeyA',
    right: 'KeyD',
    light: 'KeyJ',
    medium: 'KeyK',
    heavy: 'KeyL',
    special: 'KeyU',
    throw: 'KeyI',
    guard: 'Space',
  },
  {
    up: 'ArrowUp',
    down: 'ArrowDown',
    left: 'ArrowLeft',
    right: 'ArrowRight',
    light: 'Numpad4',
    medium: 'Numpad5',
    heavy: 'Numpad6',
    special: 'Numpad7',
    throw: 'Numpad8',
    guard: 'Numpad9',
  },
];

const STORAGE_KEY = 'washangshuang.bindings.v2';

export interface InputState {
  held: Set<Btn>;
  pressed: Set<Btn>;
  axisX: number; // -1..1
  axisY: number; // -1..1
  analog: boolean;
}

function emptyState(): InputState {
  return { held: new Set(), pressed: new Set(), axisX: 0, axisY: 0, analog: false };
}

export class InputManager {
  bindings: [Binding, Binding] = [
    { ...DEFAULT_BINDINGS[0] },
    { ...DEFAULT_BINDINGS[1] },
  ];
  private states: [InputState, InputState] = [emptyState(), emptyState()];
  private keyboardDown = new Set<string>();
  private prevHeld: [Set<Btn>, Set<Btn>] = [new Set(), new Set()];
  private touchButtons = new Set<Btn>();
  private pendingPress: [Set<Btn>, Set<Btn>] = [new Set(), new Set()];
  private touchAxis = { x: 0, y: 0 };
  private touchActive = false;
  private listening: { player: 0 | 1; btn: Btn } | null = null;
  private enabled = true;

  constructor() {
    this.load();
    window.addEventListener('keydown', this.onKeyDown, { passive: false });
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => {
      this.keyboardDown.clear();
      this.touchButtons.clear();
      this.touchAxis.x = 0;
      this.touchAxis.y = 0;
    });
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { p0: Binding; p1: Binding };
      if (parsed?.p0 && parsed?.p1) {
        this.bindings = [
          { ...DEFAULT_BINDINGS[0], ...parsed.p0 },
          { ...DEFAULT_BINDINGS[1], ...parsed.p1 },
        ];
      }
    } catch {
      /* 存档损坏时使用默认键位 */
    }
  }

  save(): void {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ p0: this.bindings[0], p1: this.bindings[1] })
      );
    } catch {
      /* 隐私模式忽略 */
    }
  }

  resetBindings(): void {
    this.bindings = [{ ...DEFAULT_BINDINGS[0] }, { ...DEFAULT_BINDINGS[1] }];
    this.save();
  }

  beginRebind(player: 0 | 1, btn: Btn): void {
    this.listening = { player, btn };
  }

  cancelRebind(): void {
    this.listening = null;
  }

  get listeningFor(): { player: 0 | 1; btn: Btn } | null {
    return this.listening;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Space' || e.code.startsWith('Arrow') || e.code.startsWith('Numpad')) {
      e.preventDefault();
    }
    if (this.listening) {
      const { player, btn } = this.listening;
      // 监听期间 Esc 必须当作「取消改键」：原先会把它直接绑成上/跳，玩家想退出反而改坏了键位
      if (e.code === 'Escape' || e.code === 'Backspace') {
        this.listening = null;
        bus.emit('ui:keys', { player, btn });
        bus.emit('ui:toast', { text: '已取消改键', ms: 1200 });
        return;
      }
      const conflict = BTNS.find((b) => b !== btn && this.bindings[player][b] === e.code);
      if (conflict) {
        // 同一玩家两个动作绑到同一个键，会一起触发；直接拒绝并保持监听
        bus.emit('ui:toast', { text: `${e.code} 已被「${BTN_LABEL[conflict]}」占用`, ms: 1500 });
        return;
      }
      this.bindings[player][btn] = e.code;
      this.listening = null;
      this.save();
      bus.emit('ui:keys', { player, btn });
      bus.emit('ui:toast', { text: `已绑定 ${e.code}`, ms: 1200 });
      return;
    }
    if (e.repeat) return;
    this.keyboardDown.add(e.code);
    // 键盘极快点击也可能短于一帧，同样挂起一次按下
    for (const p of [0, 1] as const) {
      const binding = this.bindings[p];
      for (const btn of BTNS) {
        if (binding[btn] === e.code) this.pendingPress[p].add(btn);
      }
    }
    if (e.code === 'Escape') bus.emit('ui:pause', {});
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keyboardDown.delete(e.code);
  };

  setTouchActive(active: boolean): void {
    this.touchActive = active;
    if (!active) {
      this.touchButtons.clear();
      this.touchAxis.x = 0;
      this.touchAxis.y = 0;
    }
  }

  setTouchButton(btn: Btn, down: boolean): void {
    if (down) {
      this.touchButtons.add(btn);
      // 轻点可能短于一帧，先挂起，确保输入缓冲一定能看到这次按下
      this.pendingPress[0].add(btn);
    } else {
      this.touchButtons.delete(btn);
    }
  }

  setTouchAxis(x: number, y: number): void {
    this.touchAxis.x = x;
    this.touchAxis.y = y;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) {
      this.keyboardDown.clear();
      this.touchButtons.clear();
      this.touchAxis.x = 0;
      this.touchAxis.y = 0;
    }
  }

  /** 每逻辑帧开始调用，刷新 held / pressed */
  update(activePlayers: 0 | 1 | 2 = 2): void {
    for (let p = 0 as 0 | 1; p < 2; p = (p + 1) as 0 | 1) {
      const state = this.states[p];
      const held = new Set<Btn>();
      if (this.enabled && p < activePlayers) {
        const binding = this.bindings[p];
        for (const btn of BTNS) {
          if (this.keyboardDown.has(binding[btn])) held.add(btn);
        }
        const pad = this.readGamepad(p);
        if (pad) {
          for (const btn of pad) held.add(btn);
        }
        if (p === 0 && this.touchActive) {
          for (const btn of this.touchButtons) held.add(btn);
        }
      }

      // 方向：数字轴 + 触屏模拟轴。必须先算完（模拟轴会补 left/right/up/down 到 held），
      // 再算 pressed，否则摇杆上推产生的 up 只有 held 没有 pressed，防御态里起不了跳。
      let x = (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0);
      let y = (held.has('up') ? 1 : 0) - (held.has('down') ? 1 : 0);
      let analog = false;
      if (p === 0 && this.touchActive) {
        if (Math.abs(this.touchAxis.x) > 0.22) {
          x = this.touchAxis.x;
          analog = true;
          // 摇杆推到底也要产生方向按键：否则「按住后 = 防御」在触屏上永远不成立
          if (x > 0.6) held.add('right');
          if (x < -0.6) held.add('left');
        }
        if (Math.abs(this.touchAxis.y) > 0.45) {
          y = -this.touchAxis.y;
          if (y > 0.6) held.add('up');
          if (y < -0.6) held.add('down');
        }
      }

      state.pressed.clear();
      for (const btn of held) {
        if (!this.prevHeld[p].has(btn)) state.pressed.add(btn);
      }
      for (const btn of this.pendingPress[p]) state.pressed.add(btn);
      this.pendingPress[p].clear();
      state.held = held;
      this.prevHeld[p] = new Set(held);
      state.axisX = x;
      state.axisY = y;
      state.analog = analog;
    }
  }

  private readGamepad(player: 0 | 1): Btn[] | null {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    const pad = pads[player] ?? pads.find((g) => g && g.connected) ?? null;
    if (!pad) return null;
    const out: Btn[] = [];
    const pressed = (i: number): boolean => !!pad.buttons[i]?.pressed;
    if (pressed(14)) out.push('left');
    if (pressed(15)) out.push('right');
    if (pressed(12)) out.push('up');
    if (pressed(13)) out.push('down');
    if (pressed(2)) out.push('light');
    if (pressed(3)) out.push('medium');
    if (pressed(1)) out.push('heavy');
    if (pressed(0)) out.push('special');
    if (pressed(5)) out.push('throw');
    if (pressed(4) || pressed(6)) out.push('guard');
    const ax = pad.axes[0] ?? 0;
    const ay = pad.axes[1] ?? 0;
    if (ax < -0.4) out.push('left');
    if (ax > 0.4) out.push('right');
    if (ay < -0.5) out.push('up');
    if (ay > 0.5) out.push('down');
    return out;
  }

  get(player: 0 | 1): InputState {
    return this.states[player];
  }

  /** 供 UI 显示当前实际按键 */
  keyLabel(player: 0 | 1, btn: Btn): string {
    const code = this.bindings[player][btn];
    return code
      .replace('Key', '')
      .replace('Arrow', '')
      .replace('Numpad', '小键盘 ')
      .replace('Space', '空格')
      .replace('Digit', '');
  }
}

export const input = new InputManager();
