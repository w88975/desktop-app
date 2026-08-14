# ADR 0002: DOM-Hosted Webview Shell

- Status: accepted
- Date: 2026-08-14
- Supersedes: ADR 0001 composition primitive

## Context

Native sibling `WebContentsView` surfaces sit outside shell DOM stacking.
Shell-owned dropdowns, dialogs, and floating UI therefore cannot reliably paint
over app or Agent surfaces. Product requires global header overlays to cover
both regions while retaining separate renderer lifecycles.

## Decision

Main `BrowserWindow` renderer owns one DOM layout: global header, global overlay
layer, app region, Agent region, and splitter. Home, each app tab, and Agent are
hosted as persistent Electron `<webview>` elements inside that DOM.

Normal CSS positioning and stacking control layout and overlay order. Shell
menus/dialogs render above guests. Panel/full/hidden transitions resize or hide
the same Agent element, preserving its web contents and UI state.

Main process remains lifecycle and security authority. It validates guest URL
and preload pairs in `will-attach-webview`, rejects unknown navigation, forces
`nodeIntegration: false`, `contextIsolation: true`, and a fixed preload, then
registers attached guest web contents for workspace-aware IPC routing. Closing
an app tab destroys its guest web contents.

## Consequences

- Header menus and future shell overlays can cover App and Agent regions.
- Shell, Home, App, and Agent retain distinct web contents/renderer processes.
- App and Agent layout becomes ordinary DOM/CSS; native bounds compositor code
  is removed.
- `<webview>` is an Electron-specific primitive Electron does not recommend for
  general web content. Scope stays limited to trusted, packaged, first-party
  routes with strict attachment and navigation guards.
