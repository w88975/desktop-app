# 10 · 数据模型与持久化

> 基于上游 craft-agents-oss v0.11.4 · 核验于 2026-08-08

**没有数据库。** 全部是文件系统上的 JSON / JSONL / Markdown。这对二次开发是好事：所有状态都能直接 `cat` 出来看，出问题时不必猜。

先看 [01-overview 的术语表](01-overview.md#术语表)确认概念，这一篇讲它们落在磁盘上长什么样。

## 目录全景

```
~/.craft-agent/                          ← CONFIG_DIR，可用 CRAFT_CONFIG_DIR 覆盖
│
├── config.json                          全局配置：workspace 列表、llmConnections
├── config-defaults.json                 默认值模板
├── config.json.bak-YYYY-MM-DD           自动备份（每日）
├── preferences.json                     用户偏好，含 uiLanguage
├── credentials.enc                      加密凭据（LLM key、source token）
├── drafts.json                          未发送草稿
├── window-state.json                    窗口位置尺寸
├── permissions/                         权限规则
├── themes/                              主题
├── tool-icons/  docs/  release-notes/
├── logs/                                messaging-gateway.log 等
│
└── workspaces/{slug}/                   ← 一个 workspace 一个目录
    ├── config.json                      workspace 配置与默认值
    ├── events.jsonl                     事件流（自动化引擎消费）
    ├── views.json                       会话列表视图配置
    ├── labels/                          标签树
    ├── statuses/                        自定义状态
    ├── skills/{slug}/SKILL.md           workspace 级 skill
    ├── projects/{slug}/                 config.json + assets/
    ├── sources/{slug}/                  config.json + guide.md
    └── sessions/{sessionId}/            ← 一个会话一个目录
        ├── session.jsonl                会话主体（见下）
        ├── plans/                       Plan 模式产出的计划（Markdown）
        ├── attachments/                 用户上传的附件
        ├── data/                        工具产出的数据文件
        ├── downloads/                   会话内下载的文件
        ├── long_responses/              超长工具响应的落盘
        └── api-error.json               最近一次 API 错误（排查用）
```

路径全部通过 `packages/shared/src/sessions/storage.ts` 里的 `getSessionPath()` / `getSessionAttachmentsPath()` / `getSessionPlansPath()` 等函数取，**不要手拼**。

## 会话持久化：`session.jsonl`

**第一行是 header，之后每行一条消息。**

### 第一行：`SessionHeader`

```
id, workspaceRootPath, sdkSessionId, sdkCwd, createdAt, lastUsedAt, lastMessageAt,
name, isFlagged, lastReadMessageId, enabledSourceSlugs, permissionMode,
previousPermissionMode, sessionStatus, labels, hasUnread, model, llmConnection,
connectionLocked, thinkingLevel, sharedUrl, sharedId, messageCount,
lastMessageRole, preview, tokenUsage, lastFinalMessageId
```

几个值得注意的：

| 字段 | 说明 |
|---|---|
| `workspaceRootPath` | **存的是可移植路径**（`~/.craft-agent/...` 而不是绝对路径），会话导出/跨机迁移靠它 |
| `sdkSessionId` | 后端 SDK 侧的会话 id，首条消息后才有；恢复会话靠它 |
| `sdkCwd` | 后端的工作目录。能不能改由 `canUpdateSdkCwd()` 判定 |
| `labels` | 字符串数组，元素是裸 id 或 `id::value` 形式 |
| `lastUsedAt` vs `lastMessageAt` | 分开存，后者用于稳定的日期分组（重启后不漂） |
| `hasUnread` | NEW 徽标的**唯一真源**，不要从其它字段推 |
| `preview` / `messageCount` / `tokenUsage` | 列表页要用的冗余字段，避免读全文件 |

### 后续每行：`StoredMessage`

实际出现的键：

```
id, role, content, timestamp, attachments, badges,
type, isIntermediate, turnId,
toolName, toolUseId, toolInput, toolStatus, toolIntent,
toolDisplayName, toolDisplayMeta, toolResult, isError
```

`role` 三种：`user` / `assistant` / `tool`。

### 为什么是 JSONL

- **追加写**：新消息只 append 一行，不重写整个文件
- **只读 header 就能列表**：`readSessionHeader()` 只读第一行，列 1000 个会话不需要解析全部内容
- **崩溃安全**：写坏最多丢最后一行

相关 API 在 `packages/shared/src/sessions/jsonl.ts`：

| 函数 | 用途 |
|---|---|
| `readSessionHeader()` | 只读第一行 —— 列表场景用这个 |
| `readSessionMessages()` | 只读消息，跳过 header |
| `readSessionJsonl()` / `writeSessionJsonl()` | 全量读写 |
| `makeSessionPathPortable()` / `expandSessionPath()` | 绝对路径 ↔ 可移植路径互转 |

写入经过 `persistence-queue.ts` 排队，避免并发写打架。

### 会话 ID 与 slug

`generateSessionId()` 生成形如 `260803-bright-moon` 的 id —— 日期前缀 + 两个词。词表在 `sessions/word-lists.ts`，`slug-generator.ts` 负责去重。

好处是人能读、目录名能排序。**改这个规则要考虑已有数据的兼容性。**

## 会话列表与筛选

`storage.ts` 提供一组现成的查询：

```ts
listSessions()            // 全部（只读 header）
listInboxSessions()       // 收件箱
listArchivedSessions()    // 已归档
listCompletedSessions()   // 已完成
listFlaggedSessions()     // 已标记
listActiveSessions()      // 活跃
deleteOldArchivedSessions(retentionDays)   // 按保留期清理
```

### Label 筛选只有一个实现

> **`matchesLabelFilter`（`labels/filter.ts`）是「会话是否匹配某个标签筛选」的唯一实现。** 它处理子孙标签、`__all__` 通配、可选的 `projectId` 作用域。
>
> 会话列表、AppShell 的筛选集合、NavigationContext 的自动选中**全部走它**。不要在功能代码里手写标签匹配 —— 手写的那份必然与它行为不一致。

这个函数是 browser-safe 的（不碰 Node API），所以渲染进程可以直接用。

## Label / Status / View

| 概念 | 存哪 | 关键点 |
|---|---|---|
| **Label** | `workspaces/{ws}/labels/` | 树形结构，可带值（`valueType`）。有自动打标规则 `AutoLabelRule` |
| **Status** | `workspaces/{ws}/statuses/` | 可自定义，但有固定状态与默认状态的业务约束（`statuses/crud.ts` 里强制） |
| **View** | `workspaces/{ws}/views.json` | 会话列表的筛选视图。`views/evaluator.ts` 把配置编译成 `CompiledView` 再求值 |

### Task 占用的保留 Label

Task 流程给每个任务的整个家族（orchestrator + 子任务）打一个 ITEM 标签 —— 根标签 `Task` 下的子标签，名为 `TASK-<slug>-<N>`。

规则很细且容易踩，完整描述在 `packages/shared/CLAUDE.md`。这里只留三条结论：

1. **只能通过 `SessionManager.applyTaskLabel` 铸造/继承**，不要手工建
2. **只能通过 `findTaskLabel` / `findTaskItemLabelId` / `resolveTaskScopeLabelId` 解析**
3. **永远不要假设字面 id** —— slug 会因撞名而偏移，用解析出来的 id（`TaskCreateResult.taskLabelId`）

## Task

`workspaces/{ws}/.../task.yaml` 描述一个 DAG。schema 在 `packages/shared/src/tasks/schema.ts`（zod）。

封闭枚举（改之前先确认没有下游依赖）：

| 常量 | 取值 |
|---|---|
| `NODE_KINDS` | 节点类型 |
| `AGGREGATE_MODES` | `concat` / `vote` / `majority` / `filter` / `synthesize` |
| `TRIGGER_RULES` | `all_success` / `none_failed_min_one_success` / `one_success` / `all_done` |
| `PARAM_TYPES` | `string` / `number` / `boolean` / `enum` / `json` / `text` |
| `OUTPUT_KINDS` | `param` / `artifact` |
| `RETRY_WHEN` | `error` / `empty` / `invalid` |
| `CACHE_MODES` | `pure` / `off` |
| `TASK_RUNNERS` | `conduct` / `orchestrate` |
| `PERMISSION_MODES` | `safe` / `ask` / `allow-all` |

### 任务创建有唯一入口

> `createTaskFromSpec` / `finishTaskOrchestrator`（`packages/server-core/src/tasks/create-task.ts`）实现「在看板上建任务但不运行它」。
>
> **`tasks:create` RPC 和 Agent 侧的 `create_task` 工具都调它，不要重新实现这个流程。**

运行则**只能**走 `tasks:run` / `TaskRunner`。

## Automation

`workspaces/{ws}/` 下的自动化配置，schema 在 `packages/shared/src/automations/schemas.ts`。

- **触发**：事件（label 变化、工具调用、会话状态变化等，见 `VALID_EVENTS`）或 cron（`cron-matcher.ts`）
- **条件**：`AutomationConditionSchema` 是递归结构（`z.lazy`），支持时间条件与状态条件的组合
- **动作**：`PromptActionSchema`（创建会话跑一个 prompt）或 `WebhookActionSchema`
- **历史**：`history-store.ts`；失败重试 `retry-scheduler.ts`

> **条件匹配统一走 `src/automations/utils.ts` 里的 `matcherMatches*` 适配器**，不要在功能代码里直接做原始匹配 —— 否则各处的条件门控会不一致。

`DEPRECATED_EVENT_ALIASES` 保留了老事件名的映射，改事件名时要往这里加。

## Workspace 与 Project

**Workspace** 是顶层容器，配置在 `workspaces/{slug}/config.json`：

```ts
{
  id, name, slug,
  defaults: {
    model, defaultLlmConnection, enabledSourceSlugs,
    permissionMode, cyclablePermissionModes,
    workingDirectory, thinkingLevel, colorTheme,
  },
  localMcpServers: { enabled },   // 是否允许 stdio MCP 子进程
  createdAt,
}
```

`localMcpServers.enabled` 的解析优先级：环境变量 `CRAFT_LOCAL_MCP_ENABLED` > workspace 配置 > 默认 `true`。**私有化部署时这是个安全开关**。

**Project** 是 workspace 内的子集合，`{workspaceRootPath}/projects/{slug}/`：

```ts
{
  id, slug, name, description,
  kanbanColumns: [{ id, name, dropStatusId?, color? }],
  // ...
}
```

`kanbanColumns` 一旦定义，就是该项目看板的**完整有序列**。`id` 是稳定 slug，删除后不复用；内置种子沿用 `todo` / `in-progress` / `done` 以便已有的卡片位置能存活。会话通过 `projectId` 绑定到 project。

## 数据迁移

配置结构变更走 `packages/shared/src/config/` 下的迁移机制（有 `storage-migrations` 与 `storage-startup-migration` 两组测试）。

改任何持久化结构前问三个问题：

1. 老数据读进来会怎样？—— 缺字段应该有默认值，不能崩
2. 需要写迁移吗？—— 结构变形（改名、拆分、类型变化）需要；纯新增可选字段不需要
3. 新版写出的数据，老版本读得了吗？—— 用户可能回滚

> `~/.craft-agent/config.json.bak-YYYY-MM-DD` 是自动备份，调试迁移时可以拿它对照。

## 排查清单

| 症状 | 看哪里 |
|---|---|
| 会话列表慢 | 是不是用了 `readSessionJsonl()` 而不是 `readSessionHeader()` |
| 会话导出到别的机器后路径错 | 可移植路径转换（`makeSessionPathPortable`）没走 |
| 标签筛选结果不一致 | 有地方手写了标签匹配，没走 `matchesLabelFilter` |
| Task 标签错乱 | 假设了字面 id，没用解析函数 |
| 新增的连接字段保存后丢失 | `updateLlmConnection` 的白名单（见 [08](08-models-providers.md)） |
| 自动化条件时灵时不灵 | 没走 `matcherMatches*` 适配器 |
| 升级后老数据打不开 | 缺迁移；拿 `config.json.bak-*` 对照 |
