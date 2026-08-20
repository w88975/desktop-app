import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { isValidSettingsSubpage, type SettingsSubpage } from '../../../shared/settings-registry'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import SettingsNavigator from './SettingsNavigator'
import { getSettingsPage } from './settings-registry'

function readSubpage(): SettingsSubpage {
  const hash = window.location.hash.slice(1)
  return isValidSettingsSubpage(hash) && getSettingsPage(hash) ? hash : 'app'
}

export default function SettingsApp() {
  const { t } = useTranslation()
  const [subpage, setSubpage] = React.useState<SettingsSubpage>(readSubpage)
  const page = getSettingsPage(subpage) ?? getSettingsPage('app')!
  const Page = page.component

  const selectSubpage = React.useCallback((next: SettingsSubpage) => {
    if (!getSettingsPage(next)) next = 'app'
    window.location.hash = next
    setSubpage(next)
    void window.settingsAppAPI.setActiveSubpage(next)
  }, [])

  React.useEffect(() => {
    if (window.location.hash !== `#${subpage}`) window.history.replaceState(null, '', `#${subpage}`)
    void window.settingsAppAPI.setActiveSubpage(subpage)
    const onHashChange = () => setSubpage(readSubpage())
    const offNavigate = window.settingsAppAPI.onNavigate(next => {
      selectSubpage(isValidSettingsSubpage(next) ? next : 'app')
    })
    window.addEventListener('hashchange', onHashChange)
    return () => {
      offNavigate()
      window.removeEventListener('hashchange', onHashChange)
    }
  }, [selectSubpage, subpage])

  return (
    <main className="settings-app-root">
      <aside className="settings-app-sidebar">
        <PanelHeader title={t('sidebar.settings')} />
        <div className="min-h-0 flex-1">
          <SettingsNavigator selectedSubpage={subpage} onSelectSubpage={selectSubpage} />
        </div>
      </aside>
      <section className="settings-app-content">
        <React.Suspense fallback={<div className="settings-app-loading">正在加载设置…</div>}>
          <Page />
        </React.Suspense>
      </section>
    </main>
  )
}
