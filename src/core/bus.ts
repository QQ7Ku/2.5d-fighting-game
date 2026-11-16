/**
 * 事件总线（接口契约见 docs/07-接口契约.md）
 * 所有跨系统通信只允许通过这里，禁止模块间直接调用战斗内部状态。
 */

import type { Btn } from './input';

export interface GameEvents {
  'loading:progress': { ratio: number; label: string };
  'loading:fail': { error: string; step: string };
  'loading:done': Record<string, never>;

  'match:start': { mode: 'ai' | 'local'; difficulty: 'easy' | 'normal' | 'hard' };
  'match:end': { winner: 0 | 1 | -1; reason: 'ko' | 'time' | 'double' };
  'round:start': { round: number };
  'round:end': { winner: 0 | 1 | -1; reason: 'ko' | 'time' | 'double' };

  'hud:health': { player: 0 | 1; hp: number; max: number };
  'hud:meter': { player: 0 | 1; value: number };
  'hud:timer': { seconds: number };
  'hud:combo': { player: 0 | 1; count: number; damage: number };
  'hud:rounds': { p0: number; p1: number };
  'hud:callout': { text: string; ms?: number };

  'combat:hit': {
    attacker: 0 | 1;
    defender: 0 | 1;
    moveId: string;
    damage: number;
    destroyLevel: 0 | 1 | 2 | 3;
    point: { x: number; y: number; z: number };
  };
  'combat:block': { defender: 0 | 1; moveId: string; chip: number };
  'combat:ko': { player: 0 | 1 };

  'destroy:damage': { objectId: string; stage: number; hp: number };
  'destroy:break': { objectId: string; tier: 1 | 2 | 3; position: { x: number; y: number; z: number } };
  'destroy:chain': { objectId: string; from: string };
  'destroy:collapse': { zoneId: string; fromX: number; toX: number };
  'destroy:stage': { objectId: string; stage: number; maxStage: number };

  'fx:hit': { x: number; y: number; z: number; level: 0 | 1 | 2 | 3 };
  'fx:shake': { strength: number; frames: number };
  'fx:impact': { x: number; y: number; kind: 'block' | 'hit' | 'heavy' };

  'sfx:play': { tag: string; gain?: number; detune?: number };

  'perf:tier': { tier: 'high' | 'medium' | 'low'; reason: string };
  'perf:fps': { fps: number };

  'ui:pause': Record<string, never>;
  'ui:resume': Record<string, never>;
  'ui:toast': { text: string; ms?: number };
  'ui:keys': { player: 0 | 1; btn: Btn };
}

type Handler<K extends keyof GameEvents> = (payload: GameEvents[K]) => void;

class Bus {
  private map = new Map<string, Set<Handler<never>>>();

  on<K extends keyof GameEvents>(type: K, fn: Handler<K>): () => void {
    let set = this.map.get(type as string);
    if (!set) {
      set = new Set();
      this.map.set(type as string, set);
    }
    set.add(fn as Handler<never>);
    return () => this.off(type, fn);
  }

  off<K extends keyof GameEvents>(type: K, fn: Handler<K>): void {
    this.map.get(type as string)?.delete(fn as Handler<never>);
  }

  emit<K extends keyof GameEvents>(type: K, payload: GameEvents[K]): void {
    const set = this.map.get(type as string);
    if (!set) return;
    for (const fn of Array.from(set)) {
      try {
        (fn as unknown as Handler<K>)(payload);
      } catch (err) {
        // 单个监听器异常不允许打断战斗循环
        console.error('[bus]', type, err);
      }
    }
  }

  clear(): void {
    this.map.clear();
  }
}

export const bus = new Bus();
