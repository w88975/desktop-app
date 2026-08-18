# ADR 0003: Agent Full View as a Shell Tab

- Status: accepted
- Date: 2026-08-18

## Context

Agent is global and persistent. It has a docked panel presentation and a full
presentation. The current full presentation is an overlay outside the shell tab
model, and the global Agent icon restores whichever presentation was last used.
This makes Full Agent behave differently from other full content views and gives
the icon mode-dependent reopen behavior.

## Decision

Full Agent is represented by one fixed shell tab, analogous to fixed Home. The
tab always exists, cannot be closed, and projects the same persistent Agent
renderer and state used by Agent Panel; it does not create a second Agent
instance or renderer.

- `Open Agent full view` closes Agent Panel, focuses Agent tab, and displays Full
  Agent.
- Switching to Home or an app tab keeps Agent tab open and hides Full Agent.
- Activating Agent tab displays Full Agent again.
- Agent tab has no close control and never leaves shell tab model.
- Operations previously described as closing Agent tab instead unfocus it,
  hiding Full Agent without destroying Agent renderer, conversation state, or
  in-progress work.
- Global Agent icon opens Agent Panel unless Agent tab is focused. When Agent tab
  is focused, icon unfocuses it instead.
- Global Agent icon never restores Full Agent from presentation history.
- More precisely, global Agent icon follows this state machine:
  - focused Agent tab -> unfocus Agent tab and restore previous content target;
    do not open Agent Panel;
  - unfocused Agent tab plus hidden Agent Panel -> open Agent Panel;
  - unfocused Agent tab plus visible Agent Panel -> close Agent Panel.
- Global Agent icon never focuses Agent tab. Full Agent can be focused only by
  clicking fixed Agent tab or selecting `Open Agent full view` inside Agent
  Panel.
- Opening Full Agent records currently active Home or app tab as previous
  content target. Unfocusing Agent tab restores that target. If target app tab no longer
  exists, shell activates rightmost remaining app tab, then Home as fallback.
- Full Agent retains `Dock Agent as panel`. Activating it unfocuses Agent tab,
  restores previous content target, and opens Agent Panel. Session, draft, and
  in-progress work remain unchanged.
- Title-bar tab order is App Logo, Back, Forward, fixed Home, fixed Agent tab,
  dynamic app tabs, then right-aligned global Agent icon.
- A vertical divider separates fixed tabs from dynamic app tabs. It appears
  between fixed Agent tab and dynamic tab group only while at least one dynamic
  app tab exists. It is decorative, non-interactive, and hidden when group is
  empty.
- Active styling is presentation-specific. Agent tab is active only while Full
  Agent is focused. Global Agent icon is active only while Agent Panel is
  visible. Hidden Agent leaves both inactive. Agent tab uses tab-selection
  semantics such as `aria-selected`; global icon uses toggle semantics such as
  `aria-pressed`.
- Clicking Agent tab while Agent Panel is visible performs one atomic state
  transition: record current content as previous content target, close Panel,
  focus Agent tab, and display Full Agent. Agent renderer and conversation state
  are unchanged. Shell must not publish an intermediate frame with both
  presentations visible or resize app content before Full Agent covers it.
- Clicking already focused Agent tab is a no-op. It does not unfocus Agent, open
  Panel, reload renderer, or reset conversation state. Users leave Full Agent by
  selecting Home or an app tab, using global Agent icon, or selecting Full
  Agent's `Dock Agent as panel` control.
- Full-only shell commands (`new-session`, `open-settings`, `open-shortcuts`, and
  `toggle-sidebar`) atomically close visible Agent Panel, record current content
  target, focus Agent tab, wait for Agent renderer readiness, then dispatch.
  When Agent tab is already focused, shell dispatches directly. `new-session`
  also uses Full Agent because Panel v1 does not provide session navigation.
- Window initialization is intent-based. Ordinary launch and ordinary workspace
  windows focus Home with Agent Panel hidden. Focused-session windows, Agent
  command deep links, and required Agent onboarding focus Agent tab. Restart does
  not restore previous Agent focus without an explicit startup intent. Current
  `initialAgentMode` should become `initialActiveTarget` so navigation and
  presentation are not conflated.
- Shell state uses explicit navigation plus Panel visibility:

  ```ts
  type ActiveTarget =
    | { kind: 'home' }
    | { kind: 'app'; tabId: string }
    | { kind: 'agent' }

  interface ShellState {
    activeTarget: ActiveTarget
    tabs: AppTab[]
    agentPanelVisible: boolean
    previousContentTabId: string | null
    agentPanelWidthPx: number
  }
  ```

  `tabs` contains dynamic app tabs only; `null` previous content means Home.
  Focused Agent target implies hidden Panel. Visible Panel implies Home or app
  target. Hidden Agent means unfocused Agent tab plus hidden Panel. Agent
  presentation is derived from these fields. Legacy `AgentMode`, `visible`, and
  `lastMode` presentation state is removed.
- Tab and navigation state is owned by dedicated
  `apps/electron/src/main/shell-tab-manager.ts`. `ShellTabManager` is independent
  from Electron web contents and exposes intent-level operations for Home,
  dynamic app tabs, fixed Agent tab, Agent Panel, and previous-content fallback.
  Every operation uses copy-on-write transaction semantics: build next snapshot,
  validate invariants, then replace current state once. Failed validation leaves
  prior state unchanged. One operation returns one committed snapshot plus an
  explicit side-effect description; it never emits partial state.
- `ShellViewManager` delegates all tab/navigation mutations to
  `ShellTabManager`. It remains responsible for `<webview>` authorization,
  renderer lifecycle, IPC, and applying returned effects such as renderer close
  or Agent navigation command. It emits shell state once after successful
  transaction. No other main-process class mutates tab state directly.
- `ShellTabManager` public operations include `activateHome`, `openAppTab`,
  `activateAppTab`, `closeAppTab`, `focusAgentTab`, `unfocusAgentTab`,
  `toggleAgentPanel`, and `dockAgentAsPanel`. Operation names express intent;
  generic mode toggles are excluded. Implementation comments documenting state
  invariants, fallback rules, and transaction boundaries are written in Chinese.
- Fixed Agent tab renders Bot icon plus `Agent`, using same geometry and selected
  styling as fixed Home. Right-aligned global Agent control is icon-only to avoid
  duplicate `Agent` labels. Its tooltip and accessible label are stateful:
  `Open Agent panel` when hidden, `Close Agent panel` when Panel is visible, and
  `Exit Agent full view` when Agent tab is focused.
- Full Agent navigation intent depends on focus source. Direct Agent-tab click
  restores last Full internal route. Panel `Open Agent full view` opens Panel's
  current conversation when one is selected; without a selected conversation it
  supplies no navigation intent and does not force any destination. Full-only
  commands open their requested New Session, Settings, Shortcuts, or sidebar
  destination. Focused-session windows and deep links open specified
  conversation. Switching to Home or app tabs does not reset Full internal
  route.
- Header navigation uses one accessible tablist. Home, Agent, and dynamic app
  entries use tab semantics with selected state. Left/Right moves keyboard focus;
  Enter/Space activates. Home and Agent ignore tab-close operations. Dynamic app
  tabs retain labeled close controls. Decorative fixed/dynamic divider is hidden
  from accessibility tree.
- Generic `toggleAgent` and `toggleAgentPresentationMode` APIs are removed.
  Shell exposes explicit `toggleAgentPanel`, `focusAgentTab(intent?)`,
  `unfocusAgentTab`, and `dockAgentAsPanel` commands with corresponding IPC
  channels. Current internal callers migrate together; no compatibility aliases
  remain, preventing legacy last-mode behavior from returning.
- Panel appearance and disappearance retain matching current 120ms animation.
  Panel-to-Full, Full-to-Panel, Full-to-content, content-to-Full, and normal tab
  activation are animation-free and commit as one shell state change. Splitter
  dragging remains immediate. No fade, slide, or intermediate Full webview resize
  is shown.
- Shell tab focus does not enter global Back/Forward history. Home, Agent, and
  app selection are shell focus, not page navigation. Back/Forward is not an
  exit mechanism for Full Agent; detailed history behavior remains separate.
- Narrow windows preserve App Logo, Back, Forward, fixed Home, fixed Agent tab,
  and right-aligned Agent icon. Dynamic app-tab group shrinks and scrolls
  horizontally; its labels may truncate while close controls remain usable.
  Fixed Agent tab never collapses to icon-only or enters an overflow menu.

## Consequences

- Full Agent follows normal tab activation and switching behavior while keeping
  fixed, non-closable identity.
- Agent tab identity and Agent renderer identity remain separate concepts.
- Shell state must model Agent as fixed navigation target while preserving one
  global Agent renderer.
- Tab behavior gains one testable domain owner, allowing future reorder,
  pinning, overflow, restore, and multi-instance policies without spreading
  mutations across shell lifecycle code.
- `lastMode` is removed. Active target plus explicit Panel visibility fully
  determine Agent presentation.

## Deferred follow-ups

- Detailed Back/Forward ownership and routing.
- Detailed Agent renderer crash-recovery UX.
