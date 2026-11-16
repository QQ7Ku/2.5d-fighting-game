#!/usr/bin/env node
/**
 * Skill 生成管线（构建期 / 离线）
 *
 * 流程：模型原始输出 → 规范化 → 注入溯源信息（提示词哈希、输入哈希、种子、时间）
 *      → JSON Schema 校验 → 合并审核结论 → 输出候选库 / 已审核库 / 运行时bundle
 *
 * 本脚本可复现：同一 model-output 文件 + 同一 prompt 文件 → 同一 promptHash / inputsHash。
 * 模型本身不参与运行时，运行时只读取 skills.generated.json。
 *
 * 用法：node skills/scripts/generate.mjs [--check]
 *   --check 只校验不写文件（CI 用）
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const CHECK_ONLY = process.argv.includes('--check');

const sha256 = (text) => 'sha256:' + createHash('sha256').update(text, 'utf8').digest('hex');

const canonical = (value) => {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
};

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const writeJson = (p, v) => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(v, null, 2) + '\n', 'utf8');
};

const schema = readJson(join(ROOT, 'skills/schema/skill.schema.json'));
const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

const promptPath = join(ROOT, 'skills/prompts/special-skill.prompt.md');
const promptText = readFileSync(promptPath, 'utf8');
const promptHash = sha256(promptText);

const sourceFile = process.argv.find((a) => a.endsWith('.json')) ?? 'skills/candidates/model-output-20261113.json';
const sourcePath = resolve(ROOT, sourceFile);
const source = readJson(sourcePath);

const decisionsPath = join(ROOT, 'skills/review/decisions.json');
const decisions = existsSync(decisionsPath) ? readJson(decisionsPath) : { decisions: {} };

const nowIso = new Date().toISOString().slice(0, 19) + '+08:00';

const results = [];
let failed = 0;

for (const raw of source.candidates) {
  const inputsHash = sha256(canonical(raw));
  const decision = decisions.decisions[raw.skillId] ?? {
    status: 'pending',
    reviewId: 'RV-PENDING',
    reviewer: '未审核',
    notes: '尚无审核记录，不得进入 v2 构建。',
  };

  const withProvenance = {
    ...raw,
    provenance: {
      generator: 'model-assisted',
      modelVersion: source.modelVersion,
      promptId: source.promptId,
      promptHash,
      seed: source.seed,
      inputsHash,
      generatedAt: source.createdAt,
      reviewStatus: decision.status,
      reviewId: decision.reviewId,
      reviewer: decision.reviewer,
      balanceNotes: decision.notes,
    },
  };

  const ok = validate(withProvenance);
  if (!ok) {
    failed++;
    console.error(`✗ Schema 校验失败: ${raw.skillId}`);
    for (const err of validate.errors ?? []) {
      console.error(`   ${err.instancePath || '/'} ${err.message}`);
    }
  }

  results.push({ skill: withProvenance, ok });

  if (!CHECK_ONLY) {
    writeJson(join(ROOT, `skills/candidates/${raw.skillId}.json`), withProvenance);
    if (ok && decision.status === 'approved') {
      writeJson(join(ROOT, `skills/generated/${raw.skillId}.json`), withProvenance);
    }
  }
}

// 清理已审核库中不再被批准的旧文件
if (!CHECK_ONLY && existsSync(join(ROOT, 'skills/generated'))) {
  const approvedIds = new Set(
    results.filter((r) => r.ok && r.skill.provenance.reviewStatus === 'approved').map((r) => r.skill.skillId)
  );
  for (const file of readdirSync(join(ROOT, 'skills/generated'))) {
    if (!file.endsWith('.json')) continue;
    const id = file.replace(/\.json$/, '');
    if (!approvedIds.has(id)) {
      console.warn(`! 移除未通过审核的入库文件: ${file}`);
      writeFileSync(join(ROOT, 'skills/generated/__stale__' + file), readFileSync(join(ROOT, 'skills/generated', file)));
    }
  }
}

// 运行时 bundle：只包含已审核通过的技能
const approved = results
  .filter((r) => r.ok && r.skill.provenance.reviewStatus === 'approved')
  .map((r) => r.skill);

const bundle = {
  schemaVersion: '1.0.0',
  bundleVersion: '2.0.0',
  generatedFrom: source.recordId,
  modelVersion: source.modelVersion,
  promptHash,
  seed: source.seed,
  generatedAt: source.createdAt,
  skills: approved,
};

if (!CHECK_ONLY) {
  writeJson(join(ROOT, 'src/data/skills.generated.json'), bundle);
  writeJson(join(ROOT, 'skills/seeds/seeds.json'), {
    schemaVersion: '1.0.0',
    records: [
      {
        recordId: source.recordId,
        seed: source.seed,
        modelVersion: source.modelVersion,
        promptId: source.promptId,
        promptHash,
        sourceFile,
        generatedAt: source.createdAt,
        approvedSkills: approved.map((s) => s.skillId),
        rejectedSkills: results
          .filter((r) => r.skill.provenance.reviewStatus === 'rejected')
          .map((r) => r.skill.skillId),
        reproduce: `node skills/scripts/generate.mjs ${sourceFile}`,
      },
    ],
  });
}

const total = results.length;
const pass = results.filter((r) => r.ok).length;
console.log(`\nSkill 生成管线 v2 —— 候选 ${total}，Schema 通过 ${pass}，失败 ${failed}`);
for (const r of results) {
  const s = r.skill;
  const tag = s.provenance.reviewStatus === 'approved' ? '✔ 入库' : s.provenance.reviewStatus === 'rejected' ? '✘ 驳回' : '… 待审';
  console.log(`  ${tag}  ${s.skillId.padEnd(22)} ${s.displayName.zh}  ${s.provenance.reviewId}`);
}
console.log(`  promptHash = ${promptHash.slice(0, 23)}…  seed = ${source.seed}\n`);

process.exit(failed > 0 ? 1 : 0);
