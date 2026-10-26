# dsh-thinking-trail

给 DeepSeek Harness 用的「思考路径」插件：AI 把每个任务的**目标 → 路线 → 决策 → 教训**留在本地，下次遇到同类任务先查旧路，而不是从零找路。

- 跨会话：路径存在 `~/.dsh/thinking-trails/*.jsonl`，不同对话共享同一份。
- 人可读：纯 JSONL 明文，可以直接 grep / 打开看 / 提交到仓库。
- 零依赖：只用 Node 标准库，不 import 任何 `@deepseek-ai/*` 内部包，方便单独复制、开源、改造。
- 七个工具，四件事：
  - **思考路径**：`record_thought` 任务收尾写一条（`goal`、`route` 必填，`decisions`/`lessons`/`tags` 可选）；`recall_thoughts` 按关键词检索，不带关键词返回最近几条。
  - **任务日志**：`open_task_log` 建一份按任务的 md（路径 / 经验 / 不足 / 进步 / 思考路径）；`append_task_log` 往对应小节追加，建好会把**完整路径告诉你**。每次任务开始前 AI 会先问你要不要记。`record_thought` 收尾时也会顺手把路径写进当前日志。
  - **能力核对**：`check_capability` 列出「这次任务需要的能力 → 本机有没有」：扫已装 skill（`~/.dsh/skills`）和已装插件（profile `bundles`），缺的会明说。
  - **会话素材调度**：`link_material` 把从别的会话调来的内容登记进日志表格，**同 session_id + seq 自动判重**；`list_material` 列出已登记的，避免重复搬运。
- 一条系统提示（order 150）：
  - 需求精化（内部步骤，不回显）：收到需求先在心里拆成「目标 / 必须满足 / 不能碰 / 怎么算做完」，直接执行；不回显拆解、不挤牙膏式追问；一次工具调用能拿全的不分两次。用用户的语言思考；非简单任务先给路线再执行；开工前先查旧路；收尾存一条；`#关键词` 表示从旧会话调素材，先检索、由用户挑、只读确认过的、每读一条就登记去重。

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
    askLog: true                   # 每次任务前问要不要记日志；false = 只在你说「记日志」时建
```

## 改完代码怎么生效

**必须重启应用**。实测当前版本 dsh 的 `hmr` 只热载 profile 配置（`cordis.patch.yml`），对模块代码无效：
- `root: ["node_modules/..."]` 相对路径会解析到 dsh-hmr 包自己的目录（`baseDir` 取的是 `ctx.baseUrl`），因此永远 watch 不到；
- 换成绝对路径、或开 `ignored: []`，目录虽然对上，但 `profileModules()` 只认能被 Loader 匹配的 `file:` 模块，改文件后不触发 reload；
- 用 `disabled: true/false` 强制重建也不生效。

所以流程是：改 `lib/index.js` → `node test/smoke.mjs` → 退出应用重开。重启后 `~/.dsh/thinking-trails/state.json` 会盖新的 `appliedAt`，可用来确认加载成功；加载失败会写 `apply-error.txt`。

## 配置文件位置

- 路径库：`<DSH_HOME>/thinking-trails/trails.jsonl`（2 MB 自动轮转）
- 任务日志：`<DSH_HOME>/thinking-trails/logs/YYYY-MM-DD-<标题>.md`
- 当前日志指针：`<DSH_HOME>/thinking-trails/current-log.json`（`record_thought` 靠它找日志）
- DSH_HOME 默认 `~/.dsh`；可用上面的 `dir` 配置整体挪走。

## 自测

```bash
node test/smoke.mjs
```

会跑一遍 mock 注册、用 dsh 真实的 JSON Schema 校验器校验工具 schema，并验证记录/检索。默认从 `/tmp/ex` 找 dsh 内部包副本，可用 `DSH_TOOLS=/path/to/dsh-tools/lib/index.js` 覆盖。

## License

MIT
