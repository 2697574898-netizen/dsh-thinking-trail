# 可复用的现成能力清单

调研时间：2026-10-26。**联网抓取受限**（`web_fetch` 对 npm / GitHub 均被拦），外部插件只凭搜索结果标题确认存在，**未实机验证**；装之前请先看作者 README。

## 一、本机已装（无需重复造）

从当前 profile 的 `bundles` 读出来的：

| 能力 | 承载插件 | 说明 |
| --- | --- | --- |
| 识图 / 看图 | `@deepseek-ai/dsh-vision-router` | 图片路由与描述，已启用 |
| 出图 / 改图 | `@deepseek-ai/dsh-image-gen` | 生成与编辑图片，已启用 |
| 技能管理 | `@michengai/dsh-skills-manager` | 本地 skill 的增删改查 |
| 上下文压缩 | `dsh-context`（billion-context） | 长会话自动折叠 |
| 读文件缓存 | `dsh-readcache` | 重复读文件不重付 token |
| 回滚 | `dsh-rewind-plugin` | 会话/文件回滚 |
| 思考档位 | `dsh-thinking-levels` | 调整推理强度 |
| 记忆技能 | `engramory` | 文件式长期记忆（skill，非插件） |
| 搜索 | 内置 `web_search` / `web_fetch` | 抓取信息的第一选择 |

**结论：识图、出图、技能管理都已具备，不需要再装同类插件。**

## 二、外部插件（按需，非必需）

| 插件 | 方向 | 和我们的关系 |
| --- | --- | --- |
| `dsh-workspace-recollection` | DSH 工作区内跨会话记忆 | 和 thinking-trail 方向重叠；它偏「记忆存储」，我们偏「任务路径 + 任务日志 + 调度去重」。装了会重复，二选一。 |
| `dsh-mnemosyne` / `@lanbaolu/dsh-mneme` / `dsh-memgas` | 记忆类 | 同上，语义检索型记忆。想要「按意思找」而不是「按词找」时再考虑。 |
| `dsh-goodmemory` | skills 插件 | 和已装的 skills-manager 功能重叠。 |
| `dsh-plugin-deepseek-search` | DeepSeek 官方 Search / Fetch API 工具 | 需要 DeepSeek key；内置 `web_search` 已够用，除非需要官方 API 的配额与返回格式。 |
| `dsh-kit` | 插件集合 + 安装器 | 一次性装多个插件时省事，但会引入版本锁定，单插件场景不必。 |
| `dsh-plugin-night-owl` | 主题 | 与本插件无关。 |

## 三、结论

1. **不重复造**：识图、出图、技能、搜索、压缩都有了，thinking-trail 只补「路径留存 + 任务日志 + 调度去重」这一块。
2. **不急着装外部记忆插件**：它们和 thinking-trail 的路径库重叠，先用手上这套跑一段时间，真需要语义检索再换。
3. 新插件优先查一遍现有 `bundles` 和内置包（`@deepseek-ai/dsh-tool-*`），能复用就不写。
