/**
 * smoke test：不启动 DSH，用 mock ctx 跑一遍 apply，
 * 并用 dsh 真实的 JSON Schema 校验器核对工具 schema。
 * 用法：node test/smoke.mjs
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { apply } from '../lib/index.js';

// dsh 解出的内部包副本（仅本机测试用；换机器时把 DSH_TOOLS 指到任意 dsh-tools/lib/index.js）
const DSH_TOOLS = process.env.DSH_TOOLS ?? '/tmp/ex/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js';
const { assertSupportedJsonSchema } = await import(DSH_TOOLS);

const dir = mkdtempSync(join(tmpdir(), 'trail-'));
const tools = new Map();
const sections = [];
const ctx = {
	systemPrompt: { section: (s) => sections.push(s) },
	tools: { register: (def) => tools.set(def.name, def) }
};

apply(ctx, { dir });

// 1. 提示词 section
assert.equal(sections.length, 1);
assert.ok(Number.isFinite(sections[0].order));
assert.match(sections[0].text, /路线/);

// 2. 工具 schema 过 dsh 的校验器
assert.deepEqual([...tools.keys()].sort(), ['recall_thoughts', 'record_thought']);
for (const def of tools.values()) {
	assertSupportedJsonSchema(def.parameters);
	assertSupportedJsonSchema(def.output.schema);
}

// 3. 记录 + 检索
const recorded = await tools.get('record_thought').execute({
	goal: '给 DSH 做思考路径插件',
	route: '读插件 API → 写 JSONL 存储 → 挂 profile',
	decisions: '不 import 内部包，方便开源',
	lessons: '手写 JSON Schema 即可，不必 defineTool',
	tags: ['dsh', 'plugin']
});
assert.equal(recorded.ok, true);

const hit = await tools.get('recall_thoughts').execute({ query: '插件' });
assert.equal(hit.scanned, 1);
assert.equal(hit.matches[0].goal, '给 DSH 做思考路径插件');

const miss = await tools.get('recall_thoughts').execute({ query: '完全不存在的词' });
assert.equal(miss.matches.length, 0);

const recent = await tools.get('recall_thoughts').execute({});
assert.equal(recent.matches.length, 1);

rmSync(dir, { recursive: true, force: true });
console.log('smoke ok');
