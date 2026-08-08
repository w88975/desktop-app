# aidp-desktop

基于 [craft-agents-oss](https://github.com/craft-ai-agents/craft-agents-oss) v0.11.4 的 Electron 桌面应用。
Bun workspace 单仓，TypeScript + React 18 + Tailwind v4。

## 仓库地图

```
apps/
  electron/   桌面应用主体（main / preload / renderer 三进程 + transport 层）
  webui/      浏览器端 UI，复用同一套 RPC
  viewer/     只读会话分享页
  cli/        命令行入口
packages/
  shared/     业务逻辑、协议定义（protocol/）、i18n
  core/       共享类型
  ui/         跨 app 共享的 React 组件
  server/ server-core/     服务端与传输层
  session-mcp-server/ pi-agent-server/ session-tools-core/   子进程服务
  messaging-gateway/ messaging-whatsapp-worker/
```

## 启动

```bash
bun install
bun run electron:dev     # 首次会下载 uv 并构建 3 个子进程服务，约 1-2 分钟
```

只改 UI 时用 `bun run playground:dev`，不必启动整个 Electron。

## ⚠️ 三个必须知道的事实

1. **`bun run lint` 整条链是红的**，但不是你的问题 —— 是上游带来的 133/17/3 个 eslint 存量问题。提交前跑 `bun run typecheck` 和 `bun test`。项目自有的质量门禁（`lint:ipc-sends`、`lint:tool-name-checks`、`lint:i18n:*`、`typecheck:staged`）都是通的，可单独跑。
2. **组件有两个家**，放错地方会导致 webui/viewer 编译失败或代码无法复用。渲染进程专用的进 `apps/electron/src/renderer/components/ui/`；三端共享的进 `packages/ui/src/components/`。
3. **进程间通信不是 `ipcRenderer.invoke`**，是一套 WS RPC。新增 API 方法要改 4 个文件，漏一处会被 CI 拦住。

## 详细约定

具体怎么做见 `.claude/skills/`：

- `ui-components` — 组件放哪、shadcn 怎么加、playground 快速回路
- `dev-workflow` — 构建、调试、提交前校验、日志与配置目录
- `electron-ipc` — 新增 RPC 方法的 4 处改动与信道分类规则

面向人的二次开发文档（架构、RPC、Agent 内核、术语表、上游同步约定）在 `docs/dev/`，索引见 `docs/README.md`。

## MCP

`.mcp.json` 已配 `shadcn`（查/加组件）、`chrome-devtools`（调试渲染进程）、`context7`（查 Tailwind v4 / Radix / Electron 39 等新版本文档）。首次使用需授权，走 npx 联网拉包。
