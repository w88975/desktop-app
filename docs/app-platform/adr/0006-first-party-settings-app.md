# ADR 0006: First-Party Settings App

- Status: accepted
- Date: 2026-08-20

## Context

Settings currently live inside the Agent renderer and use Agent navigation,
layout, context, and command routing. This makes Settings appear to be an Agent
feature even though the desktop Shell needs one extensible location for both
current Agent settings and future main-App settings.

The existing Settings UI contains eleven pages: App, AI, Appearance, Input,
Workspace, Permissions, Labels, Messaging, Server, Shortcuts, and Preferences.
Their behavior and persistence must remain unchanged. This change relocates the
feature; it does not redesign Settings or add settings.

The Shell already owns Home, fixed Agent navigation, and closable dynamic App
tabs. It also supports singleton App definitions. Settings should use that
mental model while remaining a trusted first-party surface rather than joining
the manifest-discovered PWA trust model from ADR 0004.

## Decision

### Product model and tab lifecycle

Settings is a trusted first-party App with identity `settings`. It opens as a
normal dynamic App tab with `instancePolicy: "single"`:

- each Shell window may contain at most one Settings tab;
- opening Settings again focuses the existing tab without resetting its page,
  scroll position, or transient renderer state;
- a newly opened Settings tab is appended to the dynamic-tab tail;
- the tab is closable and follows the existing active-tab close fallback;
- closing the tab destroys its renderer;
- Settings tabs are not restored after process restart.

Singleton scope is per Shell window, not process-wide. An invocation targets
the currently focused managed Shell window. Multiple windows may therefore show
Settings independently.

Activating Settings from Full Agent has exactly the same Shell transition as
activating Home or another App tab. It focuses Settings as the active content
target and unfocuses Full Agent. Settings never adds a special Agent-state
transition. If Agent Panel is open or closed, opening Settings preserves that
Panel state.

### Entry points

Settings is available from:

- a fixed first-party card at the start of Home's Apps list;
- the retained Settings item in the Shell Logo menu;
- the macOS application menu;
- `Command+,` on macOS and `Control+,` on Windows and Linux.

The old visible Settings entry inside Agent is removed.

The shortcut is a window-local application shortcut, not an Electron
`globalShortcut`. Main process handles it for Shell web contents and every
attached guest web contents so it works while Home, Agent, Settings, or another
App has keyboard focus. It also works while an input is focused. Only the
standard combination without Shift or Alt is accepted. The existing
`app.settings` action definition remains available to the read-only Shortcuts
page, but Agent renderer no longer executes it.

All entry points use one main-process `openSettings` path. On macOS, choosing
Settings while authenticated with no Shell window creates one normal Shell
window and opens its Settings tab. While unauthenticated, the action only shows
or focuses Auth window; no Settings intent is retained for after Login.

### First-party runtime boundary

Settings is registered in code as a trusted internal App. It does not use an
external-App manifest, directory discovery, rescan state, or an External App
partition. It cannot be removed, overridden, or placed into loading state by
Apps-directory contents.

Settings owns a dedicated renderer entry and a least-privilege preload. The
preload exposes the APIs required by current Settings pages, not the complete
Agent preload. The Settings renderer loads independently from Agent renderer;
an Agent renderer failure does not prevent the Settings shell from opening.
Pages whose backend dependency is unavailable retain their current error
behavior.

No Settings-specific crash recovery, reload contract, retry view, or error
state is added. The surface follows the current trusted internal-renderer
lifecycle.

### Settings feature module

Renderer code moves into `renderer/features/settings/`. The module owns:

- Settings App root;
- current navigator and pages;
- a typed page registry;
- a narrow `SettingsRuntimeContext` and API adapters.

The registry is the single source of page metadata and component resolution.
Each page declares its ID, title, icon, order, lazy component, runtime
requirements, and visibility predicate. Existing feature-flag visibility,
including Server settings, remains unchanged. Future main-App and Agent settings
extend this same static typed registry. Runtime plugin registration is outside
scope.

Only identifiers and route-independent shared types that are genuinely needed
across process boundaries remain in shared code. Existing pages stop depending
on the broad Agent `AppShellContext`; `SettingsRuntimeContext` supplies current
workspace information, refresh operations, and narrowly adapted services.

Files move to the new module without compatibility re-export files. Imports are
updated in one migration.

### Navigation and UI

Existing Settings presentation is preserved: its left navigation continues to
show App, AI, Appearance, and all other current groups, with the selected page
on the right. Future settings may extend existing groups or add groups. No empty
main-App or Agent wrapper group is introduced.

The Settings surface uses normal App-region inset, border, and corner geometry.
Existing settings controls, spacing, copy, page ordering, and behavior remain
unchanged except that every `Open in new window` affordance is removed.

Settings keeps internal page location in the renderer hash, for example
`settings.html#appearance`. A new tab starts on App settings. Invalid hashes are
replaced with the default. Reopening an existing tab preserves its current hash;
closing and reopening within the same process remembers the last selected page
for that Shell window. Process restart does not persist that selection.

Shell Back and Forward controls are not connected to Settings navigation in
this change. Settings continues to navigate through its own left navigation.

### Workspace and persistence

Settings follows the current workspace of its Shell window rather than keeping
the workspace captured when its renderer was created. Workspace-scoped changes
refresh Settings surfaces bound to that workspace. Global changes refresh every
Settings surface.

Existing storage remains authoritative and no data migration occurs:

- global Agent configuration remains in `config.json`;
- user preferences remain in `preferences.json`;
- workspace configuration remains in existing workspace storage;
- renderer preferences remain in existing local storage.

Existing save and submit semantics remain unchanged. No draft layer, navigation
confirmation, snapshot, or new persistence mechanism is introduced. Existing
configuration watchers continue to synchronize file-backed state. Renderer
local-storage/Jotai state adds storage-event synchronization so multiple
Settings renderers converge.

Shell workspace updates must also update the Settings runtime projection; the
manager must not retain a stale creation-time workspace ID.

### Removal of Agent-owned Settings navigation

This is a direct migration rather than a compatibility period. Remove:

- Agent Settings route and route-parser branch;
- Settings custom/deep-link handling;
- deep-link forwarding or compatibility rendering;
- Agent renderer Settings entry and handler;
- every Settings `Open in new window` action;
- old page paths and compatibility re-exports.

All in-repository callers move to the main-process Settings App path in the same
change. Unsupported legacy Settings deep links do not open Settings and are not
queued.

## Invariants

- A Shell window owns zero or one Settings tab.
- Settings is never resolved through External App discovery or manifests.
- Every Settings entry point reaches the same main-process open operation.
- Opening Settings never creates a standalone Settings window.
- Opening or focusing Settings does not reset its active page.
- Settings follows its containing Shell window's current workspace.
- Existing setting values and persistence locations require no migration.
- Agent renderer no longer owns or renders Settings navigation.
- Unauthenticated invocation never bypasses Auth gate or queues Settings work.

## Consequences

- Settings feels and behaves like a first-class application while preserving
  current Settings UI and behavior.
- Main-App settings can be added to one registry without recreating an Agent
  navigation dependency.
- Dedicated renderer and preload create a clear capability boundary, at the cost
  of adapting the broad contexts currently used by several pages.
- Main-process shortcut routing makes `Command/Control+,` consistent across all
  focused surfaces and operating systems.
- Multiple windows can edit the same global settings, requiring explicit
  cross-renderer synchronization for local-storage-backed values.
- Removing routes and deep links simplifies the final model but intentionally
  provides no compatibility for old Settings URLs.

## Verification

Implementation must verify:

- Home, Agent, Settings, and another App can invoke the shortcut;
- repeated opens focus one Settings tab per window;
- separate Shell windows may each open one Settings tab;
- activation from Full Agent matches Home/App activation semantics;
- Agent Panel visibility is preserved;
- Home card, Shell Logo menu, native menu, and shortcut share one open path;
- all eleven existing pages retain their functionality and visibility rules;
- global and workspace-scoped changes synchronize to the correct windows;
- removed Agent routes, deep links, handlers, and new-window actions no longer
  exist;
- type checking, targeted lint, automated tests, renderer build, and manual UI
  checks pass.

## Deferred work

- Shell Back/Forward history ownership and Settings integration.
- Runtime plugin registration for settings pages.
- Settings-specific renderer crash recovery or retry UX.
- External App access to host settings.
- New main-App settings and new Settings groups.
