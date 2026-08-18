# App Platform Architecture

Status: active

This directory records decisions for converting current agent-only Electron app
into a multi-app desktop shell.

- [`glossary.md`](./glossary.md): shared domain language
- [`adr/0001-native-multi-renderer-shell.md`](./adr/0001-native-multi-renderer-shell.md): renderer/process boundary
- [`adr/0003-agent-full-view-as-shell-tab.md`](./adr/0003-agent-full-view-as-shell-tab.md): fixed Agent tab and Panel interaction model
- [`adr/0004-directory-discovered-external-apps.md`](./adr/0004-directory-discovered-external-apps.md): Builtin/Local/Remote PWA discovery and runtime
- [`agent-tab-refactor-plan.md`](./agent-tab-refactor-plan.md): implementation sequence and acceptance criteria
- [`external-app-development.md`](./external-app-development.md): 外部 App中文开发指南

## Confirmed product requirements

- Persistent top title bar: back, forward, fixed Home, fixed Agent tab, dynamic
  app tabs, and right-aligned Agent Panel control.
- Content region hosts Home plus multiple web apps such as TODO.
- One global Agent exists. Full view and right-side panel are presentation modes
  of that same Agent, not separate Agent instances.
- Full Agent behaves as fixed, non-closable tab application. Focusing Agent tab
  shows sidebar, session list, and conversation. Underlying content remains
  mounted and running.
- Panel mode occupies content region's right side. It shows conversation only.
- Agent state is global. Current conversation does not bind to or switch with
  active app tab.
- Title bar, content, and Agent require isolated
  renderers. Isolation must not depend on React, JavaScript, or CSS boundaries.
- Title bar retains current back/forward control UI and click affordances.
- Home v1 renders the Builtin/Local/Remote PWA launcher with source badges,
  open-directory, rescan, loading, error, and retry states. Store/search/category
  product features remain deferred.
- Agent Panel chat header replaces current Share button with `Open Agent full
  view`; Full Agent retains reverse `Dock Agent as panel`. Existing chat Close
  behavior remains.
- Migration wraps current application in a larger native shell. Current app
  becomes Agent module. Agent business behavior, sessions, workspace semantics,
  backend, and existing functions remain unchanged; only shell ownership and
  mode-specific UI are extracted or cropped.
- Workspace remains window-global. Each shell window binds one active workspace.
  Agent sessions retain current workspace ownership. Workspace selector leaves
  global title bar and remains accessible inside full Agent UI.
- Full Agent mode removes current Agent `TopBar` and keeps all current content
  below it: sidebar, session list, navigator, chat, and multi-panel behavior.
  New shell title bar remains visible. Panel mode crops sidebar, session list,
  and navigator, showing current chat only. Old-top-bar-only functions must move,
  not disappear.
- Full Agent sidebar order starts with Workspace selector, then New Session,
  then current navigation and session UI. Panel mode omits workspace selector.
  Workspace changes do not close open app tabs.
- Current App Logo menu remains at its original position in global title bar.
  It is not moved into Agent sidebar and stays accessible in every surface mode.
- Final global-title-bar order is App Logo, Back, Forward, fixed Home, fixed
  Agent tab, conditional divider, dynamic app tabs, then right-aligned icon-only
  Agent Panel control. Global sidebar-toggle control is removed; Agent-specific
  sidebar toggle lives inside Full Agent UI.
- Agent panel v1 adds no New Conversation action. It preserves current behavior.
  New sessions are created through existing full Agent sidebar flow; panel-level
  creation is deferred.
- With Agent tab unfocused, global Agent icon toggles Panel only. With Agent tab
  focused, it unfocuses Full Agent and restores previous content without opening
  Panel. Icon never focuses Full Agent and is active only while Panel is visible.
- In Agent full mode, active app keeps full content-region bounds and continues
  running. Agent view is stacked above it; shell title bar remains above both.
  Hiding Agent reveals app without resize or reflow.
- While Agent tab is focused, Home and dynamic app tabs are inactive. Activating
  Home or an app tab unfocuses Full Agent immediately. Panel remains visible when
  content tabs change.
- Home and Agent are fixed and non-closable. Dynamic app tabs are closable.
  Closing destroys that
  tab renderer. If active tab closes, shell activates nearest tab to its left,
  falling back to Home. Reopening singleton app creates fresh renderer state.
  Agent state is unaffected.
- Shell does not persist or restore app tabs in v1. Process restart begins with
  Home only.
- Builtin singleton TODO is a manifest-based PWA under
  `apps/builtin/todo-placeholder`. It uses the same registry, protocol, preload,
  bridge, partition, and tab lifecycle as Local/Remote Apps.

## Open decisions

- Detailed app-renderer crash recovery UX.
- Back/forward history ownership, enabled-state source, and command routing.
- Future Home information architecture and features.
- Agent-panel New Conversation action.
- Detailed capability matrix for built-in apps.
- Future public/untrusted external-app trust model.
- Detailed ownership of global auth and future cross-app data APIs.
- Relocation map for remaining functions currently reachable only from old
  Agent top bar. App Logo menu is retained globally.

These decisions are deferred beyond v1 unless required for new layout to work.

## Version 1 scope

- Replace current single-renderer layout with a DOM-owned shell plus isolated
  Electron `<webview>` guests.
- Build global title bar, fixed Home and Agent tabs, runtime dynamic app-tab
  infrastructure, and persistent Agent renderer shared by Panel and Full.
- Extract current app into Agent module with full/panel UI cropping.
- Preserve current Agent behavior and backend integration.
- Start every process at Home; do not restore open app tabs.
- Defer product details not required for layout or process architecture.

See [`agent-tab-refactor-plan.md`](./agent-tab-refactor-plan.md) for current code
plan and acceptance criteria. [`v1-implementation-plan.md`](./v1-implementation-plan.md)
remains historical baseline for implemented webview-shell migration.

## Closed decisions

- Agent panel mode and full mode reuse one persistent Agent `<webview>`, but use
  separate React presentation components: `AgentPanel` renders current chat
  only; `FullAgentShell` owns sidebar, navigator, and multi-panel layout. Both
  consume the same Jotai/AppShellContext/transport state. No second Agent
  renderer or duplicated business state is created.
- Dedicated main-process `ShellTabManager` is sole owner of tab/navigation
  mutations. Its intent operations are atomic and invariant-checked;
  `ShellViewManager` handles Electron lifecycle/effects and publishes only final
  committed state. Manager implementation uses Chinese comments for domain
  rules and transaction boundaries.
- Home and every open app tab own distinct persistent `<webview>` guests. Tab
  switching changes CSS visibility without reloading. Agent coverage does not
  unmount active content. Memory-pressure eviction is deferred.
- App modules declare `instancePolicy`. Built-in apps default to `single`:
  relaunch activates existing tab. `multiple` remains available for future
  document- or browser-style apps.
- Agent Close is mode-sensitive. In panel mode it hides Agent and restores app
  width. In full mode it preserves current agent-app behavior: close current
  conversation content while full Agent shell and session list stay visible.
- Switching to panel mode with no selected conversation shows New Conversation
  empty state. It does not auto-select recent history; first send creates one.
- Agent panel width is resizable. Default is 40% of content region, minimum is
  360px, maximum is 70%, and width persists per shell window. Splitter belongs
  to shell renderer, not Agent or active app renderer.
- Shell content surfaces reuse Agent panel-system geometry: shared edge inset,
  inter-panel gap, inner/edge corner radii, and cursor-following resize sash.
  Double-clicking the App/Agent sash restores the default 40% panel width.
- Header and content surfaces keep the shared 8px panel-shadow inset, preventing
  top shadows from being clipped by the shell surface viewport. Full Agent also
  applies that inset inside its guest viewport, keeping All Sessions and chat
  panel shadows fully visible.
- Narrow windows do not auto-switch Agent to full mode. Panel and app each keep
  360px minimum; shell window minimum width provides required room. Only an
  explicit user action changes panel/full mode.
- Electron shell renderer owns title bar, splitter, layout, and every overlay.
  Home, each app tab, and Agent use separate `<webview>` guests. This keeps
  guest renderer isolation while allowing shell menus/dialogs to cover all
  content through normal DOM stacking. Main owns authorization and lifecycle.
- PWA App v1 discovers Builtin Apps from `apps/builtin` plus controlled
  Local/Remote Apps from `userData/apps`, uses `manifest-hxsy.json`, and exposes
  only the three-method `hxsyApp` bridge.
  Public/untrusted content, signatures, Store installation, and capability
  grants remain out of scope; see ADR 0004.
