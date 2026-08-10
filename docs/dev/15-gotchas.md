# 15 · 踩坑集锦

> 基于上游 craft-agents-oss v0.11.4 · 核验于 2026-08-08

按「症状 → 根因」组织，用来快速定位。深入解释在各章，最细的踩坑记录在 `packages/shared/CLAUDE.md`。

## 我们自己核验出的仓库现状问题

这些不是「文档没写清」，是**当前代码/配置的真实缺口**，需要我们自己补。

| 问题 | 现状 | 影响 |
|---|---|---|
| **pre-commit 钩子不生效** | `core.hooksPath` 指向 `.husky/_`，但 `.husky/pre-commit` 文件不存在，husky shim 直接 `exit 0` | `lint:i18n:staged`、`typecheck:staged` 不会自动跑 |
| **CI 不生效** | `.github/workflows/*` 是 GitHub Actions，`origin` 是内网 GitLab；无 `.gitlab-ci.yml`；触发分支是 `main`，我们用 `master`/`develop` | 没有任何自动门禁 |
| **`Dockerfile.server` 构建不过** | `COPY` 了三个不存在的路径：`packages/craft-agents-commands`、`packages/craft-cli`、`apps/marketing` | headless 服务端无法容器化 |
| **`CRAFT_CONFIG_DIR` 覆盖不彻底** | 至少 10 处代码直接 `join(homedir(), '.craft-agent', ...)` 绕过 `CONFIG_DIR` | 多实例开发时日志与窗口状态仍共用；改数据目录名会有遗漏 |
| **`session-mcp-server` 疑似死代码** | 三处构建脚本都在构建它、`runtime-resolver` 也解析路径，但源码里找不到 spawn 它的调用点 | 无害但浪费构建时间；**不要贸然删**，打包脚本还指着它 |
| **平台构建脚本依赖 Craft 私有密钥** | `apps/electron/scripts/build-{dmg.sh,linux.sh,win.ps1}` 开头调 1Password CLI 同步密钥，那是 Craft 的保险库 | 签名与 Sentry DSN 注入在我们这里会是空的，发版前需换成自己的密钥来源 |
| **4 条 package.json 脚本无效** | `marketing:dev` / `marketing:build` / `marketing:preview` / `docs:dev`，对应目录未导出 | 跑了会报错 |
| **`bun run lint` 整条链是红的** | 上游 eslint 存量：electron 133、shared 17、ui 3 | 非零退出**不代表你改坏了** |

## 构建与运行

| 症状 | 根因 |
|---|---|
| 改了 `packages/shared` 的代码，Pi 会话没生效 | 忘了 `bun run server:build:subprocess`。`pi-agent-server` 是 bun 打包的独立产物 |
| `playground:dev` 把 Electron 的 dev server 杀了 | 两者都用 5173，前者启动时 `kill -9` 占用者。二选一 |
| 构建期 `Cannot find base config file "../../tsconfig.base.json"` | 上游遗留警告，无害 |
| 打包后启动崩溃，找不到 SDK 二进制 | `claude-agent-sdk-binary` 别名未填充。本地验证用 `electron:dist:dev:*`（带 `CRAFT_DEV_RUNTIME=1`） |
| 打包后 Pi 会话起不来 | `resources/pi-agent-server/` 没构建 |
| Windows 打包报 EBUSY | bun / uv 必须走 `extraResources`，不能放 `files` |
| 服务端启动报锁冲突 | 同一 `CRAFT_CONFIG_DIR` 已有实例在跑（单实例锁） |
| dev 版改数据影响了正式版 | 两者共用 `~/.craft-agent/`。隔离方法：仓库目录名加数字后缀 |
| WebUI 报 `Failed to fetch config: 500` | 后端没起。`webui:dev` 只有前端，代理目标 `127.0.0.1:9100` 无人监听 |
| 服务端启动即退出，报 token too short | `CRAFT_SERVER_TOKEN` 至少 16 字符；`--generate-token` 可生成 |
| 服务端报 `Another server instance is already running` | Electron 应用持有 `$CONFIG_DIR/.server.lock`。退出它，或给服务端另设 `CRAFT_CONFIG_DIR`（代价是独立的空数据集） |
| 起了服务端但 `/api/*` 是 404 | webui handler 未创建：`CRAFT_WEBUI_DIR` 没设、**指向的目录不存在**、或 `CRAFT_SERVER_TOKEN` 没设 |
| **WebUI 登录后仍显示引导界面（让你配模型）** | 通常不是真的缺配置 —— `App.tsx` 初始化**任何一步抛错都会 fallback 到引导**。先看控制台真实报错 |
| 控制台报 `Token required` | WS 握手没带会话 Cookie。vite 代理的 `changeOrigin: true` 让服务端推出 `ws://127.0.0.1:9100`，而页面在 `localhost` —— **Cookie 按主机名隔离**。设 `CRAFT_WEBUI_WS_URL=ws://localhost:9100` |

## RPC / 传输层

| 症状 | 根因 |
|---|---|
| `Channel "x" is not classified in LOCAL_ONLY or REMOTE_ELIGIBLE` | 新信道没进 `routing.ts` 的两个 Set 之一。这是**设计好的**穷尽性拦截 |
| `CHANNEL_NOT_FOUND` | handler 没注册，或注册在了 `apps/electron/src/main/handlers/`（headless 与 webui 不会加载） |
| `window.electronAPI.xxx is not a function` | `CHANNEL_MAP` 里没加映射 |
| TS 报 `Property 'xxx' does not exist on type 'ElectronAPI'` | `apps/electron/src/shared/types.ts` 的接口没补签名。运行时是 Proxy，类型全靠它 |
| 桌面版好用、webui 里没反应 | handler 放错包，或该能力浏览器里根本不存在（需要在 `web-api.ts` 覆盖） |
| 长耗时操作莫名超时 | 默认 `REQUEST_TIMEOUT_MS` 是 30s。正确做法是「立即返回 + 事件推进度」，不是加长超时 |
| 远程 workspace 下路径解析失败 | 本机路径相关的信道被错标成 `REMOTE_ELIGIBLE` |
| `err instanceof CodedError` 永远是 false | **类身份过不了 wire**。必须判 `err.code === 'X'` |
| 远程客户端收不到某些事件 | 有代码直接 `webContents.send` 绕过了 event sink。`bun run lint:ipc-sends` 会查 |
| 断线重连后界面状态错乱 | 服务端 `stale: true` 时客户端必须做全量刷新，不能只依赖增量 |

## Agent / 模型

| 症状 | 根因 |
|---|---|
| Claude 正常、其它模型异常（或反过来） | 双后端差异。重点看：网络拦截器**只对 Pi 生效**；上下文分块策略两边不同 |
| 写在拦截器里的修复 Claude 不生效 | Claude SDK 自 0.2.113 起跑原生二进制，没有 Bun `--preload` 这个口子。这是已知的 Phase-2 待办 |
| Pi 会话的提示词缓存频繁失效 | volatile 块被折进了系统前缀。Pi **只能**把 stable 折进去 |
| 插话后多出「上一轮被中断」提示 | `wasInterrupted` 只能在 steer 路径设置，`queue` 模式绝不能设 |
| 插话消息顺序错乱 | 排队消息重发时要 `monotonic()` 重新盖时间戳；且要把权威时间戳同步回前端的乐观消息 |
| 停止后会话状态不对 | 硬中断（`forceAbort`）与交接式中断（`interruptForHandoff`）用混了 |
| 改了连接配置但活跃会话没生效 | 该字段需要重启后端，看 `buildRestartRequiredSignature` 是否覆盖它 |
| 新加的连接字段保存后消失 | `updateLlmConnection` 用硬编码白名单重建对象，新字段要加进去（#838） |
| 渲染进程构建炸在 Node `stream` 模块 | 有代码从渲染进程 import 了 `models-pi.ts`（传递依赖到 AWS SDK） |
| Bedrock 报「Retry with the ID or ARN of an inference profile」 | 模型 ID 没走 Bedrock 映射表（裸 ID 会被拒） |
| 自建端点报 `Stream ended without finish_reason` | 终止 chunk 带了空 `tool_calls: []`。上游已修，但**仅 Pi 生效** |
| 并行工具调用出现重复的空 id 条目 | 网关把工具调用拆成了「初始化 + 纯参数增量」。同上一条的修复覆盖 |
| 某个模型在列表里看不到 | `PI_EXCLUDED_MODELS` / `PI_EXCLUDED_MODEL_PREFIXES`。注意 `gpt-4` 是被**前缀**排除的 |
| Thinking 关不掉 | Fable 5 / Mythos 5 类模型的 adaptive thinking 始终开启，API 拒绝 `thinking: disabled` |

## 工具 / Source / MCP

| 症状 | 根因 |
|---|---|
| `session-tool-parity.test.ts` 变红 | 用了 `executionMode: 'backend'` 却只实现一边 |
| MCP 工具调用报「找不到工具」 | 有地方没走 `proxyToolName()`，派发键漂移（#864 / #498） |
| 某个 MCP 工具凭空消失 | 名称净化后撞名，保留了第一个。看 `console.warn` |
| 模型从不调用新加的工具 | `TOOL_DESCRIPTIONS` 太含糊，或参数缺 `.describe()` |
| 工具报错但模型当成功处理 | 没用 `errorResponse`。OpenAI Responses API 看不到 `isError`，靠 `[ERROR]` 前缀 |
| Explore 模式下工具意外可用/被拦 | 工具定义的 `safeMode`；bash 命令看 `read-patterns.ts` |
| Source token 过期后不自动刷新 | `isRefreshableSource()` 是唯一判断入口；renew endpoint 是否配了 |
| 会话中途启用 source 没生效 | `setSourceServers` 的 `intendedSlugs`，以及是否走到 `SourceActivated` 重启 |

## 数据与状态

| 症状 | 根因 |
|---|---|
| 会话列表慢 | 用了 `readSessionJsonl()` 而不是只读第一行的 `readSessionHeader()` |
| 会话导出到别的机器后路径错 | 没走 `makeSessionPathPortable()` |
| 标签筛选结果不一致 | 手写了标签匹配，没走唯一实现 `matchesLabelFilter` |
| Task 标签错乱 | 假设了字面 id。slug 会撞名偏移，必须用解析函数 |
| 自动化条件时灵时不灵 | 没走 `matcherMatches*` 适配器 |
| 升级后老数据打不开 | 缺迁移。拿 `~/.craft-agent/config.json.bak-*` 对照 |
| 整个 `~/.craft-agent` 拷到新电脑后所有连接都要重新授权 | 凭据密钥由硬件标识派生（macOS IOPlatformUUID / Windows MachineGuid / Linux machine-id），换机必然解不开。要换机无感应该用远程 workspace |

## UI

| 症状 | 根因 |
|---|---|
| 组件不重渲染 | event-processor 返回了同一个引用。它**必须永远返回新引用** |
| 流式消息顺序错乱 | 有代码按位置而不是按 ID 找消息 |
| 发消息后本地那条闪一下才归位 | `handleUserMessage` 的乐观消息对账没做对 |
| `packages/ui` 的新组件 import 不到 | `package.json` 的 `exports` 是白名单，没登记就 import 不到 |
| webui / viewer 编译失败 | 共享组件里引了 Electron API 或 Node 内置模块 |
| 设置页加了但导航里没有 | `SETTINGS_PAGES` 或 `SETTINGS_PAGE_COMPONENTS` 漏了一处 |
| 界面显示 i18n key 而不是文案 | 模块级调了 `i18n.t()`（加载早于 i18n 初始化），或 key 没进 `en.json` |
| `lint:i18n:parity` 失败 | 新 key 只补了部分 locale。必须全部 7 个 |
| 找不到某个 Context | `context/`（单数）与 `contexts/`（复数）是两个不同目录 |

## 品牌 / 部署

| 症状 | 根因 |
|---|---|
| 用户被更新到 Craft 官方版本 | `electron-builder.yml` 的 `publish.url` 没改 |
| source 授权回调打到 Craft 服务器 | WebUI OAuth 中继地址硬编码 |
| 分享链接指向 Craft | `branding.ts` 的 `VIEWER_URL` |
| 与已装的 Craft Agents 抢深链协议 | `craftagents://`。注意渲染进程有十几处硬编码，不读环境变量 |
| 改了 `appId` 后窗口状态/缓存重置 | Electron userData 目录随 `appId` 变化。业务数据在 `~/.craft-agent/`，不受影响 |
| macOS 应用访问不了局域网 | `NSLocalNetworkUsageDescription` 缺失 |

## 上游同步

| 症状 | 根因 |
|---|---|
| `git merge upstream/main` 满屏冲突 | 两边历史无共同祖先。**不要 merge**，只人工比对移植 |
| 找不到上游的某个 bugfix 提交 | 上游一个版本一个压缩提交，不存在细粒度提交 |
| 同步时判断不了某处改动还要不要留 | `[aidp]` 标记的原因没写，或压根没打标记 |
| `git push --tags` 想推上游 tag | 上游 tag 在 `refs/upstream-tags/`，不会污染本地 `refs/tags/` |

## 相关文档

| 找什么 | 去哪 |
|---|---|
| 最细的实现层踩坑记录 | `packages/shared/CLAUDE.md`（203 行，维护得很好） |
| 上游英文文档哪些还可信 | [01-overview](01-overview.md#上游英文文档可信度) |
| 上游同步的完整流程 | [upstream-sync](../upstream-sync.md) |
| 提交前该跑什么 | [04-conventions](04-conventions.md) |
