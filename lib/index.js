/**
 * thinking-trail —— AI 的思考路径：跨会话留存、任务日志、会话素材调度登记。
 *
 * 六个工具：
 *   record_thought   任务收尾写一条「目标 → 路线 → 决策 → 教训」
 *   recall_thoughts  开工前检索历史路径
 *   open_task_log    建一份任务日志（路径/经验/不足/进步）
 *   append_task_log  往日志里追加某一段
 *   link_material    把「从别的会话调度来的素材」登记进日志（同来源自动去重）
 *   list_material    列出已调度素材，避免重复搬运
 *
 * 存储：<DSH_HOME>/thinking-trails/，纯文本、可 grep、可版本管理。
 * 只依赖 node 标准库，方便单独复制出去开源。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'thinking-trail';
/** 本插件用到的宿主服务：工具注册表 + 系统提示词注册表。 */
export const inject = ['tools', 'systemPrompt'];

const POLICY_SECTION = 'thinking-trail:policy';
const POLICY_ORDER = 150; // persona 之后、工具说明之前
const MAX_FILE_BYTES = 2 * 1024 * 1024; // shortcut: 单文件 2MB 就轮转，需要归档检索时再升级

/** 解析配置：dir 可覆盖存储根目录，maxResults 限制单次检索条数，askLog 关闭「每次任务前问日志」。 */
function settings(config) {
	const home = process.env.DSH_HOME ?? join(homedir(), '.dsh');
	const dir = config?.dir ?? join(home, 'thinking-trails');
	return {
		home,
		dir,
		logDir: join(dir, 'logs'),
		askLog: config?.askLog !== false,
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

/** 文件名安全化：去掉路径分隔符和控制字符，中文保留。 */
function slug(text) {
	const cleaned = String(text).replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '');
	return (cleaned || 'task').slice(0, 40);
}

const LOG_SECTIONS = [
	['path', '路径'], // 实际怎么走的
	['experience', '经验'], // 可复用的做法
	['gap', '不足'], // 没做好 / 走了弯路
	['progress', '进步'] // 比上次强在哪
];

const ENTRY_SCHEMA = {
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
};

const RECORD_OUTPUT = {
	schema: {
		type: 'object',
		additionalProperties: false,
		properties: { ok: { type: 'boolean' }, id: { type: 'string' }, file: { type: 'string' } },
		required: ['ok', 'id', 'file']
	},
	render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }]
};

const RECALL_OUTPUT = {
	schema: {
		type: 'object',
		additionalProperties: false,
		properties: {
			scanned: { type: 'number' },
			matches: { type: 'array', items: ENTRY_SCHEMA }
		},
		required: ['scanned', 'matches']
	},
	render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 1) }]
};

const TEXT_OUTPUT = {
	schema: {
		type: 'object',
		additionalProperties: false,
		properties: { ok: { type: 'boolean' }, path: { type: 'string' }, text: { type: 'string' } },
		required: ['ok']
	},
	// 有 text 就直接显示 text（能力核对是清单，不该糊成 JSON）
	render: (_args, value) => [{ type: 'text', text: typeof value.text === 'string' ? value.text : JSON.stringify(value, null, 1) }]
};

/** 建一份任务日志，返回路径。 */
function openLog(logDir, title, kind) {
	mkdirSync(logDir, { recursive: true });
	const stamp = new Date().toISOString().slice(0, 10);
	let file = join(logDir, `${stamp}-${slug(title)}.md`);
	for (let i = 2; existsSync(file); i += 1) file = join(logDir, `${stamp}-${slug(title)}-${i}.md`);
	const lines = [
		`# ${title}`,
		'',
		`- 开始：${new Date().toISOString()}`,
		`- 类型：${kind ?? '任务'}`,
		'',
		...LOG_SECTIONS.flatMap(([, label]) => [`## ${label}`, '']),
		'## 思考路径',
		'',
		'## 调度素材',
		'',
		'| 来源会话 | 事件 | 摘要 |',
		'| --- | --- | --- |'
	];
	writeFileSync(file, lines.join('\n') + '\n');
	return file;
}

/** 追加到日志的某个中文小节；小节不存在就补一个。 */
function appendLog(file, sectionLabel, text) {
	const body = readFileSync(file, 'utf8');
	const heading = `## ${sectionLabel}`;
	const line = `- ${text.replace(/\n/g, '\n- ')}`;
	const at = body.indexOf(heading);
	if (at === -1) {
		writeFileSync(file, `${body}${body.endsWith('\n') ? '' : '\n'}${heading}\n\n${line}\n`);
		return;
	}
	// 插到本节的下一个 "## " 之前，保持分节结构
	const next = body.indexOf('\n## ', at + heading.length);
	const insertAt = next === -1 ? body.length : next;
	const before = body.slice(0, insertAt).replace(/\n+$/, '\n');
	writeFileSync(file, `${before}${line}\n${body.slice(insertAt)}`);
}

/** 从日志里解析已登记的素材行。 */
function parseMaterial(file) {
	const rows = [];
	for (const line of readFileSync(file, 'utf8').split('\n')) {
		const m = line.match(/^\| ([^|]+) \| ([^|]+) \| (.*) \|$/);
		if (m === null) continue;
		const session = m[1].trim();
		if (session === '来源会话' || session.startsWith('---')) continue;
		rows.push({ session, seq: m[2].trim(), summary: m[3].trim() });
	}
	return rows;
}

/**
 * 中文能力词 → 英文关键词。用户说「识图」，装机名是 vision-router，
 * 不做这层对照就会把装了的报成没装。
 */
const CAPABILITY_ALIASES = {
	识图: ['vision', 'image'],
	看图: ['vision', 'image'],
	图片: ['vision', 'image'],
	调试: ['debug'],
	排查: ['debug', 'diagnose'],
	表格: ['excel', 'xlsx', 'spreadsheet', 'csv'],
	excel: ['excel', 'xlsx', 'spreadsheet'],
	幻灯片: ['pptx', 'slide', 'presentation'],
	文档: ['docx', 'word', 'document'],
	语音: ['voice', 'audio', 'tts'],
	联网: ['search', 'web', 'fetch'],
	搜索: ['search'],
	记忆: ['memory', 'engramory', 'recall'],
	跨会话: ['context', 'engramory', 'memory', 'trail', 'session'],
	会话检索: ['session', 'context'],
	历史: ['history', 'trail', 'recall'],
	压缩: ['compact', 'context', 'compress'],
	出图: ['image-gen', 'image'],
	画图: ['image-gen', 'image'],
	浏览器: ['browser', 'playwright'],
	终端: ['terminal', 'shell', 'bash'],
	邮件: ['mail']
};

/** 一个 need 扩展成多个可匹配关键词。 */
function expandNeed(need) {
	const raw = String(need).toLowerCase();
	const words = new Set([raw]);
	for (const [key, values] of Object.entries(CAPABILITY_ALIASES)) {
		if (raw.includes(key)) for (const word of values) words.add(word);
	}
	return [...words];
}

/** 已装 skill：读 SKILL.md 的 name/description，DSH_HOME/skills 与 profile/skills 都扫。 */
function scanSkills(home) {
	const roots = [join(home, 'skills')];
	// 插件自带的 skills（<profile>/node_modules/<pkg>/skills/<name>/SKILL.md）
	const profiles = join(home, 'profiles');
	if (existsSync(profiles)) {
		for (const profile of readdirSync(profiles)) {
			const modules = join(profiles, profile, 'node_modules');
			if (!existsSync(modules)) continue;
			for (const pkg of readdirSync(modules)) {
				const direct = join(modules, pkg, 'skills');
				if (existsSync(direct)) roots.push(direct);
				if (!pkg.startsWith('@')) continue;
				for (const sub of readdirSync(join(modules, pkg))) {
					const scoped = join(modules, pkg, sub, 'skills');
					if (existsSync(scoped)) roots.push(scoped);
				}
			}
		}
	}
	const out = [];
	const seen = new Set();
	for (const root of roots) {
		if (!existsSync(root)) continue;
		for (const dir of readdirSync(root)) {
			const md = join(root, dir, 'SKILL.md');
			if (!existsSync(md) || seen.has(dir)) continue;
			seen.add(dir);
			const head = readFileSync(md, 'utf8').slice(0, 2000);
			const fm = head.match(/^---\n([\s\S]*?)\n---/);
			const name = fm === null ? dir : (fm[1].match(/^name:\s*(.+)$/m)?.[1] ?? dir);
			const desc = fm === null ? '' : (fm[1].match(/^description:\s*(.+)$/m)?.[1] ?? '').replace(/^["']|["']$/g, '');
			out.push({ name: name.trim(), description: desc });
		}
	}
	return out;
}

/**
 * 已装插件：扫 DSH_HOME/profiles 下各 profile 的 dsh.profile.bundles。
 * 不用 import.meta.url 推 profile 目录——软链安装时它会被解析回源码目录。
 */
function scanPlugins(home) {
	const root = join(home, 'profiles');
	if (!existsSync(root)) return [];
	const out = new Set();
	for (const name of readdirSync(root)) {
		try {
			const pkg = JSON.parse(readFileSync(join(root, name, 'package.json'), 'utf8'));
			for (const bundle of pkg?.dsh?.profile?.bundles ?? []) out.add(String(bundle));
		} catch {
			/* 坏 profile 跳过 */
		}
	}
	return [...out];
}

/** 把任务需要的能力逐条对到已装 skill / 插件上。 */
function checkCapability(needs, home) {
	const skills = scanSkills(home);
	const plugins = scanPlugins(home);
	const candidates = [
		...skills.map((s) => ({ kind: 'skill', name: s.name, hay: `${s.name} ${s.description}`.toLowerCase() })),
		...plugins.map((p) => ({ kind: 'plugin', name: p, hay: p.toLowerCase() }))
	];
	const rows = needs.map((need) => {
		const words = expandNeed(need);
		// 先按名字匹配（准），名字一个都没中就退回描述匹配（全，但噪音大）
		const byName = candidates.filter((c) => words.some((w) => c.name.toLowerCase().includes(w)));
		const hits = byName.length > 0 ? byName : candidates.filter((c) => words.some((w) => c.hay.includes(w)));
		const found = hits.map((c) => `${c.kind}:${c.name}`);
		return { need: String(need), found };
	});
	return { rows, skills: skills.map((s) => s.name), plugins };
}

export function apply(ctx, config) {
	try {
		install(ctx, config);
	} catch (err) {
		// 加载失败时留证据，省得只能靠猜
		try {
			const { dir: home } = settings(config);
			mkdirSync(home, { recursive: true });
			writeFileSync(join(home, 'apply-error.txt'), `${new Date().toISOString()}\n${err?.stack ?? err}\n`);
		} catch {
			/* 诊断都写不进去就只剩抛出 */
		}
		throw err;
	}
}

function install(ctx, config) {
	const { home, dir, logDir, maxResults, askLog } = settings(config);
	// 每次加载都盖一次时间戳：看 state.json 的 mtime 就知道插件是否被重新加载（热载诊断用）
	try {
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, 'state.json'), JSON.stringify({ version: '0.2.9', appliedAt: new Date().toISOString() }));
	} catch {
		/* 诊断信息写不进去不影响主功能 */
	}

	ctx.systemPrompt.section({
		name: POLICY_SECTION,
		order: POLICY_ORDER,
		text: [
			'## 思考路径（thinking-trail）',
			'- 用用户当前使用的语言思考和回答。',
			'- 非简单任务先给「路线」：目标 → 关键步骤 → 预期产物；路线变了说明原因。',
			'- 开工前若任务像做过的，先 recall_thoughts（本地、毫秒级）；本地没有再用 session_search 扫会话历史。',
			askLog
				? '- 先问一句「这次记任务日志吗」，同意再 open_task_log，并把完整路径报给用户。'
				: '- 只有用户明确说「记日志」时才 open_task_log，不要每次问。',
			'- 只有任务明显需要本机可能没有的能力（识图/表格/某工具）才调 check_capability；纯代码或文本任务不要调。',
			'- 收尾 record_thought 存一条（同时写进当前日志）；不写密钥和隐私原文。',
			'- 日志整理、周报、历史路径普查这类重活交子 agent：说清路径和目标，让它写文件、只带回保存地址。',
			'',
			'',
			'## 需求精化（内部步骤，不回显）',
			'- 收到需求先在心里拆成四项：目标 / 必须满足 / 不能碰 / 怎么算做完，然后直接干；不要把这份拆解或「让我理解一下」回给用户。',
			'- 缺了会导致返工的关键信息，一次问全（最多 3 句），别挤牙膏式追问。',
			'- 一句话能做完的需求不要拆，直接做。',
			'- 一次工具调用能拿全的信息不分两次；不为「看起来完整」机械调工具。',
			'',
			'## 跨会话语料调度',
			'- 只在用户消息出现 #关键词 时触发；没出现就别主动扫会话历史。',
			'- 先 recall_thoughts（快），命中就不调 session_search；不命中再扫。',
			'- 命中后列 id + 一句摘要给用户挑，只读确认过的那几条；每读一条就 link_material 登记，表里已有的不重复。',
			'- 只取与当前任务直接相关的，宁少勿滥；路径/文件名原样保留。'
		].join('\n')
	});

	ctx.tools.register({
		name: 'record_thought',
		description: 'Save a reusable thought path for a finished non-trivial task.',
		parameters: {
			type: 'object',
			additionalProperties: false,
			properties: {
				goal: { type: 'string', description: 'Task goal.' },
				route: { type: 'string', description: 'Steps taken, in order.' },
				decisions: { type: 'string', description: 'Key decisions and why.' },
				lessons: { type: 'string', description: 'Reuse or avoid next time.' },
				tags: { type: 'array', items: { type: 'string' }, description: 'Retrieval tags.' }
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
			// 顺手写进当前任务日志的「思考路径」节；用户说日志也要留路径
			try {
				const cur = join(dir, 'current-log.json');
				if (existsSync(cur)) {
					const { path } = JSON.parse(readFileSync(cur, 'utf8'));
					if (typeof path === 'string' && existsSync(path)) appendLog(path, '思考路径', `${args.goal}｜${args.route.slice(0, 160)}`);
				}
			} catch {
				/* 日志写不进去不影响路径库 */
			}
			return Promise.resolve({ ok: true, id: entry.id, file });
		}
	});

	ctx.tools.register({
		name: 'recall_thoughts',
		description: 'Search thought paths saved by earlier sessions; omit query to list recent ones. Cheaper than session_search, so try it first.',
		parameters: {
			type: 'object',
			additionalProperties: false,
			properties: {
				query: { type: 'string', description: 'Keywords, case-insensitive.' },
				limit: { type: 'number', description: `Max entries to return (default ${maxResults}).` }
			},
			required: []
		},
		output: RECALL_OUTPUT,
		execute(args) {
			const all = readAll(dir);
			const limit = Number.isInteger(args.limit) && args.limit > 0 ? Math.min(args.limit, 50) : maxResults;
			const words = (args.query ?? '').trim().toLowerCase().split(/[\s,，、]+/).filter((w) => w.length > 0);
			let scored = all.map((entry) => ({ entry, score: words.filter((w) => haystack(entry).includes(w)).length }));
			if (words.length > 0) scored = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
			return Promise.resolve({
				scanned: all.length,
				matches: scored.slice(0, limit).map(({ entry }) => entry)
			});
		}
	});

	ctx.tools.register({
		name: 'open_task_log',
		description: 'Create a per-task log file (path/experience/gaps/progress). Ask the user first; once per task.',
		parameters: {
			type: 'object',
			additionalProperties: false,
			properties: {
				title: { type: 'string', description: 'Short title, used in the file name.' },
				kind: { type: 'string', description: 'Optional kind, e.g. 插件开发 / 排查.' }
			},
			required: ['title']
		},
		output: TEXT_OUTPUT,
		execute(args) {
			const path = openLog(logDir, args.title, args.kind);
			try {
				mkdirSync(dir, { recursive: true });
				writeFileSync(join(dir, 'current-log.json'), JSON.stringify({ path }));
			} catch {
				/* 记不住当前日志不影响功能 */
			}
			return Promise.resolve({ ok: true, path, text: `日志已建：${path}` });
		}
	});

	ctx.tools.register({
		name: 'append_task_log',
		description: 'Append one line to a log section.',
		parameters: {
			type: 'object',
			additionalProperties: false,
			properties: {
				path: { type: 'string', description: 'Log path returned by open_task_log.' },
				section: {
					type: 'string',
					enum: LOG_SECTIONS.map(([key]) => key),
					description: 'path=实际路径, experience=经验, gap=不足, progress=进步.'
				},
				text: { type: 'string', description: 'One entry; keep it concrete.' }
			},
			required: ['path', 'section', 'text']
		},
		output: TEXT_OUTPUT,
		execute(args) {
			if (!existsSync(args.path)) return Promise.resolve({ ok: false, path: args.path, text: '日志文件不存在' });
			const label = LOG_SECTIONS.find(([key]) => key === args.section)?.[1] ?? args.section;
			appendLog(args.path, label, args.text);
			return Promise.resolve({ ok: true, path: args.path });
		}
	});

	ctx.tools.register({
		name: 'link_material',
		description: 'Register pulled material in the log; same session+event is rejected as duplicate.',
		parameters: {
			type: 'object',
			additionalProperties: false,
			properties: {
				path: { type: 'string', description: 'Log path returned by open_task_log.' },
				session_id: { type: 'string', description: 'Source session id.' },
				seq: { type: 'string', description: 'Source event sequence (or a stable short ref).' },
				summary: { type: 'string', description: 'One-line gist; keep paths exact.' }
			},
			required: ['path', 'session_id', 'seq', 'summary']
		},
		output: TEXT_OUTPUT,
		execute(args) {
			if (!existsSync(args.path)) return Promise.resolve({ ok: false, path: args.path, text: '日志文件不存在' });
			const rows = parseMaterial(args.path);
			if (rows.some((r) => r.session === args.session_id && r.seq === args.seq)) {
				return Promise.resolve({ ok: true, path: args.path, text: '已登记过，跳过（不重复调度）' });
			}
			const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
			appendFileSync(args.path, `| ${cell(args.session_id)} | ${cell(args.seq)} | ${cell(args.summary)} |\n`);
			return Promise.resolve({ ok: true, path: args.path, text: `已登记，当前共 ${rows.length + 1} 条素材` });
		}
	});

	ctx.tools.register({
		name: 'list_material',
		description: 'List material already in this log, so nothing is pulled twice.',
		parameters: {
			type: 'object',
			additionalProperties: false,
			properties: { path: { type: 'string', description: 'Log path returned by open_task_log.' } },
			required: ['path']
		},
		output: TEXT_OUTPUT,
		execute(args) {
			if (!existsSync(args.path)) return Promise.resolve({ ok: false, path: args.path, text: '日志文件不存在' });
			return Promise.resolve({ ok: true, path: args.path, text: JSON.stringify(parseMaterial(args.path), null, 1) });
		}
	});

	ctx.tools.register({
		name: 'check_capability',
		description: 'Check if the skills/plugins a task needs are installed; report what exists and what is missing.',
		parameters: {
			type: 'object',
			additionalProperties: false,
			properties: {
				needs: { type: 'array', items: { type: 'string' }, description: 'Capability keywords, e.g. ["识图","excel"].' }
			},
			required: ['needs']
		},
		output: TEXT_OUTPUT,
		execute(args) {
			const { rows, skills, plugins } = checkCapability(args.needs ?? [], home);
			const lines = rows.map((r) => (r.found.length > 0 ? `✅ ${r.need} → ${r.found.join(', ')}` : `❌ ${r.need} → 没找到，需要另外装`));
			return Promise.resolve({
				ok: true,
				text: [
					rows.length === 0 ? '没给 needs，这是当前已装清单：' : `需要的 ${rows.length} 项：`,
					...lines,
					'',
					`已装 skill（${skills.length}）：${skills.join(', ') || '无'}`,
					'（这份清单只覆盖本机安装目录；DSH 内置技能不在其中，没找到不等于不能用。）',
					`已装插件（${plugins.length}）：${plugins.join(', ') || '无'}`
				].join('\n')
			});
		}
	});
}
