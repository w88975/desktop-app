# 文档索引

> 基于上游 craft-agents-oss v0.11.4 · 核验于 2026-08-08

本目录是 aidp-desktop 的项目文档。`dev/` 下是面向二次开发的中文文档，其余为专题文档。

## 二次开发文档（`dev/`）

| 文档 | 内容 | 什么时候看 |
|---|---|---|
| [01-overview](dev/01-overview.md) | 项目定位、与上游的关系、能力全景、**术语表**、上游英文文档可信度表 | 入职第一篇 |
| [02-repo-map](dev/02-repo-map.md) | 14 个 workspace 包逐个职责、依赖方向、边界红线 | 找不到代码在哪时 |
| [03-getting-started](dev/03-getting-started.md) | 环境准备、五种开发回路、日志与数据目录 | 第一次跑项目 |
| [04-conventions](dev/04-conventions.md) | ⚠️**必读** — 上游同步友好的改动约定、`[aidp]` 标记、质量门禁现状、提交前清单 | 写第一行代码之前 |
| [05-architecture](dev/05-architecture.md) | 进程与包依赖总图、三进程模型、桌面端/服务端/浏览器端如何复用同一套逻辑 | 建立整体心智模型 |
| [06-rpc](dev/06-rpc.md) | WS RPC 协议全貌、信道分类、新增 RPC 方法的完整改动面 | 要加后端方法时 |
| [07-agent-core](dev/07-agent-core.md) | 双后端架构、pi Agent、事件归一、一次对话的完整生命周期 | 碰 Agent 行为时 |
| [08-models-providers](dev/08-models-providers.md) | LlmConnection、三个 providerType、Pi 模型目录、接新供应商的三条路 | 要接模型时 |
| [09-tools-sources-mcp](dev/09-tools-sources-mcp.md) | 工具的三个来源、session 工具注册表、Source、MCP 代理、权限系统 | 要加工具或接外部系统时 |
| [10-sessions-data](dev/10-sessions-data.md) | 目录全景、JSONL 持久化、Label/Status/View/Task/Automation 数据模型 | 碰持久化时 |
| [11-ui](dev/11-ui.md) | 渲染层结构、状态分层、event-processor、路由、设置页、i18n | 改 UI 时 |
| [12-build-deploy](dev/12-build-deploy.md) | 四条构建产线、打包签名、headless 部署、Docker、自动更新、Sentry | 要发版或部署时 |
| [13-branding-decoupling](dev/13-branding-decoupling.md) | Craft 强绑定点逐条清单 + 同步影响与数据兼容性评估 | 做换皮或私有化时 |
| **教程** | [加一个设置项](dev/14-walkthroughs/add-setting.md) · [接入自建模型端点](dev/14-walkthroughs/add-model-endpoint.md) · [加一个业务工具](dev/14-walkthroughs/add-tool.md) | 从「读懂」到「能改」 |
| [15-gotchas](dev/15-gotchas.md) | 踩坑集锦，按「症状 → 根因」组织 | 出问题时先查这里 |

## 专题文档

| 文档 | 内容 |
|---|---|
| [upstream-sync](upstream-sync.md) | 如何拉取、对比、移植上游 craft-agents-oss 的更新 |
| [cli](cli.md) | CLI 客户端用法 |

## 阅读路线

### 第一天：跑起来 + 知道红线

1. [01-overview](dev/01-overview.md) 的「这是什么」和「术语表」两节 —— 术语不过关，后面每一句话都会误读
2. [03-getting-started](dev/03-getting-started.md) 全文，把项目跑起来
3. [04-conventions](dev/04-conventions.md) 全文 —— **这一篇不读完不要开始写代码**

### 第一周：建立心智模型

4. [02-repo-map](dev/02-repo-map.md) —— 快速过一遍，不必记住，知道有这张表可查即可
5. [05-architecture](dev/05-architecture.md) —— 三张图里的第一张，理解为什么是这个结构
6. [06-rpc](dev/06-rpc.md) —— 本项目最反直觉的一层，值得完整读
7. [07-agent-core](dev/07-agent-core.md) —— Agent 是产品核心，双后端是最容易踩坑的地方

### 之后：按方向分叉

| 你要做的事 | 接着读 |
|---|---|
| 改 UI / 加页面 / 换视觉 | [11-ui](dev/11-ui.md) → [13-branding-decoupling](dev/13-branding-decoupling.md) → 教程[加一个设置项](dev/14-walkthroughs/add-setting.md) |
| 接自有模型 / 私有 LLM 网关 | [07-agent-core](dev/07-agent-core.md) → [08-models-providers](dev/08-models-providers.md) → 教程[接入自建模型端点](dev/14-walkthroughs/add-model-endpoint.md) |
| 加业务工具 / 接内部系统 | [09-tools-sources-mcp](dev/09-tools-sources-mcp.md) → 教程[加一个业务工具](dev/14-walkthroughs/add-tool.md) |
| 私有化部署 / 平台化 | [06-rpc](dev/06-rpc.md) → [12-build-deploy](dev/12-build-deploy.md) → [13-branding-decoupling](dev/13-branding-decoupling.md) |

## 与其它文档的关系

本仓库有三类文档，受众和粒度不同，不要混用：

| 位置 | 受众 | 性质 |
|---|---|---|
| `docs/dev/**` | 人 | 心智模型 —— 是什么、为什么、在哪 |
| `.claude/skills/**` | AI 助手 | 操作手册 —— 动手时的短指令 |
| `CLAUDE.md`、`packages/*/CLAUDE.md` | AI 助手 | 红线与约束，每次会话加载 |
| `README.md`、`apps/*/README.md`、`packages/*/README.md` | — | **上游英文原文，不要修改**，可信度见 [01-overview](dev/01-overview.md#上游英文文档可信度) |

## 维护约定

- 每篇文档顶部的 `> 基于上游 vX · 核验于 YYYY-MM-DD` 表明该篇最后一次对着代码核验的时间。改动涉及某篇内容时，更新正文并刷新这一行。
- 文档中引用代码只写到**文件路径与符号名**，不写行号 —— 行号在上游同步后必然失效。
- `bun run lint:docs-links` 校验文档中的仓库路径与相对链接是否仍然有效，已接入 `validate:ci`。
  刻意不存在的路径（构建产物、教程示例、用于说明「此文件已失效」的举例）在 `scripts/check-docs-links.ts` 的 `KNOWN_ABSENT` 里豁免，或在该行加 `docs-links-ok` 注释。
