# Glossary

Status: living document

## Shell window

Electron `BrowserWindow` whose renderer owns title bar, layout, overlays, and
child `<webview>` elements.

## Agent module

Current desktop application hosted inside new shell. Retains existing Agent
business behavior, workspace/session model, backend, and features. Full/panel
presentation removes only shell-owned or mode-inapplicable UI.

## Active workspace

Window-global workspace inherited from current app. Agent sessions remain scoped
to it. Selector lives at top of full Agent sidebar. Changing it does not close
app tabs. Ordinary app renderers require explicit capability to access workspace.

## Title bar

Persistent navigation surface. Owns history controls, fixed Home entry, app tab
strip, and Agent entry. Not part of any hosted app. Back/forward controls reuse
current UI; history behavior remains unspecified. Current App Logo menu remains
at its original global-title-bar position. Order is App Logo, Back, Forward,
Home, app tabs, and right-aligned Agent entry.

## App module

Installable or built-in web application exposed through one or more tabs. TODO
is example app module. Agent is not an app module. Module manifest declares
whether it permits one tab or multiple tab instances. Version 1 app modules are
built-in, locally packaged, and first-party only.

## Capability allowlist

Manifest-declared set of preload APIs exposed to one app renderer. First-party
status does not grant full Agent or shell IPC access.

## Instance policy

App manifest rule controlling tab cardinality. `single` activates existing app
tab on relaunch; `multiple` creates a new tab and renderer.

## App tab

Open instance of an app module in title bar. Carries identity, title, navigation
state, lifecycle state, and one dedicated persistent rendering surface. Hidden
tabs remain loaded unless a future explicit eviction policy suspends them.
Closing app tab destroys its renderer. Closing active tab selects nearest tab
to left, then Home fallback.
Version 1 tabs are runtime-only. Process restart discards tab list, order, and
active selection.

## Content region

Area below title bar. Shows active Home or app tab. May remain rendered while
Agent full mode covers it. Covered app keeps full bounds and continues running.

## Home

Fixed, non-closable content entry with its own persistent renderer. Version 1
contains only a text placeholder; product functions are deferred.

## Agent

Single global capability and state owner. Full mode and panel mode are views of
this same Agent renderer. Shell changes its DOM bounds; main process changes
presentation mode. Mode changes preserve current session and in-progress work.

## Agent full mode

Presentation containing sidebar, session list, and conversation workspace.
Covers content region when visible. It preserves current application layout
below old `TopBar`; global shell title bar remains above it.

## Agent panel mode

Chat-only presentation docked at right of content region. Current conversation
is global and remains unchanged when active app tab changes. Width defaults to
40%, is draggable between 360px and 70%, and persists per shell window. Sidebar,
session list, and navigator are hidden in this mode. Version 1 provides no New
Conversation action in panel mode.

## Splitter

Shell-owned draggable boundary between active app and Agent panel. It changes
DOM bounds of both `<webview>` elements; neither guest renderer owns it.

## Agent mode toggle

Control replacing current chat-header Share button. Switches same Agent
`<webview>` between panel and full DOM bounds without reload.

## Agent hidden mode

Agent renderer remains alive but invisible. Entered by Close from panel mode.
Underlying active app receives full content-region width. Hidden state records
`lastMode`, restored by next global Agent-icon activation.

## Agent last mode

Most recent visible presentation, `panel` or `full`. Global Agent icon changes
visibility only; it hides current mode or restores `lastMode`.

## New Conversation state

Agent chat state with no selected session. Panel shows composer/empty state;
first send creates session. No historical session is selected implicitly.

## Rendering surface

Electron `<webview>` guest with independent web contents and renderer lifecycle.
Shell DOM owns bounds, visibility, and order. Main process validates attachment,
registers ownership, routes IPC, and controls teardown.

## Agent session

Persistent conversation identity and execution state owned by global Agent.
