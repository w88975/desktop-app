# ADR 0001: Native Multi-Renderer Shell

- Status: superseded by ADR 0002
- Date: 2026-08-14

## Context

Current desktop UI loads agent application into one `BrowserWindow` renderer.
`AppShell.tsx` owns top bar, session sidebar, navigator, and chat panels in one
React tree. Existing `BrowserPaneManager` proves project already coordinates
multiple Electron `BrowserView` web contents for browser tooling, but it is not
a general app-shell compositor.

New product model needs persistent title bar, multiple app tabs, global agent
full view, and docked agent panel. CSS or component boundaries do not satisfy
required renderer/process isolation.

## Decision drivers

- Renderer failure in one app must not take down shell controls or agent UI.
- Each surface gets explicit preload and IPC capabilities.
- Hidden content may keep running while agent full view covers it.
- Native bounds, stacking, focus, visibility, and lifecycle need one owner.
- Existing agent UI should be reusable without cloning agent execution state.

## Proposed direction

Use main process as compositor and lifecycle authority for one shell window.
Give title bar, active app content, and global Agent separate web contents. Main
process owns bounds and z-order. A typed shell protocol carries navigation, tab,
focus, visibility, Agent mode, and session commands.

Project uses Electron 39.2.7, where `BrowserView` is deprecated. Use
`WebContentsView` for content and Agent surfaces. Keep shell `BrowserWindow` web
contents as title-bar/splitter renderer. Main process attaches child views to
window `contentView` and owns bounds, z-order, focus, visibility, and teardown.
This primitive and ownership model is accepted for v1. Later lifecycle and
security features may extend it through separate ADRs.

Version 1 accepts only built-in, locally packaged, first-party apps. Arbitrary
remote URLs and third-party plugin apps are excluded. Each app still receives a
minimal manifest-declared preload capability allowlist. Remote and third-party
trust policy requires a later ADR.

Migration is shell extraction, not Agent rewrite. Existing application becomes
Agent module. Its business behavior, sessions, active-workspace ownership,
backend connections, and features remain unchanged. New shell takes ownership
of global title bar and native composition; Agent renderer crops shell-owned or
mode-inapplicable UI.

Active workspace remains window-global. Each shell window binds one workspace,
matching current `WindowManager` semantics. Workspace control leaves global
title bar but must remain reachable inside full Agent UI. App renderers do not
receive workspace access without manifest capability.

Full Agent mode removes current Agent `TopBar` and preserves current UI beneath
it, including sidebar, sessions, navigator, chat, and multi-panel behavior. New
shell title bar remains visible. Panel mode hides sidebar, session list, and
navigator, rendering current chat only. Any function reachable only through old
`TopBar` requires a replacement entry before that bar is removed.

Move Workspace selector to top of full Agent sidebar, above New Session and
current navigation/session UI. Omit it in panel mode. Workspace changes update
window-global active workspace without closing open app tabs.

Retain current App Logo menu at its original position in global title bar. It
must remain accessible across Home, app tabs, Agent panel, and Agent full mode;
do not relocate it into Agent sidebar.

Order global title bar as App Logo, Back, Forward, fixed Home, app tabs, and
right-aligned Agent entry. Remove global sidebar toggle because sidebar belongs
only to Agent module. Preserve that control inside full Agent UI.

Agent panel v1 does not add a New Conversation control. New sessions remain
available through existing full Agent sidebar behavior. Panel-level creation is
deferred.

Global Agent icon toggles visibility only. On hide, shell records current
presentation as `lastMode`. On reopen, shell restores that mode: full returns
full, panel returns panel. Only chat-header mode toggle changes presentation.
Agent icon appears active in either visible mode.

In full mode, active app retains full content-region bounds and remains visible
and running underneath Agent `WebContentsView`. Agent is raised above app; shell
title bar remains topmost. Hiding Agent reveals app with no app resize/reflow.

Home is fixed and non-closable. Closing an app tab destroys its web contents.
Closing active tab selects nearest remaining tab to its left, then Home. Reopen
of singleton app creates fresh renderer state. Agent lifecycle remains separate.

Version 1 does not persist or restore app tabs. Each process launch starts with
Home only. Tab restoration, renderer-state recovery, and detailed navigation
semantics are deferred; this phase targets layout and renderer architecture.

Include one built-in singleton `TODO Placeholder`, opened through a temporary
App Logo menu item. It validates runtime tab creation, renderer isolation,
switching, closing, panel split, and full Agent overlay without implementing
TODO features.

Only one global Agent exists. Panel and full modes share current session, draft,
execution, and presentation continuity. App-tab activation must not replace or
reset Agent state.

Panel and full modes reuse one persistent Agent web contents. Main process
changes its native bounds and sends explicit `panel` or `full` presentation
mode. No second Agent renderer mirrors its UI or state.

Home and each open app tab own distinct persistent web contents. Switching tabs
hides previous contents and shows selected contents without reload. Covering
content with Agent full mode does not unmount or destroy content. Renderer crash
recovery is scoped to affected tab. Memory-pressure eviction is future work.

App manifests declare `instancePolicy: 'single' | 'multiple'`. Built-in apps use
`single` initially. Launching an already-open singleton activates its existing
tab. Schema retains `multiple` for future document- and browser-style apps.

Title bar retains current back/forward button UI and click affordances. History
ownership, enabled-state source, and command routing remain deferred.

Home remains a fixed, non-closable renderer but v1 loads only a text placeholder.
App launcher, overview, recents, and other Home features remain out of scope.

Current chat-header Share action is replaced by Agent presentation toggle. It
switches the persistent Agent renderer between panel and full modes. Existing
Close control stays adjacent. In panel mode Close transitions Agent to hidden
and restores app width. In full mode Close retains current Agent behavior: close
current conversation content while full shell and session list remain visible.

When Agent has no selected conversation, entering panel mode shows New
Conversation state. It must not auto-select recent session. First send creates
session through existing flow.

Agent panel starts at 40% of content width and is resizable from 360px to 70%.
Width persists per shell window. Shell renderer owns splitter interaction; main
process applies resulting native bounds to app and Agent web contents.

Window resize never changes Agent presentation mode automatically. Panel and app
each require 360px minimum, backed by shell-window minimum width. Panel/full mode
changes only through explicit user interaction.

## Rejected direction

Single renderer with React portals, iframes, or CSS overlays. It fails required
process isolation and couples crash, memory, permissions, and lifecycle domains.
