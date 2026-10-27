/**
 * e2e：不重启 DSH，模拟真实任务从开始到收尾的完整链路。
 * 用法：node test/e2e.mjs
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { apply } from '../lib/index.js';

let langHook;

function boot(config) {
	const dir = mkdtempSync(join(tmpdir(), 'trail-e2e-'));
	const raw = new Map();
	const sections = [];
	apply({ systemPrompt: { section: (s) => sections.push(s), context: (c) => sections.push(c) },
	on: (name, fn) => { if (name === 'session/event') langHook = fn; }, tools: { register: (d) => raw.set(d.name, d) } }, { dir, ...config });
	// 包一层：每次调用都按 output.schema.required 校验返回值，防止「schema 要 path 但没返回」
	const tools = new Map();
	for (const [name, def] of raw) {
		tools.set(name, {
			...def,
			execute: async (args) => {
				const value = await def.execute(args);
				for (const key of def.output.schema.required ?? []) assert.ok(key in value, `${name} 返回值缺必填字段 ${key}`);
				for (const key of Object.keys(value)) assert.ok(key in def.output.schema.properties, `${name} 返回了 schema 未声明的字段 ${key}`);
				return value;
			}
		});
	}
	return { dir, tools, section: sections[0], cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// 1. 一条龙：不问用户，自动查路径库、自动建日志
const a = boot({});
assert.doesNotMatch(a.section.text, /记日志吗|问一句/);
assert.match(a.section.text, /先 recall_thoughts/);
assert.match(a.section.text, /直接 open_task_log/);
assert.equal(a.tools.size, 7);
a.cleanup();

// 2. 脏参数清洗：标签残渣不进路径库
const dirty = boot({});
await dirty.tools.get('record_thought').execute({ goal: '修 bug</decisions>', route: '读<lessons>日志' });
const stored = readFileSync(join(dirty.dir, 'trails.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).at(-1);
assert.equal(stored.goal, '修 bug');
assert.equal(stored.route, '读日志');
dirty.cleanup();

// 3. 真实任务链路：建日志 → 记路径 → 路径出现在日志 → 素材去重 → 能力核对
const t = boot({});
const opened = await t.tools.get('open_task_log').execute({ title: '端到端测试', kind: '自测' });
assert.equal(opened.ok, true);
const log = opened.path;
const body0 = readFileSync(log, 'utf8');
for (const h of ['## 路径', '## 经验', '## 不足', '## 进步', '## 思考路径', '## 调度素材']) assert.ok(body0.includes(h), h);
assert.ok(existsSync(join(t.dir, 'current-log.json')), '应记住当前日志');

await t.tools.get('record_thought').execute({ goal: '端到端目标', route: '建日志 → 写路径' });
const body1 = readFileSync(log, 'utf8');
assert.match(body1, /## 思考路径[\s\S]*端到端目标/);

await t.tools.get('link_material').execute({ path: log, session_id: 's1', seq: '7', summary: 'x' });
const dup = await t.tools.get('link_material').execute({ path: log, session_id: 's1', seq: '7', summary: 'y' });
assert.match(dup.text, /跳过/);

const cap = await t.tools.get('check_capability').execute({ needs: ['ponytail', 'zzz不存在zzz'] });
assert.match(cap.text, /✅ ponytail/);
assert.match(cap.text, /❌ zzz不存在zzz/);
assert.match(cap.text, /已装 \d+ skill/);
assert.doesNotMatch(cap.text, /已装插件（21）/, '清单不该再怼一长串');

// 4. 坏行不应弄崩检索
writeFileSync(join(t.dir, 'trails.jsonl'), `${readFileSync(join(t.dir, 'trails.jsonl'), 'utf8')}这不是 JSON\n`);
const hit = await t.tools.get('recall_thoughts').execute({ query: '端到端' });
assert.equal(hit.matches.length, 1);

t.cleanup();
console.log('e2e ok');
