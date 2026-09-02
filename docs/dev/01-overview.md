# 01 · 项目全景

> 基于上游 craft-agents-oss v0.11.4 · 核验于 2026-08-08

## 这是什么

aidp-desktop 是 AI Doctor Platform 的桌面客户端，基于开源项目 **craft-agents-oss**（Apache-2.0）二次开发。

上游 craft-agents-oss 是 craft.do 团队做的**通用 Agent 工作台**。它不是聊天框，也不是编程助手，而是一个「多会话收件箱 + 可任意接入外部系统」的产品形态：

- 左边是会话列表，像收件箱一样有状态流转（Todo → In Progress → Needs Review → Done）、标签、归档
- 中间是对话，流式输出、工具调用可视化、权限询问内联展示
- 用自然语言接入外部系统 —— 「把 Linear 加进来」，Agent 自己去找 API 文档、配凭据、生成配置
- 同一套代码跑三端：Electron 桌面应用、浏览器 WebUI、只读分享页

对我们的意义是：**这是一个已经打磨过的 Agent 产品外壳**，二次开发的重点不是从零搭，而是把它的模型接入、工具接入、UI 换成我们自己的。

## 与上游的关系

| 项 | 值 |
|---|---|
| 上游仓库 | `https://github.com/craft-ai-agents/craft-agents-oss.git`（已配为 git remote `upstream`） |
| 起始快照 | v0.11.4，上游提交 `50ffa143`，2026-08-06 |
| 我方仓库 | `gitlab.i.huaxisy.com/.../frontend/desktop-app`（remote `origin`） |
| 同步方式 | **不 merge，只人工比对移植** |
| 许可 | Apache-2.0，`LICENSE` / `NOTICE` / `TRADEMARK.md` 必须保留 |

上游是「一个版本 = 一个压缩提交」，没有可 cherry-pick 的粒度，且我们的 `develop` 与上游历史无共同祖先 —— `git merge upstream/main` 只会产生大量无意义冲突，**不要执行**。完整的同步流程见 [upstream-sync](../upstream-sync.md)。

这条约束反过来决定了我们的写码方式：**每一次修改上游文件，都是未来同步时的一笔债**。所以 [04-conventions](04-conventions.md) 里那套「优先新增、必要时打标记」的约定不是形式主义，请务必先读。

## 术语表

这些词在本项目里都有精确含义，且与中文直觉有偏差。**文档和代码里一律使用英文原词**，不译。

| 术语 | 是什么 | 别理解成 |
|---|---|---|
| **Workspace** | 最顶层的组织单位。所有东西都归属于某个 workspace：sources、sessions、skills、labels、statuses、projects。物理上是 `~/.craft-agent/workspaces/{slug}/` 一个目录。一个 workspace 可以「属于」一台远程服务器 | 不是 VS Code 的工作区，也不是「团队/租户」——它是本地目录 |
| **Session** | 一次对话。有完整的消息历史、状态、标签、权限模式、绑定的 LLM 连接。持久化为 JSONL | 不是 HTTP session，也不是「登录会话」 |
| **Source** | 外部系统的接入点，三种类型：`mcp`（MCP 服务器）、`api`（REST API）、`local`（本地文件系统）。带凭据、带使用说明（`guide.md`） | 不是「数据源」那么窄 —— 它既供数据也供操作能力，本质是「一组工具 + 一份说明书 + 一套凭据」 |
| **Skill** | 一段专门的指令集，用 `SKILL.md`（YAML frontmatter + Markdown）描述。可以声明触发的文件模式、自动放行的工具、需要的 sources。分 global / workspace / project 三级 | 不是「技能点」，也不是代码插件 —— 它是给模型读的提示词包 |
| **Project** | workspace 内的子集合，把一组 session、一个工作目录、一批共享资产（PDF/图片）绑在一起，可自定义看板列。session 通过 `projectId` 绑定 | **不是「项目」**（那是整个仓库）。它更接近「专题文件夹」 |
| **Task** | 可编排的任务，`task.yaml` 描述 DAG，由 orchestrator session 驱动子会话执行。有专门的保留 label 体系 | 不是 TODO 项，也不是 Agent 内部的 `Task` 工具（那是子 Agent 派生） |
| **Automation** | 事件驱动的自动化规则：label 变化、定时（cron）、工具调用等事件触发，自动创建 session | 不是 CI/CD |
| **Label** | 会话标签，树形结构，可带值（`valueType`）。Task 流程会占用一批保留 label | — |
| **Status** | 会话的工作流状态，可自定义（内置 Todo / In Progress / Needs Review / Done） | 不是运行状态（那叫 session state） |
| **View** | 会话列表的筛选视图配置 | — |
| **Permission Mode** | 固定三档：`safe`（Explore，只读）、`ask`（Ask to Edit，默认，逐次询问）、`allow-all`（Auto，全自动）。SHIFT+TAB 循环 | 这三个值是硬约束，不要新增 |
| **LLM Connection** | 一个模型接入配置：provider 类型、认证方式、模型列表、自定义端点等。一个 workspace 可以配多个，按 session 选用 | 不是「连接池」 |
| **Backend / Provider** | Agent 的执行后端，目前两个：`anthropic`（Claude Agent SDK）和 `pi`（Pi SDK，跑在子进程）。绝大多数第三方模型都走 `pi` | 见 [07-agent-core](07-agent-core.md) |

## 能力全景

以下是上游已经实现、我们直接继承的能力。做二次开发前先确认「是不是已经有了」。

**会话与工作流**
多会话收件箱、状态流转、标签树、归档、Flag、AI 自动生成标题、会话分享（只读页）、跨 workspace 转移会话、Kanban 看板视图。

**Agent 能力**
流式输出、工具调用可视化、三档权限模式与自定义规则、后台任务与进度追踪、Plan 模式、思考等级（thinking level）、多文件 diff 查看、会话中途插话（steer / queue 两种策略）、子 Agent 派生、内置浏览器面板（CDP 驱动）。

**接入能力**
MCP 服务器（HTTP 与本地 stdio 两种）、REST API（内置 Google / Slack / Microsoft 的 OAuth 流程）、本地文件系统、OpenAPI 规范导入、从 Claude Code 迁移 skills 与 MCP 配置。

**模型接入**
Anthropic（API Key / Claude Max OAuth）、Google AI Studio、ChatGPT Plus（Codex OAuth）、GitHub Copilot OAuth、OpenAI API、AWS Bedrock、任意 OpenAI 兼容的自建端点。

**多端与部署**
Electron 桌面应用、headless 服务端（可 Docker 部署）、浏览器 WebUI、只读分享页 viewer、CLI 客户端。桌面应用可连接远程服务器上的 workspace。

**其它**
自动化规则引擎（事件 / cron 触发）、消息网关（**Lark / 飞书、Telegram、WhatsApp** 接入）、级联主题系统、7 种语言的 i18n、文档处理工具链（PDF / Office / 图片，基于 Python + uv）。

## 上游英文文档可信度

仓库里的英文 `README.md` 全部是上游原文，**不要修改**（改了会让上游 diff 满屏噪音）。但它们与当前代码有偏差，下表是逐条核验的结果。

### `README.md`（根目录，25KB）

| 章节 | 可信度 | 说明 |
|---|---|---|
| Why / Things that just work / Features | ✅ 可信 | 产品层描述，仍然准确 |
| Installation | ⚠️ 部分 | 一键安装脚本指向上游发布渠道，我们用不上；Build from Source 部分可信 |
| Remote Server (Headless) | ✅ 可信 | 环境变量与启动方式与 `packages/server/src/index.ts` 一致 |
| CLI Client | ✅ 可信 | 与 `docs/cli.md` 互补 |
| Architecture | ⚠️ 粗略 | 只有分层示意，不算错，但远不足以支撑开发。以 [05-architecture](05-architecture.md) 为准 |
| Supported LLM Providers | ✅ 可信 | 与 `packages/shared/src/config/models-pi.ts` 一致 |
| Google OAuth Setup | ✅ 可信 | 操作步骤仍然有效，但凭据要换成我们自己的 |

### `apps/electron/README.md`

| 章节 | 可信度 | 说明 |
|---|---|---|
| Architecture 目录树 | ❌ **已失效** | 列出的 `main/ipc.ts`、`main/sessions.ts`、`main/agent-service.ts`、`main/sources-service.ts`、`preload/index.ts`、`renderer/hooks/useAgentState.ts` **全部不存在**。实际结构：IPC 在 `main/handlers/`，session 管理已上移到 `packages/server-core/src/sessions/SessionManager.ts`，preload 是 `preload/bootstrap.ts` |
| 1. SDK Path Resolution | ✅ 可信 | 与 `agent/backend/internal/runtime-resolver.ts` 一致 |
| 2. Authentication Environment Setup | ⚠️ 过时 | 认证已收敛到 LLM Connection + `credentials/`，不再是直接写 `process.env` |
| 3. AgentEvent Type Mismatches | ⚠️ 部分过时 | `text_delta.text`、`error.message` 仍正确；但「`tool_result` 只有 `toolUseId`」已不成立 —— 现在有可选的 `toolName` 字段 |
| 4. CraftAgent Constructor | ❌ 已失效 | 不应再直接 `new CraftAgent(...)`。走 `createAgent()` / `createBackend()` 工厂，见 [07-agent-core](07-agent-core.md) |
| 5. esbuild Configuration | ❌ 已失效 | 「只外置 electron」不成立。实际外置的还有 `@anthropic-ai/claude-agent-sdk`、`koffi`、`link-preview-js`、`qrcode-terminal`、`jimp`，见 `scripts/electron-build-main.ts` |
| Navigation System | ✅ 可信 | `renderer/contexts/NavigationContext.tsx`、`renderer/lib/navigate.ts`、`shared/routes.ts` 都在 |
| Environment Variables / 1Password | ❌ 不适用 | 依赖 Craft 私有的 1Password 保险库 |

### 包级文档

| 文件 | 可信度 |
|---|---|
| `packages/shared/CLAUDE.md` | ✅ **高价值**，203 行，维护得很好。大量踩坑记录（mid-stream 行为、MCP 代理工具名、Pi 缓存前缀、i18n 全套约定）本文档不复述，直接引用 |
| `packages/core/CLAUDE.md`、`packages/core/README.md` | ✅ 可信，篇幅小 |
| `packages/server-core/README.md` | ⚠️ 只有 18 行，信息量极低 |

## 官方在线文档

Craft 维护了一套面向**最终用户**的在线文档：<https://docs-aiadp.hxsyai.com/docs>，共 13 个分区 44 页。全量索引在 <https://docs-aiadp.hxsyai.com/docs/llms.txt>（纯文本，适合直接喂给 AI 助手）。

它与本套文档的关系：

| | 官方在线文档 | `docs/dev/`（本套） |
|---|---|---|
| 视角 | **用户**：这个功能怎么用 | **开发者**：这段代码怎么组织、怎么改 |
| 典型内容 | 「如何连接飞书机器人」的界面操作步骤 | 消息网关的适配器接口与三个实现的能力差异 |
| 是否覆盖内部实现 | 否 | 是 |

**两者互补，遇到「某个功能怎么用」优先查官方文档**，本套文档不复述用户操作步骤。

### ⚠️ 官方文档描述的是「在售产品」，不等于我们 fork 的 v0.11.4

这是使用官方文档时最需要警惕的一点 —— 官方文档跟随 Craft 的**发布版本**，而我们停在开源快照 v0.11.4，两者会漂移。

已实测到的偏差（截至 2026-08）：

| 官方文档中的内容 | v0.11.4 源码实测 |
|---|---|
| 环境变量 `CRAFT_ANTHROPIC_API_KEY` | ❌ **源码中不存在** |
| 环境变量 `CRAFT_CLAUDE_OAUTH_TOKEN` | ❌ **源码中不存在** |
| API Reference / OpenAPI 规范页 | ⚠️ 是 Mintlify 的示例占位（Plant Store 沙箱），**不是真实 API**，别去对接 |

**判定方法**：官方文档里看到的任何键名、环境变量、字段，落地前先 `grep` 一遍我们的源码确认存在。

### 官方文档分区速查

| 分区 | 页数 | 本套文档的对应位置 |
|---|---|---|
| Getting Started | 2 | [03-getting-started](03-getting-started.md)（开发环境，非用户安装） |
| Core Concepts | 5 | 术语表（本篇）、[09](09-tools-sources-mcp.md) 权限、[10](10-sessions-data.md) 数据模型 |
| Sources | 7 | [09-tools-sources-mcp](09-tools-sources-mcp.md)（代码结构，非接入操作） |
| Skills | 1 | [09-tools-sources-mcp](09-tools-sources-mcp.md) |
| Statuses / Labels / Automations | 5 | [10-sessions-data](10-sessions-data.md) |
| Browser | 3 | [17-browser](17-browser.md) |
| Messaging | 4 | [16-messaging](16-messaging.md) |
| Customisation | 3 | [11-ui](11-ui.md) 外观定制一节 |
| Go Further | 9 | deeplinks 见 [13](13-branding-decoupling.md)；tasks/workspaces/kanban 见 [10](10-sessions-data.md)；document-tools 见 [09](09-tools-sources-mcp.md)；performance 相关开关见 [18](18-config-reference.md)；rich-output / sharing 仍以官方文档为准 |
| Reference | 8 | [18-config-reference](18-config-reference.md) 全量字段表；LLM 连接见 [08](08-models-providers.md)，服务端环境变量见 [12](12-build-deploy.md) |
| Server | 2 | [12-build-deploy](12-build-deploy.md) |
| API Reference | 1 | 示例占位，无内容 |

对照表列的是**代码侧**的对应位置。功能的**使用方法**一律以官方文档为准，本套文档不复述操作步骤。

## 下一步

- 想立刻跑起来 → [03-getting-started](03-getting-started.md)
- 准备写代码 → 先读 [04-conventions](04-conventions.md)
- 想先建立整体认知 → [05-architecture](05-architecture.md)
