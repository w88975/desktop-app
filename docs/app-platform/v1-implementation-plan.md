# V1 Multi-Renderer Shell Implementation Plan

Status: implemented

## Goal

Put current Agent application inside a larger Electron shell. Deliver isolated
multi-renderer layout and interaction skeleton. Preserve Agent behavior. Defer
product features and restart restoration.

## Runtime ownership

| Owner | Responsibility |
| --- | --- |
| Main process | Surface registry, guest authorization/destruction, IPC routing, workspace binding, tab lifecycle, Agent state machine |
| Shell renderer | App Logo menu, Back/Forward UI, Home, tab strip, Agent button, splitter, guest DOM layout |
| Agent renderer | Existing Agent app below old `TopBar`; full/panel visual modes |
| App renderer | One built-in app instance per `<webview>`; v1 Home and TODO placeholders |

## Core state

```ts
type AgentMode = 'panel' | 'full'

interface AgentPresentationState {
  visible: boolean
  lastMode: AgentMode
  panelWidthPx: number
}

interface AppDefinition {
  id: string
  title: string
  entry: string
  instancePolicy: 'single' | 'multiple'
  capabilities: readonly string[]
}

interface AppTab {
  id: string
  appId: string
  title: string
  webContentsId: number
}
```

Initial state: Home active, no app tabs, Agent hidden, `lastMode: 'panel'`.

## DOM-hosted guest tree

```text
BrowserWindow webContents: shell renderer
└── shell DOM
    ├── global header and overlay layer
    └── surface layout
        ├── Home <webview>
        ├── App Tab <webview>(s), one visible at a time
        └── Agent <webview>, persistent
```

Shell renderer paints title bar, overlays, splitter, and guest layout. Guests
begin below title bar. DOM stacking lets shell menus and dialogs cover every
guest. Electron guest web contents retain renderer/process isolation.

### Bounds

- Hidden Agent: active app/Home fills content region.
- Panel Agent: active app receives left remainder; Agent receives right persisted
  width; shell-owned splitter occupies gap.
- Full Agent: active app keeps full bounds and keeps running; Agent receives full
  content bounds and stacks above it.
- Title bar remains main `BrowserWindow` content and is never covered.

## Build entries and preloads

1. Add shell HTML/React entry and restricted shell preload.
2. Keep current renderer entry for Agent; add explicit surface/mode bootstrap.
3. Add lightweight app-host entry for Home and TODO placeholders.
4. Give app-host preload only shell navigation/tab-safe capabilities.
5. Keep current Agent transport preload and API surface intact.

Shell and app preloads must not expose full `ElectronAPI`. Agent retains it.

## Main-process components

### `SurfaceRegistry`

- Map every shell, Agent, Home, and app `webContents.id` to owning window,
  workspace, surface kind, and optional tab ID.
- Replace assumptions that only `BrowserWindow.webContents.id` identifies a
  workspace-bound renderer.
- Route dialogs, menu commands, deep links, broadcasts, and crash events to
  correct surface.

### `ShellViewManager`

- Authorize only known local Home, Agent, and app guest URLs/preloads during
  `will-attach-webview`.
- Register/destroy guest web contents during `did-attach-webview` and tab close.
- Enforce singleton activation.
- Own active tab and Home fallback.
- Publish tab and Agent state consumed by shell DOM layout.
- Keep Agent mounted through hidden, panel, and full modes.
- Destroy all child web contents during window teardown.

### Agent state machine

```text
hidden(lastMode=panel) --Agent icon--> panel
hidden(lastMode=full)  --Agent icon--> full
panel                  --Agent icon--> hidden(panel)
full                   --Agent icon--> hidden(full)
panel                  --header toggle--> full
full                   --header toggle--> panel
panel                  --Close--> hidden(panel)
full                   --Close--> current Agent close-session behavior
```

Mode changes resize same Agent view. No navigation, reload, remount, or duplicate
Agent renderer.

## Agent extraction

1. Add Agent presentation context sourced from main-process events.
2. Remove current `TopBar` from Agent renderer.
3. Full mode preserves current layout beneath `TopBar`.
4. Move Workspace selector to top of full Agent sidebar, above New Session.
5. Put Agent sidebar-toggle control inside full Agent UI.
6. Panel mode hides sidebar, session list, and navigator; render current chat.
7. Replace chat-header Share control with panel/full toggle.
8. Keep chat-header Close behavior mode-sensitive.
9. Do not add panel New Conversation control.

App Logo menu moves to shell renderer but remains in same visual position. Menu
commands that act on Agent must be brokered through main process to Agent view.

## Shell UI

Order:

```text
[App Logo] [Back] [Forward] [Home] [App Tabs...] ... [Agent]
```

- Reuse current App Logo and Back/Forward components/styles.
- Keep Back/Forward interaction wiring minimal; history semantics deferred.
- Home is fixed and non-closable; body contains one placeholder label.
- App tabs show close control.
- Agent button reflects visible state, not panel/full distinction.
- Splitter defaults Agent to 40%, clamps Agent to 360px–70%, keeps app at least
  360px, and persists width for current process/window only in v1.
- Window resize never changes Agent mode.

## Placeholder app

- Register `todo-placeholder` with `instancePolicy: 'single'`.
- Add temporary App Logo menu entry to open/activate it.
- Render only a TODO placeholder label.
- Closing destroys view. Reopening creates fresh view.
- Do not persist tab across process restart.

## Suggested implementation sequence

1. Add shared surface, app manifest, tab, and Agent-state types plus unit tests.
2. Add `SurfaceRegistry`; migrate workspace lookup to support child web contents.
3. Add shell/app build entries and restricted preloads.
4. Add `ShellViewManager` with Home, app-tab lifecycle, and bounds tests.
5. Switch `WindowManager` startup from Agent root to shell root; attach persistent
   Agent view.
6. Build shell title bar, Home placeholder, tab strip, Agent button, splitter.
7. Extract old `TopBar`; add Agent full/panel presentation context and UI crop.
8. Move Workspace selector/sidebar toggle; broker App Logo menu commands.
9. Add TODO placeholder/open-menu path.
10. Add integration tests, visual QA, renderer-process/crash checks.

## Acceptance criteria

- App starts on placeholder Home with new title bar.
- App Logo menu works from Home, app tab, Agent panel, and Agent full mode.
- TODO opens once, owns distinct web contents, switches without reload, closes,
  and reopens fresh.
- Agent renderer exists once and remains alive while hidden.
- Agent icon hides/restores last panel/full mode.
- Panel resize changes app/Agent DOM bounds; `<webview>` preserves guest process
  isolation.
- Full Agent covers still-running, full-width active app and never covers title bar.
- Panel/full switch preserves Agent session, draft, streaming, and scroll state.
- Full Agent keeps current features and workspace/session behavior.
- Closing panel restores app full width; full Close keeps current session-close
  behavior.
- Restart returns to Home without restoring TODO tab.
- Logging or a test verifies shell, Agent, Home, and TODO have distinct
  `webContents.id`; renderer-process IDs are captured in integration test.

## Deferred

- Back/forward history semantics.
- Tab restore and renderer-state recovery.
- Memory-pressure suspension/eviction.
- Home launcher/overview product.
- Panel New Conversation control.
- Real TODO behavior.
- Remote and third-party apps.
- Final capability matrix and advanced crash UX.
