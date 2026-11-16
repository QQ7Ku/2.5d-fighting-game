# 01 · 架构与架构决策记录（ADR）

版本 **v2.0.0** · 适用构建 `dist/` · 最后更新 2026-11-13

## 1. 总览

```
浏览器
├── 渲染层  Three.js（WebGL2）
│   ├── Arena        场景：手工核心区 + 程序化装饰（decor.json）
│   ├── CharacterRig 程序化低模骨骼 + 关键帧姿势混合
│   ├── CameraRig    2.5D 侧视跟拍 + 受击震动 + KO 推近
│   └── FxSystem     火花/冲击环/尘土（对象池）
├── 逻辑层（固定 60Hz）
│   ├── Fighter      状态机 / 输入缓冲 / 判定框 / 受击
│   ├── Match        回合、计时、胜负、破坏联动
│   ├── Destruction  三级破坏 / 连锁 / 碎片池
│   └── AI           三档难度状态机
├── 输入层  InputManager（键盘 / 手柄 / 触屏 → 统一 InputState）
├── 音频层  AudioEngine（Web Audio 全合成）
└── 界面层  Hud / TouchControls / Screens
```

数据流严格单向：`输入 → 逻辑（60Hz）→ 事件总线 → 表现层（渲染/音效/UI）`。
表现层不得反向修改战斗状态；所有跨系统通信走 `src/core/bus.ts`。

## 2. ADR 清单

### ADR-0001 渲染引擎锁定 Three.js
- **状态**：已接受（v2.0.0 起生效，锁定不可更换）
- **背景**：需在 Three.js / Babylon.js / Phaser 3 中选定 2.5D 格斗渲染方案。
- **决策**：Three.js r169 + Vite。
- **理由**：包体小（gzip 后约 164KB 业务代码 + 引擎）；`MeshToonMaterial` 便于做低多边形赛璐璐风；
  骨骼与动画系统足够支撑程序化骨骼驱动；移动端可控像素比与阴影。
- **替代方案**：Babylon.js（内置功能多但首屏更重）；Phaser 3（2D 引擎，3D 人物需额外自证，不采纳）。
- **后果**：需自行实现 2.5D 镜头、碰撞与破坏物理（见 ADR-0003）。

### ADR-0002 角色资产：程序化骨骼为运行时主链路
- **状态**：已接受
- **背景**：要求「原创低模 + 骨骼动画」，并要求用 Skill（Aholo Lux3D）生成 3D 人物。
- **已执行**：调用 Lux3D OpenAPI `text-to-3d`（G1 / hand_painted / 12000 面）生成李宾网格，
  产物 `assets/lux3d/libin_mesh_glb.glb`（6.97 MB，`artifact_delivery inspect` 校验通过：
  glbVersion 2、1 mesh / 1 material、**0 skin、0 animation**）。生成记录见 `docs/11-资产清单与合规.md`。
- **决策**：**运行时角色使用自建程序化骨骼 + 代码关键帧 Clip**，Lux3D 产物作为设计期参考资产保留。
- **理由**（三点硬约束，非偏好）：
  1. 产物为**静态网格**，无 skeleton/skin，需再走 `auto-rig` 才能动画；
  2. 即便完成绑骨，`animation-retarget` 只接受平台公开动画 ID（走/跑/待机类），
     **不存在**本作设计的 6 招普通攻击 + 4 个原创必杀 + 投技的动作数据；
  3. 6.97 MB 静态网格 + PBR 贴图不符合移动端首屏 ≤8s 与 30fps 预算。
- **后果**：动画表现力弱于动捕，但**状态机与 Clip 一一对应、可复现、零版权风险**；
  若后续拿到可用绑骨 + 自定义动作数据，只需替换 `CharacterRig`，战斗系统无需改动（接口未变）。
- **升级路径**：`CharacterRig` 已隔离在 `src/view/rig.ts`，对外只暴露 `play/setPhase/setFacing/setTier`。

### ADR-0003 物理与破坏：轻量自研（非物理引擎）
- **决策**：2D AABB（x 轴 + y 轴）判定 + 屏幕空间击退速度 + 碎片抛体。
- **理由**：格斗游戏需要**逐帧确定性**，物理引擎的连续碰撞与休眠策略会引入不可复现的击退距离；
  自研可精确控制顿帧（hitstop）、击退换算与破坏触发顺序。
- **后果**：无真实刚体堆叠；碎片只做重力 + 地面反弹 + 摩擦，不做碎片间碰撞（性能与可读性优先）。

### ADR-0004 Skill 生成模型：仅构建期、离线、可复现
- **决策**：模型只输出 JSON 候选 → `skills/scripts/generate.mjs` 注入溯源 + Schema 校验 + 合并审核结论。
- **理由**：运行时不得依赖不可控在线服务；生成必须可复现（提示词哈希 + 输入哈希 + 种子）。
- **后果**：`dist` 内只含已审核的 4 条必杀；未审核候选物理上不进入 bundle。

### ADR-0005 程序化场景的边界
- **决策**：生成器只写 `layers`（远景山脊/树影/地面贴花/灯笼分布/碎片外观/落叶），
  `manual` 段（核心战斗区、地面分段、边界、碰撞体、关键可破坏物、塌陷区）为**只读复制**。
- **理由**：战斗可读性与公平性不能由随机数决定。
- **校验**：生成器内置 4 条断言，任一装饰进入核心区或遮挡判定通道即 `exit 1`。

### ADR-0006 音频：Web Audio 实时合成
- **决策**：全部音效由振荡器 + 噪声 + 滤波包络合成，无任何音频文件。
- **理由**：零版权风险、零下载体积、可按事件参数化（力度/顿帧）。
- **后果**：音色偏"电子打击"，后续可替换为原创录音，接口（`sfx:play` 标签）不变。

## 3. 目录结构

```
/workspace
├── index.html                 单页入口（HUD/触屏/菜单骨架）
├── src/
│   ├── main.ts                启动、主循环、预算应用、调试钩子
│   ├── style.css              全套 UI 样式（含安全区适配）
│   ├── core/                  bus / input / audio / perf / math
│   ├── data/                  moves.ts（招式合并）+ skills.generated.json（构建产物）
│   ├── view/                  arena / rig / clips / camera / fx
│   ├── game/                  fighter / match / destruction / ai
│   └── ui/                    hud / touch / screens
├── skills/                    Schema、提示词、种子、候选库、审核、入库
├── scene/                     参数、生成器、输出、生成记录
├── assets/lux3d/              Lux3D 生成产物（设计期资产）
├── docs/                      12 份设计/测试/合规文档 + agents/ 12 份角色化记录
└── dist/                      v2 构建产物（静态，无需后端）
```

## 4. 关键技术取舍

| 取舍 | 选择 | 代价 |
|---|---|---|
| 逻辑帧率 | 固定 60Hz + 累加器（rawDt 钳 0.1s，单帧最多补 6 步） | 极低帧率设备上战斗节奏变慢，但不会跳帧穿模 |
| 判定 | 2D AABB，忽略 z | 无纵深闪避，符合 2.5D 操作预期 |
| 阴影 | 方向光 PCFSoft，低档关闭 | 低画质失去接地感 |
| 材质 | MeshToonMaterial + 3 阶梯度贴图 | 无 PBR，金属/布料质感靠配色区分 |
| 建筑合并 | 树影/贴花/灯笼按顶点色合并 | 单株树无法单独做风吹动画 |
| 输入 | 触屏按键走 `pendingPress` 锁存 | 极快点击也不会丢输入，代价是最多延迟 1 帧 |

## 5. 版本与兼容

- 构建目标 `es2020`，`base: './'`（可部署到任意子路径）。
- 桌面：Chrome / Edge 最新版（主验收）、Firefox / Safari 基础可用。
- 移动：Android Chrome、iOS Safari 横屏；`viewport-fit=cover` + `env(safe-area-inset-*)` 适配刘海。
- 无 Service Worker、无后端、无运行时网络请求。
