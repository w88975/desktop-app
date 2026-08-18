# 外部 App 开发指南

本文面向 Builtin、Local 与 Remote App 开发者，描述首版目录、manifest、加载、
缓存及 JS Bridge协议。架构依据：
[ADR 0004](./adr/0004-directory-discovered-external-apps.md)。

## 1. 能力范围

首版支持：

- 从 Electron `userData/apps/`扫描 App目录
- 从 repo/package `apps/builtin/`加载内置 PWA
- 加载本地静态 Web App
- 加载远程 Web App
- Home页展示已发现 Apps
- singleton tab
- manifest中的 Web Tool元数据发现
- 3个基础 Host Bridge API

首版不支持 Store、ZIP、签名、自动更新、Auth、MCP、Skill、Agent调用 Web Tool、
卸载或跨 origin限制。

## 2. 打开 Apps目录

在 Home页点击 `打开 Apps 目录`。实际路径由 Electron `userData`决定，不应在
App代码中硬编码。

主客户端开发调试时可通过 `HXSY_APPS_DIR`环境变量临时覆盖扫描目录；正式运行仍
固定使用 `userData/apps`。

目录只扫描直接子目录：

```text
apps/
  <appId>/
```

要求：

- 文件夹名必须等于 manifest中的 `appId`
- `appId`只允许小写字母、数字、点、下划线、连字符，并匹配
  `^[a-z0-9][a-z0-9._-]*$`
- 一个文件夹对应一个 App
- App首次打开后使用 singleton tab；再次打开只激活原 tab
- Home页点击 `重新扫描`可手动触发发现

## 3. Builtin App

Builtin App放在仓库：

```text
apps/builtin/<appId>/
```

目录结构、manifest、Bridge、partition与 Local App完全相同。正式打包时该目录复制到
`resources/app/builtin`。Builtin与用户目录出现相同 `appId`时，Builtin优先。

内置 TODO示例：

```text
apps/builtin/todo-placeholder/
  manifest-hxsy.json
  index.html
  app.css
  app.js
  icon.svg
```

## 4. Local App

### 4.1 目录结构

```text
apps/
  com.huaxisy.local-demo/
    manifest-hxsy.json
    index.html
    icon.png
    assets/
      app.js
      app.css
```

Local App目录没有 `source.json`。

### 4.2 最小示例

`manifest-hxsy.json`：

```json
{
  "schemaVersion": 1,
  "appId": "com.huaxisy.local-demo",
  "title": "Local Demo",
  "icon": "./icon.png",
  "entry": "./index.html"
}
```

`index.html`：

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Local Demo</title>
  </head>
  <body>
    <h1>Local Demo</h1>
    <script type="module" src="./assets/app.js"></script>
  </body>
</html>
```

Local App通过以下 URL加载：

```text
hxsy-app://com.huaxisy.local-demo/index.html
```

`entry`、`icon`及页面资源必须留在当前 App目录内。绝对路径与 `../`路径穿越会被
拒绝。

## 5. Remote App

### 5.1 初始目录

Remote App初始只需要 `source.json`：

```text
apps/
  com.huaxisy.todo/
    source.json
```

```json
{
  "schemaVersion": 1,
  "type": "remote",
  "url": "https://internal.example.com/todo/"
}
```

文件夹名仍是最终 `appId`。

### 5.2 Remote站点文件

远程站点必须提供：

```text
https://internal.example.com/todo/manifest-hxsy.json
```

示例：

```json
{
  "schemaVersion": 1,
  "appId": "com.huaxisy.todo",
  "version": "0.1.0",
  "title": "TODO",
  "description": "任务管理",
  "icon": "./icon.png",
  "entry": "./index.html"
}
```

### 5.3 首次加载与缓存

扫描到 `source.json`后，Home会出现占位 App。首次打开时：

1. tab显示通用 icon与 `加载中...`
2. 主进程请求固定 manifest路径
3. 校验 `appId`与文件夹名一致
4. 下载 icon
5. 原子缓存 manifest、icon、解析后的 source信息
6. tab更新为真实 title/icon
7. 加载 remote entry

成功后目录类似：

```text
com.huaxisy.todo/
  source.json
  manifest-hxsy.json
  icon.png
```

补全后的 `source.json`示例：

```json
{
  "schemaVersion": 1,
  "type": "remote",
  "url": "https://internal.example.com/todo/",
  "manifestUrl": "https://internal.example.com/todo/manifest-hxsy.json",
  "entryUrl": "https://internal.example.com/todo/index.html",
  "iconFile": "icon.png",
  "lastResolvedAt": "2026-08-18T00:00:00.000Z"
}
```

Host更新已知字段时会保留未知字段。

### 5.4 加载失败

manifest或entry请求失败时：

- tab显示 `加载失败`
- 内容区显示通用失败页
- 点击 `重试`会在原 tab重试 manifest与entry
- App目录不会被删除
- 有旧缓存时保留旧缓存

首版不做后台自动刷新。修改远程 manifest后，可清除缓存文件并重新扫描，或在失败
页重试。

## 6. manifest-hxsy.json

### 6.1 字段

| 字段 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| `schemaVersion` | 是 | `number` | 首版必须为 `1` |
| `appId` | 是 | `string` | 必须等于目录名 |
| `title` | 是 | `string` | Home与tab展示名称 |
| `icon` | 是 | `string` | Local包内路径；Remote相对/绝对 URL |
| `entry` | 是 | `string` | Local包内路径；Remote相对/绝对 URL |
| `version` | 否 | `string` | 展示信息，不限制升级/降级 |
| `description` | 否 | `string` | App简介 |
| `webTools` | 否 | `array` | Web Tool声明，默认空数组 |

不支持的 `schemaVersion`会加载失败。未知字段会被忽略，便于未来扩展。

### 6.2 Web Tool声明

```json
{
  "webTools": [
    {
      "name": "create_todo",
      "description": "创建一个待办事项",
      "inputSchema": {
        "type": "object",
        "properties": {
          "title": { "type": "string" }
        },
        "required": ["title"]
      },
      "handler": "createTodo"
    }
  ]
}
```

字段：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `name` | 是 | Tool名称；未来会由 Host增加 `appId`命名空间 |
| `description` | 是 | 给 Agent理解用途的描述 |
| `inputSchema` | 是 | JSON Schema输入定义 |
| `handler` | 是 | 未来 Bridge handler名称 |

当前版本只发现、校验、缓存、展示这些元数据。不会向 Agent注册 Tool，也不会调用
`handler`。页面当前不需要注册 handler。

## 7. JavaScript Bridge

所有 Builtin/Local/Remote App页面都会获得：

```ts
interface HxsyAppBridge {
  getAppName(): Promise<string>
  getAppVersion(): Promise<string>
  openAgentPanel(): Promise<void>
}

interface Window {
  hxsyApp: HxsyAppBridge
}
```

不使用 `v1`等 namespace版本层级。

### 7.1 获取主客户端信息

```js
const hostName = await window.hxsyApp.getAppName()
const hostVersion = await window.hxsyApp.getAppVersion()

console.log(`${hostName} ${hostVersion}`)
```

这里返回主桌面客户端名称和版本，不是当前外部 App的 title/version。

### 7.2 打开 Agent Panel

```js
await window.hxsyApp.openAgentPanel()
```

语义是“确保 Panel打开”，不是 toggle：

- Panel已打开：no-op
- Panel隐藏：打开 Panel
- Full Agent focused：返回之前内容并打开 Panel

### 7.3 运行边界

- `contextIsolation: true`
- `nodeIntegration: false`
- Bridge不暴露 Node、文件系统或任意 IPC
- 每个 `appId`使用独立持久化 partition
- 同一 App多个运行实例未来可共享 Cookie、localStorage、IndexedDB
- 不同 Apps不共享这些数据

首版默认所有 Remote Apps都在受控内网。跨 origin导航暂不限制；后续接入不可信内容
前必须重新设计 origin allowlist与 capability授权。

## 8. Home与tab行为

- Home展示扫描到的 Apps
- 固定按 title排序
- 没有搜索、分类、自定义排序
- 点击 App创建或激活 singleton tab
- App Logo菜单不再展示 App入口
- Home提供 `打开 Apps 目录`与 `重新扫描`
- Remote loading/error状态会同时反映到 Home卡片和tab

## 9. 本地开发流程

### Builtin App

1. 在 `apps/builtin/<appId>/`创建完整 PWA目录
2. 编写 manifest、entry、icon及静态资源
3. 重新扫描或重启客户端
4. 从 Home确认“内置”标签并打开

### Local App

1. 在 Home点击 `打开 Apps 目录`
2. 创建以 `appId`命名的目录
3. 放入 manifest、entry、icon及静态资源
4. 点击 `重新扫描`
5. 从 Home打开 App
6. 修改文件后重新加载 App tab；必要时再次扫描 manifest

### Remote App

1. 启动可通过浏览器访问的 Web站点
2. 在站点 base URL提供 `manifest-hxsy.json`
3. 在 Apps目录创建 `<appId>/source.json`
4. 点击 `重新扫描`
5. 从 Home打开 App并观察首次缓存
6. 加载失败时使用通用失败页的 `重试`

## 10. 常见问题

### Home没有显示 App

检查：

- App是否位于 Apps目录的直接子目录
- 文件夹名是否等于 manifest `appId`
- Local App是否存在根目录 `manifest-hxsy.json`
- Remote App的 `source.json`是否为合法 JSON

### Local App资源404

检查 `entry`与资源 URL是否使用相对路径，且没有离开 App目录。

### Remote App一直显示加载失败

确认浏览器可访问 base URL及固定 manifest URL，并检查 manifest `appId`。失败不会删除
目录，可修复后直接点击 `重试`。

### `window.hxsyApp`不存在

该 Bridge只在主桌面客户端托管的 App webview中注入。普通浏览器访问时不存在，页面
需要先判断：

```js
if (window.hxsyApp) {
  await window.hxsyApp.openAgentPanel()
}
```
