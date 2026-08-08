# 04 · 开发约定（必读）

> 基于上游 craft-agents-oss v0.11.4 · 核验于 2026-08-08

这一篇是**写第一行代码之前必须读完**的。它不讲架构，只讲两件事：怎么改才不会在半年后的上游同步里翻车，以及提交前该跑什么。

## 一、上游同步友好的改动约定

### 为什么这件事很重要

我们不与上游 merge，只人工比对移植（原因见 [upstream-sync](../upstream-sync.md)）。这意味着每次上游发新版，都要有人拿着 `git diff upstream-tags/vA upstream-tags/vB` 逐条判断「这个改动我们要不要」。

这个判断的难度**完全取决于我们自己的改动有多容易被识别**：

- 如果我们的定制都在新文件里 → 上游 diff 干净，移植是纯粹的加法
- 如果我们的定制散落在上百个上游文件的行间 → 每次同步都要三方比对，一次半天起步，且必然漏

第一次同步时才想起这件事就已经晚了。所以下面四条从现在开始执行。

### 约定 1：优先新增文件，而不是修改上游文件

按优先级从高到低：

| 做法 | 同步成本 | 例子 |
|---|---|---|
| ✅ 新建文件，在少数几个入口点接进去 | 极低 | 新的 RPC handler 模块、新的 React 页面、新的 Source 类型实现 |
| ✅ 在上游预留的扩展点注册 | 极低 | 往 `DRIVER_REGISTRY` 加一个 driver、往 `LOCALE_REGISTRY` 加一个 locale、往 `settings-registry.ts` 加一个设置页 |
| ⚠️ 修改上游文件，改动集中在一处 | 中 | 必须打 `[aidp]` 标记（见约定 3） |
| ❌ 改动散落在上游文件的多个位置 | 高 | 考虑重构成前两种 |
| ❌ 大幅重写上游文件 | 极高 | 该文件此后放弃上游更新，在文件头注明 |

**动手前先花两分钟找扩展点。** 这个项目的扩展点比看起来多：模型 provider 有 driver 注册表，RPC 有信道映射表，UI 有设置注册表，工具有 handler 注册表。绕过扩展点去改上游主干，通常是没找到而不是没有。

### 约定 2：定制配置走独立文件

不要改上游的默认值。新增覆盖层：

- 新建自己的常量/配置模块，在上游读取处做一次「有覆盖用覆盖，没有用原值」
- 品牌、域名、端点这类必然要换的，集中到少数几个文件（详见 13-branding-decoupling，第二批交付）

理由：改默认值是最难在 diff 里被发现的一类改动 —— 它看起来只是一个字面量变了。

### 约定 3：修改上游文件必须打 `[aidp]` 标记

**单行改动**：

```ts
const timeout = 30_000 // [aidp] 内网网关首字节较慢，上游默认 10s 会误判超时
```

**多行改动**：

```ts
// [aidp] begin: 接入内部统一鉴权，替换上游的直连 API Key 分支
const token = await internalAuth.getToken(connection.slug)
headers.Authorization = `Bearer ${token}`
// [aidp] end
```

规则：

1. **原因必填**，且写「为什么」不写「做了什么」——「做了什么」diff 里看得见，「为什么」半年后没人记得。这句话是未来同步时判断「这个定制还要不要保留」的唯一依据。
2. 工单号可以作为可选后缀：`// [aidp] 内网网关首字节较慢 (AIDP-123)`。不强制，因为工单系统未必长期可访问。
3. **纯新增的文件不加标记** —— 整个文件都是我们的，逐行标记只是噪音。在文件头注释里说明用途即可。
4. 删除上游代码时，用标记注明并保留一行说明，不要直接删干净：

```ts
// [aidp] 上游此处会上报 Sentry，内网环境无出网权限，整段移除
```

### 约定 4：提交信息里区分「自研」与「移植」

- 自研改动：正常的中文 conventional commit，如 `feat: 支持内部模型网关`
- 移植上游：注明来源版本，如 `fix: 移植上游 v0.12.0 的会话超时修复 (upstream v0.11.4..v0.12.0)`

移植完成后更新 [upstream-sync](../upstream-sync.md) 顶部记录的「已对齐到的上游版本」。

## 二、质量门禁的真实状态

**先说结论：这个仓库目前没有任何自动门禁在拦你。** 提交前的检查全靠手动执行。

### pre-commit 钩子当前不生效

`package.json` 里有 `"prepare": "husky"`，`git config core.hooksPath` 也指向 `.husky/_`，但 **`.husky/pre-commit` 这个文件不存在**。husky 的 shim（`.husky/_/h`）在找不到对应脚本时会直接 `exit 0`，所以钩子是个空操作。

上游文档里提到的 `lint:i18n:staged`、`typecheck:staged` 这两条「pre-commit 用」的脚本**实际不会自动运行**。它们本身是可用的，但需要手动调。

### CI 当前不生效

`.github/workflows/validate.yml` 是 GitHub Actions，触发条件是 `pull_request` 和 `push` 到 `main`。但：

- 我们的 `origin` 是内网 GitLab，GitHub Actions 不会执行
- 仓库里没有 `.gitlab-ci.yml`
- 我们的主分支是 `master` / `develop`，不是 `main`

所以 `validate:ci` 目前只是一条可以手动跑的命令，不是关卡。

> 这两点是**已知缺口**，不是「文档没写清楚」。在补上之前，下面的手动清单就是全部防线。

### `bun run lint` 整条链是红的 —— 不是你的问题

```
lint:ipc-sends → lint:tool-name-checks → lint:electron → lint:shared → lint:ui
```

前两个通过，卡在 `lint:electron`。这是上游带来的 eslint 存量问题，基线（v0.11.4 实测）：

| 命令 | 基线结果 |
|---|---|
| `bun run lint:electron` | 133 problems（9 errors, 124 warnings） |
| `bun run lint:shared` | 17 problems（5 errors, 12 warnings） |
| `bun run lint:ui` | 3 errors |

**非零退出不代表你改坏了。只看你动过的文件，不要试图清零。**

### 项目自有的质量门禁（这些是绿的）

上游 OSS 只导出了 `package.json`，校验脚本的实现没跟着出来。仓库里补了 6 个，都可用：

| 命令 | 检查什么 | 转义标记 |
|---|---|---|
| `bun run lint:ipc-sends` | 主进程有没有绕过 RPC event sink 直接 `webContents.send` | `raw-send-ok:<原因>` |
| `bun run lint:tool-name-checks` | 有没有绕过 `isParentTaskTool()` 直接比较 `'Task'` / `'Agent'` 字面量 | `parent-task-ok:<原因>` |
| `bun run lint:i18n:coverage` | 代码里 `t('x.y')` 引用的 key 是否都在 `en.json` 中存在 | — |
| `bun run lint:i18n:strings` | 有没有硬编码的中日韩文案（应走 `t()`） | `i18n-ok` |
| `bun run lint:i18n:staged` | 同上，只查暂存文件 | — |
| `bun run typecheck:staged` | 只对暂存改动涉及的 workspace 跑 tsc | — |

转义标记写在该行或上一行的注释里。

## 三、测试

仓库里有 373 个测试文件，用 `bun test`。

```bash
bun test                    # 全量（含 *.isolated.ts 单独跑的部分）
cd packages/shared && bun test src/protocol    # 只跑某个目录
```

**`*.isolated.ts` 是特殊的**：这些测试会污染全局状态（如给 SDK 打桩、改 `process.env`），必须单独进程跑。根 `test` 脚本会 `find` 出来逐个执行。写这类测试时沿用 `.isolated.ts` 后缀，否则会破坏其它测试。

现有的 5 个：`prerequisite-manager`、`pre-tool-use-checks`（shared/agent/core）、`notifications-routing`、`session-branch-rollback`、`sessions-annotations`（electron/main）。

### 哪些测试是「契约测试」，必须让它们红

有几组测试是故意设计成「漏改就失败」的，不要绕过或跳过：

- `packages/shared/src/protocol/**` —— 信道分类穷尽性。新增 RPC 信道但没归类，这里会失败
- `packages/shared/src/agent/backend/*/session-tool-parity.test.ts` —— Claude 侧与 Pi 侧的工具集必须对齐
- `packages/shared/src/agent/__tests__/pi-query-llm.test.ts` —— `queryLlm` 的 IPC 信封必须完整传递

它们红了说明你漏了一处，不是测试过时了。

## 四、提交前清单

按顺序执行，全绿再提交：

```bash
bun run typecheck:all      # 覆盖全部 package + electron
bun test                   # 全量测试
bun run lint:ipc-sends
bun run lint:tool-name-checks
bun run lint:i18n:parity   # 改过文案的话
bun run lint:i18n:coverage
```

或者一条命令：

```bash
bun run validate:ci        # = typecheck:all + test:shared:all + test:doc-tools + 三项 i18n 检查
```

> `validate:ci` 不包含全量 `bun test`，也不包含两条 lint 脚本。追求稳妥就按上面的清单逐条跑。

改过文案的额外要求：**新增 key 必须补齐全部 7 个 locale 文件**（en / zh-Hans / de / es / hu / ja / pl），`en.json` 是基准。只改 `zh-Hans.json` 会让 parity 失败。`bun run sort-locales` 可以自动排序。

i18n 的完整约定（key 命名前缀表、复数处理、`<Trans>` 用法、跨进程语言持久化）在 `packages/shared/CLAUDE.md` 里，维护得很好，本文档不复述。

## 五、代码风格

没有 prettier 配置，也没有强制的格式化。原则是**跟着你正在改的那个文件走**：缩进、引号、分号、注释密度、命名习惯，与周围代码一致即可。

上游代码风格本身不完全统一（`packages/shared` 用分号，部分新文件不用），不要为了统一风格去动无关代码 —— 那是纯粹的同步债。

## 下一步

- [05-architecture](05-architecture.md) —— 整体结构
- 操作细节的速查版见 `.claude/skills/dev-workflow`
