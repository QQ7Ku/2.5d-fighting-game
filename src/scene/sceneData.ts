/**
 * 多场景选择（v2.5.0 / Round 32 · 竹海古径）
 *
 * 场景由 URL `?scene=<id>` 决定，**在模块初始化时固定一次**；切换场景走整页重载。
 * 原因：arena / stageDecor / skyBackdrop / colliders 都在模块顶层把场景数据取成了常量
 * （`const D = decor`），运行时热切换需要把这些常量全部改成惰性读取，收益不值。
 * 重载的代价只有一次 GLB 预热，和换地图的语义也一致。
 *
 * 未带 `?scene` 或参数非法时回落 shuangting（与线上 v2.4.9 行为完全一致）。
 */
import shuangting from '../../scene/output/decor.json';
import zhuhai from '../../scene/output/zhuhai.json';

export type SceneId = 'shuangting' | 'zhuhai';

export interface SceneMeta {
  id: SceneId;
  /** 菜单里显示的名字 */
  name: string;
  /** 副标题：一句话点题 */
  subtitle: string;
  data: unknown;
}

export const SCENES: Record<SceneId, SceneMeta> = {
  shuangting: { id: 'shuangting', name: '霜庭', subtitle: '山门古刹 · 霜夜', data: shuangting },
  zhuhai: { id: 'zhuhai', name: '竹海古径', subtitle: '密竹石阶 · 雾夜', data: zhuhai },
};

export const SCENE_IDS = Object.keys(SCENES) as SceneId[];

export function readSceneId(): SceneId {
  try {
    const q = new URLSearchParams(window.location.search).get('scene');
    if (q && q in SCENES) return q as SceneId;
  } catch {
    /* SSR / 异常环境回落默认场景 */
  }
  return 'shuangting';
}

/** 当前场景 id 与数据（模块初始化即确定，整页生命周期内不变） */
export const SCENE_ID: SceneId = readSceneId();
export const SCENE: SceneMeta = SCENES[SCENE_ID];
export const sceneData: unknown = SCENE.data;

/** 切场景：改 URL 查询串后整页重载 */
export function switchScene(id: SceneId): void {
  const url = new URL(window.location.href);
  url.searchParams.set('scene', id);
  window.location.href = url.toString();
}