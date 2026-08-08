# 12 · 构建、打包与部署

> 基于上游 craft-agents-oss v0.11.4 · 核验于 2026-08-08

四条产线：桌面应用、headless 服务端、WebUI、Viewer。它们共享大量代码，但产出物与交付方式完全不同。

## 构建产线全貌

```
桌面应用
  electron:build:main       esbuild → apps/electron/dist/main.cjs
  electron:build:preload    esbuild → apps/electron/dist/bootstrap-preload.cjs
  electron:build:renderer   vite    → apps/electron/dist/renderer/
  electron:build:resources  子进程服务 + Python 脚本 → apps/electron/resources/
  electron:build:assets     图标、主题、权限、tool-icons → dist/resources/
  ─────────────────────────────────────────
  electron:dist[:mac|:win|:linux]   electron-builder → apps/electron/release/

headless 服务端
  server:build:subprocess   session-mcp-server + pi-agent-server → 各自 dist/
  server:build[:平台-架构]   scripts/build-server.ts → 单文件可执行
  Dockerfile.server         容器镜像

WebUI        webui:build    vite → apps/webui/dist/
Viewer       viewer:build   vite → apps/viewer/dist/
```

## 桌面应用打包

配置：`apps/electron/electron-builder.yml`。

| 平台 | 产物 | 架构 |
|---|---|---|
| macOS | `.dmg` + `.zip` | arm64 + x64 |
| Windows | NSIS 安装包 | x64 |
| Linux | AppImage | x64 |

```bash
bun run electron:dist:mac        # 需要签名配置
bun run electron:dist:dev:mac    # 跳过签名，本地验证用（CSC_IDENTITY_AUTO_DISCOVERY=false）
```

`electron:dist:dev:*` 会带上 `CRAFT_DEV_RUNTIME=1`，让 `runtime-resolver.ts` 从 `.app` 包再往上找 monorepo 里的 SDK / 拦截器 / bun —— 这是**本地打包能跑起来的关键**，正式产线不要用。

### 几个非常规配置及其原因

| 配置 | 值 | 为什么 |
|---|---|---|
| `asar` | `false` | 避免解压开销与点击延迟 |
| SDK 与 ripgrep | 走 `extraResources` 而非 `files` | electron-builder v20.15.2 起 `files` 自动排除 `node_modules` |
| Windows 的 bun / uv | 走 `extraResources` | 放 `files` 里会因文件锁触发 EBUSY |
| NSIS `perMachine` | `false`（装到 `%LOCALAPPDATA%\Programs\`） | Bun 子进程在 `Program Files` 下没有读写权限 |
| macOS `NSLocalNetworkUsageDescription` | 有 | 没有这条，应用不会出现在「隐私与安全性 → 本地网络」里，LAN 访问被静默拒绝 |

### Claude SDK 二进制的打包

SDK 自 0.2.113 起拆成：薄核心包（~4MB，各平台都有）+ 每平台可选依赖包（含 ~210MB 的原生 `claude` 二进制）。

打包时通过一个**稳定别名**解决路径问题：

```
apps/electron/node_modules/@anthropic-ai/claude-agent-sdk-binary/
```

平台构建脚本在跑 electron-builder 之前把目标架构的包复制到这个别名下，`runtime-resolver.ts` 优先查它，查不到才退回「按平台名找可选依赖包」（dev / monorepo 场景可行）。

三个脚本都在 `apps/electron/scripts/`：

| 脚本 | 平台 |
|---|---|
| `apps/electron/scripts/build-dmg.sh` | macOS |
| `apps/electron/scripts/build-linux.sh` | Linux |
| `apps/electron/scripts/build-win.ps1` | Windows |

> ⚠️ **这些脚本开头会尝试用 1Password CLI（`op`）同步密钥** —— 那是 Craft 私有保险库，我们没有访问权。脚本对 `op` 缺失做了兼容（`command -v op` 判断），但**依赖密钥的步骤（签名、Sentry DSN 注入）在我们这里会是空的**。
>
> 正式发版前需要把这段换成我们自己的密钥来源。这是一处必须打 `[aidp]` 标记的上游文件修改。

`bun run electron:dist:*` 走的是 electron-builder 直连路径，**不经过这三个脚本**，因此别名不会被填充 —— 本地验证请用 `electron:dist:dev:*`（带 `CRAFT_DEV_RUNTIME=1`，解析器会向上找到 monorepo 里的包）。

### 签名与公证

**这部分需要你们自己的证书与账号，我无法填入真实值。**

- **macOS**：`electron-builder.yml` 里 `hardenedRuntime: true`、entitlements 指向 `build/entitlements.mac.plist`。公证配置被注释掉了，启用需要设 `CSC_LINK`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`，并取消 `notarize.teamId` 的注释
- **Windows**：NSIS 签名需要配 `CSC_LINK` / `CSC_KEY_PASSWORD`（代码签名证书）
- **Linux**：AppImage 无需签名

> **TODO（待补）**：确定我们用哪套证书、密钥存哪（内网密钥管理还是 CI secret）、由谁执行发版。这一节在决定之前不要照抄上游做法 —— 上游用的是 Craft 的 Apple 开发者账号。

## headless 服务端

### 直接跑

```bash
CRAFT_SERVER_TOKEN=<密钥> bun run packages/server/src/index.ts
bun run packages/server/src/index.ts --generate-token   # 生成一个随机 token
```

关键环境变量（完整列表见 `packages/server/src/index.ts` 文件头注释）：

| 变量 | 默认 | 说明 |
|---|---|---|
| `CRAFT_SERVER_TOKEN` | — | **必需**，客户端 bearer 鉴权 |
| `CRAFT_RPC_HOST` / `CRAFT_RPC_PORT` | `127.0.0.1` / `9100` | 绑定地址 |
| `CRAFT_RPC_TLS_CERT` / `_KEY` / `_CA` | — | 配了就启用 wss |
| `CRAFT_CONFIG_DIR` | `~/.craft-agent` | 数据目录 |
| `CRAFT_WEBUI_DIR` | — | 指向构建好的 webui，配了就在同端口提供 Web UI |
| `CRAFT_WEBUI_PASSWORD` | 回退到 `CRAFT_SERVER_TOKEN` | Web 登录用的较短口令 |
| `CRAFT_WEBUI_SECURE_COOKIE` | 自动 | 会话 Cookie 的 Secure 标志 |
| `CRAFT_WEBUI_WS_URL` | 自动 | 返回给浏览器的 ws/wss 地址 |
| `CRAFT_BUNDLED_ASSETS_ROOT` | — | 内置资源（docs / themes / permissions）根目录，指向 `apps/electron` |
| `CRAFT_LOCAL_MCP_ENABLED` | `true` | **私有化部署的安全开关** —— 关掉后不允许启动 stdio MCP 子进程 |
| `CRAFT_MESSAGING_WA_WORKER` / `_NODE_BIN` | — | WhatsApp worker 路径与 Node 二进制 |
| `CRAFT_DEBUG` | — | 详细日志 |

服务端会取一个**单实例锁**（`bootstrap/lock-identity.ts`），防止同一数据目录被两个进程同时写。

### Docker

`Dockerfile.server`：`oven/bun:1.3-slim` 基础镜像，非 root 用户 `craftagents`，`EXPOSE 9100`，`ENTRYPOINT ["bun", "run", "packages/server/src/index.ts"]`，内置构建 webui 与子进程服务。

> ⚠️ **`Dockerfile.server` 当前构建不过。** 它 `COPY` 了三个在本仓库中不存在的路径的 `package.json`：
>
> ```
> packages/craft-agents-commands/    ❌ 不存在
> packages/craft-cli/                ❌ 不存在
> apps/marketing/                    ❌ 不存在
> ```
>
> 这些是上游私有仓库里有、但没随开源导出的包。Docker 的 `COPY` 源不存在会直接失败。
>
> **修法**：删掉这三行 `COPY`。删之前确认后续步骤没有引用它们（实测没有）。这是个需要打 `[aidp]` 标记的上游文件修改。

`scripts/docker-smoke-test.sh` 是现成的冒烟测试，改完 Dockerfile 后可以跑它验证。

## WebUI 与 Viewer 部署

**WebUI** 是静态资源 + 同端口的 HTTP 服务：

```bash
bun run webui:build                       # → apps/webui/dist/
CRAFT_WEBUI_DIR=apps/webui/dist bun run packages/server/src/index.ts
# 或一条命令：
bun run server:prod
```

服务端侧的实现在 `packages/server-core/src/webui/`：`http-server.ts`（静态托管）、`auth.ts`（登录与 Cookie 会话）、`node-adapter.ts`。浏览器的 WebSocket 升级请求自动带上会话 Cookie，不需要 bearer token。

**Viewer** 是纯静态页（`viewer:build` → `apps/viewer/dist/`），托管在任意静态服务器即可，不需要后端。

## 自动更新

`apps/electron/src/main/auto-update.ts`，基于 `electron-updater`。

| 平台 | 机制 |
|---|---|
| macOS | 下载 zip，原子替换 app bundle |
| Windows | 下载 NSIS 安装包，退出时静默运行 |
| Linux | 下载 AppImage，替换当前文件 |

> ⚠️ **更新源硬编码指向 Craft**：`electron-builder.yml` 的 `publish.url` 与 `auto-update.ts` 的注释都是 `https://agents.craft.do/electron/latest`。
>
> **私有化分发前必须改掉**，否则用户会被推送到 Craft 官方版本上。详见 [13-branding-decoupling](13-branding-decoupling.md)。

## Sentry

主进程在 `apps/electron/src/main/index.ts` **文件最顶部**初始化（早于其它 import）。

- DSN 来自 `process.env.SENTRY_ELECTRON_INGEST_URL`，通过 esbuild 的 `--define` 在构建期烘进去
- **只在有 DSN 时启用**，`environment` 按 `app.isPackaged` 区分 production / development
- `beforeSend` 做脱敏：剥掉 `authorization` / `cookie` / `x-api-key` 请求头，以及面包屑里 key 名含 `token`/`key`/`secret`/`password`/`credential`/`auth` 的值
- 用户标识是 `sha256(hostname + homedir)` 取前 16 位的匿名机器 ID，不含 PII
- **source map 上传是刻意关闭的** —— Sentry 里看到的是压缩后的堆栈。要开需要配 `SENTRY_AUTH_TOKEN` / `SENTRY_ORG` / `SENTRY_PROJECT`，并重新启用 vite 和 esbuild 的 Sentry 插件

内网部署时：要么换成自建 Sentry 的 DSN，要么不设这个变量直接关掉。

## 环境变量矩阵

`.env.example` 里的变量**日常开发都不需要**：

| 变量 | 何时需要 |
|---|---|
| `ANTHROPIC_API_KEY`、`CRAFT_MCP_URL`、`CRAFT_MCP_TOKEN` | 上游遗留，实际在应用界面里配 |
| `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` | 开发/测试 Google source 的 OAuth；生产由用户在 source 配置里填 |
| `SLACK_OAUTH_CLIENT_ID` / `_SECRET` | Slack 集成 |
| `MICROSOFT_OAUTH_CLIENT_ID` | Microsoft 集成（PKCE，不需要 secret） |
| `SENTRY_ELECTRON_INGEST_URL` | 接 Sentry |

## CI 现状

`.github/workflows/` 下有两个 GitHub Actions 工作流（`validate.yml`、`validate-server.yml`），但：

- `origin` 是内网 GitLab，GitHub Actions 不会执行
- 仓库里没有 `.gitlab-ci.yml`
- 触发分支是 `main`，而我们用 `master` / `develop`

**所以目前没有任何 CI 在跑。** `validate.yml` 的内容仍有参考价值（它做的是：拒绝 Windows 非法文件名 → `bun install --frozen-lockfile` → `bun run validate:ci`），迁到 GitLab CI 时可以照搬这个骨架。

## 排查清单

| 症状 | 看哪里 |
|---|---|
| Docker 构建在 COPY 阶段失败 | 那三行指向不存在包的 `COPY` |
| 打包后启动就崩，报找不到 SDK 二进制 | `claude-agent-sdk-binary` 别名没填充；本地验证用 `electron:dist:dev:*` |
| 打包后 Pi 会话起不来 | `resources/pi-agent-server/` 没构建（`electron:build:resources`） |
| Windows 打包报 EBUSY | bun / uv 没走 `extraResources` |
| macOS 应用访问不了局域网 | `NSLocalNetworkUsageDescription` 缺失 |
| 服务端启动报锁冲突 | 同一 `CRAFT_CONFIG_DIR` 已有实例在跑 |
| 用户被更新到官方版本 | `publish.url` 没改 |
