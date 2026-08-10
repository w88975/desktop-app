# 03 · 环境与开发回路

> 基于上游 craft-agents-oss v0.11.4 · 核验于 2026-08-08

## 前置条件

| 依赖 | 说明 |
|---|---|
| **Bun** | 必需。包管理、构建脚本、子进程运行时全靠它。`package.json` 里几乎每条 script 都是 `bun run` |
| Node.js | 不直接用来跑项目，但 electron-builder 与部分工具链需要 |
| Python 3 | 只有文档处理工具（PDF / Office / 图片）用得到。首次启动会自动下载 `uv` 到 `apps/electron/resources/bin/<platform>/`，不需要手动装 |
| Git | 上游同步流程依赖 `refs/upstream-tags/` 命名空间，见 [upstream-sync](../upstream-sync.md) |

**不需要 `.env`。** API Key 在应用界面里配置。`.env.example` 里的变量只在做 Slack / Microsoft OAuth 或接 Sentry 时才需要，日常开发留空即可。

## 首次启动

```bash
bun install          # 约 1600 个包
bun run electron:dev
```

第一次 `electron:dev` 会多做三件事，耗时 1–2 分钟：

1. 下载 `uv` 到 `apps/electron/resources/bin/<platform>-<arch>/`
2. 构建三个子进程服务：`session-mcp-server`、`pi-agent-server`、WhatsApp worker
3. 构建 main / preload，启动 Vite（5173），拉起 Electron 窗口

> 构建期会出现 `Cannot find base config file "../../tsconfig.base.json"` 警告 —— 上游遗留，无害，忽略。

## 五种开发回路

不同的改动用不同的回路，别一律 `electron:dev`。

| 命令 | 跑起什么 | 端口 | 什么时候用 |
|---|---|---|---|
| `bun run electron:dev` | 完整桌面应用 | 5173 | 改主进程、传输层、Agent、端到端验证 |
| `bun run playground:dev` | 只有组件预览页，不启动 Electron | 5173 | **只改组件样式/交互时用这个**，秒级热更 |
| `bun run webui:dev` | 浏览器端 UI（**只有前端**，需另起后端） | 5175 | 改 webui 适配层、验证浏览器兼容 |
| `bun run viewer:dev` | 只读分享页 | 5174 | 改分享页 |
| `bun run server:dev` | 只跑 headless 服务端 | 由环境变量决定 | 改服务端逻辑、调 RPC、测 CLI |

> ⚠️ **`playground:dev` 与 `electron:dev` 抢 5173**，且前者启动时会 `kill -9` 占用者。不要同时跑。

> ⚠️ **`webui:dev` 只启动前端。** 它把 `/api`、`/login`、`/ws` 代理到 `127.0.0.1:9100`，后端必须另开一个终端起。只跑 `webui:dev` 会在页面上看到 `Failed to fetch config: 500` —— 那是 vite 代理连不上目标。完整两终端流程见 [12-build-deploy](12-build-deploy.md#开发-webui两条路)。

补充回路：

```bash
bun run server:dev:webui   # 服务端 + 构建好的 webui，一起跑（webui 在 3100）
bun run server:prod        # 生产模式跑服务端，托管 webui 静态资源
bun run electron:start     # 完整构建后启动（不带热更，验证构建产物用）
```

## 构建

```bash
bun run electron:build              # main + preload + renderer + resources + assets
bun run server:build:subprocess     # 只重建 session-mcp-server 与 pi-agent-server
bun run electron:clean              # 清构建产物
```

**改了 `packages/shared/src/**` 里被 `pi-agent-server` 引用的模块，必须 `bun run server:build:subprocess`**，否则子进程跑的还是旧代码 —— 这类问题的症状通常是「明明改了却没生效」，很难查。

打包分发（`electron:dist:*`）见 12-build-deploy（第二批交付）。

## 数据与配置目录

所有用户数据在 **`~/.craft-agent/`**（可用环境变量 `CRAFT_CONFIG_DIR` 覆盖，定义在 `packages/shared/src/config/paths.ts`）：

```
~/.craft-agent/
├── config.json              全局配置（含 LLM 连接、workspace 列表）
├── config-defaults.json     默认值模板
├── preferences.json         用户偏好（含 uiLanguage，主进程语言从这里恢复）
├── credentials.enc          加密后的凭据
├── drafts.json              未发送的草稿
├── window-state.json        窗口位置尺寸
├── permissions/             权限规则
├── themes/                  主题
├── tool-icons/  docs/  release-notes/
├── logs/                    messaging-gateway.log 等
└── workspaces/{slug}/
    ├── config.json          workspace 配置
    ├── events.jsonl         事件流
    ├── sessions/{sessionSlug}/   会话（JSONL 持久化）
    ├── sources/{sourceSlug}/     config.json + guide.md
    ├── skills/  projects/  labels/  statuses/
    └── views.json
```

Electron 自身的数据（缓存、localStorage）在 `~/Library/Application Support/@craft-agent/electron/`（macOS）。

### ⚠️ 开发版和正式版共用同一份数据

如果机器上装了正式版 `Craft Agents.app`，它和你的 dev 版读写**同一个** `~/.craft-agent/`。开发时改坏数据会影响正式版。

需要隔离时，把仓库目录名加数字后缀（如 `aidp-desktop-1`），脚本会自动切到 `~/.craft-agent-1`、端口 `1173`、应用名 `Craft Agents [1]`。

## 日志

| 路径 | 内容 |
|---|---|
| `~/Library/Logs/@craft-agent/electron/main.log` | 主进程，JSON Lines 格式 |
| `~/.craft-agent/logs/messaging-gateway.log` | 消息网关 |
| `~/.craft-agent/workspaces/<ws>/events.jsonl` | 该 workspace 的事件流 |

```bash
tail -f ~/Library/Logs/@craft-agent/electron/main.log
```

开发模式下日志自动开启。设 `CRAFT_DEBUG=true` 可以拿到更详细的输出。

渲染进程用 Electron 自带 DevTools 调试；也可以用 `.mcp.json` 里配好的 `chrome-devtools` MCP 让 AI 助手直接看控制台和网络。

## 已知的无效命令

`package.json` 里有 4 条脚本跑不起来，因为它们依赖的目录没随上游开源导出：

- `marketing:dev` / `marketing:build` / `marketing:preview` —— `apps/marketing` 不存在
- `docs:dev` —— `apps/online-docs` 不存在

另有 9 条上游脚本（发布流水线、1Password 密钥同步、OSS 同步等）已从 `package.json` 删除，它们只存在于 Craft 的私有仓库。

## 下一步

- **写代码之前先读 [04-conventions](04-conventions.md)** —— 提交前该跑什么、哪些 lint 天生是红的、改上游文件的标记约定
- 操作细节的速查版见 `.claude/skills/dev-workflow`（给 AI 助手用的短指令，内容与本篇一致）
