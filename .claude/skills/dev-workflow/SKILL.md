---
name: dev-workflow
description: 本项目的启动、构建、调试与提交前校验流程。涉及跑起项目、构建失败、该跑哪些检查、找日志、配置目录冲突、lint 报错时使用。
---

# 开发流程

## 首次启动

```bash
bun install              # 约 1600 个包
bun run electron:dev
```

首次 `electron:dev` 会自动完成（约 1-2 分钟）：

1. 下载 uv 到 `apps/electron/resources/bin/<platform>/`
2. 构建 3 个子进程服务：session-mcp-server、pi-agent-server、WhatsApp worker
3. 构建 main / preload，启动 vite（5173）与 Electron 窗口

构建期出现的 `Cannot find base config file "../../tsconfig.base.json"` 警告是上游遗留，无害。

API key 在应用内配置，**不需要 `.env`**。`.env` 只在做 Slack / Microsoft OAuth 或 Sentry 时才需要。

## 更快的回路

| 命令 | 用途 | 端口 |
|---|---|---|
| `bun run playground:dev` | 只看组件，不启动 Electron | 5173 |
| `bun run webui:dev` | 浏览器端 UI | 5175 |
| `bun run viewer:dev` | 只读分享页 | 5174 |
| `bun run server:dev` | 只跑服务端 | — |

**⚠️ `playground:dev` 和 `electron:dev` 都用 5173**，且前者启动时会 `kill -9` 占用者。不要同时跑。

## 提交前跑什么

```bash
bun run typecheck        # ✅ 实测通过（packages/shared）
bun run typecheck:all    # ✅ 覆盖全部 package + electron
bun test                 # ✅
```

## 项目自有的质量门禁

上游 OSS 仓库只导出了 `package.json`，这些校验脚本的实现没跟着出来。我们自己补了 6 个，都可用：

| 命令 | 检查什么 |
|---|---|
| `bun run lint:ipc-sends` | 主进程有没有绕过 RPC event sink 直接 `webContents.send` |
| `bun run lint:tool-name-checks` | 有没有绕过 `isParentTaskTool()` 直接比较 `'Task'`/`'Agent'` 字面量 |
| `bun run lint:i18n:coverage` | 代码里 `t('x.y')` 引用的 key 是否都在 en.json 中存在 |
| `bun run lint:i18n:strings` | 有没有硬编码的中日韩文案（应走 `t()`） |
| `bun run lint:i18n:staged` | 同上，只查暂存文件（pre-commit 用） |
| `bun run typecheck:staged` | 只对暂存改动涉及的 workspace 跑 tsc（pre-commit 用） |

前两个检查各有一个转义标记，确属例外时在该行或上一行加注释：`raw-send-ok:<原因>`、`parent-task-ok:<原因>`；i18n 文案检查用 `i18n-ok`。

### ⚠️ `bun run lint` 整条链仍然是红的

不是脚本缺失了，是 eslint 存量问题（见下）。它会依次跑
`lint:ipc-sends` → `lint:tool-name-checks` → `lint:electron` → …，
前两个通过，卡在 `lint:electron`。

### eslint 单项可以跑，但有存量错误

绕过聚合脚本能直接跑，**但三个都不是绿的**（截至 v0.11.4 的基线，实测）：

| 命令 | 基线结果 |
|---|---|
| `bun run lint:electron` | 133 problems（9 errors, 124 warnings） |
| `bun run lint:shared` | 17 problems（5 errors, 12 warnings） |
| `bun run lint:ui` | 3 errors |

**非零退出不代表你改坏了。** 只看你动过的文件，别试图清零 —— 这些是上游带来的存量。

## i18n 提醒

`packages/shared/src/i18n/locales/` 下有 7 个文件（en、zh-Hans、de、es、hu、ja、pl）。**`en.json` 是基准**，parity 脚本拿其余 6 个跟它比对（所以输出写的是 "6 locales"）。

**新增文案 key 必须补齐全部 7 个文件**，只改 `zh-Hans.json` 会让 parity 失败：

```bash
bun run lint:i18n:parity    # ✅ 当前基线通过：6 locales, 1640 keys each
bun run lint:i18n:sorted    # ✅ 按 key 排序校验
bun run sort-locales        # 自动排序
```

复数形式例外：locale 可以有 en.json 没有的 `X_few` 之类的键，脚本认这个。

## 配置目录与已安装版冲突

dev 版和正式版 `Craft Agents.app` 共用同一份数据：

- 配置：`~/.craft-agent/`
- Electron user data：`~/Library/Application Support/@craft-agent/electron/`

开发时改数据会影响正式版。需要隔离就把仓库目录名加数字后缀（如 `aidp-desktop-1`），脚本会自动切到 `~/.craft-agent-1`、端口 `1173`、应用名 `Craft Agents [1]`。

## 日志

```
~/Library/Logs/@craft-agent/electron/main.log     主进程（JSON Lines）
~/.craft-agent/logs/messaging-gateway.log         消息网关
~/.craft-agent/workspaces/<ws>/events.jsonl       事件流
```

直接 `tail -f ~/Library/Logs/@craft-agent/electron/main.log` 即可。

> 上游的 `electron:dev:logs` 等 9 条 script 已从 `package.json` 删除 —— 它们依赖的脚本只存在于 Craft 私有仓库（发布流水线、1Password 保险库、OSS 同步），从未随开源导出。被删的是：`build`、`release`、`check-version`、`oss:sync`、`sync-secrets`、`fresh-start`、`fresh-start:token`、`electron:dev:menu`、`electron:dev:logs`。
>
> **仍有 4 条无效条目**：`marketing:dev` / `marketing:build` / `marketing:preview`（`apps/marketing` 未随上游导出）和 `docs:dev`（`apps/online-docs` 未导出）。跑它们会报错，别用。

渲染进程用 `chrome-devtools` MCP 或 Electron 自带 DevTools 调试。

> 背景与原理（为什么是这套流程、门禁的真实状态）见 `docs/dev/03-getting-started.md` 与 `docs/dev/04-conventions.md`。
