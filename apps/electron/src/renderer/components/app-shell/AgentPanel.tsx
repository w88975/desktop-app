import { useMemo } from 'react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { focusedSessionIdAtom } from '@/atoms/panel-stack'
import { useSession } from '@/hooks/useSession'
import { routes } from '@/lib/navigate'
import { parseRouteToNavigationState } from '../../../shared/route-parser'
import { AppShellProvider, useAppShellContext } from '@/context/AppShellContext'
import { useAgentPresentation } from '@/context/AgentPresentationContext'
import { PanelHeaderCenterButton } from '@/components/ui/PanelHeaderCenterButton'
import { MainContentPanel } from './MainContentPanel'

/**
 * Docked Agent presentation.
 *
 * Owns no sidebar, navigator, or multi-panel layout. It renders only current
 * conversation while reusing app-level stores/context, so session, messages,
 * drafts, permissions, and transport state stay synchronized with Full Agent.
 */
export function AgentPanel() {
  const { t } = useTranslation()
  const context = useAppShellContext()
  const { closePanel } = useAgentPresentation()
  const focusedSessionId = useAtomValue(focusedSessionIdAtom)
  const [session] = useSession()
  const currentSessionId = focusedSessionId ?? session.selected

  const navState = useMemo(() => parseRouteToNavigationState(
    routes.view.allSessions(currentSessionId ?? undefined)
  ), [currentSessionId])

  const closeButton = useMemo(() => (
    <PanelHeaderCenterButton
      icon={<X className="h-4 w-4" />}
      onClick={() => { void closePanel() }}
      tooltip={t('common.close')}
    />
  ), [closePanel, t])

  const panelContext = useMemo(() => ({
    ...context,
    rightSidebarButton: closeButton,
    leadingAction: undefined,
    isFocusedPanel: true,
  }), [context, closeButton])

  return (
    <div
      data-agent-presentation="panel"
      data-agent-component="panel"
      className="h-full w-full overflow-hidden bg-background"
    >
      <AppShellProvider value={panelContext}>
        <MainContentPanel
          navStateOverride={navState}
          isSidebarAndNavigatorHidden
        />
      </AppShellProvider>
    </div>
  )
}
