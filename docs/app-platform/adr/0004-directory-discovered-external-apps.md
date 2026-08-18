# ADR 0004: Directory-Discovered External Apps

- Status: accepted
- Date: 2026-08-18

## Context

The desktop shell currently loads only built-in, packaged apps. We need a small
external-app model inspired by PWA manifests without requiring external apps to
be bundled into this repository. An app may be a local static site or a remote
web application. Both must appear in the existing tab system, and both need a
minimal JavaScript bridge to the desktop host.

The first version runs in a trusted intranet environment. It intentionally
prioritizes local development and protocol extensibility over package signing,
remote-origin restrictions, or a complete App Store.

## Decision

### Registry root and identity

The main process owns two registry roots:

```text
<repo>/apps/builtin/<appId>/
<userData>/apps/<appId>/
```

The direct child-directory name is the app identity. A manifest's `appId` must
match that directory name exactly and match `^[a-z0-9][a-z0-9._-]*$`. Main scans
both directories on startup, watches them at runtime, and exposes an explicit
rescan action. Packaged builds ship the builtin root at
`resources/app/builtin`. A builtin app wins if the user directory contains the
same `appId`.

The registry supports three source forms:

- A directory under `apps/builtin` is a Builtin App. It uses the same manifest,
  protocol, preload, bridge, partition, and tab lifecycle as other PWA apps.
- A directory without `source.json` is a Local App. It contains its manifest,
  entry HTML, icon, and all other static assets.
- A directory with `source.json` whose `type` is `remote` is a Remote App. The
  source file contains a remote base URL; cached manifest and icon files live in
  the same directory.

There is no Store, catalog, ZIP extraction, signature verification, or hash
verification in this version. Local provisioning means copying a directory into
the registry root. Future Store installation can materialize the same directory
format without changing runtime discovery.

### Builtin and Local App loading

Builtin and Local files load through a privileged standard custom scheme:

```text
hxsy-app://<appId>/<path>
```

The protocol maps requests only inside the matching app directory and rejects
absolute paths and path traversal. It does not expose the physical filesystem
path to page code.

### Remote App loading and cache

A minimal Remote App begins with:

```json
{
  "schemaVersion": 1,
  "type": "remote",
  "url": "https://internal.example.com/todo/"
}
```

Scanning this file registers a placeholder app. It does not require the remote
manifest to be available. First tab activation lazily requests
`<url>/manifest-hxsy.json` in the main process.

Remote state is explicit:

```text
discovered -> loading -> ready
                      -> error
```

- `discovered` and `loading` use a generic icon and `加载中...` tab title.
- Success validates the manifest, downloads the icon, atomically caches both,
  augments `source.json`, updates every visible projection, then loads the entry.
- Failure keeps the directory registered, changes the tab title to `加载失败`,
  and renders a shell-owned generic failure page with Retry.
- Retry repeats manifest and entry resolution in the same tab.
- Existing valid cache may supply metadata immediately. Cache update failure
  never destroys the previous valid cache.
- This version does not refresh metadata automatically in the background.

After successful resolution, host-managed `source.json` may contain:

```json
{
  "schemaVersion": 1,
  "type": "remote",
  "url": "https://internal.example.com/todo/",
  "manifestUrl": "https://internal.example.com/todo/manifest-hxsy.json",
  "entryUrl": "https://internal.example.com/todo/index.html",
  "iconFile": "icon.png",
  "lastResolvedAt": "2026-08-18T00:00:00.000Z"
}
```

Known cache fields are updated atomically. Unknown fields are preserved.

### Manifest v1

Every resolved app uses a root `manifest-hxsy.json`:

```json
{
  "schemaVersion": 1,
  "appId": "com.huaxisy.todo",
  "title": "TODO",
  "icon": "./icon.png",
  "entry": "./index.html",
  "webTools": [
    {
      "name": "create_todo",
      "description": "创建待办",
      "inputSchema": { "type": "object" },
      "handler": "createTodo"
    }
  ]
}
```

Required fields are `schemaVersion`, `appId`, `title`, `icon`, and `entry`.
Optional fields are `version`, `description`, and `webTools`; omitted
`webTools` means an empty list. Unknown fields are ignored. Unsupported schema
versions fail resolution.

Remote `entry` and `icon` resolve against the source base URL and may also be
absolute URLs. Local values must remain relative paths inside the app directory.

Web Tool declarations are parsed, validated, cached, and available for metadata
display only. Main does not register them with Agent and does not invoke their
handlers in this version. `handler` reserves a future bridge contract and is not
evaluated as JavaScript from the manifest.

### Runtime and bridge

Every app uses a restricted shared preload with `contextIsolation: true` and
`nodeIntegration: false`. Each `appId` uses its own persistent Electron session
partition. Tabs belonging to one app share cookies and web storage; different
apps do not. Replacing app code does not clear its partition.

The preload exposes one unversioned namespace:

```ts
window.hxsyApp.getAppName(): Promise<string>
window.hxsyApp.getAppVersion(): Promise<string>
window.hxsyApp.openAgentPanel(): Promise<void>
```

`getAppName` and `getAppVersion` describe the desktop host, not the external
app. `openAgentPanel` is idempotent. If Panel is visible it is a no-op; if Full
Agent is focused it restores previous content and docks Agent as Panel.

No auth, workspace, filesystem, MCP, Skill, or arbitrary IPC capability is
exposed. The bridge namespace itself is not versioned; manifest schema remains
versioned.

### Tabs and Home

External apps use the existing `ShellTabManager` and are singleton in this
version. Reopening an app activates its existing loading, ready, or error tab.

Home becomes the installed-app launcher. It lists discovered apps by title,
shows loading/error state, opens singleton tabs, exposes `打开 Apps 目录`, and
exposes `重新扫描`. It does not provide search, categories, custom sorting,
installation forms, or deletion.

App Logo menu no longer lists apps. It retains Agent-related commands.

### Trust boundary deferred

Remote top-level navigation, redirects, and cross-origin transitions are not
restricted in this version. All apps are assumed controlled inside the trusted
intranet. The shared preload therefore remains available after navigation in the
same guest. Origin allowlists, capability prompts, signatures, and Store trust
roots are explicitly deferred and must be reconsidered before accepting
untrusted apps.

## Consequences

- Local development requires only copying a folder; no packaging pipeline.
- Remote apps need only a local `source.json`; metadata becomes cached after
  first successful resolution.
- Builtin, Local, and Remote apps share manifest, tab, bridge, partition, and
  Home UI models.
- App registration is resilient to remote startup failure.
- The initial bridge is intentionally tiny but can grow through explicit host
  methods without exposing the full Agent preload.
- Current trust assumptions are unsuitable for arbitrary public web content.

## Deferred work

- App Store/catalog and installation UX.
- ZIP download/extraction, hashes, signatures, update, and rollback.
- Agent registration and invocation of manifest Web Tools.
- Auth/session bridge and scoped capability grants.
- MCP and Skill declarations.
- Remote origin/navigation policy.
- Uninstall and partition-data deletion.
- Search, categories, and custom app ordering.
