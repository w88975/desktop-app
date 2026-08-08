---
name: ui-components
description: 本项目新增或修改 React UI 组件时使用。说明 shadcn 组件与共享组件两个目录的分工、cn 工具与 Tailwind v4 约定、以及用 playground 快速预览组件的方法。涉及 shadcn add、新建组件、改样式、组件复用时触发。
---

# UI 组件约定

## 先决定：组件放哪个目录

这是本项目最高频的错误。两个目录用途不同，放错会导致无法复用或编译失败。

### `apps/electron/src/renderer/components/ui/`

shadcn registry 组件 + 仅渲染进程使用的组件。已有 40+ 个（button、dialog、command、data-table…）。

- 风格 `new-york`，基色 `neutral`，启用 CSS variables
- 配置在 `apps/electron/components.json`，别名 `@/` 指向 `apps/electron/src/renderer/`
- **`shadcn add` 必须在 `apps/electron/` 目录下执行**，否则 CLI 找不到 `components.json`：

```bash
cd apps/electron && npx shadcn@latest add <component>
```

也可以直接用 `shadcn` MCP 查组件文档和源码后再落地。

### `packages/ui/src/components/`

跨 app 共享的组件。**electron、webui、viewer 三端都在 import**（`@craft-agent/ui`）。

两条硬约束：

1. **不得引用 Electron API**。webui 跑在浏览器里，viewer 是静态页，import 到 `electron` 会直接炸。
2. **新增组件必须在 `packages/ui/package.json` 的 `exports` 里显式登记**。该字段是白名单（目前 10 条），没登记的路径外部 import 不到，报错信息还很不直观。

```json
"exports": {
  ".": "./src/index.ts",
  "./chat": "./src/components/chat/index.ts",
  "./ui/drawer": "./src/components/ui/drawer.tsx"
}
```

### 判断规则

> 只有 electron 渲染进程用 → `apps/electron/.../components/ui/`
> webui 或 viewer 也要用 → `packages/ui/src/components/`

拿不准时先放 `apps/electron`，等真的需要共享再迁移。反向迁移（从 packages/ui 拆掉 Electron 依赖）代价大得多。

## 样式约定

- `cn()` 在 `apps/electron/src/renderer/lib/utils.ts`，是 `clsx` + `twMerge` 的组合，写条件类名一律用它
- Tailwind v4，全局样式入口 `apps/electron/src/renderer/index.css`
- 变体用 `class-variance-authority`（cva），跟随现有组件写法
- 交互原语用 `@radix-ui/*`，不要自己实现弹层、焦点管理、无障碍语义

## Playground：改 UI 的快速回路

不要为了看一个组件长什么样去启动整个 Electron。

```bash
bun run playground:dev
```

起 vite 并打开 `/playground.html`，registry 在 `apps/electron/src/renderer/playground/registry/`（已有 30 个条目：chat、markdown、toasts、kanban、onboarding…）。新增组件时在 registry 里加一个条目，就能隔离预览各种状态。

**⚠️ 端口冲突**：`playground:dev` 启动前会执行 `lsof -ti:5173 | xargs kill -9`，而 `electron:dev` 的 vite 也占 5173。同时跑会把 Electron 的 dev server 杀掉。二选一，或先停掉另一个。

## 改完之后

```bash
bun run typecheck        # 实测可用
```

改了 `packages/ui` 里的组件时，注意它同时影响 webui 和 viewer。

`bun run lint` 整条链因 eslint 存量问题仍是红的，详见 `dev-workflow` skill。

> 三端如何复用同一套组件、为什么分两个目录，见 `docs/dev/05-architecture.md`。
