# Skill 生成 Agent · 任务计划与自检

## 职责
维护 Skill Schema、提示词模板、生成脚本、种子记录、候选库、自动校验与审核流转

## 交付物
- `skills/schema/skill.schema.json`
- `skills/prompts/special-skill.prompt.md`
- `skills/scripts/generate.mjs`
- `skills/seeds/seeds.json`
- `skills/candidates/*.json（5）`
- `skills/generated/*.json（4）`
- `skills/review/decisions.json`
- `docs/05-Skill生成流程.md`

## 接口约定（遵守 docs/07-接口契约.md）
- 只通过 `bus` 事件与他人通信；不改他人目录；接口变更先报总控
- 事件名 / 数据结构 / 资源命名 / 版本号 / Clip 名 / 触屏事件 全部按契约执行

## 验收自检项（已逐条执行）
1. 5 条候选全部通过 JSON Schema 校验（0 失败）
2. 4 条通过审核入库，1 条驳回并保留理由
3. promptHash / inputsHash / seed 全量记录，可复现
4. 运行时只 import 已审核 bundle
5. 脚本层阻断未审核内容进入构建

## 发现的问题与处理
- 模型原始输出第 1 版击退数值不合理，靠人工平衡审核拦住，说明自动校验不能替代人工

## 状态
已完成 v2.0.0 交付范围内的工作；未完成项与风险见 `docs/09-测试报告.md`。
