import React, { useEffect, useMemo, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { Bot, ChevronLeft, ChevronRight, Home, Keyboard, ListTodo, Settings, X } from 'lucide-react'
import { AGENT_PANEL_DEFAULT_RATIO, type ShellState, type WebviewSurfaceBootstrap } from '../shared/app-platform'
import { CraftAgentsSymbol } from './components/icons/CraftAgentsSymbol'
import { SquarePenRounded } from './components/icons/SquarePenRounded'
import { TopBarButton } from './components/ui/TopBarButton'
import { useResizeGradient } from './hooks/useResizeGradient'
import {
  PANEL_EDGE_INSET,
  PANEL_GAP,
  PANEL_SASH_HALF_HIT_WIDTH,
  PANEL_SASH_HIT_WIDTH,
  PANEL_SASH_LINE_WIDTH,
  PANEL_STACK_VERTICAL_OVERFLOW,
  RADIUS_EDGE,
  RADIUS_INNER,
} from './components/app-shell/panel-constants'
import './index.css'
import './shell.css'

const EMPTY_STATE: ShellState = {
  activeTabId: null,
  tabs: [],
  agent: { visible: false, lastMode: 'panel', panelWidthPx: 360 },
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
}

function SurfaceWebview({ src, preload, className, ariaLabel }: SurfaceWebviewProps) {
  return React.createElement('webview', {
    src,
    preload,
    className,
    'aria-label': ariaLabel,
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
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
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
        <div className="app-logo-menu popover-styled" role="menu">
          <button role="menuitem" onClick={() => run(() => { void window.shellAPI.openApp('todo-placeholder') })}>
            <ListTodo className="h-3.5 w-3.5" />
            Open TODO Placeholder
          </button>
          <div className="app-logo-menu-separator" />
          <button role="menuitem" onClick={() => run(() => { void window.shellAPI.sendAgentCommand('new-session') })}>
            <SquarePenRounded className="h-3.5 w-3.5" />
            New Session
          </button>
          <button role="menuitem" onClick={() => run(() => { void window.shellAPI.sendAgentCommand('open-settings') })}>
            <Settings className="h-3.5 w-3.5" />
            Settings
          </button>
          <button role="menuitem" onClick={() => run(() => { void window.shellAPI.sendAgentCommand('open-shortcuts') })}>
            <Keyboard className="h-3.5 w-3.5" />
            Keyboard Shortcuts
          </button>
        </div>
      )}
    </div>
  )
}

function ShellResizeSash({ panelWidth }: { panelWidth: number }) {
  const { ref, handlers, gradientStyle } = useResizeGradient()
  const right = panelWidth + PANEL_EDGE_INSET + (PANEL_GAP / 2) - PANEL_SASH_HALF_HIT_WIDTH

  return (
    <div
      ref={ref}
      className="splitter no-drag"
      style={{
        right,
        width: PANEL_SASH_HIT_WIDTH,
        top: PANEL_STACK_VERTICAL_OVERFLOW,
        bottom: PANEL_EDGE_INSET + PANEL_STACK_VERTICAL_OVERFLOW,
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
    if (!state.agent.visible || state.agent.lastMode !== 'panel') return
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
  }, [state.agent.visible, state.agent.lastMode])

  const appHostSources = useMemo(() => {
    if (!bootstrap) return null
    return {
      home: withQuery(bootstrap.appHostSrc, { appId: 'home' }),
      tabs: new Map(state.tabs.map(tab => [
        tab.id,
        withQuery(bootstrap.appHostSrc, { appId: tab.appId, tabId: tab.id }),
      ])),
    }
  }, [bootstrap, state.tabs])

  const panelVisible = state.agent.visible && state.agent.lastMode === 'panel'
  const fullVisible = state.agent.visible && state.agent.lastMode === 'full'
  const fullSized = state.agent.lastMode === 'full'

  return (
    <main
      className="shell-root"
      data-agent-visible={state.agent.visible || undefined}
      data-agent-mode={state.agent.lastMode}
      style={{
        '--agent-panel-width': `${state.agent.panelWidthPx}px`,
        '--panel-gap': `${PANEL_GAP}px`,
        '--panel-edge-inset': `${PANEL_EDGE_INSET}px`,
        '--panel-shadow-inset': `${PANEL_STACK_VERTICAL_OVERFLOW}px`,
        '--radius-edge': `${RADIUS_EDGE}px`,
        '--radius-inner': `${RADIUS_INNER}px`,
      } as React.CSSProperties}
    >
      <header className="titlebar">
        <div className="no-drag"><AppLogoMenu /></div>
        <TopBarButton aria-label="Back"><ChevronLeft className="h-[18px] w-[18px]" strokeWidth={1.5} /></TopBarButton>
        <TopBarButton aria-label="Forward"><ChevronRight className="h-[18px] w-[18px]" strokeWidth={1.5} /></TopBarButton>
        <button
          className={`home-tab no-drag ${!fullVisible && state.activeTabId === null ? 'active' : ''}`}
          onClick={() => void window.shellAPI.activateHome()}
        >
          <Home size={15} /><span>Home</span>
        </button>
        <nav className="tabs no-drag">
          {state.tabs.map(tab => (
            <button
              key={tab.id}
              className={`app-tab ${!fullVisible && state.activeTabId === tab.id ? 'active' : ''}`}
              onClick={() => void window.shellAPI.activateTab(tab.id)}
            >
              <span>{tab.title}</span>
              <span
                className="tab-close"
                role="button"
                aria-label={`Close ${tab.title}`}
                onClick={(event) => { event.stopPropagation(); void window.shellAPI.closeTab(tab.id) }}
              ><X size={13} /></span>
            </button>
          ))}
        </nav>
        <button
          className={`agent-button no-drag ${state.agent.visible ? 'active' : ''}`}
          aria-pressed={state.agent.visible}
          onClick={() => void window.shellAPI.toggleAgent()}
        >
          <Bot size={16} /><span>Agent</span>
        </button>
      </header>

      <section className="surface-layout">
        <div className={`app-region ${panelVisible ? 'with-agent-panel' : ''}`}>
          {bootstrap && appHostSources && (
            <>
              <SurfaceWebview
                src={appHostSources.home}
                preload={bootstrap.appHostPreload}
                ariaLabel="Home"
                className={`surface-webview app-surface ${state.activeTabId === null ? 'surface-active' : ''}`}
              />
              {state.tabs.map(tab => (
                <SurfaceWebview
                  key={tab.id}
                  src={appHostSources.tabs.get(tab.id)!}
                  preload={bootstrap.appHostPreload}
                  ariaLabel={tab.title}
                  className={`surface-webview app-surface ${state.activeTabId === tab.id ? 'surface-active' : ''}`}
                />
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
          <ShellResizeSash panelWidth={state.agent.panelWidthPx} />
        )}
      </section>
    </main>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(<Shell />)
