# 瓦上霜 · 单一权威资产清单（ASSETS.md）

> **本文件是本项目美术资产（模型/骨骼/动画/场景件）的唯一权威索引。**
> 其他大模型 / 开发者接手时，只需读本文件即可理解资产全貌；**以后更新资产只改这一个文件**（外加实际替换的文件本体）。
> 最后更新：v2.3.0（2026-11-16，Round 13：**全遗留项补全盒**——把 Round 12 登记的未解决项与 P1 全部做完，**无 GLB 增减（仍 24 个）**：①参考图 10 类拆件里仓库无模型的四件用**程序化几何**补齐（零 Lux3D 点数）——成对石狮（±5.15 / z−4.1）、牌坊柱脚成对抱鼓石门墩（±2.55）、经幡柱三面红幡（顶点褶皱 + 风摆）、牌坊匾额「山门」（canvas 文字纹理）；②灯架落地：横杆由 14.2 收到 10.8 并在 ±5.6 加落地立柱（原整根悬空且两端出画）；③`manual.colliders` 从「死数据」变运行时消费者：新建 `src/view/colliders.ts`，静态 2 条 + 逐道具派生 9 条，破坏即移除、回合重置恢复，`__WS.colliders()` 可查覆盖率；④灯笼由「3 左 4 右各自随机」改**严格镜像 3 对 + 中心 1 盏**（生成器改动，`LAYERS_HASH` 0e70fcb3→1f5bc92e）；⑤色调由暖橙改**冷月白**（key #ffd9a8→#d8e4f7、ambient→#607a94）；⑥雾带由 3 条 90×4 全屏横条改 2 层径向雾团，云带改 4 团不规则柔光斑（消除横纹）；⑦月亮由 (5.6,3.2) 移到 (7.2,3.35) 并避开全部灯笼吊杆；⑧星点/霜点改固定种子；⑨`wall-panel.glb` 移出预热表（省 3.6MB 请求）；⑩`accept.mjs` 噪声排除口径收窄并改**无条件** GLB 完整性校验。）
> 历史：v2.2.0（2026-11-15，Round 12：**场景执行盒**——按 r3.1 方案全量落地 P0-1~P0-4：①右侧砖墙 `wall-panel-east` 换皮成**东侧大鼓**，与 `temple-drum`（西侧大鼓）左右镜像，规格统一 1.0×1.6×1.0、坐标 ±4.7/z−2.05，`opensPassage` 通道链与 HUD「通道开启」一并退役（a′ 档）；②新建 `src/view/skyBackdrop.ts` 程序化合成「远山背景」：L0 天幕（`scene.background`）+ L1 z=−26 山脊剪影 Plane，退役 3 层程序化山脊扁片、9 株三角松、5 组低模灌木；③`temple-hall` 后撤至 z=−15 并压暗为门洞后远景殿宇；④装饰池补石灯/门墩各一件（后排 z=−3.5）。**无 GLB 增减**，随包仍 24 个；`wall-panel.glb` 自此无运行时消费者。）
> 历史：v2.1.0（2026-11-15，Round 10：**审查修订盒**——按用户确认的「远景 / 中景 / 近景」分层清单只改 5 项：修 `wrapGLBProp` 的 `max(0,…)` 让 7 件风景 GLB 恢复半埋（实测盒底 −0.9~−2.2）、台阶退回牌坊门洞下连台基、地板补 `SRGBColorSpace` 让压暗真正生效并改「奇数行横移半格」错缝、月亮收成完整小满月、`index.html` 版本号对齐 2.1.0。**本轮仍无 GLB 资产增减**，随包 GLB 仍 24 个，§2 资产表格不变；Lux3D 条件性转移仍未触发，零扣费。）
> 历史：v2.1.0（2026-11-15，Round 9：按更新参考图重搭场景——地板暖棕小网格→冷灰大石板、按真实坐标摆正解 AABB、统一「spec.y=盒底」anchor 语义与破坏物理、云/雾/月/雪脊回可见带；无 GLB 增减）；v2.0.9（2026-11-14，Round 8：按概念图补齐**风景/环境层**——6 件 Lux3D 风景 GLB（三层雪岭 / 远景殿宇 / 石台基 / 竹林天幕，竹林复用 2 次=7 放置实例）+ 纯代码氛围层（渐变天幕/冷月月晕/星点/云带/山腰雾/地面薄霜），移除实心砖墙露出天幕纵深；场景件共 22 件模型 / 运行时随包 GLB 共 24 个文件）；v2.0.8（Round 7）参考用户上传的四视图概念图「山门古刹·霜夜」搭建完整舞台 + 新增 12 件场景 GLB（6 可破坏 / 6 纯装饰），场景件共 16 件；v2.0.7（Round 6）4 件写实 PBR 场景件接入可破坏环境 + 全场景 PBR 统一；v2.0.6（Round 5）角色 GLB 文生3D + 自动绑骨 + 动画重定向接入游戏。

> **速读（给接手的大模型）**
> - **这个文件是干什么的**：全项目美术资产（GLB 模型 / 骨骼 / 动画 / 场景件）的**唯一权威索引**。文件清单在 §2、风格字典在 §3、接入映射在 §4、更新流程在 §5、合规在 §6。**不要另建清单文件。**
> - **有什么美术资产**：运行时共 **24 个随包本地 GLB** —— 2 个角色（`public/models/*_animated.glb`，各 52 骨 + 16 动画）+ **16 件场景件**（v2.0.7 的 4 件写实 PBR + v2.0.8 的 12 件舞台件：6 可破坏 / 6 纯装饰，见 §2.1b / §2.1c）+ **6 件风景件**（v2.0.9 天幕：三层雪岭 / 远景殿宇 / 石台基 / 竹林，竹林复用 2 次 = 7 放置实例，见 §2.1d）。另有 `assets/lux3d/**` 原始归档（不进运行时）与少量代码程序化资产（长棍 / 场景主体 / 特效 / **氛围层**，见 §2.3）。
> - **以后更新资产只改这个文件**：替换 `public/models/` 下的 GLB 后，只更新本文件 §2 表格与 §4 映射（如有变化）并改文首版本与日期；历史版本条目不删。场景参数的「权威源」改动走 §5 的生成器流程。

---

## 1. 本文件是干什么的

《瓦上霜》是 Three.js + TypeScript + Vite 的 2.5D 浏览器格斗原型。角色与关键场景物件的**视觉外观**由 Lux3D（Aholo）生成的 GLB 驱动；**战斗逻辑、状态机、判定、破坏、物理**仍是纯代码（`src/game/`），与美术资产完全解耦。自 v2.0.7 起全场景统一为 **PBR 材质**（`MeshStandardMaterial`），与 Lux3D 写实 PBR GLB 及 v2.0.6 的 PBR 角色 GLB 一致。v2.0.8 起场景升级为完整舞台「山门古刹·霜夜」，由用户上传的四视图概念图驱动。

三层结构，各司其职：

| 层 | 位置 | 职责 |
|---|---|---|
| 运行时资产 | `public/models/*.glb`（角色）+ `public/models/scene/*.glb`（场景件） | 游戏**实际加载**的 GLB（进 `dist/`，会发布上线） |
| 原始归档 | `assets/lux3d/**` + `assets/lux3d/scene/` | Lux3D 各阶段产物（文生3D / 绑骨 / 单动作 / 场景件），**不进运行时**，供回溯与重合并 |
| 接入代码 | `src/view/glbRig.ts` + `src/view/clipMap.ts`（角色动画）、`src/view/glbProps.ts`（场景件）、`src/view/stageDecor.ts` + `src/view/decorMotion.ts`（v2.0.8 舞台装饰 / 动态） | GLB 加载、动画播放、动作名映射、场景件占位降级与 PBR 对齐、纯装饰挂载与破坏特效分派 |

**更新资产的唯一入口**：按 §5 流程替换 `public/models/` 里的 GLB，然后更新本文件的 §2 表格与 §4 映射（如有变化）。不要另建清单文件。场景参数的权威源是 `scene/params/shuangting.json`，改后必须跑生成器刷新 `scene/output/decor.json`（**`decor.json` 是生成产物，不可手改**，详见 §5）。

---

## 2. 文件清单

### 2.1 运行时资产（`public/models/`，进 dist、会发布）

| 文件 | 大小 | 用途 | 内容 |
|---|---|---|---|
| `libin_animated.glb` | 9.86 MB | 李宾（空手拳脚） | 蒙皮网格 + 52 骨 1 skin + 16 个命名 AnimationClip |
| `yaoshan_animated.glb` | 10.45 MB | 筄山（长棍武僧） | 蒙皮网格 + 52 骨 1 skin + 16 个命名 AnimationClip（**不含长棍**，长棍运行时程序化挂载，见 §4.3） |

两个 GLB 的 16 个动画名完全相同：`A_TPose, Idle_Loop, Crouch_Idle_Loop, Walk_Loop, Jump_Start, Jump_Loop, Jump_Land, Sword_Idle, Sword_Block, Sword_Attack, Sword_Regular_A, Punch_Jab, Punch_Cross, Melee_Hook, Hit_Chest, Death01`。

### 2.1b 场景件（`public/models/scene/`，写实 PBR 静态网格，进 dist）

> 这 4 件是 v2.0.7 新增的「可破坏环境」外观资产。**Lux3D 只能出静态网格，无碎块/多状态能力**，故破坏表现完全由 `src/game/destruction.ts` 提供（隐藏模型 + 程序化碎片 + 地面塌陷），GLB 只负责外观。

| 文件 | 大小（运行时副本） | 覆盖 spec.id（10 个可破坏实例） | 形制 |
|---|---|---|---|
| `lantern.glb` | 3.50 MB | `lantern-00/01/02/05`（4 个圆灯） | 圆鼓形竹骨纸灯 + 短穗，灯纸 `#d9a35a` |
| `lantern-hex.glb` | 4.17 MB | `lantern-03/04/06`（3 个六角灯） | 六角木框纱面宫灯 + 翘角 |
| `pillar.glb` | 3.16 MB | `pillar-west`、`pillar-east`（2 立柱） | 圆木柱 + 青灰石础，高径 ≈3.3:0.5 |
| `wall-panel.glb` | 3.60 MB | **已停用（v2.2.0）** —— 原挂 `wall-panel-east`，该件已按参考图换皮成大鼓（改用 `temple-drum.glb`）；文件保留但无运行时消费者 | 灰砖薄板带砖缝 |

**体积说明**：原始下载产物内嵌 3 张 2048² PNG/件（合计 38 MB），运行时副本用 `.build-log/review/round6/compact-textures.py` 把贴图降到 1024²（几何与 PBR 材质不变、不重新生成、不计费）→ 合计 **14.4 MB**；压缩后 `inspect --format glb` 仍全部 `valid=true`。原始 2048 产物完整保留在 `assets/lux3d/scene/`。

**明确不做**：`floor-mid`（无 props、靠 `Arena.collapse()` 隐藏地板）、地面/院墙/瓦檐/廊柱/过梁/山脊/树影/苔痕/落叶（无 spec 或纯装饰）。规格、坐标、碎片预设见 `scene/output/decor.json` 的 `manual.keyDestroyables` 与 `layers.lanterns`。

> **v2.0.8 注**：上面「明确不做」是 v2.0.7 口径。v2.0.8 起「石牌坊 / 石阶 / 竹丛 / 瓦檐 / 高石灯幢 / 水缸」已作为 **6 件纯装饰随包 GLB** 补上（见 §2.1c），但仍**不进 props / specs / 破坏链**；地面 / 院墙 / 廊柱 / 过梁 / 山脊 / 苔痕 / 落叶仍为程序化，不做 GLB。

### 2.1c 场景件（v2.0.8 新增 12 件，`public/models/scene/<id>.glb`，进 dist）

> 这 12 件是 v2.0.8 依据**用户上传的四视图概念图（山门古刹·霜夜）**搭建完整舞台时新增的资产，生成方式为「**2 件图生3D 试点 + 10 件文生3D**」（详见 §3.1b）。加上 §2.1b 的 4 件，**场景件共 16 件**。
> 分类铁律：**6 件可破坏**进 `props` / `specs` / 破坏链（写进 `scene/params/shuangting.json` 的 `manual.keyDestroyables`）；**6 件纯装饰「不进 `props` / `specs` / 破坏链」**，只挂 `arena.decorGroup`（详见 §4.5）。既有 v2.0.7 的 4 件与 11 件破坏链一个不动。

| # | id | 生成方式 | 分类 | 用途 |
|---|---|---|---|---|
| 1 | `gate-stone` | 图生3D 试点（裁图 `gate-stone_front.png`） | 纯装饰·镇场 | 山门石牌坊，不打碎 |
| 2 | `incense-burner` | 图生3D 试点（裁图 `incense-burner_tight.png`） | **可破坏** | 青铜三足香炉，碎后青烟 |
| 3 | `temple-drum` | 文生3D | **可破坏** | 红色大架鼓 |
| 4 | `stone-lantern` | 文生3D | **可破坏** | 六角石灯，碎后灯灭 |
| 5 | `gate-pier` | 文生3D | **可破坏** | 抱鼓石 |
| 6 | `hitching-post` | 文生3D | **可破坏** | 拴马桩 |
| 7 | `sutra-pole` | 文生3D | **可破坏** | 经幡杆，碎后落幡 |
| 8 | `stone-steps` | 文生3D | 纯装饰 | 霜白石阶 |
| 9 | `bamboo` | 文生3D | 纯装饰 | 竹丛 |
| 10 | `eave-tile` | 文生3D | 纯装饰 | 青灰瓦檐 |
| 11 | `stone-lamp-tall` | 文生3D | 纯装饰 | 高石灯幢 |
| 12 | `water-vat` | 文生3D | 纯装饰 | 陶制水缸 |

- **6 件可破坏 ID**：`incense-burner`, `temple-drum`, `stone-lantern`, `gate-pier`, `hitching-post`, `sutra-pole`。
- **6 件纯装饰 ID（不进 `props` / `specs` / 破坏链）**：`gate-stone`, `stone-steps`, `bamboo`, `eave-tile`, `stone-lamp-tall`, `water-vat`。
- 运行时 12 件均由 `assets/lux3d/scene/<id>_textured.glb` 原始产物压贴图到 1024² 后拷贝而来；缺件由占位降级兜底（见 §4.5）。

### 2.1d 风景件（v2.0.9 新增 6 模型 / 7 放置实例，`public/models/scene/<model>.glb`，进 dist）

> v2.0.9 针对用户反馈「只有道具、没有概念图里的**风景**」补齐**环境/天幕层**：把概念图的远景（雪岭 / 殿宇 / 台基 / 竹林）做成 Lux3D 实体 GLB，挂在 `arena.sceneryGroup`，**不进 `props` / `specs` / 破坏链**（纯背景，不可打、无判定）。天空渐变 / 冷月月晕 / 星点 / 云带 / 山腰雾带 / 地面薄霜为**纯代码氛围层**（§2.3）——这些是着色与贴图效果，做成 GLB 既贵又不自然。月亮文生3D 返回尺度荒谬（约 3.47e6 单位），**已废弃为 GLB，改代码发光圆盘 + 月晕**。

| 模型文件 | 放置实例（id） | 用途 | 说明 |
|---|---|---|---|
| `mountain-far.glb` | `mountain-far` | 远景雪岭（z=-25） | 最远一层，宽 72 贴满画面 |
| `mountain-mid.glb` | `mountain-mid` | 中景雪岭（z=-20） | 第二层纵深 |
| `mountain-near.glb` | `mountain-near` | 近景雪岭（z=-15） | 第三层，殿宇身后 |
| `temple-hall.glb` | `temple-hall` | 远景殿宇剪影（z=-11，居中） | 概念图主景，山门正后 |
| `stone-terrace.glb` | `stone-terrace` | 石台基（z=-9，殿宇脚下托底） | 概念图「牌坊所坐石台基」 |
| `bamboo-grove.glb` | `bamboo-L` / `bamboo-R`（复用 2 次） | 竹林天幕（x=±11，z=-9） | 分列两侧远景 |

- 6 个模型文件均为文生3D（`faceCount` 10k~50k），原始 2048² 产物归档 `assets/lux3d/scene/`，运行时副本压贴图到 1024²（72MB→28MB）。
- 布局经**投影标定**：俯视 2.5D 机位（cam≈(0,2.9,7.6) 看 (0,1.15,0)，FOV 40°）下背景可视带仅世界 y∈[0,4.5]（z=-13 基准），全部风景件压低成横向剪影带；`mountStageScenery` 注释含标定过程。
- `bamboo-grove` 一文件两实例：`wrapGLBProp` 按各自占位盒独立缩放/落位，模板只 parse 一次。

### 2.2 原始归档（`assets/lux3d/`，不进运行时、不删旧）

| 文件 | 阶段 | 说明 |
|---|---|---|
| `libin_textured.glb` (7.9 MB) | 文生3D v1 | 首版，双臂松弛非严格 T-pose，**绑骨失败已弃用**，仅留档 |
| `libin_textured2.glb` (8.0 MB) | 文生3D v2 | 严格 T-pose 提示词重生成，绑骨成功（李宾最终网格来源） |
| `libin_rigged2.glb` (14.2 MB) | 自动绑骨 | 52 骨，李宾绑骨成功产物 |
| `yaoshan_textured.glb` (8.5 MB) | 文生3D | 筄山网格（Round 5 复用 Round 4 产物） |
| `yaoshan_rigged.glb` (15.5 MB) | 自动绑骨 | 52 骨，筄山绑骨成功产物（Round 4） |
| `libin_mesh_glb.glb` / `libin_mesh_zip.zip` | Round 4 旧产物 | 早期 mesh 导出，留档 |
| `yaoshan_glb.glb` / `yaoshan_zip.zip` | Round 4 旧产物 | 早期 mesh 导出，留档 |
| `libin_actions/*.glb`（16 个） | 动画重定向 | 李宾逐动作 GLB（合并前的中间产物） |
| `yaoshan_actions/*.glb`（16 个） | 动画重定向 | 筄山逐动作 GLB（合并前的中间产物） |
| `assets/lux3d/scene/<name>_textured.glb`（4 个） | Round 6 文生3D | 4 件写实 PBR 场景件的原始产物（下载留档，运行时用 `public/models/scene/` 的副本） |
| `assets/lux3d/scene/<id>_textured.glb`（12 个） | Round 7 v2.0.8 | 12 件舞台场景件的原始 2048² 贴图产物（2 图生3D 试点 + 10 文生3D），留档；运行时用 `public/models/scene/` 的 1024² 副本 |
| `assets/lux3d/scene/<model>.glb` + `<model>_raw.glb` + `<model>_textured.glb`（6 组） | Round 8 v2.0.9 | 6 件风景件（雪岭×3/殿宇/台基/竹林）原始产物与压缩版留档；运行时用压到 1024² 的副本。另有 `moon` 文生3D 尺度荒谬（≈3.47e6 单位）**废弃不入运行时**，冷月改代码实现 |

### 2.3 运行时非 GLB 美术资产（代码程序化生成，无文件）

| 资产 | 位置 | 说明 |
|---|---|---|
| 长棍（筄山） | `src/view/glbRig.ts` 运行时挂载 | 木色棍身 + 两端铜箍，挂到 GLB 右手骨 `mixamorigRightHand`；v2.0.7 起为 PBR 材质 |
| 场景主体 + 可破坏件占位 | `src/view/arena.ts` | **程序化 + 本地 GLB 混合**：地面/院墙/廊柱/坑体/碎片等仍程序化生成（全 PBR 材质）；v2.0.8 起 16 个可破坏实例（v2.0.7 的 10 + 新增 6）的外观由 `public/models/scene/*.glb` 覆盖，另有 6 件纯装饰挂 `decorGroup`（不进 specs）；**GLB 加载失败自动降级回程序化占位** |
| 灯笼吊杆 + 光晕 | `src/view/arena.ts` | 吊杆为独立 `glbKeep` Mesh、光晕为 Sprite，GLB 灯身就位后仍保留可见 |
| **氛围层（v2.0.9 风景天幕）** | `src/view/stageScenery.ts` | 纯代码夜景：渐变天幕（v2.2.0 起由 `skyBackdrop.ts` 合成：渐变 + 最远山影 + 地平冷光）、冷月发光圆盘（v2.3.0 移至 (7.2,3.35,−7.2)、r=0.68）+ 月晕 Sprite（加法混合）+ 120 星点（v2.3.0 起固定种子）、云团 Sprite×4（v2.3.0 改不规则柔光斑）、山脚雾团 Plane×2（v2.3.0 改径向雾团，消除横向条纹）、地面薄霜 Plane（v2.3.0 起固定种子）。全部挂 `arena.sceneryGroup`、不进破坏链，由 `arena.update` 的 `elapsed` 驱动（`updateScenery`，不新增 rAF） |
| **程序化补件（v2.3.0）** | `src/view/stoneProps.ts` | 参考图 10 类拆件里**仓库无 GLB** 的四件 + 灯架，全部 `mergeGeometries` 合并为单网格（各 1 draw call）：①成对石狮（`makeLionGeometry`，须弥座/后躯/前胸/前腿/爪/头/吻/鬃毛 7 颗/耳/尾/绣球，约 1.8m，±5.15/z−4.1）；②成对抱鼓石门墩（`makeDrumStoneGeometry`，正面为圆鼓面，±2.55/z−2.42，贴在牌坊柱脚）；③经幡柱三面红幡（`makeBanner`，PlaneGeometry 6×8 段，竖向褶皱 + 顶点风摆，`updateStoneProps` 驱动）；④匾额（`makePlaque`，512×168 canvas 写「山门」金字阴刻 + 双层金边）；⑤灯架落地立柱 ×2（±5.6/z−1.95，半径 0.05~0.065）。全部只挂 `decorGroup`、**不进 props/specs**，`__WS.stoneProps()` 可查世界包围盒 |
| **碰撞体运行时（v2.3.0）** | `src/view/colliders.ts` | 把参考图「紫色方块 = 实体碰撞」落地：`manual.colliders` 静态 2 条 + 由 spec 派生 9 条逐道具 AABB；`dropCollider(id)` 在 `destruction.breakObject()` 调用、`restoreColliders()` 在 `reset()` 调用；`__WS.colliders()` 返回总数/存活/覆盖率，`__WS.showColliders(true)` 可画出半透明盒 |
| 特效（火花/冲击环） | `src/view/fx.ts` | 程序化生成，unlit（`MeshBasicMaterial`）不参与 PBR 统一 |

---

## 3. 美术风格字典（生成新资产时照此描述）

供后续文生3D / 补资产时复用的一致风格描述：

> v2.0.7 起视觉基准为**写实 PBR**：Lux3D 生成的 GLB 保留原 `MeshStandard/Physical` 材质（不做 toonize），程序化场景反过来统一到 `MeshStandardMaterial`。HUD/菜单仍保持水墨风，二者调性反差是**已知妥协**（用户已确认不动 UI）。

- **整体角色**：中国院落武僧，写实 PBR 贴图，低饱和国风配色，干净拓扑，单角色单网格。
- **李宾（`id: 'libin'`，空手）**：青年男性武术家，短发束带，靛蓝色（藏青）短打练功服，黑色绑腿布鞋，腰束布带，体型精干，双手空、无任何道具。**生成时必须严格 T-pose**：双臂水平伸直、肘部完全伸直、掌心向下、双腿并拢直立、面向镜头。
- **筄山（`id: 'yaoshan'`，长棍）**：中年武僧，青碧色（青绿）僧袍，束袖，黑色僧鞋，脖挂念珠，体型敦实。手部**空**（长棍由程序挂载，不要让模型自带武器，避免绑骨/重定向异常）。同样严格 T-pose。
- **骨骼**：标准 Mixamo 兼容人形骨架（52 骨，含 `mixamorigRightHand` 等），单 skin。
- **姿态铁律**：文生3D 必须显式要求严格 T-pose，否则自动绑骨大概率返回 `MODEL_NOT_RIGGABLE`（双臂松弛/屈肘是常见失败原因）。

### 3.1 场景物件风格字典（v2.0.7 写实 PBR，写进生成提示词）

统一前缀：`photorealistic Chinese courtyard prop, physically-based materials, real surface roughness and subtle specular, high-detail PBR textures, single static mesh, front facing +Z, no plinth, no base, no ground, no scene, no people, no extra props, clean background, neutral studio lighting`。

- **参数**：`version=G1` + `style=photorealistic`（**G1 固定输出 PBR GLB**，无需也不能传 `enablePbr`——那是 G1-Turbo 字段）；`faceCount=20000~30000`；`outputFormat=["glb"]`。静态件**不需要** auto-rig / retarget。
- **形制必须锁死中式院落**（写实模式易跑出欧式/现代物件）：圆灯=鼓形竹骨纸灯+短穗、灯纸 `#d9a35a`；六角灯=木框纱面翘角；立柱=圆木柱+石础（高径≈3.3:0.5）、木 `#6b4a30`；东侧大鼓=红漆鼓身+木架（v2.2.0 起由 `temple-drum.glb` 承担，取代原东墙板）。
- 允许真实粗糙度与高光，但**不含发光贴图**（灯笼光晕由运行时 Sprite 给）、**不带吊杆**（吊杆由程序化 Mesh 提供）、**不带底座**。
- **落盘前压贴图**：Lux3D 出的是 2048² PNG，运行时副本统一降到 1024²（用 `.build-log/review/round6/compact-textures.py`），否则 4 件约 38 MB / 显存约 200 MB，软渲染与移动端压力大。
- **缩放对齐**：Lux3D 模型的长宽比/朝向常与 spec 不符（立柱偏矮胖、墙板 X 宽 Z 薄而游戏要 X 薄 Z 宽）。`glbProps.ts` 按占位盒**逐轴**对齐而非等比缩放，`wall-panel` 另绕 Y 转 90°（v2.2.0 起该模型已无消费者，映射保留但不再命中）；换取尺寸与判定精确一致，模型有轻微形变（已知妥协）。

### 3.1b 场景物件风格字典（v2.0.8 四视图驱动舞台，写进生成提示词）

> v2.0.8 以**用户上传的四视图概念图（山门古刹·霜夜）**为形制与配色基准搭建完整舞台，并从概念图裁出正视图用于 2 件图生3D 试点。本节参数与 v2.0.7 的 4 件（§3.1，`faceCount=20000~30000`）不同，**生成 v2.0.8 的 12 件以本节为准**。

- **四视图参考图驱动**：四视图概念图仅作形制 / 配色参考；裁图 `gate-stone_front.png` / `incense-burner_tight.png` 用于图生3D 试点。私有上传 URL 属凭据级信息，**绝不写入本文件或任何交付物**。
- **配色字典（舞台统一）**：朱红 `#b3402f` / 暖灯 `#e8a34a` / 青灰瓦 `#3f4a4c` / 霜白 `#d8d5cc` / 深棕木 `#5a3a26`；夜色 `skyTop` 冷蓝 `#101a26`、`skyBottom` `#24303a`，`fogDensity` 0.014→0.018，ambient 偏冷 / key 保留暖灯 / rim 冷月光（**不动角色材质**）。
- **参数**：`version=G1` + `style=photorealistic`（**G1 固定输出 PBR GLB，禁传 `enablePbr`**，该字段属 G1-Turbo）；**`faceCount=100000`**；`outputFormat=['glb']`；`region='cn'`。静态件**不需要** auto-rig / retarget。
- **图生3D 试点（2 件）**：`gate-stone`、`incense-burner` 用 `create_image_to_3d_task(img=裁图URL, version='G1', faceCount=100000, ...)`。**提交前必须先走真实报价**（`content_id=quoteId`），**单价 20 分 / 件**；本轮 12 件 × 20 分 = 240 分，报价已冻结于 `.build-log/review/round7/INTERFACE.md`。返回纯 taskId 字符串，立即落盘、绝不重复提交。
- **文生3D（10 件）**：`create_text_to_3d_task(prompt, version='G1', style='photorealistic', faceCount=100000, ...)`，10 条 prompt 见 `items-quote.json`。
- **落盘前压贴图**：Lux3D 出 2048² PNG，运行时副本统一压到 **1024²**（把 `.build-log/review/round7/compact-textures.py` 文件列表改为 12 件）；原始 2048 产物完整保留在 `assets/lux3d/scene/`。
- **校验**：静态件用 `artifact_delivery.py inspect FILE --format glb`（**不加** `--require-rig`）。

### 3.1c 风景件风格字典（v2.0.9 天幕，写进生成提示词）

- **参数**：`version=G1` + `style=photorealistic`；**`faceCount=10000~50000`**（风景件远、被雾罩，面数低于道具件省预算）；`outputFormat=['glb']`；`region='cn'`。**单价 20 分/件**，本轮 7 件报价 140 分（quoteId 冻结于 `.build-log/review/round8/`），分 5+2 两批提交、每批前重新报价（报价 300s 过期）。
- **prompt 锁「剪影远景」形制**：`distant snow mountain ridge silhouette / distant Chinese temple hall silhouette / stone terrace platform / bamboo grove backdrop`，强调 `single static mesh, front facing +Z, no ground plane`。**月亮已验证不适合文生3D**（返回尺度 ≈3.47e6 单位），夜景天体一律代码实现，不再尝试。
- **布局铁律**：俯视机位背景可视带世界 y∈[0,4.5]（z=-13 基准），新风景件必须落在这个带内（见 §4.6 v2.0.9 增量的标定说明），否则整体没入画面上沿之外。

---

## 4. 接入映射（游戏 ↔ 资产）

### 4.1 角色 → GLB 文件

由 `CharacterDef.id` 直接推导（`src/data/moves.ts`），**不需要**额外字段：

`libin` → `models/libin_animated.glb`；`yaoshan` → `models/yaoshan_animated.glb`。

### 4.2 游戏 clip 名 → GLB 动画名（权威实现见 `src/view/clipMap.ts`）

| 游戏 clip | GLB 动画 | 备注 |
|---|---|---|
| `idle` / `intro` | `Idle_Loop` | |
| `victory` | 李宾 `Idle_Loop`；筄山 `Sword_Idle` | 平台无 victory 动作 |
| `walk_f` / `walk_b` | `Walk_Loop` | 后退同前走 |
| `crouch` | `Crouch_Idle_Loop` | |
| `block_stand` / `block_crouch` | `Sword_Block` | |
| `jump_up` / `jump_fall` / `land` | `Jump_Start` / `Jump_Loop` / `Jump_Land` | |
| `ko` | `Death01` | |
| `hit_light` / `hit_heavy` | `Hit_Chest` | 平台只有这一种受击 |
| `atk_light` | 李宾 `Punch_Jab`；筄山 `Sword_Regular_A` | 按武器分流 |
| `atk_medium` | 李宾 `Punch_Cross`；筄山 `Sword_Attack` | |
| `atk_heavy` / `atk_crouch` / `atk_air` / `throw_exec` | 见 `clipMap.ts` | |
| 原创必杀（缠丝劲/回澜棍/掷棍归巢等 `move.clip`） | 回退到该武器重攻击 | 平台无对应动作，**已知妥协** |

未知 clip 一律回退该武器重攻击，再回退 `Idle_Loop`，并在控制台 `console.warn` 留痕。

### 4.3 筄山长棍的运行时挂载

GLB 内**无**长棍网格。`glbRig.ts` 在加载完成后查找骨节点 `mixamorigRightHand`，把程序化长棍（含两端铜箍）作为其子对象挂载并按骨姿态校正朝向。战斗判定不依赖该对象（用 `move.hits` 几何），故棍仅是视觉。

### 4.4 降级策略（角色）

GLB 加载失败 / 文件缺失时，`glbRig.ts` 自动回退到内置程序化 `CharacterRig`（`src/view/rig.ts` + `src/data/clips.ts`，v2.0.5 全套保留），游戏永不因资产问题崩溃，控制台留痕。

### 4.5 场景件接入映射与降级（v2.0.7，权威实现 `src/view/glbProps.ts`）

- **注册**：`arena.ts` 三处 `props.set(id, obj)` 改为 `wrapGLBProp(id, model, placeholder)` 返回的**常驻根节点**。该根节点继承原物件的 position/scale/quaternion，因此 `destruction.ts:81` 的 `baseScale = props.get(id).scale.x` 快照恒等改造前（灯笼 `l.scale`、立柱/墙板 `1`）。
- **spec → 模型**：`pillar-west/east → pillar`、`wall-panel-east → temple-drum`（v2.2.0 换皮为东侧大鼓）、`lantern-00/01/02/05 → lantern`、`lantern-03/04/06 → lantern-hex`、`floor-mid → 无`（本来就没有 props）。
- **破坏链路不变**：`destruction.ts` 只写 `visible / scale / rotation.z`（Object3D 通用属性），作用于常驻根节点自动下发到 GLB 子树。`breakObject()` 隐藏、`applyStage()` 缩小抖动、`reset()` 复原全部生效；碎片数只由 `spec.tier/stages/preset` 决定，与网格和材质无关。
- **对齐**：占位盒与 GLB 盒都在加入父节点前按**局部坐标系**测量，等比缩放 + 底面接地 + X/Z 居中；灯笼目标盒只统计灯身主体（排除 `glbKeep` 吊杆与 Sprite 光晕），避免细长吊杆拉高模型。
- **复用**：4 个模型各 `GLTFLoader.load` 一次，10 个实例用 `clone(true)` 共享 geometry/material。
- **降级**：单件 404 / 解析失败 → 该件保留程序化占位（其余照常），`[glbProp]` warn，游戏永不崩；删掉 `public/models/scene/` 即**全量回退**，零代码回滚。
- **PBR 统一**：`arena.ts`（13 处）、`destruction.ts`（碎片池）、`glbRig.ts`（程序化长棍）改为 `MeshStandardMaterial`；unlit 元素（山脊/贴花/`fx.ts` 火花/落叶/Sprite）与 `rig.ts` 角色降级路径保持原样。灯光沿用现有 Hemisphere+Ambient+Directional+3 PointLight + ACESFilmic，不新增灯。

#### v2.0.8 增量（舞台装饰 / 可破坏件接入，实现见冻结契约 INTERFACE.md B 节）

- **`glbProps.ts` 新导出**：`DECOR_MODELS`（6 纯装饰）、`DECOR_DESTROY_MODELS`（6 可破坏）、`ALL_SCENE_MODELS`（= 原 `SCENE_MODELS` 4 + 6 + 6 = **16**，供 `main.ts` 预热）；`template(model)` 提升为 `export`。`SCENE_MODELS` / `wrapGLBProp` / `glbPropsDebug` / `GLB_PROPS` 签名不变。
- **`buildDecorDestroyables`（6 件可破坏）**：`arena.ts` 的 `buildProps()` 循环遇 `DECOR_DESTROY_IDS.has(k.id)` 即 `continue`，交给此函数 —— 每件造占位 `Object3D`（尺寸 / 坐标取自 spec），`wrapGLBProp(k.id, k.id, ph)`（**模型名 = id，不复用 `pillar`**），`props.set(k.id, wrapped)` + `scene.add(wrapped)`。破坏表现走既有 `destruction.ts`，逻辑零改（仅 `PRESET_COLORS` 补 `stone_lantern` 青灰色）。
- **`decorGroup` 接入（6 件纯装饰）**：`arena.ts` 将 `decorGroup` 提升为 `readonly decorGroup = new THREE.Group()`，构造末尾调 `mountStageDecor(this)`（`stageDecor.ts`）。6 件纯装饰由 `DECOR_PLACEMENTS`（坐标写在代码里，**不进 `decor.json`**）用 `template()` 加载 + 逐轴包围盒接地，**绝不进 `arena.props` / `arena.specs` / 破坏链**，只挂 `decorGroup`；`decorMotion.tick(dt)` 复用 `arena.update` 的 `elapsed` 驱动（不新增 rAF），订阅 `destroy:break` 分派破坏特效（香炉青烟 / 经幡落幡）。
- **`wrapGLBProp` 三层常驻根沿用 v2.0.7**：常驻根节点 + 占位子节点 + GLB 子节点；根节点继承原 position/scale/quaternion，`destruction.ts` 只写 `visible/scale/rotation.z` 自动下发到 GLB 子树，`baseScale` 快照恒等改造前。
- **单件 404 占位降级**：可破坏件单件 404 / 解析失败 → 保留程序化占位（`[glbProp]` warn），其余照常；纯装饰件单件 404 → **静默跳过**（warn 留痕）、不崩；删除 `public/models/scene/` 即全量回退，零代码回滚。
- **探针出口**：`main.ts` 的 `__WS.stageDecor()` 返回 6 件纯装饰挂载状态（`inProps` 恒 false、`group` 恒 true），`__WS.specs()` 返回全量 spec（供门禁数 17）。

#### v2.0.9 增量（风景天幕层，实现见 `src/view/stageScenery.ts`）

- **`arena.ts` 新增 `readonly sceneryGroup`**，构造末尾在 `mountStageDecor(this)` 之后调 `mountStageScenery(this)`；`update(dt)` 内 `updateScenery(this.elapsed)` 驱动云移/雾呼吸/月晕脉动。
- **实体风景件（6 模型 / 7 实例）**：`SCENERY` 占位盒数组 → `wrapGLBProp(id, model, ph)` 常驻根（与道具同管线），占位盒只定缩放与落点、**不进 `props`/`specs`**；`bamboo-grove` 两实例（`bamboo-L`/`bamboo-R`）共享一次 parse。单件 404 静默降级为淡剪影占位盒。
- **`glbProps.ts` 新导出 `SCENERY_MODELS`**（6 件模型名单独成表，**不并入 `ALL_SCENE_MODELS` 16 件预热表**，避免扰动既有探针断言）；`main.ts` 预热额外拉取 6 件、`__WS.scenery()` 返回 7 实例加载状态。
- **移除实心砖墙**：`buildArchitecture()` 删掉 z=-2.3 整面砖墙（v2.0.4 引入的「廊下感」来源，挡住整个天幕），保留瓦檐 + 门柱 + 门楣作前景「山门」框——灯笼吊杆仍挂框下，殿宇/雪岭/冷月自框后展开成多层纵深。
- **布局经投影标定**（标定脚本 `.build-log/diag-calib.mjs`）：背景可视带世界 y∈[0,4.5]（z=-13 基准），风景件整体压低成横向剪影带；**月亮置于殿宇侧后方 x=10**（殿宇 x∈[-6,6] 会挡住正后方月盘）。
- **`scene.background` 由纯色改渐变贴图**：`buildSky` 用 CanvasTexture（`skyTop`→`skyBottom`）铺满视口；雾色 `#24303a` 与 `fogDensity=0.018` 不变。`probe-stage` 对应断言已由「背景冷蓝纯色」改为「背景为渐变贴图 + 雾冷蓝不变」。

---

## 5. 更新资产的标准流程（无凭据，任何人/模型可执行）

1. **生成**：按 §3 风格字典生成/修改网格（严格 T-pose）→ 自动绑骨 → 动画重定向（动作集见 §2.1 的 16 个动画名；缺动作按 §4.2 回退规则在 `clipMap.ts` 调整）。
2. **合并**：把绑骨网格与 N 个单动作 GLB 合并成一个 GLB（保留动画命名）。参考脚本：`.build-log/review/round5/merge-page.html` + `merge-run.mjs`（浏览器内 GLTFLoader.parse + GLTFExporter 合并，Node 直接 parse 会因纹理解码报 `self is not defined`）。
3. **校验**：角色 GLB 用 `artifact_delivery.py inspect FILE --format glb --require-rig --require-animation --minimum-animation-clips 16`；**场景件是静态网格，用 `inspect FILE --format glb`（不加 `--require-rig` / `--require-animation`）**。
4. **落盘**：替换 `public/models/<角色>_animated.glb` 或 `public/models/scene/<场景件>.glb`；原始产物归档进 `assets/lux3d/` 或 `assets/lux3d/scene/`（不删旧文件）。
5. **改本文件**：更新 §2 表格（文件名/大小/说明）与 §4 映射（如有变化），更新文首的版本与日期。**这就是「以后更新资产只改这个文件」的含义。**
6. **回归**：`npx tsc --noEmit` → `npm run build` → `.build-log/regress.mjs`（14 项）→ `.build-log/accept.mjs`（ERRORS: none）→ `.build-log/probe-glb.mjs`（角色）→ `.build-log/probe-scene-glb.mjs`（场景件 PBR/破坏/降级）。

### 场景参数权威源与生成器（v2.0.8 授权边界变更）

- 场景的**唯一权威源**是 `scene/params/shuangting.json`：`manual.keyDestroyables` 定义可破坏 spec，`palette` / `fogDensity` / `lighting` 定义视觉（夜色冷蓝 + 暖灯冷月光比）。**`scene/output/decor.json` 是生成产物，不可手改**。
- 改权威源后必须跑 **`node scene/generator/generate.mjs`**（等价 `npm run scene:generate`）**刷新 `decor.json`**；`layers` / `colliders` / `arena` / 既有 spec 不动。
- v2.0.8 用户明确批准了**授权边界变更**：① 新增 6 件可破坏 spec 到 `manual.keyDestroyables`；② 修改权威源并重跑生成器；③ 回归数字从 **11 件 / 126 片** 改为 **17 件 / 约 170 片**（< capMax 200）。只改视觉参数时同样走此流程，不直接编辑 `decor.json`。
- 生成参数 / 报价 / 任务落盘口径见冻结契约 `.build-log/review/round7/INTERFACE.md`（本文件不复述凭据与私有 URL）。

## 6. 合规与安全

- Lux3D（Aholo）生成的资产仅用于本项目原型演示；平台 API 凭据**绝不**写入本文件或任何交付物（凭据由运行环境注入）。
- 本文件不含任何签名 URL / API key / 私有下载地址。
- **运行时资产均为随包本地 GLB**（`public/` 原样拷入 `dist/`），**零网络请求、零远程资产**；过去「运行时零外部资产」的表述已修订为「零远程资产、随包本地 GLB」。合规签署见 `docs/11`。
- 归档文件体积较大（约 300 MB），如需精简可仅保留 `*_rigged*.glb` 与 `*_actions/`；当前保留全量以便回溯。
- **参考图来源**：v2.0.8 舞台形制 / 配色取自**用户上传的四视图概念图（山门古刹·霜夜）**，仅作参考；裁图用于 2 件图生3D 试点。私有上传 URL / 报价凭据绝不写入本文件或任何交付物。
- **授权边界变更（用户明确批准）**：新增 6 件可破坏物（超出原「仅 4 件、不新增」边界）、修改权威源 `scene/params/shuangting.json` 并重跑生成器刷新 `decor.json`、回归数字 11 件 / 126 片 → 17 件 / 约 170 片。执行方式为**多 Agent 并行**（① 资产生成 / ② 引擎接入 / ③ 文档清单 / ④ 探针脚本），靠唯一 owner + 编排层串行收口（tsc / build / 门禁 / 发布）化解冲突，冻结契约见 `.build-log/review/round7/INTERFACE.md`。
- **零远程资产**：全部 **24 个 GLB**（2 角色 + 16 场景件 + 6 风景件）随 `public/` 原样拷入 `dist/`，为**同源本地文件**；运行时**零网络请求、零远程资产、无在线生成服务调用**，`GLTFLoader` 仅加载同源 `models/`，加载失败自动降级、游戏不崩。合规签署见 `docs/11`。
