# 教程 · 加一个设置项

> 基于上游 craft-agents-oss v0.11.4 · 核验于 2026-08-08

**目标**：加一个应用级布尔设置「会话完成时播放提示音」，从设置页开关一路打通到磁盘持久化。

**为什么先做这个**：它完整覆盖了 [06-rpc](../06-rpc.md) 里那 4 处必改点，是理解本项目通信层最快的方式。做完这一个，其它 RPC 方法都是同一套路。

**参照实现**：`appearance:getRichToolDescriptions` / `setRichToolDescriptions` —— 下面每一步都可以对着它抄。

> 代码为节选示意，保留真实的类型名与路径，省略了无关分支。

## 全景

```
渲染进程  设置页开关
   │  window.electronAPI.getPlayCompletionSound() / set...()
   ▼  ①③④ 定义信道 → 分类 → 映射方法名 + 补类型
服务端    settings handler
   ▼  ⑤ 注册 handler
storage   getPlayCompletionSound() / setPlayCompletionSound()
   ▼
~/.craft-agent/config.json
```

## 第 1 步 · 定义信道

`packages/shared/src/protocol/channels.ts`

```ts
export const RPC_CHANNELS = {
  // ...
  appearance: {
    GET_RICH_TOOL_DESCRIPTIONS: 'appearance:getRichToolDescriptions',
    SET_RICH_TOOL_DESCRIPTIONS: 'appearance:setRichToolDescriptions',
    // [aidp] begin: 会话完成提示音
    GET_PLAY_COMPLETION_SOUND: 'appearance:getPlayCompletionSound',
    SET_PLAY_COMPLETION_SOUND: 'appearance:setPlayCompletionSound',
    // [aidp] end
  },
}
```

命名规则 `domain:camelCase`。**字符串值是对外契约**，定了就别改。

> 这是修改上游文件，按 [04-conventions](../04-conventions.md) 打 `[aidp]` 标记。

## 第 2 步 · 分类信道

`packages/shared/src/protocol/routing.ts`

这是个应用级的本地 UI 偏好，跟着同域的 `RICH_TOOL_DESCRIPTIONS` 放进 `LOCAL_ONLY_CHANNELS`：

```ts
export const LOCAL_ONLY_CHANNELS = new Set<string>([
  // ...
  // appearance — local UI preferences
  RPC_CHANNELS.appearance.GET_RICH_TOOL_DESCRIPTIONS,
  RPC_CHANNELS.appearance.SET_RICH_TOOL_DESCRIPTIONS,
  // [aidp] 会话完成提示音 —— 与同域其它外观偏好一致，属本机 UI 偏好
  RPC_CHANNELS.appearance.GET_PLAY_COMPLETION_SOUND,
  RPC_CHANNELS.appearance.SET_PLAY_COMPLETION_SOUND,
])
```

**漏了这一步会被测试直接拦住**（穷尽性校验），这是设计好的：

```bash
cd packages/shared && bun test src/protocol
# Channel "appearance:getPlayCompletionSound" is not classified in
# LOCAL_ONLY or REMOTE_ELIGIBLE. Add it to one set in routing.ts.
```

## 第 3 步 · 存储读写

`packages/shared/src/config/storage.ts`，照抄 `getRichToolDescriptions` 的结构：

```ts
// [aidp] begin: 会话完成提示音
/** 会话完成时是否播放提示音。未设置时默认 false。 */
export function getPlayCompletionSound(): boolean {
  const config = loadStoredConfig()
  if (config?.playCompletionSound !== undefined) {
    return config.playCompletionSound
  }
  return false
}

export function setPlayCompletionSound(enabled: boolean): void {
  const config = loadStoredConfig()
  if (!config) return
  config.playCompletionSound = enabled
  saveConfig(config)
}
// [aidp] end
```

同时在同文件的 `StoredConfig` 类型上加 `playCompletionSound?: boolean`。

> **必须是可选字段并给默认值** —— 老用户的 `config.json` 里没有这个键，读出来是 `undefined`。见 [10-sessions-data](../10-sessions-data.md) 的数据迁移一节。

## 第 4 步 · 注册服务端 handler

`packages/server-core/src/handlers/rpc/settings.ts`

先把信道加进模块顶部的 `HANDLED_CHANNELS`：

```ts
export const HANDLED_CHANNELS = [
  // ...
  RPC_CHANNELS.appearance.GET_RICH_TOOL_DESCRIPTIONS,
  RPC_CHANNELS.appearance.SET_RICH_TOOL_DESCRIPTIONS,
  RPC_CHANNELS.appearance.GET_PLAY_COMPLETION_SOUND,   // [aidp]
  RPC_CHANNELS.appearance.SET_PLAY_COMPLETION_SOUND,   // [aidp]
] as const
```

再在 `registerSettingsHandlers()` 里注册：

```ts
// [aidp] begin: 会话完成提示音
server.handle(RPC_CHANNELS.appearance.GET_PLAY_COMPLETION_SOUND, async () => {
  const { getPlayCompletionSound } = await import('@craft-agent/shared/config/storage')
  return getPlayCompletionSound()
})

server.handle(RPC_CHANNELS.appearance.SET_PLAY_COMPLETION_SOUND, async (_ctx, enabled: boolean) => {
  const { setPlayCompletionSound } = await import('@craft-agent/shared/config/storage')
  setPlayCompletionSound(enabled)
})
// [aidp] end
```

两个要点：

- **放在 `server-core`，不要放在 `apps/electron/src/main/handlers/`** —— 后者只在 Electron GUI 模式注册，headless 服务端和 webui 会缺这个功能
- `await import(...)` 的动态导入是这个文件的既有风格，跟着写即可（避免顶层加载 Node-only 模块）

## 第 5 步 · 映射方法名

`apps/electron/src/transport/channel-map.ts`

```ts
export const CHANNEL_MAP = {
  // ...
  getRichToolDescriptions: invoke(RPC_CHANNELS.appearance.GET_RICH_TOOL_DESCRIPTIONS),
  setRichToolDescriptions: invoke(RPC_CHANNELS.appearance.SET_RICH_TOOL_DESCRIPTIONS),
  // [aidp] begin: 会话完成提示音
  getPlayCompletionSound: invoke(RPC_CHANNELS.appearance.GET_PLAY_COMPLETION_SOUND),
  setPlayCompletionSound: invoke(RPC_CHANNELS.appearance.SET_PLAY_COMPLETION_SOUND),
  // [aidp] end
}
```

**到这里 `window.electronAPI.getPlayCompletionSound()` 就已经存在了** —— preload 完全不用动，API 是由这张表动态生成的。

## 第 6 步 · 补类型

`apps/electron/src/shared/types.ts` 的 `ElectronAPI` 接口：

```ts
export interface ElectronAPI {
  // ...
  getRichToolDescriptions(): Promise<boolean>
  setRichToolDescriptions(enabled: boolean): Promise<void>
  // [aidp] begin: 会话完成提示音
  getPlayCompletionSound(): Promise<boolean>
  setPlayCompletionSound(enabled: boolean): Promise<void>
  // [aidp] end
}
```

**这一步不能省。** 运行时是 Proxy，编译期的全部约束都来自这个接口 —— 不补的话调用点没有任何类型检查。

## 第 7 步 · 接到设置页

`apps/electron/src/renderer/pages/settings/AppearanceSettingsPage.tsx`

```tsx
// [aidp] begin: 会话完成提示音
const [playCompletionSound, setPlayCompletionSound] = useState(false)

useEffect(() => {
  window.electronAPI?.getPlayCompletionSound?.().then(setPlayCompletionSound)
}, [])

const handlePlayCompletionSoundChange = useCallback(async (checked: boolean) => {
  setPlayCompletionSound(checked)                              // 乐观更新
  await window.electronAPI?.setPlayCompletionSound?.(checked)
}, [])
// [aidp] end
```

`?.` 可选链是这个文件的既有写法 —— 兼容 API 尚未就绪或运行在 webui 且服务端没注册该信道的情况。

界面部分跟着页面里已有的 Switch 组件写。文案要走 i18n：

```tsx
<Switch
  checked={playCompletionSound}
  onCheckedChange={handlePlayCompletionSoundChange}
/>
<Label>{t('settings.appearance.playCompletionSound')}</Label>
```

## 第 8 步 · 补 i18n

**新增 key 必须补齐全部 7 个 locale 文件**（`packages/shared/src/i18n/locales/`）：`en`（基准）、`zh-Hans`、`de`、`es`、`hu`、`ja`、`pl`。

```jsonc
// en.json
"settings.appearance.playCompletionSound": "Play sound when a session completes",
// zh-Hans.json
"settings.appearance.playCompletionSound": "会话完成时播放提示音",
```

只改一两个文件会让 `lint:i18n:parity` 失败。

```bash
bun run sort-locales          # 自动按 key 排序
bun run lint:i18n:parity      # 各 locale key 一致
bun run lint:i18n:coverage    # 代码里引用的 key 在 en.json 存在
```

## 验证

```bash
# 1. 信道分类穷尽性（漏第 2 步会红）
cd packages/shared && bun test src/protocol

# 2. 传输层路由
cd apps/electron && bun test src/transport

# 3. 类型（漏第 6 步会红）
bun run typecheck:all

# 4. i18n
bun run lint:i18n:parity && bun run lint:i18n:coverage

# 5. 跑起来点一下
bun run electron:dev
```

端到端确认：

1. 设置 → Appearance，切换开关
2. `cat ~/.craft-agent/config.json | grep playCompletionSound` → 应该看到 `true`
3. 重启应用，开关状态应该保持

## 常见错误对照

| 报错 / 现象 | 漏了哪一步 |
|---|---|
| `Channel "..." is not classified in LOCAL_ONLY or REMOTE_ELIGIBLE` | 第 2 步 |
| `CHANNEL_NOT_FOUND` | 第 4 步（或 handler 放错了包） |
| `window.electronAPI.getPlayCompletionSound is not a function` | 第 5 步 |
| TS 报 `Property 'getPlayCompletionSound' does not exist on type 'ElectronAPI'` | 第 6 步 |
| 界面上显示的是 `settings.appearance.playCompletionSound` 原文 | 第 8 步，或 key 没进 `en.json` |
| `lint:i18n:parity` 失败 | 第 8 步只改了部分 locale |
| 桌面版好用、webui 里这个开关没反应 | handler 放进了 `apps/electron/src/main/handlers/` |

## 变体：workspace 级设置

上面做的是**应用级**设置（存 `~/.craft-agent/config.json`）。如果这个设置应该按 workspace 区分：

- 存储改用 `workspaces/{ws}/config.json` 的 `defaults` 段（见 `packages/shared/src/workspaces/types.ts` 的 `WorkspaceConfig`）
- handler 签名要收 `workspaceId` 参数
- 信道分类改成 **`REMOTE_ELIGIBLE`** —— workspace 数据属于持有它的服务器
- 设置页改到 `WorkspaceSettingsPage.tsx`
