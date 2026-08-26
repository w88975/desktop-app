import React, { useEffect, useMemo, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { AppWindow, Bot, ChevronLeft, ChevronRight, Globe2, Home, Keyboard, LoaderCircle, LogOut, RotateCw, Settings, X } from 'lucide-react'
import {
  AGENT_PANEL_DEFAULT_RATIO,
  getActiveContentTabId,
  type ShellState,
  type WebviewSurfaceBootstrap,
} from '../shared/app-platform'
import { CraftAgentsSymbol } from './components/icons/CraftAgentsSymbol'
import { SquarePenRounded } from './components/icons/SquarePenRounded'
import { TopBarButton } from './components/ui/TopBarButton'
import {
  ContextMenu,
  ContextMenuTrigger,
  StyledContextMenuContent,
  StyledContextMenuItem,
} from './components/ui/styled-context-menu'
import { ThemeProvider } from './context/ThemeContext'
import { AgentRendererRoot } from './agent-renderer-root'
import { setupI18n } from '@craft-agent/shared/i18n'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { useResizeGradient } from './hooks/useResizeGradient'
import {
  PANEL_EDGE_INSET,
  PANEL_SASH_HALF_HIT_WIDTH,
  PANEL_SASH_HIT_WIDTH,
  PANEL_SASH_LINE_WIDTH,
  PANEL_STACK_VERTICAL_OVERFLOW,
  RADIUS_EDGE,
  RADIUS_INNER,
} from './components/app-shell/panel-constants'
import './index.css'
import './shell.css'

setupI18n([LanguageDetector, initReactI18next])

const APP_REGION_INSET = 8
const DISMISS_SHELL_OVERLAYS_EVENT = 'shell-dismiss-overlays'
const SHELL_RESIZING_DATA_KEY = 'resizing'

interface TabPointerDragRuntime {
  pointerId: number
  startX: number
  sourceIndex: number
  targetIndex: number
  order: string[]
  rects: DOMRect[]
  moved: boolean
}

interface TabPointerDragVisual {
  tabId: string
  sourceIndex: number
  targetIndex: number
  offsetX: number
  dragWidth: number
}

function stopShellResize(): void {
  delete document.documentElement.dataset[SHELL_RESIZING_DATA_KEY]
}

const EMPTY_STATE: ShellState = {
  activeTarget: { kind: 'home' },
  tabs: [],
  agentPanelVisible: false,
  previousContentTabId: null,
  agentPanelWidthPx: 360,
}

function withQuery(base: string, params: Record<string, string>): string {
  const url = new URL(base)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return url.toString()
}

interface SurfaceWebviewProps {
  src: string
  preload?: string
  className: string
  ariaLabel: string
  partition?: string
}

function SurfaceWebview({ src, preload, className, ariaLabel, partition }: SurfaceWebviewProps) {
  const ref = useRef<Electron.WebviewTag | null>(null)

  useEffect(() => {
    const webview = ref.current
    if (!webview) return
    const dismissShellOverlays = () => window.dispatchEvent(new Event(DISMISS_SHELL_OVERLAYS_EVENT))
    webview.addEventListener('focus', dismissShellOverlays)
    return () => webview.removeEventListener('focus', dismissShellOverlays)
  }, [])

  return React.createElement('webview', {
    ref,
    src,
    ...(preload ? { preload } : {}),
    className,
    'aria-label': ariaLabel,
    ...(partition ? { partition } : {}),
  })
}

function normalizeBrowserInput(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return 'about:blank'
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed
  if (/^(localhost|\d{1,3}(?:\.\d{1,3}){3}|[\w-]+(?:\.[\w-]+)+)(?::\d+)?(?:\/|$)/i.test(trimmed)) {
    return `https://${trimmed}`
  }
  return `https://duckduckgo.com/?q=${encodeURIComponent(trimmed)}`
}

function BrowserTabSurface({ tab, active }: { tab: ShellState['tabs'][number]; active: boolean }) {
  const ref = useRef<Electron.WebviewTag | null>(null)
  const [address, setAddress] = useState(tab.browserState?.url ?? tab.entry)

  useEffect(() => {
    if (tab.browserState?.url) setAddress(tab.browserState.url)
  }, [tab.browserState?.url])

  const navigate = () => {
    const target = normalizeBrowserInput(address)
    setAddress(target)
    void ref.current?.loadURL(target)
  }

  const viewportStyle = tab.browserState?.viewportWidth && tab.browserState?.viewportHeight
    ? { width: `${tab.browserState.viewportWidth}px`, height: `${tab.browserState.viewportHeight}px` }
    : undefined

  return (
    <div className={`surface-webview browser-app-surface app-surface ${active ? 'surface-active' : ''}`} style={viewportStyle}>
      <div className="browser-app-toolbar no-drag">
        <button disabled={!tab.browserState?.canGoBack} onClick={() => ref.current?.goBack()} aria-label="后退"><ChevronLeft size={16} /></button>
        <button disabled={!tab.browserState?.canGoForward} onClick={() => ref.current?.goForward()} aria-label="前进"><ChevronRight size={16} /></button>
        <button onClick={() => tab.browserState?.isLoading ? ref.current?.stop() : ref.current?.reload()} aria-label={tab.browserState?.isLoading ? '停止' : '刷新'}>
          {tab.browserState?.isLoading ? <X size={15} /> : <RotateCw size={15} />}
        </button>
        <form onSubmit={(event) => { event.preventDefault(); navigate() }}>
          <Globe2 size={14} />
          <input value={address} onChange={event => setAddress(event.target.value)} aria-label="地址" spellCheck={false} />
        </form>
      </div>
      {React.createElement('webview', {
        ref,
        src: tab.entry,
        partition: tab.partition,
        allowpopups: 'true',
        className: 'browser-app-webview',
        'aria-label': tab.title,
      })}
      {tab.browserState?.agentControlLabel && (
        <div className="browser-agent-overlay">
          <span>{tab.browserState.agentControlLabel}</span>
        </div>
      )}
    </div>
  )
}

function BrowserTabIcon({ favicon }: { favicon?: string | null }) {
  const [failed, setFailed] = useState(false)

  useEffect(() => setFailed(false), [favicon])

  if (!favicon || failed) {
    return <Globe2 className="app-tab-icon-placeholder" size={14} />
  }

  return (
    <img
      className="app-tab-icon"
      src={favicon}
      alt=""
      onError={() => setFailed(true)}
    />
  )
}

function AppLogoMenu() {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const dismissShellOverlays = () => setOpen(false)
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('blur', dismissShellOverlays)
    window.addEventListener(DISMISS_SHELL_OVERLAYS_EVENT, dismissShellOverlays)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('blur', dismissShellOverlays)
      window.removeEventListener(DISMISS_SHELL_OVERLAYS_EVENT, dismissShellOverlays)
    }
  }, [open])

  const run = (action: () => void) => {
    setOpen(false)
    action()
  }

  return (
    <div ref={rootRef} className="logo-menu-anchor">
      <TopBarButton aria-label="App menu" aria-expanded={open} isActive={open} onClick={() => setOpen(value => !value)}>
        <CraftAgentsSymbol className="h-4 text-accent" />
      </TopBarButton>
      {open && (
        <>
          <div
            className="app-logo-menu-dismiss-layer"
            aria-hidden="true"
            onPointerDown={() => setOpen(false)}
          />
          <div className="app-logo-menu popover-styled" role="menu">
            <button role="menuitem" onClick={() => run(() => { void window.shellAPI.sendAgentCommand('new-session') })}>
              <SquarePenRounded className="h-3.5 w-3.5" />
              New Session
            </button>
            <button role="menuitem" onClick={() => run(() => { void window.shellAPI.openSettings() })}>
              <Settings className="h-3.5 w-3.5" />
              Settings
            </button>
            <button role="menuitem" onClick={() => run(() => { void window.shellAPI.openSettings('shortcuts') })}>
              <Keyboard className="h-3.5 w-3.5" />
              Keyboard Shortcuts
            </button>
            <div className="app-logo-menu-separator" />
            <button role="menuitem" onClick={() => run(() => { void window.authAPI.logout() })}>
              <LogOut className="h-3.5 w-3.5" />
              退出登录
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function ShellResizeSash({ panelWidth }: { panelWidth: number }) {
  const { ref, handlers, gradientStyle } = useResizeGradient()
  const right = panelWidth + PANEL_EDGE_INSET + (APP_REGION_INSET / 2) - PANEL_SASH_HALF_HIT_WIDTH

  return (
    <div
      ref={ref}
      className="splitter no-drag"
      style={{
        right,
        width: PANEL_SASH_HIT_WIDTH,
        // Match App and Agent vertical insets so the visible seam starts and ends
        // on the same horizontal edges as both surfaces.
        top: APP_REGION_INSET,
        bottom: APP_REGION_INSET + PANEL_STACK_VERTICAL_OVERFLOW,
      }}
      onMouseMove={handlers.onMouseMove}
      onMouseLeave={handlers.onMouseLeave}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.preventDefault()
        handlers.onMouseDown()
        document.documentElement.dataset[SHELL_RESIZING_DATA_KEY] = 'true'
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerUp={stopShellResize}
      onPointerCancel={stopShellResize}
      onLostPointerCapture={stopShellResize}
      onDoubleClick={() => {
        void window.shellAPI.setPanelWidth(window.innerWidth * AGENT_PANEL_DEFAULT_RATIO)
      }}
    >
      <div
        className="splitter-line"
        style={{ ...gradientStyle, width: PANEL_SASH_LINE_WIDTH }}
      />
    </div>
  )
}

function Shell() {
  const [state, setState] = useState<ShellState>(EMPTY_STATE)
  const [bootstrap, setBootstrap] = useState<WebviewSurfaceBootstrap | null>(null)
  const tabsRef = useRef<HTMLDivElement | null>(null)
  const surfaceOrderRef = useRef<string[]>([])
  const contextMenuContentRef = useRef<HTMLDivElement | null>(null)
  const tabDragRuntimeRef = useRef<TabPointerDragRuntime | null>(null)
  const suppressTabClickRef = useRef(false)
  const [tabDrag, setTabDrag] = useState<TabPointerDragVisual | null>(null)
  const [optimisticTabOrder, setOptimisticTabOrder] = useState<string[] | null>(null)
  const [contextMenuOpenTabId, setContextMenuOpenTabId] = useState<string | null>(null)

  const closeTabContextMenu = () => {
    contextMenuContentRef.current?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    )
    setContextMenuOpenTabId(null)
  }
  const previousPanelVisibleRef = useRef(false)
  const previousFullVisibleRef = useRef(false)

  useEffect(() => {
    void Promise.all([
      window.shellAPI.getState(),
      window.shellAPI.getWebviewBootstrap(),
    ]).then(([nextState, nextBootstrap]) => {
      setState(nextState)
      setBootstrap(nextBootstrap)
    })
    return window.shellAPI.onStateChanged(setState)
  }, [])

  useEffect(() => {
    if (!state.agentPanelVisible) return
    const onPointerMove = (event: PointerEvent) => {
      if (document.documentElement.dataset[SHELL_RESIZING_DATA_KEY] !== 'true') return
      // Chromium can lose pointer capture at a <webview> process boundary. If
      // button state says primary button is already up, terminate stale drag.
      if ((event.buttons & 1) === 0) {
        stopShellResize()
        return
      }
      void window.shellAPI.setPanelWidth(window.innerWidth - event.clientX)
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') stopShellResize()
    }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', stopShellResize)
    window.addEventListener('pointercancel', stopShellResize)
    window.addEventListener('mouseup', stopShellResize)
    window.addEventListener('blur', stopShellResize)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', stopShellResize)
      window.removeEventListener('pointercancel', stopShellResize)
      window.removeEventListener('mouseup', stopShellResize)
      window.removeEventListener('blur', stopShellResize)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      stopShellResize()
    }
  }, [state.agentPanelVisible])

  const appHostSources = useMemo(() => {
    if (!bootstrap) return null
    return {
      home: withQuery(bootstrap.appHostSrc, { appId: 'home' }),
      tabs: new Map(state.tabs.filter(tab => tab.kind === 'built-in').map(tab => [
        tab.id,
        withQuery(bootstrap.appHostSrc, { appId: tab.appId, tabId: tab.id }),
      ])),
    }
  }, [bootstrap, state.tabs])

  const surfaceTabs = useMemo(() => {
    const byId = new Map(state.tabs.map(tab => [tab.id, tab]))
    surfaceOrderRef.current = surfaceOrderRef.current.filter(tabId => byId.has(tabId))
    for (const tab of state.tabs) {
      if (!surfaceOrderRef.current.includes(tab.id)) surfaceOrderRef.current.push(tab.id)
    }
    return surfaceOrderRef.current.map(tabId => byId.get(tabId)!).filter(Boolean)
  }, [state.tabs])

  const displayedTabs = useMemo(() => {
    if (!optimisticTabOrder) return state.tabs
    const byId = new Map(state.tabs.map(tab => [tab.id, tab]))
    if (optimisticTabOrder.length !== state.tabs.length || optimisticTabOrder.some(tabId => !byId.has(tabId))) {
      return state.tabs
    }
    return optimisticTabOrder.map(tabId => byId.get(tabId)!)
  }, [optimisticTabOrder, state.tabs])

  const panelVisible = state.agentPanelVisible
  const fullVisible = state.activeTarget.kind === 'agent'
  const activeContentTabId = getActiveContentTabId(state)
  const animatePanelTransition = !fullVisible
    && !previousFullVisibleRef.current
    && panelVisible !== previousPanelVisibleRef.current
  const agentButtonLabel = fullVisible
    ? 'Exit Agent full view'
    : panelVisible ? 'Close Agent panel' : 'Open Agent panel'

  useEffect(() => {
    if (panelVisible) return
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  }, [panelVisible])

  const handleTabListKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'))
    const index = tabs.indexOf(document.activeElement as HTMLElement)
    if (index < 0) return
    event.preventDefault()
    const offset = event.key === 'ArrowRight' ? 1 : -1
    tabs[(index + offset + tabs.length) % tabs.length]?.focus()
  }

  useEffect(() => {
    previousPanelVisibleRef.current = panelVisible
    previousFullVisibleRef.current = fullVisible
  }, [fullVisible, panelVisible])

  useEffect(() => {
    if (state.activeTarget.kind !== 'app') return
    const activeTabId = state.activeTarget.tabId
    const frame = requestAnimationFrame(() => {
      const target = Array.from(tabsRef.current?.querySelectorAll<HTMLElement>('[data-tab-id]') ?? [])
        .find(element => element.dataset.tabId === activeTabId)
      target?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    })
    return () => cancelAnimationFrame(frame)
  }, [state.activeTarget, state.tabs.length])

  useEffect(() => {
    if (!optimisticTabOrder) return
    const stateOrder = state.tabs.map(tab => tab.id)
    if (stateOrder.length !== optimisticTabOrder.length) {
      setOptimisticTabOrder(null)
      return
    }
    if (stateOrder.every((tabId, index) => tabId === optimisticTabOrder[index])) {
      setOptimisticTabOrder(null)
    }
  }, [optimisticTabOrder, state.tabs])

  const getTabDragTransform = (tabId: string, index: number): React.CSSProperties | undefined => {
    if (!tabDrag) return undefined
    if (tabId === tabDrag.tabId) {
      return { transform: `translate3d(${tabDrag.offsetX}px, 0, 0)` }
    }
    const shift = tabDrag.dragWidth + 2
    if (tabDrag.targetIndex > tabDrag.sourceIndex && index > tabDrag.sourceIndex && index <= tabDrag.targetIndex) {
      return { transform: `translate3d(${-shift}px, 0, 0)` }
    }
    if (tabDrag.targetIndex < tabDrag.sourceIndex && index >= tabDrag.targetIndex && index < tabDrag.sourceIndex) {
      return { transform: `translate3d(${shift}px, 0, 0)` }
    }
    return undefined
  }

  return (
    <ThemeProvider activeWorkspaceId={state.workspaceId ?? null}>
      <main
        className="shell-root"
        data-agent-visible={(panelVisible || fullVisible) || undefined}
        data-agent-mode={fullVisible ? 'full' : panelVisible ? 'panel' : 'hidden'}
        data-tab-context-menu-open={contextMenuOpenTabId ? 'true' : undefined}
        style={{
          '--agent-panel-width': `${state.agentPanelWidthPx}px`,
          '--panel-edge-inset': `${PANEL_EDGE_INSET}px`,
          '--app-region-inset': `${APP_REGION_INSET}px`,
          '--radius-edge': `${RADIUS_EDGE}px`,
          '--radius-inner': `${RADIUS_INNER}px`,
        } as React.CSSProperties}
      >
      <header className="titlebar">
        <div className="no-drag"><AppLogoMenu /></div>
        <TopBarButton aria-label="Back"><ChevronLeft className="h-[18px] w-[18px]" strokeWidth={1.5} /></TopBarButton>
        <TopBarButton aria-label="Forward"><ChevronRight className="h-[18px] w-[18px]" strokeWidth={1.5} /></TopBarButton>
        <nav className="tab-strip" role="tablist" aria-label="Application tabs" onKeyDown={handleTabListKeyDown}>
          <button
            role="tab"
            aria-selected={state.activeTarget.kind === 'home'}
            tabIndex={state.activeTarget.kind === 'home' ? 0 : -1}
            className={`home-tab ${state.activeTarget.kind === 'home' ? 'active' : ''}`}
            onClick={() => void window.shellAPI.activateHome()}
          >
            <Home size={15} /><span>Home</span>
          </button>
          <button
            role="tab"
            aria-selected={fullVisible}
            tabIndex={fullVisible ? 0 : -1}
            className={`agent-tab ${fullVisible ? 'active' : ''}`}
            onClick={() => void window.shellAPI.focusAgentTab()}
          >
            <Bot size={15} /><span>Agent</span>
          </button>
          {state.tabs.length > 0 && <span className="tab-group-divider" aria-hidden="true" />}
          <div
            ref={tabsRef}
            className="tabs"
            role="presentation"
            onWheel={(event) => {
              if (!tabsRef.current || tabsRef.current.scrollWidth <= tabsRef.current.clientWidth) return
              if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
              tabsRef.current.scrollLeft += event.deltaY
              event.preventDefault()
            }}
          >
            {displayedTabs.map((tab, index) => {
              const tabIndex = state.tabs.findIndex(candidate => candidate.id === tab.id)
              return (
                <ContextMenu
                  key={tab.id}
                  onOpenChange={open => setContextMenuOpenTabId(open ? tab.id : null)}
                >
                  <ContextMenuTrigger asChild>
                    <button
                      data-tab-id={tab.id}
                      role="tab"
                      aria-selected={state.activeTarget.kind === 'app' && state.activeTarget.tabId === tab.id}
                      tabIndex={state.activeTarget.kind === 'app' && state.activeTarget.tabId === tab.id ? 0 : -1}
                      className={`app-tab ${state.activeTarget.kind === 'app' && state.activeTarget.tabId === tab.id ? 'active' : ''} ${tabDrag?.tabId === tab.id ? 'dragging' : ''}`}
                      style={getTabDragTransform(tab.id, index)}
                      onClick={(event) => {
                        if (suppressTabClickRef.current) {
                          event.preventDefault()
                          return
                        }
                        void window.shellAPI.activateTab(tab.id)
                      }}
                      onPointerDown={(event) => {
                        if (event.button !== 0 || (event.target as HTMLElement).closest('.tab-close')) return
                        const elements = Array.from(tabsRef.current?.querySelectorAll<HTMLElement>('[data-tab-id]') ?? [])
                        const sourceIndex = elements.findIndex(element => element.dataset.tabId === tab.id)
                        if (sourceIndex < 0) return
                        event.currentTarget.setPointerCapture(event.pointerId)
                        tabDragRuntimeRef.current = {
                          pointerId: event.pointerId,
                          startX: event.clientX,
                          sourceIndex,
                          targetIndex: sourceIndex,
                          order: displayedTabs.map(candidate => candidate.id),
                          rects: elements.map(element => element.getBoundingClientRect()),
                          moved: false,
                        }
                        closeTabContextMenu()
                        setTabDrag({
                          tabId: tab.id,
                          sourceIndex,
                          targetIndex: sourceIndex,
                          offsetX: 0,
                          dragWidth: elements[sourceIndex]!.getBoundingClientRect().width,
                        })
                      }}
                      onPointerMove={(event) => {
                        const runtime = tabDragRuntimeRef.current
                        if (!runtime || runtime.pointerId !== event.pointerId) return
                        const offsetX = event.clientX - runtime.startX
                        if (Math.abs(offsetX) > 3) runtime.moved = true
                        const draggedRect = runtime.rects[runtime.sourceIndex]!
                        const draggedCenter = draggedRect.left + draggedRect.width / 2 + offsetX
                        let targetIndex = runtime.sourceIndex
                        if (offsetX > 0) {
                          for (let candidate = runtime.sourceIndex + 1; candidate < runtime.rects.length; candidate += 1) {
                            const rect = runtime.rects[candidate]!
                            if (draggedCenter >= rect.left + rect.width / 2) targetIndex = candidate
                          }
                        } else if (offsetX < 0) {
                          for (let candidate = runtime.sourceIndex - 1; candidate >= 0; candidate -= 1) {
                            const rect = runtime.rects[candidate]!
                            if (draggedCenter <= rect.left + rect.width / 2) targetIndex = candidate
                          }
                        }
                        runtime.targetIndex = targetIndex
                        setTabDrag(current => current ? { ...current, offsetX, targetIndex } : current)
                        const strip = tabsRef.current
                        if (strip) {
                          const stripRect = strip.getBoundingClientRect()
                          if (event.clientX < stripRect.left + 24) strip.scrollLeft -= 12
                          else if (event.clientX > stripRect.right - 24) strip.scrollLeft += 12
                        }
                      }}
                      onPointerUp={(event) => {
                        const runtime = tabDragRuntimeRef.current
                        if (!runtime || runtime.pointerId !== event.pointerId) return
                        if (runtime.moved) {
                          suppressTabClickRef.current = true
                          const nextOrder = [...runtime.order]
                          const [movedTabId] = nextOrder.splice(runtime.sourceIndex, 1)
                          nextOrder.splice(runtime.targetIndex, 0, movedTabId!)
                          setOptimisticTabOrder(nextOrder)
                          void window.shellAPI.setTabOrder(nextOrder).catch(() => setOptimisticTabOrder(null))
                          setTimeout(() => { suppressTabClickRef.current = false }, 0)
                        }
                        tabDragRuntimeRef.current = null
                        setTabDrag(null)
                        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                          event.currentTarget.releasePointerCapture(event.pointerId)
                        }
                      }}
                      onPointerCancel={() => {
                        tabDragRuntimeRef.current = null
                        setTabDrag(null)
                      }}
                    >
                      {tab.kind === 'browser' ? (
                        <BrowserTabIcon favicon={tab.browserState?.favicon} />
                      ) : tab.iconUrl ? (
                        <img className="app-tab-icon" src={tab.iconUrl} alt="" />
                      ) : tab.kind === 'internal' ? (
                        <Settings className="app-tab-icon-placeholder" size={14} />
                      ) : tab.kind === 'external' ? (
                        <AppWindow className="app-tab-icon-placeholder" size={14} />
                      ) : null}
                      <span className="app-tab-title">{tab.title}</span>
                      <span
                        className="tab-close"
                        role="button"
                        tabIndex={0}
                        aria-label={`Close ${tab.title}`}
                        onClick={(event) => { event.stopPropagation(); void window.shellAPI.closeTab(tab.id) }}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter' && event.key !== ' ') return
                          event.preventDefault()
                          event.stopPropagation()
                          void window.shellAPI.closeTab(tab.id)
                        }}
                      ><X size={13} /></span>
                    </button>
                  </ContextMenuTrigger>
                  <StyledContextMenuContent
                    ref={contextMenuContentRef}
                    minWidth="min-w-40"
                    style={{ zIndex: 'var(--z-floating-menu, 400)' }}
                  >
                    <StyledContextMenuItem onSelect={() => void window.shellAPI.closeTab(tab.id)}>关闭</StyledContextMenuItem>
                    <StyledContextMenuItem
                      disabled={tabIndex < 0 || tabIndex === state.tabs.length - 1}
                      onSelect={() => void window.shellAPI.closeTabsRight(tab.id)}
                    >关闭右侧</StyledContextMenuItem>
                    <StyledContextMenuItem
                      disabled={state.tabs.length <= 1}
                      onSelect={() => void window.shellAPI.closeOtherTabs(tab.id)}
                    >关闭其他</StyledContextMenuItem>
                  </StyledContextMenuContent>
                </ContextMenu>
              )
            })}
          </div>
        </nav>
        <TopBarButton
          className={`agent-button no-drag ${panelVisible ? 'active' : ''}`}
          aria-label={agentButtonLabel}
          title={agentButtonLabel}
          aria-pressed={panelVisible}
          onClick={() => void window.shellAPI.toggleAgentPanel()}
        >
          <Bot size={16} />
        </TopBarButton>
      </header>

      {contextMenuOpenTabId && (
        <div
          className="tab-context-surface-dismiss-layer"
          aria-hidden="true"
          onPointerDown={closeTabContextMenu}
          onContextMenu={event => {
            event.preventDefault()
            closeTabContextMenu()
          }}
        />
      )}

      <section className="surface-layout">
        <div className={`app-region ${panelVisible ? 'with-agent-panel' : ''} ${animatePanelTransition ? 'panel-transition' : ''}`}>
          {bootstrap && appHostSources && (
            <>
              <SurfaceWebview
                src={appHostSources.home}
                preload={bootstrap.appHostPreload}
                ariaLabel="Home"
                className={`surface-webview app-surface ${activeContentTabId === null ? 'surface-active' : ''}`}
              />
              {surfaceTabs.filter(tab => tab.kind !== 'browser' && (tab.kind === 'built-in' || tab.kind === 'internal' || tab.status === 'ready')).map(tab => (
                <SurfaceWebview
                  key={tab.id}
                  src={tab.kind === 'built-in' ? appHostSources.tabs.get(tab.id)! : tab.entry}
                  preload={tab.kind === 'built-in'
                    ? bootstrap.appHostPreload
                    : tab.kind === 'internal' ? bootstrap.settingsPreload : bootstrap.externalAppPreload}
                  ariaLabel={tab.title}
                  partition={tab.partition}
                  className={`surface-webview app-surface ${activeContentTabId === tab.id ? 'surface-active' : ''}`}
                />
              ))}
              {surfaceTabs.filter(tab => tab.kind === 'browser').map(tab => (
                <BrowserTabSurface
                  key={tab.id}
                  tab={tab}
                  active={activeContentTabId === tab.id}
                />
              ))}
              {surfaceTabs.filter(tab => tab.kind === 'internal' && tab.status !== 'ready').map(tab => (
                <div
                  key={`status-${tab.id}`}
                  className={`app-status-surface ${activeContentTabId === tab.id ? 'surface-active' : ''}`}
                  aria-label={`${tab.title}正在加载`}
                >
                  <div className="settings-loading-splash">
                    <CraftAgentsSymbol className="settings-loading-symbol text-accent" />
                    <p>正在加载设置</p>
                  </div>
                </div>
              ))}
              {surfaceTabs.filter(tab => tab.kind === 'external' && tab.status !== 'ready').map(tab => (
                <div
                  key={`status-${tab.id}`}
                  className={`app-status-surface ${activeContentTabId === tab.id ? 'surface-active' : ''}`}
                  aria-label={tab.title}
                >
                  {tab.status === 'error' ? (
                    <div className="app-status-content">
                      <AppWindow size={36} strokeWidth={1.4} />
                      <h2>App 加载失败</h2>
                      <p>{tab.error || '无法加载 App，请稍后重试。'}</p>
                      <button onClick={() => void window.shellAPI.retryExternalApp(tab.appId)}>
                        <RotateCw size={14} />重试
                      </button>
                    </div>
                  ) : (
                    <div className="app-status-content">
                      <LoaderCircle className="app-status-spinner" size={30} strokeWidth={1.6} />
                      <h2>正在加载 App...</h2>
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </div>

        {bootstrap && (
          <SurfaceWebview
            src={bootstrap.agentSrc}
            preload={bootstrap.agentPreload}
            ariaLabel="Agent"
            className={`surface-webview agent-surface agent-full-sized ${fullVisible ? 'agent-full-visible' : ''}`}
          />
        )}

        <div
          className={`agent-panel-host ${panelVisible ? 'agent-panel-host-visible' : ''}`}
          aria-hidden={!panelVisible}
        >
          <AgentRendererRoot forcePresentation="panel" showToaster={false} />
        </div>

        {panelVisible && (
          <ShellResizeSash panelWidth={state.agentPanelWidthPx} />
        )}
      </section>
      </main>
    </ThemeProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(<Shell />)
