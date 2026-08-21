# Main App Tools 指引

本文供 AI Agent 与后续开发者阅读，描述 Agent 如何查看、切换、关闭主桌面应用中的 tab，以及如何扩展更多主 App 能力。

## 1. 工具分组

主 App 工具统一使用 `main_app_` 前缀，契约集中在：

```text
packages/session-tools-core/src/handlers/main-app-tools.ts
```

当前工具：

| Tool | 权限 | 用途 |
| --- | --- | --- |
| `main_app_list_tabs` | 只读 | 列出 Home、Agent、全部打开的 App tabs，并标记当前 active target |
| `main_app_switch_tab` | UI 操作 | 切换到 Home、Agent 或指定 App tab |
| `main_app_close_tab` | 关闭操作 | 关闭指定 App tab |

## 2. Tab 模型

Home 与 Agent 是主 Shell 的持久 surface，也作为保留 tab 暴露：

```json
{
  "target": "home",
  "kind": "home",
  "title": "Home",
  "active": false,
  "closable": false
}
```

```json
{
  "target": "agent",
  "kind": "agent",
  "title": "Agent",
  "active": true,
  "closable": false
}
```

普通 App tab：

```json
{
  "target": "runtime-tab-id",
  "kind": "app",
  "title": "TODO",
  "active": false,
  "closable": true,
  "tabId": "runtime-tab-id",
  "appId": "todo-placeholder",
  "status": "ready"
}
```

注意：

- `appId` 标识 App 类型。
- `tabId` 标识当前运行时 tab 实例。
- 切换、关闭普通 App 必须使用 `tabId`。
- Home、Agent 使用固定 target：`home`、`agent`。
- Home、Agent 不可关闭。

## 3. 列出 Tabs

调用：

```json
{}
```

Tool：`main_app_list_tabs`

返回：

```json
{
  "activeTarget": "agent",
  "tabs": [
    {
      "target": "home",
      "kind": "home",
      "title": "Home",
      "active": false,
      "closable": false
    },
    {
      "target": "tab-123",
      "kind": "app",
      "title": "TODO",
      "active": false,
      "closable": true,
      "tabId": "tab-123",
      "appId": "todo-placeholder",
      "status": "ready"
    },
    {
      "target": "agent",
      "kind": "agent",
      "title": "Agent",
      "active": true,
      "closable": false
    }
  ]
}
```

Agent 在不知道当前 tab 状态时，必须先调用此工具。

## 4. 切换 Tab

切换 Home：

```json
{
  "target": "home"
}
```

切换 Agent：

```json
{
  "target": "agent"
}
```

切换普通 App：

```json
{
  "target": "tab-123"
}
```

Tool：`main_app_switch_tab`

切换已存在 App tab 不会 reload App，也不会丢失 renderer 状态。

## 5. 关闭 Tab

```json
{
  "target": "tab-123"
}
```

Tool：`main_app_close_tab`

关闭普通 App tab 会：

- 从 tab bar 移除 tab。
- 销毁对应 App renderer/WebContents。
- detach App Browser CDP controller。
- 拒绝该 App 尚未完成的 WebTool、`app_browser` 操作。

以下调用会失败：

```json
{ "target": "home" }
```

```json
{ "target": "agent" }
```

因为 Home、Agent 是持久主 App surface。

## 6. 推荐 Agent 流程

```text
main_app_list_tabs
→ 找到目标 target/tabId
→ main_app_switch_tab
→ 必要时使用 app_browser 或 call_webtool
→ 用户明确要求关闭时 main_app_close_tab
→ main_app_list_tabs 验证最终状态
```

规则：

- 不猜 tabId。
- 不把 appId 当 tabId。
- 关闭前检查 `closable`。
- 用户未要求时，不主动关闭仍可能保留状态的 App tab。
- 切换 Agent 表示切换到 Agent full tab；不会创建第二个 Agent renderer。

## 7. 扩展 Main App 能力

新增能力时保持同一分组：

1. 在 `packages/session-tools-core/src/context.ts` 定义 transport-neutral callback/type。
2. 在 `packages/session-tools-core/src/handlers/main-app-tools.ts` 添加 handler。
3. 在 `packages/session-tools-core/src/tool-defs.ts` 添加 schema、description、registry entry。
4. 在 `packages/shared/src/agent/session-scoped-tool-callback-registry.ts` 扩展 `MainAppToolsFns`。
5. 在 `packages/shared/src/agent/session-self-management-bindings.ts` 添加 lazy binding。
6. 在 `packages/server-core/src/sessions/SessionManager.ts` 绑定 workspace/session。
7. 在 `apps/electron/src/main/main-app-tools.ts` 实现 Shell 行为。
8. 在 `apps/electron/src/main/window-manager.ts` 路由到正确 workspace window。
9. 更新 `packages/shared/src/prompts/system.ts` 的 `Main App Tools` 说明。
10. 补 handler、Shell state、权限、Claude/Pi parity 测试。

命名约定：

```text
main_app_<verb>_<object>
```

例：

```text
main_app_list_tabs
main_app_switch_tab
main_app_close_tab
main_app_get_active_app
main_app_resize_panel
```

## 8. 实现位置

- Tool handlers：`packages/session-tools-core/src/handlers/main-app-tools.ts`
- Tool schemas：`packages/session-tools-core/src/tool-defs.ts`
- Callback types：`packages/session-tools-core/src/context.ts`
- Agent callback registry：`packages/shared/src/agent/session-scoped-tool-callback-registry.ts`
- Session bindings：`packages/server-core/src/sessions/SessionManager.ts`
- Shell operations：`apps/electron/src/main/main-app-tools.ts`
- Workspace window routing：`apps/electron/src/main/window-manager.ts`
- System prompt：`packages/shared/src/prompts/system.ts`
