# 18 · 配置文件全量参考

> 基于上游 craft-agents-oss v0.11.4 · 核验于 2026-08-09

本篇是**逐字段对着源码核验**的配置参考，回答「这个键叫什么、什么类型、默认值是多少、改了有什么风险」。

数据模型的整体组织（目录布局、JSONL 持久化、Label/Task/Automation）见 [10-sessions-data](10-sessions-data.md)。

> ⚠️ **官方在线文档的配置页与本篇有出入。** 官方文档跟随在售版本，我们停在 v0.11.4。已核实的偏差列在最后一节。**以本篇 / 源码为准。**

## 文件一览

| 文件 | 定义在 | 内容 |
|---|---|---|
| `~/.craft-agent/config.json` | `config/storage.ts` 的 `StoredConfig` | 全局配置：workspace 列表、LLM 连接、应用级开关 |
| `~/.craft-agent/preferences.json` | `config/preferences.ts` 的 `UserPreferences` | 用户个人偏好，会注入到系统提示词 |
| `~/.craft-agent/config-defaults.json` | — | 从内置资源同步的默认值模板，**每次启动覆写**，不要手改 |
| `~/.craft-agent/credentials.enc` | `credentials/` | 加密凭据，**不要手改** |
| `workspaces/{ws}/config.json` | `workspaces/types.ts` 的 `WorkspaceConfig` | workspace 级配置与默认值 |
| `workspaces/{ws}/projects/{p}/config.json` | `projects/types.ts` 的 `ProjectConfig` | project 配置与看板列 |
| `workspaces/{ws}/sources/{s}/config.json` | `sources/types.ts` 的 `FolderSourceConfig` | Source 配置 |

`CONFIG_DIR` 可用环境变量 `CRAFT_CONFIG_DIR` 覆盖 —— 但**覆盖不彻底**，见 [13-branding-decoupling](13-branding-decoupling.md#-7-数据目录-craft-agent)。

## `config.json` — `StoredConfig`

**只有 3 个字段是必填的**：`workspaces`、`activeWorkspaceId`、`activeSessionId`。其余全部可选，缺失时用默认值。

### 模型与会话

| 键 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `llmConnections` | `LlmConnection[]` | — | 模型接入配置数组，**认证与模型配置的权威来源**。字段详见 [08-models-providers](08-models-providers.md) |
| `defaultLlmConnection` | `string` | — | 新会话默认用哪条连接（slug） |
| `defaultThinkingLevel` | `ThinkingLevel` | — | 应用级默认思考等级 |

### Workspace 与会话状态

| 键 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `workspaces` | `Workspace[]` | **必填** | workspace 列表 |
| `activeWorkspaceId` | `string \| null` | **必填** | 当前活跃 workspace |
| `activeSessionId` | `string \| null` | **必填** | 当前活跃会话 |

`Workspace`（`packages/core/src/types/workspace.ts`）：`id`、`name`、`slug`、`rootPath`、`createdAt` 必填；`lastAccessedAt`、`iconUrl`、`mcpUrl`、`mcpAuthType`、`remoteServer` 可选。

`remoteServer` 就是远程 workspace 的连接配置，见 [12-build-deploy](12-build-deploy.md#桌面客户端怎么连远程服务端)。

### 界面与输入

| 键 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `notificationsEnabled` | `boolean` | `true` | 任务完成的桌面通知 |
| `colorTheme` | `string` | `'default'` | 预置主题 ID（如 `'dracula'`、`'nord'`） |
| `autoCapitalisation` | `boolean` | `true` | 输入时首字母自动大写 |
| `sendMessageKey` | `'enter' \| 'cmd-enter'` | `'enter'` | 发送键 |
| `spellCheck` | `boolean` | `false` | 输入框拼写检查 |
| `keepAwakeWhileRunning` | `boolean` | `false` | 会话运行时阻止屏幕休眠 |

### 工具

| 键 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `richToolDescriptions` | `boolean` | `true` | 给所有工具调用附加意图/动作元信息 |
| `browserToolEnabled` | `boolean` | `true` | 内置浏览器工具开关。**用 Playwright/Puppeteer 时应关掉** |
| `allowRemoteEvaluate` | `boolean` | `true` | 是否允许远程 Agent 在本地浏览器上调 `browser_tool evaluate`。**私有化部署应评估是否关掉** |

浏览器工具见 [17-browser](17-browser.md)。

### 上下文与缓存

| 键 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `extendedPromptCache` | `boolean` | `false` | 提示词缓存 TTL 用 1 小时而非 5 分钟 |
| `enable1MContext` | `boolean` | `false` | 支持的模型启用 100 万上下文窗口。**需要 Anthropic Tier 4+**，默认关闭是刻意的 |
| `rtkEnabled` | `boolean` | `false` | 把 Bash 命令路由过 [rtk](https://github.com/rtk-ai/rtk) 压缩工具输出，省 token |

### 网络与平台

| 键 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `networkProxy` | `NetworkProxySettings` | — | `{ enabled, httpProxy?, httpsProxy?, noProxy? }`。**内网部署常用** |
| `gitBashPath` | `string` | — | **Windows 专用**：Git Bash（`bash.exe`）路径，供 SDK 子进程使用。不设时 SDK 只会在 `Program Files` 里硬编码搜索（#935） |

### 服务端模式

| 键 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `serverConfig` | `ServerConfig` | — | 内嵌远程服务端设置 |

```ts
interface ServerConfig {
  enabled: boolean       // 开启后绑 0.0.0.0 而非 127.0.0.1
  port: number           // 默认 9100
  tlsCertPath?: string   // PEM 证书路径，配了就启用 wss://
  tlsKeyPath?: string    // 配了 cert 就必须配
  token?: string         // 远程客户端鉴权 token，首次开启时自动生成
}
```

### 内部状态

| 键 | 类型 | 说明 |
|---|---|---|
| `dismissedUpdateVersion` | `string` | 用户忽略的版本，不再对该版本提示更新 |
| `setupDeferred` | `boolean` | 引导流程里选了「稍后设置」，下次启动跳过引导 |
| `migrationsApplied` | `string[]` | **一次性迁移标记**。用于「每个用户最多跑一次」的迁移（例如把曾被移除的模型恢复进连接列表，但用户后来又主动删掉就不再加回） |

> **加新的持久化字段时**：必须是可选并给默认值（老用户的 `config.json` 里没有）；如果是 `LlmConnection` 上的字段，**还要加进 `updateLlmConnection` 的硬编码白名单**，否则下次保存被静默丢弃（#838）。

### 自动备份

每天一份 `config.json.bak-YYYY-MM-DD`，保留最近 3 份。调试迁移时可以拿来对照。

## `preferences.json` — `UserPreferences`

这份文件的内容**会被注入系统提示词**（`formatPreferencesForPrompt()`），所以它不只是设置，而是给模型的用户画像。

| 键 | 类型 | 说明 |
|---|---|---|
| `name` | `string` | 用户名字 |
| `timezone` | `string` | 时区 |
| `location` | `UserLocation` | 地理位置 |
| `notes` | `string` | **Agent 自己学到的关于用户的自由笔记** |
| `diffViewer` | `DiffViewerPreferences` | diff 查看器显示偏好 |
| `includeCoAuthoredBy` | `boolean`（默认 `true`） | git commit 是否带 `Co-Authored-By` 尾注 |
| `uiLanguage` | `LanguageCode` | 界面语言 |
| `updatedAt` | `number` | 最后更新时间戳 |

### `uiLanguage` 的两条特殊规则

1. **不可通过 `update_user_preferences` 工具修改** —— 界面的 Appearance 下拉是唯一写入方。Agent 改不了用户的界面语言。
2. **主进程靠它恢复语言** —— 主进程的 i18n 没有检测插件（Node 里没有 `localStorage`），启动时从这个字段恢复，否则每次重启都退回英文。会话标题的语言也走它（`resolveTitleLanguageName()`），**不是** `i18n.resolvedLanguage`（后者在早期标题生成时可能还是 `'en'`，#885）。

### 读取时的净化

`loadPreferences()` 会**剥掉历史遗留的自由文本 `language` 字段**再返回 —— 旧值是 `"Hungarian"`、`"English"` 这种自然语言而非语言码，直接丢弃不迁移，避免写回时污染。

## `workspaces/{ws}/config.json` — `WorkspaceConfig`

```ts
{
  id, name, slug,
  defaults?: {
    model?, defaultLlmConnection?, enabledSourceSlugs?,
    permissionMode?,              // 'safe' | 'ask' | 'allow-all'
    cyclablePermissionModes?,     // SHIFT+TAB 可循环的模式，至少 2 个
    workingDirectory?, thinkingLevel?, colorTheme?,
  },
  localMcpServers?: { enabled: boolean },
  createdAt,
}
```

`localMcpServers.enabled` 的解析优先级：

```
环境变量 CRAFT_LOCAL_MCP_ENABLED  >  workspace 配置  >  默认 true
```

> **私有化部署的安全开关**：关掉后不允许启动 stdio 类型的 MCP 子进程，即 Agent 无法在宿主机上拉起任意本地进程。

`colorTheme` 在这里会**覆盖应用级**的同名设置（级联主题）。

## 环境变量

完整的服务端环境变量表见 [12-build-deploy](12-build-deploy.md)。这里补充**桌面端/开发用**的：

| 变量 | 默认 | 用途 |
|---|---|---|
| `CRAFT_CONFIG_DIR` | `~/.craft-agent` | 数据目录（覆盖不彻底，见 13 章） |
| `CRAFT_APP_NAME` | `华小竹` | 运行时应用名，多实例开发用 |
| `CRAFT_DEEPLINK_SCHEME` | `huaxiaozhu` | 深链协议名，多实例开发用 |
| `CRAFT_INSTANCE_NUMBER` | — | 实例编号 |
| `CRAFT_VITE_PORT` | 自动 | Vite 开发服务器端口 |
| `VITE_DEV_SERVER_URL` | — | Vite 开发服务器地址 |
| `CRAFT_DEV_RUNTIME` | — | 本地打包时让运行时解析器向上找 monorepo（见 12 章） |
| `CRAFT_LOCAL_MCP_ENABLED` | `true` | 是否允许 stdio MCP 子进程 |
| `CRAFT_DEBUG` | — | 详细日志 |
| `ANTHROPIC_BASE_URL` | `https://api.anthropic.com` | 覆盖 Anthropic 端点 |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN` / `AWS_REGION` / `AWS_PROFILE` | — | Bedrock 认证 |

## 与官方在线文档的偏差

官方配置文档在 <https://docs-aiadp.hxsyai.com/docs/reference/config/config-file>。已核实的不一致：

| 官方文档 | v0.11.4 实测 |
|---|---|
| 环境变量 `CRAFT_ANTHROPIC_API_KEY` | ❌ 源码中**不存在** |
| 环境变量 `CRAFT_CLAUDE_OAUTH_TOKEN` | ❌ 源码中**不存在** |
| `config.json` 的 `pendingUpdate` 字段（版本 / 安装包路径 / SHA256） | ❌ `StoredConfig` 中**不存在** |
| 未提及 | ✅ 实际存在：`rtkEnabled`、`networkProxy`、`allowRemoteEvaluate`、`enable1MContext`、`extendedPromptCache`、`serverConfig`、`gitBashPath`、`migrationsApplied`、`defaultThinkingLevel`、`setupDeferred`、`autoCapitalisation`、`sendMessageKey`、`spellCheck`、`keepAwakeWhileRunning`、`richToolDescriptions`、`browserToolEnabled` |

**判定方法**：官方文档里看到任何键名，落地前先 `grep` 源码确认。反过来，官方没写的键不代表不存在 —— 以 `StoredConfig` 的定义为准。

## 排查清单

| 症状 | 看哪里 |
|---|---|
| 新增的配置字段保存后消失 | `LlmConnection` 上的字段要加进 `updateLlmConnection` 白名单 |
| 老用户升级后崩溃 | 新字段没设成可选、没给默认值 |
| 改了 `CRAFT_CONFIG_DIR` 但部分数据还在老目录 | 有 10 处代码绕过 `CONFIG_DIR`，见 13 章 |
| Windows 上 Bash 工具找不到 | `gitBashPath` 没配 |
| 内网环境模型请求超时 | `networkProxy` 没配 |
| Agent 改不了界面语言 | 设计如此：`uiLanguage` 只有 Appearance 下拉能写 |
| 会话标题语言不对 | 走 `resolveTitleLanguageName()` 而非 `i18n.resolvedLanguage` |
| 想禁止 Agent 在宿主机拉子进程 | `CRAFT_LOCAL_MCP_ENABLED=false` 或 workspace 的 `localMcpServers.enabled` |
