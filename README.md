# dsh-thinking-trail

给 DeepSeek Harness 用的「思考路径」插件：AI 把每个任务的**目标 → 路线 → 决策 → 教训**留在本地，下次遇到同类任务先查旧路，而不是从零找路。

- 跨会话：路径存在 `~/.dsh/thinking-trails/*.jsonl`，不同对话共享同一份。
- 人可读：纯 JSONL 明文，可以直接 grep / 打开看 / 提交到仓库。
- 零依赖：只用 Node 标准库，不 import 任何 `@deepseek-ai/*` 内部包，方便单独复制、开源、改造。
- 两个工具：
  - `record_thought`：任务收尾时写一条（`goal`、`route` 必填，`decisions`/`lessons`/`tags` 可选）。
  - `recall_thoughts`：按关键词检索历史路径；不带关键词时返回最近几条。
- 一条系统提示（order 150）：用用户的语言思考；非简单任务先给路线再执行；开工前先查旧路；收尾存一条。

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

## 自测

```bash
node test/smoke.mjs
```

会跑一遍 mock 注册、用 dsh 真实的 JSON Schema 校验器校验工具 schema，并验证记录/检索。默认从 `/tmp/ex` 找 dsh 内部包副本，可用 `DSH_TOOLS=/path/to/dsh-tools/lib/index.js` 覆盖。

## License

MIT
