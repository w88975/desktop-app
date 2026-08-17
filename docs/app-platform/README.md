# App Platform Architecture

Status: discovery

This directory records decisions for converting current agent-only Electron app
into a multi-app desktop shell.

- [`glossary.md`](./glossary.md): shared domain language
- [`adr/0001-native-multi-renderer-shell.md`](./adr/0001-native-multi-renderer-shell.md): renderer/process boundary

## Confirmed product requirements

- Persistent top title bar: back, forward, fixed Home, app tabs, Agent entry.
- Content region hosts Home plus multiple web apps such as TODO.
- One global Agent exists. Full view and right-side panel are presentation modes
  of that same Agent, not separate Agent instances.
- Full mode overlays content region without replacing or unmounting underlying
  content. It shows sidebar, session list, and conversation.
- Panel mode occupies content region's right side. It shows conversation only.
- Agent state is global. Current conversation does not bind to or switch with
  active app tab.
- Title bar, content, and Agent require isolated
  renderers. Isolation must not depend on React, JavaScript, or CSS boundaries.
- Title bar retains current back/forward control UI and click affordances.
- Home v1 renders only a text placeholder. Launcher, overview, recents, and
  other Home product features are deferred.
- Agent chat header replaces current Share button with panel/full mode toggle.
  Existing Close button remains beside it.
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
- Final global-title-bar order is App Logo, Back, Forward, fixed Home, app tabs,
  then right-aligned Agent entry. Global sidebar-toggle control is removed; an
  Agent-specific sidebar toggle lives inside full Agent UI.
- Agent panel v1 adds no New Conversation action. It preserves current behavior.
  New sessions are created through existing full Agent sidebar flow; panel-level
  creation is deferred.
- Global Agent icon toggles visibility without changing presentation mode.
  Hiding records `lastMode`; reopening restores panel or full exactly as last
  shown. Only chat-header mode toggle changes panel/full mode. Icon is active in
  either visible mode.
- In Agent full mode, active app keeps full content-region bounds and continues
  running. Agent view is stacked above it; shell title bar remains above both.
  Hiding Agent reveals app without resize or reflow.
- While Full Agent is visible, Home and app tabs do not show active styling.
  Activating Home or an app tab hides Full Agent immediately and activates the
  selected content. Panel Agent remains visible when content tabs change.
- Hidden Agent retains bounds for its `lastMode`. In particular, hidden Full
  Agent stays full-width so reopening does not paint a compact intermediate
  layout or trigger a second layout pass.
- Home is fixed and non-closable. App tabs are closable. Closing destroys that
  tab renderer. If active tab closes, shell activates nearest tab to its left,
  falling back to Home. Reopening singleton app creates fresh renderer state.
  Agent state is unaffected.
- Shell does not persist or restore app tabs in v1. Process restart begins with
  Home only.
- Version 1 includes built-in singleton `TODO Placeholder`, opened from a
  temporary App Logo menu entry. It exists only to exercise tab and renderer
  architecture; no TODO product behavior is implemented.

## Open decisions

- Detailed app-renderer crash recovery UX.
- Back/forward history ownership, enabled-state source, and command routing.
- Future Home information architecture and features.
- Agent-panel New Conversation action.
- Detailed capability matrix for built-in apps.
- Future remote/third-party app trust model.
- Detailed ownership of global auth and future cross-app data APIs.
- Relocation map for remaining functions currently reachable only from old
  Agent top bar. App Logo menu is retained globally.

These decisions are deferred beyond v1 unless required for new layout to work.

## Version 1 scope

- Replace current single-renderer layout with a DOM-owned shell plus isolated
  Electron `<webview>` guests.
- Build global title bar, fixed placeholder Home, runtime app-tab infrastructure,
  and persistent Agent renderer with hidden/panel/full modes.
- Extract current app into Agent module with full/panel UI cropping.
- Preserve current Agent behavior and backend integration.
- Start every process at Home; do not restore open app tabs.
- Defer product details not required for layout or process architecture.

See [`v1-implementation-plan.md`](./v1-implementation-plan.md) for code plan and
acceptance criteria.

## Closed decisions

- Agent panel mode and full mode reuse one persistent Agent `<webview>`, but use
  separate React presentation components: `AgentPanel` renders current chat
  only; `FullAgentShell` owns sidebar, navigator, and multi-panel layout. Both
  consume the same Jotai/AppShellContext/transport state. No second Agent
  renderer or duplicated business state is created.
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
- Narrow windows do not auto-switch Agent to full mode. Panel and app each keep
  360px minimum; shell window minimum width provides required room. Only an
  explicit user action changes panel/full mode.
- Electron shell renderer owns title bar, splitter, layout, and every overlay.
  Home, each app tab, and Agent use separate `<webview>` guests. This keeps
  guest renderer isolation while allowing shell menus/dialogs to cover all
  content through normal DOM stacking. Main owns authorization and lifecycle.
- Version 1 loads only built-in, locally packaged, first-party apps. Arbitrary
  remote URLs and third-party app plugins are out of scope. App manifests still
  declare minimal preload capabilities.
