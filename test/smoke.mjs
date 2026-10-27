/**
 * smoke test：不启动 DSH，用 mock ctx 跑一遍 apply，
 * 并用 dsh 真实的 JSON Schema 校验器核对工具 schema。
 * 用法：node test/smoke.mjs
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { apply } from '../lib/index.js';

// dsh 解出的内部包副本（仅本机测试用；换机器时把 DSH_TOOLS 指到任意 dsh-tools/lib/index.js）
const DSH_TOOLS = process.env.DSH_TOOLS ?? '/tmp/ex/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js';
// 找不到 dsh 内部包时降级：跳过官方 schema 校验，不让测试卡在环境上
let assertSupportedJsonSchema = null;
try {
	({ assertSupportedJsonSchema } = await import(DSH_TOOLS));
} catch {
	console.log('提示：未找到 dsh-tools 校验器，跳过 schema 校验（设 DSH_TOOLS 可恢复）');
}

const dir = mkdtempSync(join(tmpdir(), 'trail-'));
const tools = new Map();
const sections = [];
let langHook;
const ctx = {
	systemPrompt: { section: (s) => sections.push(s), context: (c) => sections.push(c) },
	on: (name, fn) => { if (name === 'session/event') langHook = fn; },
	tools: { register: (def) => tools.set(def.name, def) }
};

apply(ctx, { dir });

// 1. 提示词 section + 动态语言段
assert.equal(sections.length, 2);
assert.ok(Number.isFinite(sections[0].order));
assert.match(sections[0].text, /路线/);
assert.match(sections[0].text, /先查路径库/);
assert.match(sections[1].text(), /中文/);

// 用户改说英文后，指令跟着切
assert.equal(typeof langHook, 'function');
langHook({}, { type: 'user/message', data: { text: 'please fix the parser bug' } });
assert.match(sections[1].text(), /英文/);
langHook({}, { type: 'user/message', data: { text: '帮我修一下解析器的 bug' } });
assert.match(sections[1].text(), /中文/);

// 2. 工具 schema 过 dsh 的校验器
assert.deepEqual(
	[...tools.keys()].sort(),
	['append_task_log', 'check_capability', 'link_material', 'list_material', 'open_task_log', 'recall_thoughts', 'record_thought']
);
if (assertSupportedJsonSchema !== null) {
	for (const def of tools.values()) {
		assertSupportedJsonSchema(def.parameters);
		assertSupportedJsonSchema(def.output.schema);
	}
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
assert.equal((await tools.get('recall_thoughts').execute({ query: '完全不存在的词' })).matches.length, 0);
assert.equal((await tools.get('recall_thoughts').execute({})).matches.length, 1);

// 4. 任务日志
const opened = await tools.get('open_task_log').execute({ title: '测试任务', kind: '自测' });
assert.equal(opened.ok, true);
const log = opened.path;
assert.match(readFileSync(log, 'utf8'), /## 不足/);
assert.match(readFileSync(log, 'utf8'), /## 思考路径/);

await tools.get('append_task_log').execute({ path: log, section: 'path', text: '写 schema → 跑 smoke' });
await tools.get('append_task_log').execute({ path: log, section: 'gap', text: '一开始忘了去重' });
const body = readFileSync(log, 'utf8');
assert.match(body, /写 schema → 跑 smoke/);
assert.match(body, /一开始忘了去重/);
// 追加内容必须落在对应小节里，不能串到别的小节
assert.ok(body.indexOf('一开始忘了去重') < body.indexOf('## 进步'));

// 4b. record_thought 同时写进当前任务日志
await tools.get('record_thought').execute({ goal: '第二条路径', route: '验证写日志' });
assert.match(readFileSync(log, 'utf8'), /## 思考路径[\s\S]*第二条路径/);

// 5. 素材调度去重
const linked = await tools.get('link_material').execute({ path: log, session_id: 's1', seq: '12', summary: '插件 API 结论' });
assert.match(linked.text, /已登记/);
const again = await tools.get('link_material').execute({ path: log, session_id: 's1', seq: '12', summary: '重复搬运' });
assert.match(again.text, /跳过/);
await tools.get('link_material').execute({ path: log, session_id: 's2', seq: '3', summary: '第二条' });
const list = await tools.get('list_material').execute({ path: log });
assert.equal(JSON.parse(list.text).length, 2);

// 6. 不存在的日志路径要给明确失败
const missing = await tools.get('append_task_log').execute({ path: join(dir, 'nope.md'), section: 'path', text: 'x' });
assert.equal(missing.ok, false);

// 7. 能力核对：本机装了 ponytail skill，假词应报缺
const cap = await tools.get('check_capability').execute({ needs: ['ponytail', 'zzz不存在zzz'] });
assert.match(cap.text, /✅ ponytail/);
assert.match(cap.text, /❌ zzz不存在zzz/);

rmSync(dir, { recursive: true, force: true });
console.log('smoke ok');
