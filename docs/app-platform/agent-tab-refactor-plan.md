# Agent Tab Refactor Plan

Status: implemented

Source of truth: [ADR 0003](./adr/0003-agent-full-view-as-shell-tab.md)

## Goal

Make global persistent Agent a fixed, non-closable tab application while keeping
Agent Panel as second presentation of same renderer and business state.

## Work sequence

1. Add `apps/electron/src/main/shell-tab-manager.ts` as sole tab/navigation state
   owner. Use copy-on-write transactions, invariant validation, one commit per
   operation, explicit returned effects, and Chinese comments for state rules.
2. Replace `AgentPresentationState` and `lastMode` with `activeTarget`, explicit
   `agentPanelVisible`, `previousContentTabId`, and existing panel width.
3. Move Home, dynamic app-tab, fixed Agent-tab, Panel, and fallback operations
   from `ShellViewManager` into `ShellTabManager`. Keep webview lifecycle and IPC
   orchestration in `ShellViewManager`.
4. Replace generic Agent toggle IPC with explicit Panel/focus/unfocus/dock
   commands. Keep renderer-ready command queue.
5. Add fixed Agent tab after fixed Home. Add conditional decorative divider
   before dynamic app tabs. Keep fixed controls visible when dynamic strip
   overflows.
6. Derive presentation: focused Agent target renders Full; visible Panel renders
   `AgentPanel`; otherwise same Agent webview remains mounted and hidden.
7. Add source-aware navigation intent. Direct Agent-tab focus restores last Full
   route; Panel expansion targets selected conversation only when one exists;
   Full-only commands target requested destination.
8. Preserve symmetric 120ms Panel open/close animation. Make every transition
   involving Full Agent animation-free and atomic.
9. Migrate startup intent from `initialAgentMode` to `initialActiveTarget`.
10. Add exhaustive `shell-tab-manager` transaction tests, then update manager,
    shell-renderer, preload/IPC, and integration tests.

## `ShellTabManager` contract

```ts
interface TabTransaction<T = void> {
  state: ShellTabState
  value: T
  effects: readonly ShellTabEffect[]
}

interface ShellTabManager {
  getState(): Readonly<ShellTabState>
  activateHome(): TabTransaction
  openAppTab(input: OpenAppTabInput): TabTransaction<AppTab>
  activateAppTab(tabId: string): TabTransaction
  closeAppTab(tabId: string): TabTransaction
  focusAgentTab(intent?: AgentNavigationIntent): TabTransaction
  unfocusAgentTab(): TabTransaction
  toggleAgentPanel(): TabTransaction
  dockAgentAsPanel(): TabTransaction
}
```

Manager contract rules:

- Returned snapshots are immutable from caller perspective.
- Invalid tab IDs or invariant violations commit nothing.
- State mutation and effect description are atomic; Electron side effects run
  only after commit.
- One user intent causes at most one shell-state publication.
- Tests cover every state transition, invalid input, fallback, and reentrant
  request boundary.

## Acceptance criteria

- Header order: Logo, Back, Forward, Home, Agent, conditional divider, dynamic
  app tabs, right-aligned icon-only Agent Panel control.
- Agent tab always exists, cannot close, and is active only when Full Agent is
  focused.
- Right Agent icon toggles Panel while Agent tab is unfocused. While Full is
  focused it returns to previous content without opening Panel.
- Panel `Open Agent full view` and direct Agent-tab activation never create a
  second Agent renderer or lose conversation, draft, task, or route state.
- Full `Dock Agent as panel` returns to previous content and opens Panel.
- Home/app selection immediately unfocuses Full. Panel remains open across
  content-tab switches.
- Panel/Full transitions publish no illegal state with both presentations
  visible. Full transitions show no intermediate layout or animation.
- Full-only commands focus Agent tab before dispatch and wait for renderer ready.
- `ShellTabManager` is sole mutation owner. Every public operation either commits
  one valid state or leaves state unchanged; no intermediate shell state emits.
- Fixed/dynamic tabs expose correct tablist keyboard and ARIA behavior.
- Normal launch starts Home with Panel hidden; explicit Agent startup intents
  focus Agent tab.
