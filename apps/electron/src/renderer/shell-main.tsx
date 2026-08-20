import React, { useEffect, useMemo, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { AppWindow, Bot, ChevronLeft, ChevronRight, Home, Keyboard, LoaderCircle, LogOut, RotateCw, Settings, X } from 'lucide-react'
import {
  AGENT_PANEL_DEFAULT_RATIO,
  getActiveContentTabId,
  type ShellState,
  type WebviewSurfaceBootstrap,
} from '../shared/app-platform'
import { CraftAgentsSymbol } from './components/icons/CraftAgentsSymbol'
import { SquarePenRounded } from './components/icons/SquarePenRounded'
import { TopBarButton } from './components/ui/TopBarButton'
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

const APP_REGION_INSET = 8
const DISMISS_SHELL_OVERLAYS_EVENT = 'shell-dismiss-overlays'

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
  preload: string
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
    preload,
    className,
    'aria-label': ariaLabel,
    ...(partition ? { partition } : {}),
  })
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
        handlers.onMouseDown()
        document.documentElement.dataset.resizing = 'true'
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
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
      if (document.documentElement.dataset.resizing !== 'true') return
      void window.shellAPI.setPanelWidth(window.innerWidth - event.clientX)
    }
    const stop = () => { delete document.documentElement.dataset.resizing }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', stop)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', stop)
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

  const panelVisible = state.agentPanelVisible
  const fullVisible = state.activeTarget.kind === 'agent'
  // Hidden Agent 保持 Full bounds；再次 focus Agent tab 时不会先绘制窄版布局。
  const fullSized = !panelVisible
  const activeContentTabId = getActiveContentTabId(state)
  const animatePanelTransition = !fullVisible
    && !previousFullVisibleRef.current
    && panelVisible !== previousPanelVisibleRef.current
  const agentButtonLabel = fullVisible
    ? 'Exit Agent full view'
    : panelVisible ? 'Close Agent panel' : 'Open Agent panel'

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

  return (
    <main
      className="shell-root"
      data-agent-visible={(panelVisible || fullVisible) || undefined}
      data-agent-mode={fullVisible ? 'full' : panelVisible ? 'panel' : 'hidden'}
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
          <div className="tabs" role="presentation">
            {state.tabs.map(tab => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={state.activeTarget.kind === 'app' && state.activeTarget.tabId === tab.id}
              tabIndex={state.activeTarget.kind === 'app' && state.activeTarget.tabId === tab.id ? 0 : -1}
              className={`app-tab ${state.activeTarget.kind === 'app' && state.activeTarget.tabId === tab.id ? 'active' : ''}`}
              onClick={() => void window.shellAPI.activateTab(tab.id)}
            >
              {tab.iconUrl ? (
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
            ))}
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
              {state.tabs.filter(tab => tab.kind === 'built-in' || tab.kind === 'internal' || tab.status === 'ready').map(tab => (
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
              {state.tabs.filter(tab => tab.kind === 'internal' && tab.status !== 'ready').map(tab => (
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
              {state.tabs.filter(tab => tab.kind === 'external' && tab.status !== 'ready').map(tab => (
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
            className={`surface-webview agent-surface ${fullSized ? 'agent-full-sized' : ''} ${panelVisible ? 'agent-panel-visible' : ''} ${fullVisible ? 'agent-full-visible' : ''}`}
          />
        )}

        {panelVisible && (
          <ShellResizeSash panelWidth={state.agentPanelWidthPx} />
        )}
      </section>
    </main>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(<Shell />)
