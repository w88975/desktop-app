---
name: electron-ipc
description: 本项目主进程与渲染进程通信、新增或修改 RPC 方法时使用。说明 WS RPC 架构、新增 API 必改的 4 个文件、LOCAL_ONLY 与 REMOTE_ELIGIBLE 信道分类规则。涉及 electronAPI、preload、transport、channel、新增后端方法时触发。
---

# 进程间通信（WS RPC）

## 先纠正一个预期

**本项目不用 `ipcRenderer.invoke`。** 通信走一层 WebSocket RPC，这样同一套渲染层代码既能跑在 Electron 里，也能跑在浏览器（webui）里，还能连远程服务器。

```
渲染进程  window.electronAPI.getSessions()
   │        由 buildClientApi() 依据 CHANNEL_MAP 动态生成，不是手写的
   ▼
preload   RoutedClient  ──┬── localClient      → 本地内嵌服务（LOCAL_ONLY）
                          └── workspaceClient  → 拥有当前 workspace 的服务（REMOTE_ELIGIBLE，可能在远端）
   ▼
服务端    ws://127.0.0.1:<port>
```

关键文件：

| 文件 | 职责 |
|---|---|
| `packages/shared/src/protocol/channels.ts` | 信道名常量（`RPC_CHANNELS`），**wire format 是稳定契约** |
| `packages/shared/src/protocol/routing.ts` | 信道分类，两个 Set |
| `apps/electron/src/transport/channel-map.ts` | 方法名 → 信道 |
| `apps/electron/src/transport/routed-client.ts` | 按分类路由 |
| `apps/electron/src/transport/build-api.ts` | 由 CHANNEL_MAP 生成 API 代理 |
| `apps/electron/src/shared/types.ts` | `ElectronAPI` 接口（编译期类型约束） |

## 新增一个 API 方法：必改 4 处

漏掉任何一处都会失败，且报错位置离病因很远。按顺序改：

### 1. 定义信道 — `packages/shared/src/protocol/channels.ts`

```ts
export const RPC_CHANNELS = {
  sessions: {
    GET: 'sessions:get',
    MY_NEW_METHOD: 'sessions:myNewMethod',   // ← 加这里
  },
}
```

命名遵循 `domain:camelCase`。**值是对外契约，改动等于破坏兼容性**；键名可以自由重组。

### 2. 分类信道 — `packages/shared/src/protocol/routing.ts`

必须归入且仅归入两个 Set 之一：

- **`LOCAL_ONLY_CHANNELS`** — 从根本上依赖本机 OS / Electron。窗口管理、原生对话框（文件/文件夹选择）、shell 打开、本地文件路径、workspace 列表这类本地配置。
- **`REMOTE_ELIGIBLE_CHANNELS`** — 属于 workspace 的数据，谁持有 workspace 就由谁处理。会话、消息、任务、工具调用等绝大多数业务方法。

判断口诀：

> 这个调用在「workspace 在远程服务器上」时，还应该在本机执行吗？
> 是 → LOCAL_ONLY　　否 → REMOTE_ELIGIBLE

分类错的典型后果：把一个本地文件路径相关的信道标成 REMOTE_ELIGIBLE，远程服务器拿到本机路径却解析不了。仓库里 `file.READ_USER_ATTACHMENT` 的注释就记录了这个坑。

**忘记分类会被 CI 拦住** —— 有穷尽性测试保证新信道未分类即失败：

```bash
cd packages/shared && bun test src/protocol     # 8 tests
```

### 3. 映射方法名 — `apps/electron/src/transport/channel-map.ts`

```ts
export const CHANNEL_MAP = {
  myNewMethod: invoke(RPC_CHANNELS.sessions.MY_NEW_METHOD),        // 请求/响应
  onMyNewEvent: listener(RPC_CHANNELS.sessions.MY_NEW_EVENT),      // 服务端推送
}
```

`invoke` 可选传 `transform` 对返回值做转换。渲染进程侧的 `window.electronAPI.myNewMethod()` 由此自动生成，**不需要手写 preload**。

### 4. 类型 + 服务端 handler

在 `apps/electron/src/shared/types.ts` 的 `ElectronAPI` 接口里补方法签名（运行时是代理，类型全靠这个接口约束），并在服务端注册对应 handler。

## 第 5 处：新增 LOCAL_ONLY 时别忘了 webui

webui 跑在浏览器里，没有本地 Electron。`apps/webui/src/adapter/web-api.ts` 逐个覆盖了 LOCAL_ONLY 方法的 web 等价实现。

**新增 LOCAL_ONLY 信道时，如果 webui 也需要这个能力，必须在这里补一个实现**，否则 webui 静默缺功能。REMOTE_ELIGIBLE 信道不受影响。

## 验证

```bash
cd packages/shared && bun test src/protocol              # 信道分类穷尽性
cd apps/electron && bun test src/transport               # 路由行为
bun run typecheck:all
```
