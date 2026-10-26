# dsh-thinking-trail

给 DeepSeek Harness 用的「思考路径」插件：AI 把每个任务的**目标 → 路线 → 决策 → 教训**留在本地，下次遇到同类任务先查旧路，而不是从零找路。

- 跨会话：路径存在 `~/.dsh/thinking-trails/*.jsonl`，不同对话共享同一份。
- 人可读：纯 JSONL 明文，可以直接 grep / 打开看 / 提交到仓库。
- 零依赖：只用 Node 标准库，不 import 任何 `@deepseek-ai/*` 内部包，方便单独复制、开源、改造。
- 六个工具，三件事：
  - **思考路径**：`record_thought` 任务收尾写一条（`goal`、`route` 必填，`decisions`/`lessons`/`tags` 可选）；`recall_thoughts` 按关键词检索，不带关键词返回最近几条。
  - **任务日志**：`open_task_log` 建一份按任务的 md（路径 / 经验 / 不足 / 进步）；`append_task_log` 往对应小节追加。每次任务开始前 AI 会先问你要不要记。
  - **会话素材调度**：`link_material` 把从别的会话调来的内容登记进日志表格，**同 session_id + seq 自动判重**；`list_material` 列出已登记的，避免重复搬运。
- 一条系统提示（order 150）：用用户的语言思考；非简单任务先给路线再执行；开工前先查旧路；收尾存一条；`#关键词` 表示从旧会话调素材，先检索、由用户挑、只读确认过的、每读一条就登记去重。

## 安装（本机 DSH，已装好）

```bash
# 1. 链到 profile 的 node_modules
ln -sfn /path/to/dsh-thinking-trail ~/.dsh/profiles/desktop/node_modules/dsh-thinking-trail

# 2. 把包名追加到 ~/.dsh/profiles/desktop/package.json 的 dsh.profile.bundles
#    "bundles": [ ..., "dsh-thinking-trail" ]

# 3. 重载窗口（client 侧改动）/ 重启应用（host 侧首次加载）
```

卸载：从 `bundles` 删掉包名，删除软链即可；已记录的路径文件不会被删。

## 配置

在 profile 的 `cordis.patch.yml` 里按 id 覆盖：

```yaml
- id: dsh-thinking-trail
  config:
    dir: /Users/you/notes/trails   # 默认 <DSH_HOME>/thinking-trails
    maxResults: 5                  # recall 默认返回条数
```

## 热重载（改代码免重启）

DSH 的 `hmr` 默认只监听 profile 配置文件，**不监听模块代码**。要用「边用边改」，在 profile 的 `cordis.patch.yml` 加：

```yaml
- id: hmr
  config:
    root: ["node_modules/dsh-thinking-trail"]   # 只看这个插件目录
    ignored: []                                  # 别把 node_modules 整体忽略掉
```

改完 `lib/index.js` 保存即热重载；配置本身也是热载的。

## 配置文件位置

- 路径库：`<DSH_HOME>/thinking-trails/trails.jsonl`（2 MB 自动轮转）
- 任务日志：`<DSH_HOME>/thinking-trails/logs/YYYY-MM-DD-<标题>.md`
- DSH_HOME 默认 `~/.dsh`；可用上面的 `dir` 配置整体挪走。

## 自测

```bash
node test/smoke.mjs
```

会跑一遍 mock 注册、用 dsh 真实的 JSON Schema 校验器校验工具 schema，并验证记录/检索。默认从 `/tmp/ex` 找 dsh 内部包副本，可用 `DSH_TOOLS=/path/to/dsh-tools/lib/index.js` 覆盖。

## License

MIT
