/**
 * 启动入口：渲染器、加载流程、固定步长主循环、对局生命周期
 */

import './style.css';
import * as THREE from 'three';
import { bus } from './core/bus';
import { quality, isMobileDevice, type Budget } from './core/perf';
import { audio } from './core/audio';
import { input } from './core/input';
import { Arena } from './view/arena';
import { ALL_SCENE_MODELS, SCENERY_MODELS, glbPropsDebug, GLB_PROPS } from './view/glbProps';
import { stageDecorDebug } from './view/stageDecor';
import { stonePropsDebug } from './view/stoneProps';
import { collidersDebug, setColliderDebugVisible } from './view/colliders';
import { FxSystem } from './view/fx';
import { CameraRig } from './view/camera';
import { DestructionSystem } from './game/destruction';
import { Match, type MatchOptions } from './game/match';
import { Hud } from './ui/hud';
import { TouchControls } from './ui/touch';
import { Screens } from './ui/screens';
import { CHARACTERS } from './data/moves';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

class Game {
  private renderer: THREE.WebGLRenderer;
  private arena: Arena;
  private fx: FxSystem;
  private cameraRig: CameraRig;
  private destruction: DestructionSystem;
  private match: Match | null = null;
  private hud = new Hud();
  private touch = new TouchControls();
  private screens: Screens;
  private clock = new THREE.Clock();
  private accumulator = 0;
  private running = false;
  private paused = false;
  private fpsFrames = 0;
  private fpsTime = 0;
  private budget: Budget;
  private matchOptions: MatchOptions = { mode: 'ai', difficulty: 'normal', rounds: 3 };
  private lastFps = 60;
  private tickCount = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.budget = quality.budget;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: this.budget.antialias,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.budget.pixelRatio));
    this.renderer.shadowMap.enabled = this.budget.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.resize();

    this.arena = new Arena(this.budget);
    this.cameraRig = new CameraRig(window.innerWidth / window.innerHeight);
    this.fx = new FxSystem(this.arena.scene, this.budget);
    this.destruction = new DestructionSystem(this.arena, this.arena.scene, this.budget);
    this.screens = new Screens(this.touch);

    quality.onApply((b) => this.applyBudget(b));
    this.bindScreens();
    this.bindGlobal();
  }

  private applyBudget(budget: Budget): void {
    this.budget = budget;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, budget.pixelRatio));
    this.renderer.shadowMap.enabled = budget.shadows;
    this.arena.applyBudget(budget);
    this.destruction.applyBudget(budget);
    this.fx.applyBudget(budget);
    audio.setAmbience(budget.ambience);
    if (this.match) {
      this.match.fighters[0].rig.setTier(budget.shadows ? 'high' : 'low');
      this.match.fighters[1].rig.setTier(budget.shadows ? 'high' : 'low');
    }
    bus.emit('ui:toast', { text: `画质档位：${quality.tier === 'high' ? '高' : quality.tier === 'medium' ? '中' : '低'}`, ms: 1100 });
  }

  private bindScreens(): void {
    this.screens.onStart = (cfg) => this.startMatch({ mode: cfg.mode, difficulty: cfg.difficulty, rounds: 3 });
    this.screens.onRestart = () => this.startMatch(this.matchOptions);
    this.screens.onQuit = () => this.endMatch();
    this.screens.onPause = () => {
      this.paused = true;
      input.setEnabled(false);
    };
    this.screens.onResume = () => {
      this.paused = false;
      input.setEnabled(true);
    };
  }

  private bindGlobal(): void {
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => window.setTimeout(() => this.resize(), 250));
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener(
      'touchmove',
      (e) => {
        if (e.touches.length > 1) e.preventDefault();
      },
      { passive: false }
    );
    const unlock = (): void => {
      void audio.ensure();
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    window.addEventListener('gamepadconnected', () => {
      bus.emit('ui:toast', { text: '手柄已连接', ms: 1400 });
    });
    this.renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      bus.emit('ui:toast', { text: '渲染上下文丢失，正在恢复…', ms: 2400 });
    });
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    if (this.cameraRig) this.cameraRig.setAspect(w / h);
    if (isMobileDevice() && this.match) this.touch.enable();
  }

  async load(): Promise<void> {
    const fill = $('load-fill');
    const label = $('load-label');
    const steps: { label: string; run: () => Promise<void> | void }[] = [
      { label: '正在铺瓦…', run: () => this.wait(120) },
      { label: '搭建庭院…', run: () => this.wait(180) },
      { label: '生成装饰层…', run: () => this.wait(140) },
      { label: '预热碎片池…', run: () => this.wait(120) },
      { label: '准备角色骨骼…', run: () => this.preloadModels() },
      { label: '合成音效…', run: () => this.wait(90) },
    ];
    try {
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        label.textContent = step.label;
        bus.emit('loading:progress', { ratio: i / steps.length, label: step.label });
        fill.style.width = `${Math.round((i / steps.length) * 100)}%`;
        await step.run();
      }
      fill.style.width = '100%';
      label.textContent = '准备就绪';
      await this.wait(160);
      bus.emit('loading:done', {});
      $('overlay-loading').classList.add('hidden');
      this.screens.showMenu();
      this.startLoop();
    } catch (err) {
      console.error(err);
      label.textContent = '加载失败，请检查浏览器是否支持 WebGL2';
      const retry = $('load-retry');
      retry.classList.remove('hidden');
      retry.onclick = () => window.location.reload();
      bus.emit('loading:fail', { error: String(err), step: 'init' });
    }
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  /** 加载界面预热 Lux3D 角色/场景 GLB（仅暖 HTTP 缓存，不阻塞对局；加载失败也不影响降级回退）。 */
  private async preloadModels(): Promise<void> {
    const urls = [
      new URL('models/libin_animated.glb', document.baseURI).href,
      new URL('models/yaoshan_animated.glb', document.baseURI).href,
      ...ALL_SCENE_MODELS.map((m) => new URL(`models/scene/${m}.glb`, document.baseURI).href),
      ...SCENERY_MODELS.map((m) => new URL(`models/scene/${m}.glb`, document.baseURI).href),
    ];
    await Promise.all(
      urls.map((u) =>
        fetch(u, { cache: 'force-cache' })
          .then(() => undefined)
          .catch(() => undefined)
      )
    );
  }

  startMatch(opts: MatchOptions): void {
    this.endMatch();
    this.matchOptions = opts;
    this.hud.reset();
    this.hud.show();
    this.destruction.reset();
    this.match = new Match(
      this.arena.scene,
      this.arena,
      this.destruction,
      this.fx,
      this.cameraRig,
      opts,
      opts.mode === 'local' ? [CHARACTERS.libin, CHARACTERS.yaoshan] : [CHARACTERS.libin, CHARACTERS.yaoshan]
    );
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.budget.pixelRatio));
    this.match.fighters[0].rig.setTier(quality.tier === 'low' ? 'low' : quality.tier === 'medium' ? 'medium' : 'high');
    this.match.fighters[1].rig.setTier(quality.tier === 'low' ? 'low' : quality.tier === 'medium' ? 'medium' : 'high');
    this.paused = false;
    input.setEnabled(true);
    if (isMobileDevice()) this.touch.enable();
    else this.touch.disable();
    input.update(opts.mode === 'local' ? 2 : 1);
  }

  endMatch(): void {
    if (!this.match) return;
    this.match.dispose();
    this.match = null;
    this.hud.hide();
    this.touch.disable();
    bus.emit('hud:callout', { text: '', ms: 1 });
  }

  private startLoop(): void {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    const loop = (): void => {
      requestAnimationFrame(loop);
      this.tick();
    };
    requestAnimationFrame(loop);
  }

  private tick(): void {
    this.tickCount++;
    const realDt = this.clock.getDelta();
    

    const rawDt = Math.min(0.1, realDt);
    // 帧率统计（用未钳制的真实帧时间，避免低帧率下读数虚高）
    this.fpsFrames++;
    this.fpsTime += realDt;
    if (this.fpsTime >= 0.5) {
      this.lastFps = this.fpsFrames / this.fpsTime;
      bus.emit('perf:fps', { fps: this.lastFps });
      quality.update(this.lastFps);
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }

    if (!this.match) {
      this.arena.update(rawDt);
      this.cameraRig.update(rawDt, 0, 0, 0, 0, false);
      this.fx.update(rawDt);
      this.renderer.render(this.arena.scene, this.cameraRig.camera);
      this.hud.update();
      return;
    }

    if (!this.paused) {
      input.update(((window as unknown as { __game: Game }).__game.currentMode) === 'local' ? 2 : 1);
      this.accumulator += rawDt;
      const step = 1 / 60;
      let steps = 0;
      // rawDt 钳在 0.1s，最多只能补 6 步；写 8 是永远到不了的上限
      while (this.accumulator >= step && steps < 6) {
        this.match.step();
        this.accumulator -= step;
        steps++;
      }
      if (this.accumulator > 0.5) this.accumulator = 0;
    }

    this.match.render(this.paused ? 0 : rawDt);
    this.renderer.render(this.arena.scene, this.cameraRig.camera);
    this.hud.update();
  }

  /* ---------- 自动化测试与调试钩子 ---------- */
  attachTestHook(): void {
    const api = {
      get match() {
        return (window as unknown as { __game: Game }).__game.currentMatch;
      },
      get fps() {
        return (window as unknown as { __game: Game }).__game.lastFps;
      },
      get tier() {
        return quality.tier;
      },
      start(mode: 'ai' | 'local' = 'ai', difficulty: 'easy' | 'normal' | 'hard' = 'normal') {
        (window as unknown as { __game: Game }).__game.startMatch({ mode, difficulty, rounds: 3 });
      },
      press(btn: string, ms = 80) {
        input.setTouchActive(true);
        input.setTouchButton(btn as never, true);
        window.setTimeout(() => input.setTouchButton(btn as never, false), ms);
      },
      setAxis(x: number, y: number) {
        input.setTouchActive(true);
        input.setTouchAxis(x, y);
      },
      state() {
        const g = (window as unknown as { __game: Game }).__game as unknown as {
          currentMatch: Match | null;
          destruction: DestructionSystem;
        };
        const m = g.currentMatch;
        if (!m) return { phase: 'menu' };
        return {
          phase: m.phase,
          round: m.round,
          wins: m.wins,
          timer: m.timerFrames,
          hp: m.fighters.map((f) => f.hp),
          state: m.fighters.map((f) => f.state),
          move: m.fighters.map((f) => f.move?.id ?? null),
          meter: m.fighters.map((f) => Math.round(f.meter)),
          x: m.fighters.map((f) => Number(f.x.toFixed(2))),
          ticks: (window as unknown as { __game: { tickCount: number } }).__game.tickCount,
          fragments: g.destruction.fragmentCount,
          broken: g.destruction.brokenCount,
        };
      },
      step(n = 60) {
        const m = (window as unknown as { __game: Game }).__game.currentMatch;
        if (!m) return;
        for (let i = 0; i < n; i++) {
          input.update(((window as unknown as { __game: Game }).__game.currentMode) === 'local' ? 2 : 1);
          m.step();
        }
      },
      info() {
        const g = (window as unknown as { __game: Game }).__game as unknown as {
          renderer: THREE.WebGLRenderer;
        };
        const info = g.renderer.info;
        return { calls: info.render.calls, tris: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures };
      },
      pauseAI(on = true) {
        const m = (window as unknown as { __game: Game }).__game.currentMatch;
        if (m) m.aiPaused = on;
      },
      place(x0: number, x1: number) {
        const m = (window as unknown as { __game: Game }).__game.currentMatch;
        if (!m) return;
        m.fighters[0].x = x0;
        m.fighters[1].x = x1;
      },
      setHp(player: 0 | 1, hp: number) {
        const m = (window as unknown as { __game: Game }).__game.currentMatch;
        if (!m) return;
        m.fighters[player].hp = hp;
      },
      setMeter(player: 0 | 1, v: number) {
        const m = (window as unknown as { __game: Game }).__game.currentMatch;
        if (!m) return;
        m.fighters[player].meter = v;
      },
      destroyAll(level: 3) {
        const g = (window as unknown as { __game: Game }).__game as unknown as {
          arena: Arena;
          destruction: DestructionSystem;
        };
        for (const spec of g.arena.specs) {
          // v2.2.0 修正：原来不传 z（默认 0），一旦物件纵深超过命中容差 zTol=2.1 就永远打不到，
          // 会伪装成「破坏链正常」而掩盖真实位置问题。改为用物件自身的 z 打自己。
          g.destruction.impactAt(spec.x, spec.y + spec.h * 0.5, level as 0 | 1 | 2 | 3, 'debug', spec.z);
          g.destruction.impactAt(spec.x, spec.y + spec.h * 0.5, level as 0 | 1 | 2 | 3, 'debug', spec.z);
        }
      },
      rigs() {
        const m = (window as unknown as { __game: Game }).__game.currentMatch;
        if (!m) return null;
        const rigs = (m as unknown as { rigs: unknown[] }).rigs;
        return rigs.map((r) => {
          const rig = r as { debug?: () => unknown };
          return typeof rig.debug === 'function' ? rig.debug() : { mode: 'procedural' };
        });
      },
      glbProps() {
        return glbPropsDebug();
      },
      propsVisible() {
        const g = (window as unknown as { __game: Game }).__game as unknown as { arena: Arena };
        const out: Record<string, boolean> = {};
        for (const [id, o] of g.arena.props) out[id] = o.visible;
        return out;
      },
      propMaterials() {
        // PBR 统一断言用：列出 arena 场景树里实体 Mesh 的材质类型统计
        const g = (window as unknown as { __game: Game }).__game as unknown as { arena: Arena };
        const counts: Record<string, number> = {};
        g.arena.scene.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh || o instanceof THREE.Sprite) return;
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const m of mats) {
            const t = m?.type ?? 'unknown';
            counts[t] = (counts[t] ?? 0) + 1;
          }
        });
        return counts;
      },
      stageDecor() {
        return stageDecorDebug();
      },
      stoneProps() {
        // v2.3.0 程序化补件探针（石狮 / 抱鼓石 / 红幡 / 匾额 / 灯柱）：
        // kind + 世界包围盒，供 probe-stage 断言「贴地 minY≈0」「在可见带内」「左右镜像」。
        return stonePropsDebug();
      },
      colliders() {
        // v2.3.0：紫色方块「实体碰撞」的运行时落地（静态 + 逐道具派生 AABB）。
        // 破坏时 alive=false、回合重置恢复；missing 列出未覆盖的 spec（应为空）。
        return collidersDebug();
      },
      showColliders(visible = true) {
        setColliderDebugVisible(visible);
        return collidersDebug().visible;
      },
      scenery() {
        // v2.0.9 风景天幕探针：列出 sceneryGroup 下所有常驻根（GLB 经 wrapGLBProp 注册的风景件）
        const g = (window as unknown as { __game: Game }).__game as unknown as { arena: Arena };
        const out: Record<string, { model: string; loaded: boolean; fallbackVisible: boolean; visible: boolean }> = {};
        g.arena.sceneryGroup.traverse((o) => {
          const id = o.userData?.destroyableId as string | undefined;
          if (id && o.parent === g.arena.sceneryGroup) {
            const gp = GLB_PROPS.get(id);
            out[id] = { model: gp?.model ?? id, loaded: gp?.loaded ?? false, fallbackVisible: gp?.fallbackVisible ?? true, visible: o.visible };
          }
        });
        return out;
      },
      specs() {
        const g = (window as unknown as { __game: Game }).__game as unknown as { arena: Arena };
        return g.arena.specs.map((s) => ({ id: s.id, tier: s.tier }));
      },
      destroyBoxes() {
        // 供 probe-anchors.mjs 断言：每个可破坏件的 spec 盒底世界 y(minY)≈0，
        // 与人物脚底统一在同一 y 轴。纯数据、序列化友好、不抛错。
        const g = (window as unknown as { __game: Game }).__game as unknown as { arena: Arena };
        return g.arena.specs.map((s) => {
          const minY = s.y;
          const maxY = minY + s.h;
          return { id: s.id, minY, maxY, grounded: Math.abs(minY) < 0.05 };
        });
      },
    };
    (window as unknown as { __game: Game }).__game = this;
    (window as unknown as { __WS: typeof api }).__WS = api;
    (window as unknown as { __WS: { step?: (n?: number) => void } }).__WS.step = (n = 60) => {
      for (let i = 0; i < n; i++) {
        input.update(((window as unknown as { __game: Game }).__game.currentMode) === 'local' ? 2 : 1);
        this.match?.step();
      }
    };
  }

  get currentMatch(): Match | null {
    return this.match;
  }

  get currentMode(): 'ai' | 'local' {
    return this.matchOptions.mode;
  }

  screensHandleEnd(winner: 0 | 1 | -1, reason: 'ko' | 'time' | 'double'): void {
    this.screens.showResult(winner, reason);
  }

  get arenaInstance(): Arena {
    return this.arena;
  }

  get destructionSystem(): DestructionSystem {
    return this.destruction;
  }
}

const canvas = $<HTMLCanvasElement>('stage');
const game = new Game(canvas);
game.attachTestHook();
bus.on('match:end', ({ winner, reason }) => {
  input.setEnabled(false);
  window.setTimeout(() => {
    game.screensHandleEnd(winner, reason);
  }, 900);
});
void game.load();

export { game };
