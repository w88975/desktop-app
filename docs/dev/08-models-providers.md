# 08 · 模型与供应商接入

> 基于上游 craft-agents-oss v0.11.4 · 核验于 2026-08-08

先读 [07-agent-core](07-agent-core.md) 的双后端一节，这一篇是它的展开。

## 核心概念：LlmConnection

一个「模型接入配置」就是一条 `LlmConnection`（定义在 `packages/shared/src/config/llm-connections.ts`，持久化在 `~/.craft-agent/config.json` 的 `llmConnections` 数组里）。

一个 workspace 可以配多条，会话按 slug 选用。

```ts
interface LlmConnection {
  slug: string            // URL 安全的唯一标识，如 'anthropic-api'、'ollama-local'
  name: string            // 界面显示名
  providerType: LlmProviderType   // 决定用哪个后端 / SDK
  authType: LlmAuthType           // 决定凭据怎么存、怎么传、UI 长什么样
  baseUrl?: string                // 自定义端点（pi_compat 必填）
  piAuthProvider?: string         // Pi SDK 侧的供应商名，仅 providerType='pi' 有意义
  customEndpoint?: CustomEndpointConfig   // 自建端点的协议配置
  models?: Array<ModelDefinition | string>  // 覆盖可用模型列表
  defaultModel?: string
  modelSelectionMode?: ModelSelectionMode
  midStreamBehavior?: MidStreamBehavior
  // ... OAuth 身份信息、时间戳
}
```

**凭据不存在这里。** API Key / OAuth token 走 `packages/shared/src/credentials/`，加密后落在 `~/.craft-agent/credentials.enc`，通过 `getLlmCredentialKey(slug, type)` 关联。

## 三个 providerType

```
anthropic  ──→ ClaudeAgent（Claude Agent SDK）
pi         ──→ PiAgent，用 Pi SDK 内置的供应商目录
pi_compat  ──→ PiAgent，指向任意兼容端点
```

`providerType` 与 `authType` 的合法组合是**封闭集合**（`isValidProviderAuthCombination`）：

| providerType | 允许的 authType |
|---|---|
| `anthropic` | `api_key`、`oauth` |
| `pi` | `api_key`、`oauth`、`iam_credentials`、`environment`、`none` |
| `pi_compat` | `api_key_with_endpoint`、`none` |

`authType` 全集：`api_key` / `api_key_with_endpoint` / `oauth` / `iam_credentials`（AWS 风格）/ `bearer_token` / `service_account_file`（GCP 风格）/ `environment`（从环境变量自动探测）/ `none`（本地模型如 Ollama）。

## Pi 的模型目录来自 SDK，不是我们的表

这是最容易误解的一点。

`packages/shared/src/config/models-pi.ts` **不维护供应商列表**，它调用 Pi SDK 的 `getProviders()` / `getModels()` 动态取：

```ts
import { getProviders, getModels } from '@earendil-works/pi-ai/compat'
```

我们在这个文件里只做三件事：

1. **排除**已知有问题的模型/供应商 —— `PI_EXCLUDED_MODELS`、`PI_EXCLUDED_MODEL_PREFIXES`、`PI_EXCLUDED_PROVIDERS`
2. **显示名覆盖** —— `PI_PROVIDER_DISPLAY`，没配的用 `formatProviderName()` 从 key 推（`vercel-ai-gateway` → `Vercel Ai Gateway`）
3. **格式转换** —— `piModelToDefinition()` 把 SDK 的 `Model` 转成我们的 `ModelDefinition`，id 加 `pi/` 前缀

推论：

- **「Pi 新支持了某供应商」= 升级 `@earendil-works/pi-ai` 版本**，不是改我们的代码
- 想临时屏蔽某个模型 → 加进排除清单，这是个正当的定制点
- 想改显示名 → `PI_PROVIDER_DISPLAY`

> ⚠️ **`models-pi.ts` 绝不能被渲染进程 import。** 它传递依赖到 `@aws-sdk/client-bedrock-runtime` → Node 的 `stream`，会炸掉 Vite 的渲染进程构建。文件头有明确警告。只允许主进程、服务端、构建脚本、CLI 使用。渲染进程需要模型信息时走 RPC（`llmConnections` / `pi` 域的信道）。

Anthropic 侧则相反 —— `packages/shared/src/config/models.ts` 的 `MODEL_REGISTRY` 是**硬编码**的，因为它要在渲染进程里也能用。加 Claude 新模型要改这张表。

## 接入一个新供应商：三条路

### 路线 A：Pi SDK 已支持 —— 零代码

在应用界面 Settings → AI 里加连接即可。程序化创建的话：

```ts
{
  slug: 'my-vendor',
  name: 'My Vendor',
  providerType: 'pi',
  authType: 'api_key',
  piAuthProvider: 'my-vendor',   // 必须是 getProviders() 返回的名字之一
}
```

`getPiApiKeyProviders()` 返回当前可选的供应商列表（已过滤排除项、按 anthropic → google → openai 优先排序）。

### 路线 B：OpenAI / Anthropic 协议兼容的自建端点 —— 零代码

这是**接内部模型网关最常见的路线**。

```ts
{
  slug: 'internal-gateway',
  name: '内部模型网关',
  providerType: 'pi_compat',
  authType: 'api_key_with_endpoint',
  baseUrl: 'https://llm.internal.example.com/v1',
  customEndpoint: {
    api: 'openai-completions',   // 或 'anthropic-messages'
    supportsImages: false,       // 显式声明，不会自动猜
  },
  models: [
    { id: 'internal-large', name: 'Internal Large', contextWindow: 128_000, supportsImages: true },
    'internal-small',            // 字符串形式默认 128K 上下文
  ],
}
```

`CustomEndpointApi` 只有两个值：`openai-completions` 与 `anthropic-messages`。它决定 Pi SDK 用哪个流式适配器。

**能力覆盖的优先级**：每个模型对象上的 `supportsImages` 覆盖 `customEndpoint.supportsImages` 这个端点级默认值。`supportsImages: false` 必须能够覆盖端点级的 `true` —— 这条在 `packages/pi-agent-server/src/custom-endpoint-models.ts` 里有专门处理，改的时候别破坏。

完整操作步骤见教程 [接入自建端点](14-walkthroughs/add-model-endpoint.md)。

### 路线 C：需要新的 OAuth 流程 —— 少量代码

`packages/shared/src/auth/` 下已有 Claude、ChatGPT、Google、Microsoft、Slack 和一个通用 OAuth 实现（`generic-oauth.ts`）。

新增一个 OAuth 供应商大致是：写一份 `xxx-oauth-config.ts`（授权/令牌端点、scope）+ 一份 `xxx-oauth.ts`（换取与刷新），复用 `pkce.ts`、`callback-server.ts`、`oauth-flow-store.ts`。

> **新增持久化字段的坑（#838）**：`updateLlmConnection` 用一份**硬编码的白名单**重建连接对象。往 `LlmConnection` 上加了新字段却没加进那份白名单，字段会在下一次保存时被静默丢弃。

## 模型解析链路

一次会话到底用哪个模型，经过这些环节：

```
会话的 model 字段
   │  没有 → workspace defaults.model
   │  没有 → 连接的 defaultModel
   │  没有 → getDefaultModelForConnection(providerType, piAuthProvider)
   ▼
normalizeDeprecatedModelId()      废弃 id 的迁移映射
   ▼
Pi 侧：resolvePiModel()           自定义端点优先级、找不到时的回退
Claude 侧：MODEL_REGISTRY 查表
   ▼
实际请求
```

几个相关函数（都在 `config/llm-connections.ts`）：

| 函数 | 用途 |
|---|---|
| `getModelsForProviderType()` | 列出某 providerType 可用的模型 |
| `getDefaultModelsForConnection()` | 新建连接时的默认模型列表 |
| `PI_PREFERRED_DEFAULTS` | 各 Pi 供应商的首选默认模型（按优先级数组） |
| `getMiniModel()` / `getSummarizationModel()` | 挑便宜的小模型做标题生成 / 摘要 |
| `isDeniedMiniModelId()` | 某些模型不适合当 mini model，在这里拦掉 |
| `resolveEffectiveConnectionSlug()` | 会话绑的连接被删了时怎么回退 |

### AWS Bedrock 的模型 ID 特殊处理

Bedrock 拒绝裸模型 ID（`anthropic.claude-opus-4-8`），必须用带区域前缀的推理配置 ID（`us.anthropic.claude-opus-4-8`）。

`llm-connections.ts` 里有三张表处理这件事：`BEDROCK_MODEL_MAP`（正向）、`BEDROCK_REVERSE_MAP`（反向，含 us/eu/global 三套前缀）、`deriveBedrockRegionPrefix()`（从 AWS region 推前缀，`eu-*` → `eu`，其余一律 `us`）。

**加新的 Claude 模型时，这三张表要一起更新**，否则 Bedrock 连接会在运行时失败。

## 连接的生命周期

| 阶段 | 涉及 |
|---|---|
| 创建 | `llmConnections.SETUP` RPC → 建连接记录 + 存凭据。OAuth 的身份信息在这一步写入，**不是**在 EXCHANGE 那一步（连接记录此时才存在） |
| 校验 | `validateConnection()` / `testBackendConnection()` → driver 的 `testConnection` |
| 拉模型列表 | `model-fetcher.ts` + driver 的 `fetchModels`；`initModelRefreshService()` 在启动时装好定期刷新 |
| 修改 | `llmConnections.SAVE` RPC → 主动推 `SessionManager.refreshConnectionRuntime()` 给活跃会话热更 |
| 热更 vs 重启 | `runtime-config.ts` 的 `buildRestartRequiredSignature()` 判定，见下 |

### 哪些改动能热更，哪些必须重启后端

`update_runtime_config` 这个子进程 IPC **只带** `model`、`providerType`、`authType`、`baseUrl`、`customEndpoint`、`customModels`。

`piAuthProvider`、`slug` 以及更广的凭据/路由状态**改不了**。`buildRestartRequiredSignature()` 把这批字段单独哈希；签名变了就跳过原地更新，直接销毁并重建后端。

改这块时的判断标准：**这个字段能在活着的子进程里安全生效吗**？不能就必须进 restart signature。

## 排查清单

| 症状 | 看哪里 |
|---|---|
| 渲染进程构建炸在 Node `stream` 模块 | 有代码从渲染进程 import 了 `models-pi.ts` |
| 新加的连接字段保存后消失 | `updateLlmConnection` 的白名单没加 |
| Bedrock 报「Retry with the ID or ARN of an inference profile」 | 模型 ID 没走 Bedrock 映射表 |
| 改了连接配置但会话没生效 | 该字段可能需要重启后端，看 restart signature 是否覆盖它 |
| 自建端点报「Stream ended without finish_reason」 | 见 `packages/shared/CLAUDE.md` 里 OpenAI SSE 剥离流那条 |
| 某个模型在列表里看不到 | `PI_EXCLUDED_MODELS` / `PI_EXCLUDED_MODEL_PREFIXES` |
| 供应商列表里没有想要的 | `PI_EXCLUDED_PROVIDERS`；或 Pi SDK 版本不支持，需升级 |
