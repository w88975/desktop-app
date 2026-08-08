# 教程 · 加一个业务工具

> 基于上游 craft-agents-oss v0.11.4 · 核验于 2026-08-08

**目标**：给 Agent 加一个自研工具 `lookup_patient`，让它能查询内部系统。

**关键收益**：改一个包，**两个后端（Claude 与 Pi）自动都有**。

先读 [09-tools-sources-mcp](../09-tools-sources-mcp.md) 的「工具的三个来源」。

## 先确认该不该写代码

| 需求 | 做法 |
|---|---|
| 接一个已有 MCP 服务器 | 加一个 **Source**（`type: 'mcp'`），零代码 |
| 接一个 REST API | 加一个 **Source**（`type: 'api'`）+ 写好 `guide.md`，零代码 |
| 能力属于产品本身、与用户配置无关 | 加 **session 工具** ← 本篇 |
| 需要模型/浏览器等后端运行时能力 | session 工具 + `executionMode: 'backend'`，代价翻倍 |

**先考虑 Source。** 它不改代码、按 workspace 配置、凭据有现成的加密与刷新机制。只有当能力是「所有用户、所有 workspace 都该有的产品能力」时，才写成 session 工具。

## 全部改动都在 `packages/session-tools-core/`

```
packages/session-tools-core/src/
├── tool-defs.ts              ① schema  ② 描述  ④ 注册
├── handlers/
│   ├── lookup-patient.ts     ③ 实现（新建）
│   └── index.ts              ③ 导出
└── context.ts                （需要新宿主能力时才动）
```

## 第 1 步 · 定义 schema

`packages/session-tools-core/src/tool-defs.ts`

```ts
// [aidp] begin: 内部患者信息查询
export const LookupPatientSchema = z.object({
  patientId: z.string().describe('患者唯一标识'),
  fields: z.array(z.string()).optional().describe('需要返回的字段，省略则返回摘要'),
})
// [aidp] end
```

**`.describe()` 不是可选的** —— 它会变成模型看到的参数说明。写得含糊，模型就会传错参数。

## 第 2 步 · 写工具描述

同文件的 `TOOL_DESCRIPTIONS`：

```ts
export const TOOL_DESCRIPTIONS = {
  // ...
  // [aidp]
  lookup_patient: `按患者 ID 查询基本信息。

用于：用户提到某个患者 ID 且需要其基本信息时。
不用于：批量导出、统计分析（那些走数据平台）。
返回：姓名、年龄、主要诊断的摘要文本。找不到时返回明确的错误说明。`,
}
```

这段文字是**模型判断「何时该调这个工具」的唯一依据**，比实现代码更影响实际效果。写清楚「用于什么」和「不用于什么」。

## 第 3 步 · 实现 handler

新建 `packages/session-tools-core/src/handlers/lookup-patient.ts`：<!-- docs-links-ok 教程示例文件 -->

```ts
import type { SessionToolContext } from '../context.ts'
import type { ToolResult } from '../types.ts'
import { successResponse, errorResponse } from '../response.ts'

export interface LookupPatientArgs {
  patientId: string
  fields?: string[]
}

export async function handleLookupPatient(
  ctx: SessionToolContext,
  args: LookupPatientArgs
): Promise<ToolResult> {
  try {
    const record = await fetchPatient(args.patientId, args.fields)
    if (!record) {
      return errorResponse(`未找到患者 ${args.patientId}。请确认 ID 是否正确。`)
    }
    return successResponse(formatPatient(record))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return errorResponse(`查询失败：${message}`)
  }
}
```

从 `handlers/index.ts` 导出。

### 三条实现约定

**① 用 `successResponse` / `errorResponse`，不要手搓 `ToolResult`**

`errorResponse` 会给文本加 `[ERROR]` 前缀 —— 因为 OpenAI Responses API 的 `function_call_output` **只有一个纯字符串 `output` 字段，没有 `success` / `status` / `error`**。`isError: true` 对模型是不可见的，前缀是模型唯一能识别失败的方式。（`response.ts` 的注释里有完整背景。）

**② 错误信息是写给模型看的，不是写给日志的**

对比一下现有代码的写法：

```ts
// ❌ 模型无从下手
return errorResponse('Invalid status')

// ✅ 模型知道下一步怎么做（摘自 set-session-status.ts）
return errorResponse(
  `Unknown status: "${status}". Available status IDs: ${available.join(', ')}`
)
```

**③ 宿主能力从 `ctx` 拿，不要直接 import**

`SessionToolContext` 提供 `sessionId`、`workspacePath`、`workspaceRootPath`、`workingDirectory`、`plansFolderPath`、`fs`（文件系统接口）、`credentialManager`、`callbacks`，以及一批可选的宿主方法（`setSessionStatus`、`resolveStatus` 等）。

**可选的宿主方法必须先判空**，因为不是所有宿主都提供：

```ts
if (!ctx.setSessionStatus) {
  return errorResponse('set_session_status is not available in this context.')
}
```

## 第 4 步 · 注册

`SESSION_TOOL_DEFS` 数组加一条：

```ts
export const SESSION_TOOL_DEFS: SessionToolDef[] = [
  // ...
  // [aidp] 内部患者信息查询
  {
    name: 'lookup_patient',
    description: TOOL_DESCRIPTIONS.lookup_patient,
    inputSchema: LookupPatientSchema,
    executionMode: 'registry',
    safeMode: 'allow',
    readOnly: true,
    handler: handleLookupPatient,
  },
]
```

四个字段怎么选：

| 字段 | 本例 | 判断依据 |
|---|---|---|
| `executionMode` | `'registry'` | **默认选它**。选 `'backend'` 意味着 Claude 和 Pi 各实现一遍 |
| `safeMode` | `'allow'` | 只读查询，Explore 模式下允许。**任何有副作用的都必须 `'block'`** |
| `readOnly` | `true` | 无副作用，支持并行的后端可以并行调 |
| `handler` | 函数 | `'registry'` 必须给；`'backend'` 必须是 `null` |

**到这里就完成了。** 不需要分别改两个后端：

- Claude 侧：`claude-agent.ts` 的 `createSdkMcpServer()` 从注册表生成
- Pi 侧：`backend/pi/session-tool-defs.ts` 的 `getSessionToolProxyDefs()` 生成（自动加 `mcp__session__` 前缀）

## 验证

```bash
# 1. 工具集在两个后端对齐（漏注册会红）
cd packages/shared && bun test src/agent/backend

# 2. session-tools-core 自身
cd packages/session-tools-core && bun test

# 3. 类型
bun run typecheck:all

# 4. 工具名检查
bun run lint:tool-name-checks

# 5. Pi 子进程要重建才能拿到新工具
bun run server:build:subprocess

# 6. 跑起来
bun run electron:dev
```

端到端：**两个后端都要测**。

1. 用 Anthropic 连接开一个会话，让它调这个工具
2. 用 Pi 连接（任意非 Anthropic 模型）再开一个，重复一遍
3. 切到 Explore（`safe`）模式，确认 `safeMode` 的行为符合预期

## 常见问题

| 现象 | 原因 |
|---|---|
| `session-tool-parity.test.ts` 变红 | 用了 `executionMode: 'backend'` 却只实现了一边 |
| Pi 会话里没有这个工具，Claude 有 | 忘了 `bun run server:build:subprocess` |
| 模型从来不调这个工具 | `TOOL_DESCRIPTIONS` 写得太含糊，或参数 `.describe()` 缺失 |
| 模型调了但传错参数 | schema 的 `.describe()` 不够具体 |
| Explore 模式下意外可用 | `safeMode` 应该是 `'block'` |
| 工具报错但模型当成功了 | 没用 `errorResponse`，缺 `[ERROR]` 前缀 |

## 变体：需要后端运行时能力

如果工具必须调用模型（像 `call_llm`）或操作浏览器实例（像 `browser_tool`），只能用 `executionMode: 'backend'`：

```ts
{
  name: 'my_backend_tool',
  description: TOOL_DESCRIPTIONS.my_backend_tool,
  inputSchema: MyBackendToolSchema,
  executionMode: 'backend',
  safeMode: 'allow',
  handler: null,          // 必须是 null
}
```

然后**两边都要实现**：

- Claude 侧：`packages/shared/src/agent/claude-agent.ts`
- Pi 侧：`packages/pi-agent-server/src/index.ts`（子进程内）

> ⚠️ 这两处都是上游文件里的手工合并区，每次上游同步都要人工处理。**能用 `'registry'` 就别用 `'backend'`。**

## 变体：加一个 Source 而不是工具

如果结论是「该做成 Source」，就没有代码要写：

1. 建目录 `~/.craft-agent/workspaces/{ws}/sources/patient-api/`
2. 写 `config.json`（`type: 'api'`，端点、认证方式）
3. 写 `guide.md` —— **这一步的质量决定一切**，它会被注入上下文告诉模型这个 source 能干什么、怎么用、有什么坑
4. 在应用里点「测试连接」

细节见 [09-tools-sources-mcp](../09-tools-sources-mcp.md) 的 Source 一节。
