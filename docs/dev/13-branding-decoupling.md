# 13 · Craft 强绑定点与解耦清单

> 基于上游 craft-agents-oss v0.11.4 · 核验于 2026-08-08

上游代码里散落着与 Craft 品牌、域名、服务的硬编码。做换皮或私有化时，这些必须逐个决策。

本篇是**逐条扫描核验**的结果，不是凭印象罗列。每一项都标了两件事：

- **同步影响** —— 改了会不会增加将来上游同步的成本
- **数据兼容** —— 改了会不会让已有用户的数据读不到

## 优先级总览

| 级别 | 项 | 不改的后果 |
|---|---|---|
| 🔴 **必改** | 自动更新源 | 用户被推送到 Craft 官方版本，直接覆盖我们的应用 |
| 🔴 **必改** | WebUI OAuth 中继地址 | source 授权回调打到 Craft 的服务器 |
| 🔴 **必改** | Sentry DSN | 崩溃数据发到 Craft（或我们自己的第三方账号） |
| 🟠 **应改** | appId / productName / 应用名 | 与已装的 华小竹 冲突；品牌不对 |
| 🟠 **应改** | 深链协议 `huaxiaozhu://` | 与已装的 华小竹 抢协议注册 |
| 🟠 **应改** | Viewer 分享域名 | 分享链接指向 Craft |
| 🟡 **可改** | 数据目录 `~/.craft-agent/` | 与已装版本共用数据（可能正是你想要的，也可能不是） |
| 🟡 **可改** | 包名 `@craft-agent/*` | 纯内部命名，改动收益低、成本高 |
| 🟢 **按需** | 界面文案里的品牌名、帮助链接、logo | 视产品定位 |

## 逐条清单

### 🔴 1. 自动更新源

| | |
|---|---|
| 位置 | `apps/electron/electron-builder.yml` 的 `publish.url`；`apps/electron/src/main/auto-update.ts`（注释） |
| 当前值 | `https://docs-aiadp.hxsyai.com/electron/latest` |
| 同步影响 | 低 —— 单行配置，冲突面小 |
| 数据兼容 | 无影响 |

分发我们自己的构建之前**必须改**。`provider: generic`，只需要一个能提供 YAML 清单 + 二进制的静态托管（S3 / MinIO / 内网 nginx 都行）。

不打算做自动更新的话，把整个 `publish` 段删掉，并在 `auto-update.ts` 里关掉检查。

### 🔴 2. WebUI Source OAuth 中继

| | |
|---|---|
| 位置 | `packages/shared/src/auth/oauth-relay.ts`（相关逻辑）；行为描述见 `packages/shared/CLAUDE.md` |
| 当前值 | 固定重定向到 `https://api-aidp.hxsyai.com/v1/auth/callback` |
| 同步影响 | 中 —— 涉及 OAuth 状态信封的处理 |
| 数据兼容 | 已授权的 source 不受影响；新授权流程会走新地址 |

WebUI 的 source OAuth 用一个**稳定的中继回调地址**，真正的部署侧回调目标装在中继自有的外层 `state` 信封里，由中继的 router worker 拆包。

私有化部署必须换成我们自己的中继，或改造成直接回调（如果部署地址是固定的，可以省掉中继）。

> 这一项工作量最大 —— 它不只是改一个常量，中继本身是一个需要我们提供的服务。

### 🔴 3. Sentry

| | |
|---|---|
| 位置 | `apps/electron/src/main/index.ts` 顶部；DSN 来自 `SENTRY_ELECTRON_INGEST_URL`，构建期由 esbuild `--define` 烘入 |
| 当前值 | 无默认值 —— 不设环境变量就完全关闭 |
| 同步影响 | 无（本来就是环境变量） |
| 数据兼容 | 无影响 |

**这一项其实不需要改代码**，只要构建时不注入 DSN 就是关闭状态。要接自建 Sentry 就注入自己的 DSN。

已有的脱敏逻辑（剥 authorization / cookie / x-api-key，面包屑里 key 名含 token/secret/password 的值打码，用户 ID 是匿名机器哈希）质量不错，接自建 Sentry 时保留即可。

### 🟠 4. 应用标识与名称

| 项 | 位置 | 当前值 |
|---|---|---|
| `appId` | `apps/electron/electron-builder.yml` | `com.huaxisy.huaxiaozhu` |
| `productName` | 同上 | `华小竹` |
| `copyright` | 同上 | `Copyright © 2026 Huaxisy` |
| Linux `maintainer` | 同上 | `Huaxisy` |
| 运行时应用名 | `apps/electron/src/main/index.ts` | `app.setName(process.env.CRAFT_APP_NAME \|\| '华小竹')` |
| `homepage` / `author` | `apps/electron/package.json` | `https://docs-aiadp.hxsyai.com/` / `Huaxisy` |

| | |
|---|---|
| 同步影响 | 低 —— 都是配置字面量 |
| 数据兼容 | ⚠️ **改 `appId` 会让 Electron 的 userData 目录换位置**（`~/Library/Application Support/<appId 派生>`），窗口状态、缓存等会重置。业务数据在 `~/.craft-agent/`，不受影响 |

**`app.setName()` 已经支持 `CRAFT_APP_NAME` 环境变量覆盖** —— 这是上游为多实例开发留的口子，我们可以直接复用，不必改代码。

`华小竹` 这个字面量在源码里出现 216 次（含 i18n 文案、注释、测试）。不要全局替换 —— 先决定哪些是用户可见的、哪些只是注释。

### 🟠 5. 深链协议

| | |
|---|---|
| 位置 | `apps/electron/src/main/index.ts` 的 `DEEPLINK_SCHEME` |
| 当前值 | `process.env.CRAFT_DEEPLINK_SCHEME \|\| 'huaxiaozhu'` |
| 同步影响 | 低 |
| 数据兼容 | 已分享出去的 `huaxiaozhu://` 链接会失效 |

**同样已支持环境变量覆盖**（`CRAFT_DEEPLINK_SCHEME`），上游为多实例开发留的。

但注意：**渲染进程里有十几处硬编码拼 `huaxiaozhu://` 字符串**，它们不读这个环境变量：

```
renderer/components/ui/EditPopover.tsx
renderer/components/ui/HeaderMenu.tsx
renderer/components/app-shell/SidebarMenu.tsx
renderer/components/app-shell/SkillsListPanel.tsx
renderer/components/app-shell/SourcesListPanel.tsx
renderer/pages/ChatPage.tsx
renderer/pages/SourceInfoPage.tsx
renderer/pages/SkillInfoPage.tsx
renderer/pages/settings/SettingsNavigator.tsx
```

**真要换协议名，正确做法是先做一个 `deeplink(route)` 辅助函数**，把这十几处收敛过去，再让它读配置。这是个典型的「先建扩展点，再定制」——见 [04-conventions](04-conventions.md) 的约定 1。

### 🟠 6. Viewer 与分享域名

| 项 | 位置 | 当前值 |
|---|---|---|
| `VIEWER_URL` | `packages/shared/src/branding.ts` | `https://docs-aiadp.hxsyai.com` |
| Viewer 开发代理 | `apps/viewer/vite.config.ts` | `target: 'https://docs-aiadp.hxsyai.com'` |
| Viewer 页头链接 | `apps/viewer/src/components/Header.tsx` | `https://docs-aiadp.hxsyai.com` |

| | |
|---|---|
| 同步影响 | 低 |
| 数据兼容 | ⚠️ **已分享出去的会话链接会失效**（`sharedUrl` 存在会话 header 里，是完整 URL） |

`branding.ts` 只有 20 行，除了 `VIEWER_URL` 就是一个 ASCII logo（用于 OAuth 回调页）。**这是最容易换的一个文件。**

### 🟡 7. 数据目录 `~/.craft-agent/`

| | |
|---|---|
| 主定义 | `packages/shared/src/config/paths.ts` 的 `CONFIG_DIR = process.env.CRAFT_CONFIG_DIR \|\| join(homedir(), '.craft-agent')` |
| 同步影响 | 中 |
| 数据兼容 | 🔴 **改了之后已有用户的全部数据读不到** —— 会话、凭据、workspace 全在这个目录下 |

> ⚠️ **`CRAFT_CONFIG_DIR` 这个环境变量并不能完全覆盖目录。** 至少 10 处代码绕过 `CONFIG_DIR` 直接 `join(homedir(), '.craft-agent', ...)`：
>
> | 文件 | 用途 |
> |---|---|
> | `apps/electron/src/main/logger.ts` | 消息网关日志、自动更新日志 |
> | `apps/electron/src/main/window-state.ts` | 窗口状态 |
> | `apps/electron/src/main/index.ts` | messaging 目录 |
> | `packages/server/src/index.ts` | messaging 目录 |
> | `packages/shared/src/interceptor-common.ts` | 拦截器读的配置文件与日志目录 |
> | `packages/session-tools-core/src/handlers/config-validate.ts` | 配置校验根目录 |
> | `apps/electron/src/renderer/playground/registry/*.ts` | playground 取样数据（开发用，可忽略） |
>
> 所以「改目录名」实际是「把这 10 处也收敛到 `CONFIG_DIR`」。工作量不大，但**漏一处就会出现「数据分散在两个目录」的诡异故障**。
>
> 顺带一提：这也意味着多实例开发（`~/.craft-agent-1`）目前并不彻底 —— 日志和窗口状态仍然共用。

**建议**：除非有明确的隔离需求，**先不改**。如果要改，把它作为一个独立的、有测试覆盖的改动来做，并写数据迁移。

### 🟡 8. 包名 `@craft-agent/*`

14 个 workspace 包全部叫 `@craft-agent/xxx`。

| | |
|---|---|
| 同步影响 | 🔴 **极高** —— 每个 import 语句都会与上游 diff 冲突 |
| 数据兼容 | 无影响 |

**强烈建议不改。** 包名是纯内部标识，用户看不到，改名的收益接近零，但会让此后每次上游同步都变成噩梦。

### 🟢 9. 界面文案、帮助链接、logo

| 项 | 位置 |
|---|---|
| 帮助文档链接 | `apps/electron/src/shared/menu-schema.ts`、`renderer/components/app-shell/TopBar.tsx`、`renderer/pages/ChatPage.tsx` —— 都指向 `https://docs-aiadp.hxsyai.com/docs*` |
| i18n 文案里的品牌名 | `packages/shared/src/i18n/locales/*.json`。上游约定是「品牌名保持英文」（Craft、华小竹、Workspace…） |
| ASCII logo | `packages/shared/src/branding.ts`，用于 OAuth 回调页 |
| 应用图标 | `apps/electron/resources/icon.icns` / `.ico` / `.png`、`dmg-background.tiff` |
| macOS Liquid Glass 图标 | `apps/electron/scripts/afterPack.cjs` 编译 Assets.car，`CFBundleIconName: AppIcon` |

帮助链接建议一次性收敛到一个常量文件，而不是散着改 —— 同样是「先建扩展点」。

## 推荐的执行顺序

如果要做完整的品牌解耦，按这个顺序，每步都可独立验证：

1. **`branding.ts`** —— 换 `VIEWER_URL` 与 logo（10 分钟，零风险）
2. **electron-builder.yml** —— `appId` / `productName` / `copyright` / `maintainer` / `publish.url`（半小时；注意 userData 目录会变）
3. **Sentry** —— 构建时不注入 DSN，或换成自建（10 分钟）
4. **图标资源** —— 换 icns/ico/png/dmg 背景（看设计交付）
5. **帮助链接收敛** —— 建一个 `links.ts` 常量文件，把散落的 URL 收进去（1 小时）
6. **深链协议** —— 先建 `deeplink()` 辅助函数收敛那十几处，再换协议名（半天）
7. **i18n 文案** —— 按需替换用户可见的品牌名（视文案量）
8. **OAuth 中继** —— 需要我们自己提供中继服务（这一项是真正的工程量，单独排期）
9. **数据目录** —— 除非必须，否则不做；要做就先把那 10 处绕过 `CONFIG_DIR` 的代码收敛，再改，并写迁移

**每一步都记得按 [04-conventions](04-conventions.md) 打 `[aidp]` 标记并写清原因。**

## 核验方法

这份清单可以用下面的命令重新核验（上游升级后建议重跑）：

```bash
# 域名与协议
grep -rn "craft\.do\|huaxiaozhu://\|agents\.craft" \
  --include="*.ts" --include="*.tsx" --include="*.yml" --include="*.json" \
  apps packages scripts | grep -v node_modules | grep -v "/dist/"

# 绕过 CONFIG_DIR 的数据目录硬编码
grep -rn "'\.craft-agent'" --include="*.ts" apps packages | grep -v node_modules

# 品牌字面量
grep -rn "华小竹" --include="*.ts" --include="*.tsx" apps packages | grep -v node_modules
```
