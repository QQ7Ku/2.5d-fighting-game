# 05 · Skill 生成模型流程（必杀技配置）

版本 v2.0.0（技能配置 v2.0.1）· 目录 `skills/` · 脚本 `skills/scripts/generate.mjs`

## 1. 角色定位

「Skill 生成模型」= **设计期/构建期**用来产出**原创必杀技 JSON 配置**的模型。
它不产出代码、不参与运行时。运行时的 `dist` 只读取构建产物 `src/data/skills.generated.json`。

```
策划意图/约束  →  模型生成候选 JSON  →  脚本：注入溯源 + Schema 校验
              →  战斗系统 Agent 平衡审核  →  QA Agent 可玩性审核
              →  总控批准入库（generated/）  →  构建打进 bundle
```

## 2. Schema

`skills/schema/skill.schema.json`（draft-07，`additionalProperties: false`）。必填 15 个顶层字段：

| 字段组 | 关键内容 |
|---|---|
| 标识 | `schemaVersion / skillId / version / characterId / displayName` |
| 指令 | `input.motion`（none/qcf/qcb/dp/charge/doubleTap）、`input.button`、`requiresGround` |
| 帧数据 | `frames.startup/active/recovery` |
| 判定 | `hits[]`：`box{x,y,w,h}`、`damage`、`hitstun`、`blockstun`、`hitstop`、`knockback`、`guard`、`destructionLevel`、`meterGain`、`fx`、`sfx` |
| 位移 | `movement[]`：帧 + vx/vy |
| 动画 | `animation.clip / speed / cancelInto / cancelWindow` |
| 3D 特效 | `vfx3d.preset / colorHex / scale / trail / shakeStrength` |
| 音效 | `audio.voice / impact` |
| 资源 | `resource.meterCost / cooldownFrames` |
| 连招兼容 | `compat.comboFrom / comboInto / airOk / tags` |
| 溯源 | `provenance`：模型版本、提示词 ID + 哈希、种子、输入哈希、时间、审核状态/编号/审核人/平衡备注 |

**强约束**（Schema + 提示词双重限制，审核再复核）：
- 只允许 JSON，不允许代码/着色器/脚本；
- `startup ≤ 10` 的招式不得带 `destructionLevel ≥ 2`；
- 单招总伤害 ≤ 140，总帧 ≥ 34；
- `unblockable` 仅允许 `startup ≥ 18`；
- `cancelInto` 不得含自身、不得形成 A→B→A 循环；
- `meterCost / 总伤害 ≥ 0.18`。

## 3. 提示词与可复现

- 模板：`skills/prompts/special-skill.prompt.md`（含原创合规条款、坐标系定义、平衡硬约束、输出格式）
- 提示词哈希：`promptHash = sha256(模板全文)` = `sha256:f9bd187ce9a807d4…`
- 种子：`20261113`；模型版本：`deepseek-v4.1-flash`
- 输入哈希：`inputsHash = sha256(规范化候选 JSON)`（键排序后序列化，保证稳定）
- 记录文件：`skills/seeds/seeds.json`

**复现命令**

```bash
node skills/scripts/generate.mjs                       # 重新生成 + 校验 + 落盘
node skills/scripts/generate.mjs --check               # 仅校验（CI）
```

同一输入 → 同一 `promptHash` / `inputsHash` / 同一 bundle 内容（仅 `generatedAt` 取自记录文件，不取系统时间）。

## 4. 候选库与审核

| skillId | 名称 | 角色 | 版本 | 审核 | 结论摘要 |
|---|---|---|---|---|---|
| `libin_sp1_chansi` | 缠丝劲 | 李宾 | 2.0.1 | RV-001b | 三段突进掌，总 46 帧 / 132 裸伤害（含连段缩放实测 119）/ 25 气；v2.0.1 修正前两段击退（1.2→0.35）后三段可全中 |
| `libin_sp2_zhendi` | 震地印 | 李宾 | 2.0.0 | RV-002 | 20 帧起手不可防御范围冲击，两处 `destructionLevel=3` 来源之一（震地印 / 回澜棍第二段），冷却 90 帧 |
| `yaoshan_sp1_huilan` | 回澜棍 | 筄山 | 2.0.0 | RV-003 | 两段横扫，二段击退 7.6 用于把对手推向立柱 |
| `yaoshan_sp2_guichao` | 掷棍归巢 | 筄山 | 2.0.0 | RV-004 | 中远距 overhead 投射，防止对手长期蹲防 |
| `libin_sp3_yingzong` | 影踪掌 | 李宾 | 2.0.0 | **RV-005 驳回** | 6 帧无敌起手 + 破坏 3 + 自我取消循环 + 伤害/资源比 6.0 → 违反 3 条硬约束 |

审核记录：`skills/review/decisions.json`（含逐条平衡意见与复测数据）。
候选库：`skills/candidates/*.json`（含被驳回者，保留以供复查）。
入库：`skills/generated/*.json`（仅 `reviewStatus = approved`）。

## 5. 阻断机制

- 未审核 / 驳回 / Schema 失败 → **不会**写入 `skills/generated/`，也不会进入 `skills.generated.json`。
- 生成脚本会打印每个候选的入库状态，并以非 0 退出码表示存在 Schema 失败（本次 0 失败）。
- 构建过程无网络请求，`dist` 内不存在任何模型调用代码。

## 6. 降级方案

| 风险 | 降级 |
|---|---|
| 模型输出不合规 | 策划直接手写同结构 JSON，`provenance.generator = hand-authored` |
| 在线模型不可用 | 全部流程离线，本地脚本即可完成校验与落盘 |
| 平衡反复 | 走版本号递增（2.0.0 → 2.0.1）+ 新审核编号（RV-001 → RV-001b），旧版本保留在 git 与候选库 |
| 运行时误用未审核内容 | 运行时只 import `src/data/skills.generated.json`，该文件由脚本按审核结论生成；源码中不存在手写必杀数值 |

## 7. 本轮生成统计

- 候选 5 条，Schema 通过 5 条，失败 0 条
- 通过审核入库 4 条（满足验收「至少 4 个必杀配置」）
- 驳回 1 条，驳回理由完整记录
- 从 2.0.0 到 2.0.1 的平衡修订 1 次，附复测数据
