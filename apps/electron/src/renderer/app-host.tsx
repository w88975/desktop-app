import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { AppWindow, FolderOpen, LoaderCircle, RefreshCw, RotateCw, Wrench } from 'lucide-react'
import type { InstalledAppSummary } from '../shared/app-platform'
import './app-host.css'

function AppIcon({ app }: { app: InstalledAppSummary }) {
  if (app.iconUrl) return <img src={app.iconUrl} alt="" />
  if (app.status === 'loading' || app.status === 'discovered') {
    return <LoaderCircle className="home-app-spinner" size={22} />
  }
  return <AppWindow size={22} strokeWidth={1.5} />
}

const SOURCE_LABELS = {
  builtin: '内置',
  local: '本地',
  remote: '远程',
} as const

function HomeLauncher() {
  const [apps, setApps] = useState<InstalledAppSummary[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void window.appHostAPI.listInstalledApps().then(setApps).finally(() => setLoading(false))
    return window.appHostAPI.onInstalledAppsChanged(nextApps => {
      setApps(nextApps)
      setLoading(false)
    })
  }, [])

  return (
    <main className="home-launcher">
      <header className="home-header">
        <div>
          <h1>Apps</h1>
          <p>内置、本地与远程应用</p>
        </div>
        <div className="home-actions">
          <button onClick={() => void window.appHostAPI.openAppsDirectory()}>
            <FolderOpen size={15} />打开 Apps 目录
          </button>
          <button onClick={() => void window.appHostAPI.rescanExternalApps()}>
            <RefreshCw size={15} />重新扫描
          </button>
        </div>
      </header>

      {loading ? (
        <div className="home-empty"><LoaderCircle className="home-app-spinner" size={28} /><span>正在扫描 Apps...</span></div>
      ) : apps.length === 0 ? (
        <div className="home-empty">
          <AppWindow size={36} strokeWidth={1.3} />
          <h2>暂无 Apps</h2>
          <p>打开 Apps 目录，复制 Local App目录或创建 Remote App source.json。</p>
          <button onClick={() => void window.appHostAPI.openAppsDirectory()}><FolderOpen size={15} />打开 Apps 目录</button>
        </div>
      ) : (
        <section className="home-app-grid" aria-label="已安装 Apps">
          {apps.map(app => (
            <article
              key={app.appId}
              className={`home-app-card status-${app.status}`}
              tabIndex={0}
              role="button"
              onClick={() => void window.appHostAPI.openInstalledApp(app.appId)}
              onKeyDown={event => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                void window.appHostAPI.openInstalledApp(app.appId)
              }}
            >
              <div className="home-app-icon"><AppIcon app={app} /></div>
              <div className="home-app-copy">
                <div className="home-app-title-row">
                  <h2>{app.title}</h2>
                  <div className="home-app-badges">
                    {app.sourceType && <span className="home-app-source">{SOURCE_LABELS[app.sourceType]}</span>}
                    {app.webTools.length > 0 && <span className="home-tool-count"><Wrench size={11} />{app.webTools.length}</span>}
                  </div>
                </div>
                <p>{app.description || app.appId}</p>
                {app.status === 'error' && (
                  <button
                    className="home-retry"
                    onClick={event => {
                      event.stopPropagation()
                      void window.appHostAPI.retryExternalApp(app.appId)
                    }}
                  >
                    <RotateCw size={12} />重试
                  </button>
                )}
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <HomeLauncher />
)
