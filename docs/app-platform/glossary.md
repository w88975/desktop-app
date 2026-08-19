# Glossary

Status: living document

## Authentication gate

Process-wide entry boundary that permits Shell windows only after `AuthService`
has established an authenticated session. It does not yet authorize background
services or External Apps.

## Auth service

Main-process singleton that owns Huaxiaozhu token credentials, Login/Logout,
startup and 401 refresh, SMS cooldown, Auth-state broadcasts, and constrained
authenticated HTTP requests. It never returns raw tokens to renderers.

## Auth state

Non-secret renderer projection of process authentication state. Contains status,
remembered mobile identity, optional user-visible error, and SMS resend deadline.

## Auth window

Single dedicated `BrowserWindow` shown while authentication is checking or
missing. It hosts only Login UI through a least-privilege preload. It never
coexists intentionally with visible Shell windows. Closing it quits App.

## Authenticated request

Main-process HTTP capability that attaches current access token to a relative
path under the fixed Huaxiaozhu API root. It refreshes and retries once after a
401 response. Absolute and cross-origin targets are invalid.

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

Persistent navigation surface. Owns history controls, fixed Home and Agent tabs,
dynamic app-tab strip, and global Agent icon. Not part of any hosted app.
Back/forward controls reuse current UI; history behavior remains unspecified.
Current App Logo menu remains at its original global-title-bar position. Order
is App Logo, Back, Forward, fixed Home, fixed Agent tab, dynamic app tabs, then
right-aligned global Agent icon. A vertical divider between Agent tab and dynamic
app tabs separates fixed navigation from runtime tabs. Divider is decorative and
exists only while at least one dynamic app tab is open.

## App module

Installable or built-in web application exposed through one or more tabs. TODO
is example app module. Agent behaves as fixed tab application but is not a
dynamic `AppDefinition` module and owns no separate tab renderer. Module manifest
declares whether it permits one tab or multiple tab instances. PWA App v1
supports Builtin, Local, and controlled Remote singleton apps through one
registry/runtime model.

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

## Fixed tab

Permanent, non-closable title-bar navigation target. Home and Agent are fixed
tabs. They share tablist selection and keyboard behavior with dynamic app tabs
but ignore close operations and are not members of runtime `tabs` collection.

## Shell Tab Manager

Pure main-process domain owner implemented in `shell-tab-manager.ts`. Owns fixed
and dynamic tab focus, Agent Panel visibility, previous-content fallback, and tab
metadata transitions. Each intent builds a copied next state, validates all
invariants, commits once, and returns explicit effects for `ShellViewManager` to
apply. It never owns Electron web contents or emits partial UI state.

## Content region

Area below title bar. Shows active Home or app tab. May remain rendered while
Agent full mode covers it. Covered app keeps full bounds and continues running.

## Home

Fixed, non-closable content entry with its own persistent renderer. Version 1
contains the Builtin/Local/Remote PWA launcher. Store, search, categories, and
other product features remain deferred.

## Agent

Single global capability and state owner. Full mode and panel mode are views of
this same Agent renderer. Shell changes its DOM bounds; main process changes
presentation mode. Mode changes preserve current session and in-progress work.

## Agent full mode

Presentation containing sidebar, session list, and conversation workspace,
hosted by fixed Agent tab. It uses same persistent Agent renderer and state as
Agent Panel. Switching away hides Full Agent while Agent tab remains available.

## Agent tab

Fixed, non-closable shell-tab projection of global Agent full presentation,
analogous to fixed Home. It is not an app module and does not own a separate
renderer. Unfocusing it hides Full Agent while preserving Agent renderer,
conversation state, and in-progress work. Active styling means Full Agent is
focused; it uses tab-selection semantics.

## Previous content target

Home or app tab active immediately before Agent tab gains focus. Unfocusing Agent
tab restores this target. If target app tab no longer exists, shell activates
rightmost remaining app tab, then Home. Suggested state field is
`previousContentTabId`, where `null` represents Home.

## Agent presentation transition

Atomic shell-state change between Agent Panel and focused Agent tab. Same Agent
renderer remains mounted. Shell must not expose an intermediate state where both
presentations are visible or where app content visibly resizes before Full Agent
covers it. Panel appearance and disappearance retain matching 120ms animation;
transitions involving Full Agent do not.

## Agent presentation command

Explicit shell command for one transition: toggle Panel, focus Agent tab,
unfocus Agent tab, or dock Full Agent as Panel. Generic presentation-mode toggle
APIs are excluded because they cannot express fixed-tab focus semantics.

## Agent navigation intent

Optional Full Agent destination attached to a focus transition. Direct fixed-tab
activation has no new intent and restores last Full route. Panel expansion and
shell commands carry explicit conversation or feature destinations. It changes
navigation only, never Agent renderer identity.

## Full-only Agent command

Shell command requiring Full Agent navigation: new session, settings, shortcuts,
or sidebar toggle. Shell focuses fixed Agent tab before dispatch. If Agent Panel
is visible, transition closes it atomically. Command waits for Agent renderer
readiness and is never rendered transiently inside Panel.

## Initial active target

Shell navigation target selected by window-creation intent. Ordinary windows
start on Home with Agent Panel hidden. Focused-session windows, Full-only command
deep links, and required Agent onboarding start on fixed Agent tab. It replaces
legacy `initialAgentMode`, which conflates navigation with presentation.

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

Panel chat-header control replacing current Share button. It focuses fixed Agent
tab and switches same Agent `<webview>` from Panel to Full without reload. Full
Agent reverse control unfocuses Agent tab, restores previous content target, and
opens Agent Panel.

## Global Agent icon

Title-bar control for Agent presence, not Full Agent navigation. With Agent tab
unfocused, it toggles Agent Panel. With Agent tab focused, it unfocuses Agent tab
and restores previous content target without opening Panel. It never focuses Agent
tab. Active styling means Agent Panel is visible; it uses toggle-button
semantics. It is icon-only; stateful tooltip and accessible label describe open
Panel, close Panel, or exit Full action.

## Agent hidden mode

Agent renderer remains alive but invisible. Agent tab is unfocused and Agent
Panel is hidden. Underlying active app receives full content-region width. Next
global Agent-icon activation opens Panel; it never restores Full from history.

## Agent last mode

Removed legacy presentation history. Target architecture derives presentation
from active shell target and explicit Agent Panel visibility.

## Active target

Exactly one focused shell navigation target: Home, dynamic app tab, or fixed
Agent tab. Full Agent exists when active target is Agent. This replaces using
Agent visibility as an overlay on separately active tab selection.

## New Conversation state

Agent chat state with no selected session. Panel shows composer/empty state;
first send creates session. No historical session is selected implicitly.

## Rendering surface

Electron `<webview>` guest with independent web contents and renderer lifecycle.
Shell DOM owns bounds, visibility, and order. Main process validates attachment,
registers ownership, routes IPC, and controls teardown.

## Agent session

Persistent conversation identity and execution state owned by global Agent.
