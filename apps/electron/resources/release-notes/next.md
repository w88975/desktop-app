# Pending Release Notes

This file accumulates release notes for the next unreleased version. PRs that add user-visible behavior should append a bullet to the relevant section here. Versioned files (`X.Y.Z.md`) are owned by the release skill — never create them in feature commits.

## Features

- **Agent-controlled Apps and WebTools** — Agents can discover installed Apps, open or close their tabs, invoke manifest-declared functions registered by App pages through `window.agent.tools`, and receive structured results.
- **Agent App browser control** — Agents can inspect rendered App DOM/accessibility snapshots and simulate clicks, input, scrolling, dragging, keys, and navigation directly inside each isolated App WebView.
- **Main App tab tools** — Agents can list Home, Agent, and open App tabs, switch the active tab without reloading it, and close closable App tabs through grouped `main_app_*` tools.

## Improvements

## Bug Fixes

## Breaking Changes
