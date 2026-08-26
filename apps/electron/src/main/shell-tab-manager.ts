import type {
  ActiveTarget,
  AgentNavigationIntent,
  AppDefinition,
  AppTab,
  ShellState,
} from '../shared/app-platform'

export type ShellTabEffect =
  | { type: 'close-app-renderer'; tab: AppTab }
  | { type: 'navigate-agent'; intent: AgentNavigationIntent }

export interface TabTransaction<T = void> {
  readonly state: ShellState
  readonly value: T
  readonly effects: readonly ShellTabEffect[]
}

export interface OpenAppTabInput {
  definition: AppDefinition
  tabId: string
  webContentsId: number
  activate?: boolean
}

export interface OpenAppTabResult {
  tab: AppTab
  created: boolean
}

interface ShellTabManagerOptions {
  initialActiveTarget: 'home' | 'agent'
  panelWidthPx: number
}

function cloneTarget(target: ActiveTarget): ActiveTarget {
  return target.kind === 'app' ? { kind: 'app', tabId: target.tabId } : { kind: target.kind }
}

function cloneState(state: ShellState): ShellState {
  return {
    activeTarget: cloneTarget(state.activeTarget),
    tabs: state.tabs.map(tab => ({ ...tab })),
    agentPanelVisible: state.agentPanelVisible,
    previousContentTabId: state.previousContentTabId,
    agentPanelWidthPx: state.agentPanelWidthPx,
  }
}

/**
 * Shell tab/navigation 唯一状态写入者。
 *
 * 每个公开操作都在状态副本上完成：构造 next state -> 校验不变量 -> 单次提交。
 * 校验失败时旧状态保持不变；Electron renderer 生命周期由 ShellViewManager 根据
 * transaction effects 处理，避免 domain state 混入 WebContents 副作用。
 */
export class ShellTabManager {
  private state: ShellState

  constructor(options: ShellTabManagerOptions) {
    this.state = {
      activeTarget: { kind: options.initialActiveTarget },
      tabs: [],
      agentPanelVisible: false,
      previousContentTabId: null,
      agentPanelWidthPx: options.panelWidthPx,
    }
    this.validate(this.state)
  }

  getState(): ShellState {
    return cloneState(this.state)
  }

  activateHome(): TabTransaction {
    return this.commit(draft => {
      draft.activeTarget = { kind: 'home' }
      // Panel 属于内容区域辅助呈现；切换内容 tab 时保持可见。
    })
  }

  openAppTab(input: OpenAppTabInput): TabTransaction<OpenAppTabResult> {
    return this.commit<OpenAppTabResult>(draft => {
      if (input.definition.instancePolicy === 'single') {
        const existing = draft.tabs.find(tab => tab.appId === input.definition.id)
        if (existing) {
          if (input.activate !== false) draft.activeTarget = { kind: 'app', tabId: existing.id }
          return { value: { tab: existing, created: false } }
        }
      }

      const tab: AppTab = {
        id: input.tabId,
        appId: input.definition.id,
        title: input.definition.title,
        webContentsId: input.webContentsId,
        kind: input.definition.kind,
        entry: input.definition.entry,
        iconUrl: input.definition.iconUrl,
        status: input.definition.status ?? 'ready',
        error: input.definition.error,
        partition: input.definition.partition,
        browserInstanceId: input.definition.browserInstanceId,
      }
      draft.tabs.push(tab)
      if (input.activate !== false) draft.activeTarget = { kind: 'app', tabId: tab.id }
      return { value: { tab, created: true } }
    })
  }

  updateBrowserTab(
    tabId: string,
    patch: Partial<NonNullable<AppTab['browserState']>>,
  ): TabTransaction {
    return this.commit(draft => {
      const tab = this.requireTab(draft, tabId)
      if (tab.kind !== 'browser') throw new Error(`Tab is not a browser: ${tabId}`)
      tab.browserState = {
        url: tab.browserState?.url ?? tab.entry,
        title: tab.browserState?.title ?? tab.title,
        favicon: tab.browserState?.favicon ?? null,
        isLoading: tab.browserState?.isLoading ?? false,
        canGoBack: tab.browserState?.canGoBack ?? false,
        canGoForward: tab.browserState?.canGoForward ?? false,
        ...patch,
      }
      if (patch.title) tab.title = patch.title
    })
  }

  activateAppTab(tabId: string): TabTransaction {
    return this.commit(draft => {
      this.requireTab(draft, tabId)
      draft.activeTarget = { kind: 'app', tabId }
    })
  }

  reorderAppTab(
    tabId: string,
    targetTabId: string,
    placement: 'before' | 'after',
  ): TabTransaction {
    return this.commit(draft => {
      if (tabId === targetTabId) return
      const sourceIndex = draft.tabs.findIndex(tab => tab.id === tabId)
      const targetIndex = draft.tabs.findIndex(tab => tab.id === targetTabId)
      if (sourceIndex < 0) throw new Error(`Unknown app tab: ${tabId}`)
      if (targetIndex < 0) throw new Error(`Unknown app tab: ${targetTabId}`)

      const [moved] = draft.tabs.splice(sourceIndex, 1)
      const remainingTargetIndex = draft.tabs.findIndex(tab => tab.id === targetTabId)
      const insertionIndex = placement === 'before'
        ? remainingTargetIndex
        : remainingTargetIndex + 1
      draft.tabs.splice(insertionIndex, 0, moved)
    })
  }

  setAppTabOrder(tabIds: readonly string[]): TabTransaction {
    return this.commit(draft => {
      if (tabIds.length !== draft.tabs.length || new Set(tabIds).size !== tabIds.length) {
        throw new Error('Invalid app tab order')
      }
      const byId = new Map(draft.tabs.map(tab => [tab.id, tab]))
      if (tabIds.some(tabId => !byId.has(tabId))) throw new Error('Invalid app tab order')
      draft.tabs = tabIds.map(tabId => byId.get(tabId)!)
    })
  }

  closeAppTab(tabId: string): TabTransaction<AppTab | null> {
    return this.commit(draft => {
      const index = draft.tabs.findIndex(tab => tab.id === tabId)
      if (index < 0) return { value: null }
      const [removed] = draft.tabs.splice(index, 1)

      if (draft.activeTarget.kind === 'app' && draft.activeTarget.tabId === tabId) {
        const fallback = draft.tabs[index - 1]
        draft.activeTarget = fallback ? { kind: 'app', tabId: fallback.id } : { kind: 'home' }
      }

      // Full Agent 下 previous content 被关闭：按约定回退到最右动态 tab，再回 Home。
      if (draft.previousContentTabId === tabId) {
        draft.previousContentTabId = draft.tabs.at(-1)?.id ?? null
      }

      return {
        value: removed,
        effects: [{ type: 'close-app-renderer', tab: removed }],
      }
    })
  }

  focusAgentTab(intent?: AgentNavigationIntent): TabTransaction {
    if (intent && (intent.type !== 'conversation' || !intent.sessionId.trim())) {
      throw new Error('Invalid Agent navigation intent')
    }
    return this.commit(draft => {
      if (draft.activeTarget.kind !== 'agent') {
        draft.previousContentTabId = draft.activeTarget.kind === 'app'
          ? draft.activeTarget.tabId
          : null
        draft.activeTarget = { kind: 'agent' }
        draft.agentPanelVisible = false
      }
      return intent ? { effects: [{ type: 'navigate-agent', intent }] } : undefined
    })
  }

  unfocusAgentTab(): TabTransaction {
    return this.commit(draft => {
      if (draft.activeTarget.kind !== 'agent') return
      draft.activeTarget = this.resolvePreviousContent(draft)
      draft.agentPanelVisible = false
    })
  }

  toggleAgentPanel(): TabTransaction {
    return this.commit(draft => {
      if (draft.activeTarget.kind === 'agent') {
        draft.activeTarget = this.resolvePreviousContent(draft)
        draft.agentPanelVisible = false
        return
      }
      draft.agentPanelVisible = !draft.agentPanelVisible
    })
  }

  dockAgentAsPanel(): TabTransaction {
    return this.commit(draft => {
      if (draft.activeTarget.kind === 'agent') {
        draft.activeTarget = this.resolvePreviousContent(draft)
      }
      draft.agentPanelVisible = true
    })
  }

  ensureAgentPanelVisible(): TabTransaction {
    return this.commit(draft => {
      if (draft.activeTarget.kind === 'agent') {
        draft.activeTarget = this.resolvePreviousContent(draft)
      }
      draft.agentPanelVisible = true
    })
  }

  setAgentPanelWidth(panelWidthPx: number): TabTransaction {
    return this.commit(draft => {
      draft.agentPanelWidthPx = panelWidthPx
    })
  }

  updateTabWebContentsId(tabId: string, webContentsId: number): TabTransaction {
    return this.commit(draft => {
      this.requireTab(draft, tabId).webContentsId = webContentsId
    })
  }

  updateAppTab(tabId: string, definition: AppDefinition): TabTransaction {
    return this.commit(draft => {
      const tab = this.requireTab(draft, tabId)
      tab.title = definition.title
      tab.entry = definition.entry
      tab.iconUrl = definition.iconUrl
      tab.status = definition.status ?? 'ready'
      tab.error = definition.error
      tab.partition = definition.partition
    })
  }

  private commit<T = void>(
    mutate: (draft: ShellState) => void | {
      value?: T
      effects?: readonly ShellTabEffect[]
    }
  ): TabTransaction<T> {
    const draft = cloneState(this.state)
    const result = mutate(draft)
    this.validate(draft)
    this.state = draft
    const value = result && 'value' in result ? result.value as T : undefined as T
    const effects = result && 'effects' in result ? result.effects ?? [] : []
    return {
      state: cloneState(draft),
      value: value === undefined ? value : structuredClone(value),
      effects: structuredClone(effects),
    }
  }

  private resolvePreviousContent(state: ShellState): ActiveTarget {
    if (state.previousContentTabId && state.tabs.some(tab => tab.id === state.previousContentTabId)) {
      return { kind: 'app', tabId: state.previousContentTabId }
    }
    return { kind: 'home' }
  }

  private requireTab(state: ShellState, tabId: string): AppTab {
    const tab = state.tabs.find(candidate => candidate.id === tabId)
    if (!tab) throw new Error(`Unknown app tab: ${tabId}`)
    return tab
  }

  /** 所有 transaction 提交前统一校验，禁止 UI 观察到非法组合。 */
  private validate(state: ShellState): void {
    const ids = new Set<string>()
    for (const tab of state.tabs) {
      if (ids.has(tab.id)) throw new Error(`Duplicate app tab: ${tab.id}`)
      ids.add(tab.id)
    }
    if (state.activeTarget.kind === 'app' && !ids.has(state.activeTarget.tabId)) {
      throw new Error(`Active app tab does not exist: ${state.activeTarget.tabId}`)
    }
    if (state.activeTarget.kind === 'agent' && state.agentPanelVisible) {
      throw new Error('Agent tab and Agent Panel cannot be visible together')
    }
    if (state.previousContentTabId && !ids.has(state.previousContentTabId)) {
      throw new Error(`Previous content tab does not exist: ${state.previousContentTabId}`)
    }
    if (!Number.isFinite(state.agentPanelWidthPx) || state.agentPanelWidthPx <= 0) {
      throw new Error(`Invalid Agent panel width: ${state.agentPanelWidthPx}`)
    }
  }
}
