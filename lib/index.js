/**
 * thinking-trail —— 让 AI 的思考路径跨会话留存并复用。
 *
 * 两个工具：
 *   record_thought  任务结束后写一条「目标 → 路线 → 决策 → 教训」
 *   recall_thoughts 开工前按关键词（或不带关键词看最近）检索历史路径
 *
 * 存储：<DSH_HOME>/thinking-trails/*.jsonl，纯文本、一行一条，可 grep。
 * 只依赖 node 标准库，不 import @deepseek-ai/*，方便单独复制出去开源。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const name = 'thinking-trail';
/** 本插件用到的宿主服务：工具注册表 + 系统提示词注册表。 */
export const inject = ['tools', 'systemPrompt'];

const POLICY_SECTION = 'thinking-trail:policy';
const POLICY_ORDER = 150; // persona 之后、工具说明之前
const MAX_FILE_BYTES = 2 * 1024 * 1024; // shortcut: 单文件 2MB 就轮转，需要归档检索时再升级

/** 解析配置：dir 可覆盖存储目录，maxResults 限制单次检索条数。 */
function settings(config) {
	const home = process.env.DSH_HOME ?? join(homedir(), '.dsh');
	return {
		dir: config?.dir ?? join(home, 'thinking-trails'),
		maxResults: Number.isInteger(config?.maxResults) && config.maxResults > 0 ? config.maxResults : 5
	};
}

/** 当前主文件；超过阈值就改名归档，返回新的空主文件路径。 */
function currentFile(dir) {
	mkdirSync(dir, { recursive: true });
	const file = join(dir, 'trails.jsonl');
	if (existsSync(file) && statSync(file).size > MAX_FILE_BYTES) {
		renameSync(file, join(dir, `trails-${Date.now()}.jsonl`));
	}
	return file;
}

/** 读出目录下所有 jsonl 的条目；坏行直接跳过（手改文件不该弄崩工具）。 */
function readAll(dir) {
	if (!existsSync(dir)) return [];
	const entries = [];
	for (const file of readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort()) {
		for (const line of readFileSync(join(dir, file), 'utf8').split('\n')) {
			if (line.trim() === '') continue;
			try {
				entries.push(JSON.parse(line));
			} catch {
				/* 坏行跳过 */
			}
		}
	}
	return entries.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

/** 一条记录里可被检索的全文。 */
function haystack(entry) {
	return [entry.goal, entry.route, entry.decisions, entry.lessons, ...(entry.tags ?? [])].filter(Boolean).join('\n').toLowerCase();
}

const RECORD_OUTPUT = {
	schema: {
		type: 'object',
		additionalProperties: false,
		properties: {
			ok: { type: 'boolean' },
			id: { type: 'string' },
			file: { type: 'string' },
			total: { type: 'number' }
		},
		required: ['ok', 'id', 'file', 'total']
	},
	render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }]
};

const RECALL_OUTPUT = {
	schema: {
		type: 'object',
		additionalProperties: false,
		properties: {
			scanned: { type: 'number' },
			matches: {
				type: 'array',
				items: {
					type: 'object',
					additionalProperties: false,
					properties: {
						id: { type: 'string' },
						at: { type: 'string' },
						goal: { type: 'string' },
						route: { type: 'string' },
						decisions: { type: 'string' },
						lessons: { type: 'string' },
						tags: { type: 'array', items: { type: 'string' } }
					},
					required: ['id', 'at', 'goal', 'route']
				}
			}
		},
		required: ['scanned', 'matches']
	},
	render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 1) }]
};

export function apply(ctx, config) {
	const { dir, maxResults } = settings(config);

	ctx.systemPrompt.section({
		name: POLICY_SECTION,
		order: POLICY_ORDER,
		text: [
			'## 思考路径（thinking-trail）',
			'- 用用户当前使用的语言思考和回答。',
			'- 非简单任务先给一段「路线」：目标 → 关键步骤 → 预期产物，再动手；路线中途变了就说明为什么变。',
			'- 开工前若任务看起来以前做过，先 recall_thoughts 查一次历史路径，能找到桥就别重新找路。',
			'- 任务收尾时用 record_thought 存一条：目标、路线、关键决策、可复用的教训。只写能复用的东西，不写密钥、token 或用户隐私原文。'
		].join('\n')
	});

	ctx.tools.register({
		name: 'record_thought',
		description: 'Record the thought path of a finished task (goal, route, decisions, lessons) so future sessions can reuse it. Call once when a non-trivial task is done.',
		parameters: {
			type: 'object',
			additionalProperties: false,
			properties: {
				goal: { type: 'string', description: 'What the task was trying to achieve.' },
				route: { type: 'string', description: 'The route taken: steps or waypoints, in order.' },
				decisions: { type: 'string', description: 'Key decisions and why (the load-bearing reasons).' },
				lessons: { type: 'string', description: 'What to reuse or avoid next time.' },
				tags: { type: 'array', items: { type: 'string' }, description: 'Short retrieval tags.' }
			},
			required: ['goal', 'route']
		},
		output: RECORD_OUTPUT,
		execute(args) {
			const file = currentFile(dir);
			const entry = {
				id: `t_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
				at: new Date().toISOString(),
				goal: args.goal,
				route: args.route,
				...(args.decisions === undefined ? {} : { decisions: args.decisions }),
				...(args.lessons === undefined ? {} : { lessons: args.lessons }),
				tags: args.tags ?? []
			};
			appendFileSync(file, JSON.stringify(entry) + '\n');
			return Promise.resolve({ ok: true, id: entry.id, file, total: readAll(dir).length });
		}
	});

	ctx.tools.register({
		name: 'recall_thoughts',
		description: 'Search thought paths recorded by earlier sessions. Use before starting work that may already have a route. Omit query to list the most recent entries.',
		parameters: {
			type: 'object',
			additionalProperties: false,
			properties: {
				query: { type: 'string', description: 'Keywords; matched case-insensitively against goal, route, decisions, lessons and tags.' },
				limit: { type: 'number', description: `Max entries to return (default ${maxResults}).` }
			},
			required: []
		},
		output: RECALL_OUTPUT,
		execute(args) {
			const all = readAll(dir);
			const limit = Number.isInteger(args.limit) && args.limit > 0 ? Math.min(args.limit, 50) : maxResults;
			const q = (args.query ?? '').trim().toLowerCase();
			const words = q.split(/[\s,，、]+/).filter((w) => w.length > 0);
			let scored = all.map((entry) => ({
				entry,
				score: words.length === 0 ? 0 : words.filter((w) => haystack(entry).includes(w)).length
			}));
			if (words.length > 0) scored = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
			const matches = scored.slice(0, limit).map(({ entry }) => ({
				id: entry.id,
				at: entry.at,
				goal: entry.goal,
				route: entry.route,
				...(entry.decisions === undefined ? {} : { decisions: entry.decisions }),
				...(entry.lessons === undefined ? {} : { lessons: entry.lessons }),
				tags: entry.tags ?? []
			}));
			return Promise.resolve({ scanned: all.length, matches });
		}
	});
}
