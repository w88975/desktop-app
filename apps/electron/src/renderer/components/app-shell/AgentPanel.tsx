import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { Inbox, X } from 'lucide-react'
import { extractLabelId, getDescendantIds, sortLabelsForDisplay } from '@craft-agent/shared/labels'
import { focusedSessionIdAtom } from '@/atoms/panel-stack'
import { sessionMetaMapAtom, type SessionMeta } from '@/atoms/sessions'
import { useSession } from '@/hooks/useSession'
import { useLabels } from '@/hooks/useLabels'
import { useStatuses } from '@/hooks/useStatuses'
import { useProjects } from '@/hooks/useProjects'
import { navigate, routes } from '@/lib/navigate'
import { parseRouteToNavigationState } from '../../../shared/route-parser'
import { AppShellProvider, useAppShellContext } from '@/context/AppShellContext'
import { useAgentPresentation } from '@/context/AgentPresentationContext'
import { useTheme } from '@/context/ThemeContext'
import { statusConfigsToSessionStatuses, type SessionStatus, type SessionStatusId } from '@/config/session-status-config'
import { PanelHeaderCenterButton } from '@/components/ui/PanelHeaderCenterButton'
import { MainContentPanel } from './MainContentPanel'
import { AllSessionsPanel } from './AllSessionsPanel'
import { SessionListFilterDropdown } from './SessionListFilterDropdown'
import { PanelHeader } from './PanelHeader'
import type { ChatGroupingMode } from './SessionList'
import type { FilterMode } from './inherited-filter-params'

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
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const [session] = useSession()
  const currentSessionId = focusedSessionId ?? session.selected
  const [showAllSessions, setShowAllSessions] = useState(false)
  const [listFilter, setListFilter] = useState<Map<SessionStatusId, FilterMode>>(new Map())
  const [labelFilter, setLabelFilter] = useState<Map<string, FilterMode>>(new Map())
  const [projectFilter, setProjectFilter] = useState<Map<string, FilterMode>>(new Map())
  const [chatGroupingMode, setChatGroupingMode] = useState<ChatGroupingMode>('date')
  const [searchActive, setSearchActive] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

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

  const inboxButton = useMemo(() => (
    <PanelHeaderCenterButton
      icon={<Inbox className="h-4 w-4" />}
      onClick={() => setShowAllSessions(true)}
      tooltip={t('sidebar.allSessions')}
    />
  ), [t])

  const exitAllSessionsButton = useMemo(() => (
    <PanelHeaderCenterButton
      icon={<X className="h-4 w-4" />}
      onClick={() => setShowAllSessions(false)}
      tooltip={t('common.close')}
    />
  ), [t])

  // Workspace-scoped config for session menus (labels, dynamic statuses). App's raw
  // context omits these — FullAgentShell loads them internally, so the docked panel,
  // which never mounts FullAgentShell, must load its own copy. Without this the
  // session title menu renders with empty labels/statuses (missing 标签 row, empty
  // 状态 submenu).
  const { workspaces, activeWorkspaceId } = context
  const { labels: labelConfigs } = useLabels(activeWorkspaceId ?? null)
  const { statuses: statusConfigs } = useStatuses(activeWorkspaceId ?? null)
  const { projects } = useProjects(activeWorkspaceId)
  const { isDark } = useTheme()
  const activeWorkspace = useMemo(
    () => workspaces.find(w => w.id === activeWorkspaceId) ?? null,
    [workspaces, activeWorkspaceId],
  )

  // Convert StatusConfig to SessionStatus with resolved icons (same as FullAgentShell)
  const [sessionStatuses, setSessionStatuses] = useState<SessionStatus[]>([])
  useEffect(() => {
    if (!activeWorkspace?.id || statusConfigs.length === 0) {
      setSessionStatuses([])
      return
    }
    setSessionStatuses(statusConfigsToSessionStatuses(statusConfigs, activeWorkspace.id, isDark))
  }, [statusConfigs, activeWorkspace?.id, isDark])

  const labels = useMemo(() => sortLabelsForDisplay(labelConfigs), [labelConfigs])
  const projectOptions = useMemo(
    () => projects.map(project => ({
      id: project.config.id,
      slug: project.config.slug,
      name: project.config.name,
      color: project.config.color,
    })),
    [projects],
  )

  const allSessionMetas = useMemo(() => {
    const remoteWorkspaceId = activeWorkspace?.remoteServer?.remoteWorkspaceId
    return Array.from(sessionMetaMap.values()).filter(meta =>
      !meta.hidden
      && !meta.isArchived
      && (!activeWorkspaceId
        || meta.workspaceId === activeWorkspaceId
        || (!!remoteWorkspaceId && meta.workspaceId === remoteWorkspaceId))
    )
  }, [sessionMetaMap, activeWorkspaceId, activeWorkspace?.remoteServer?.remoteWorkspaceId])

  const filteredSessionMetas = useMemo(() => {
    let result = allSessionMetas

    const statusIncludes = new Set<SessionStatusId>()
    const statusExcludes = new Set<SessionStatusId>()
    for (const [id, mode] of listFilter) {
      if (mode === 'include') statusIncludes.add(id)
      else statusExcludes.add(id)
    }
    if (statusIncludes.size > 0) {
      result = result.filter(meta => statusIncludes.has((meta.sessionStatus || 'todo') as SessionStatusId))
    }
    if (statusExcludes.size > 0) {
      result = result.filter(meta => !statusExcludes.has((meta.sessionStatus || 'todo') as SessionStatusId))
    }

    const labelIncludes = new Set<string>()
    const labelExcludes = new Set<string>()
    for (const [id, mode] of labelFilter) {
      for (const expandedId of [id, ...getDescendantIds(labelConfigs, id)]) {
        if (mode === 'include') labelIncludes.add(expandedId)
        else labelExcludes.add(expandedId)
      }
    }
    if (labelIncludes.size > 0) {
      result = result.filter(meta => meta.labels?.some(label => labelIncludes.has(extractLabelId(label))))
    }
    if (labelExcludes.size > 0) {
      result = result.filter(meta => !meta.labels?.some(label => labelExcludes.has(extractLabelId(label))))
    }

    const projectIncludes = new Set<string>()
    const projectExcludes = new Set<string>()
    for (const [id, mode] of projectFilter) {
      if (mode === 'include') projectIncludes.add(id)
      else projectExcludes.add(id)
    }
    if (projectIncludes.size > 0) {
      result = result.filter(meta => !!meta.projectId && projectIncludes.has(meta.projectId))
    }
    if (projectExcludes.size > 0) {
      result = result.filter(meta => !meta.projectId || !projectExcludes.has(meta.projectId))
    }

    return result
  }, [allSessionMetas, listFilter, labelFilter, projectFilter, labelConfigs])

  const handleSessionLabelsChange = useCallback(async (sessionId: string, sessionLabels: string[]) => {
    try {
      await window.electronAPI.sessionCommand(sessionId, { type: 'setLabels', labels: sessionLabels })
      // Session will emit a 'labels_changed' event that updates the session state
    } catch (err) {
      console.error('[AgentPanel] Failed to set session labels:', err)
    }
  }, [])

  const panelContext = useMemo(() => ({
    ...context,
    rightSidebarButton: closeButton,
    leadingAction: inboxButton,
    centerPanelHeaderTitle: true,
    isFocusedPanel: true,
    labels,
    sessionStatuses,
    onSessionLabelsChange: handleSessionLabelsChange,
  }), [context, closeButton, inboxButton, labels, sessionStatuses, handleSessionLabelsChange])

  const handleSelectSession = useCallback((sessionId: string) => {
    const syncSelection = async () => {
      try {
        const syncAgentConversation = window.electronAPI.syncAgentConversation
        if (typeof syncAgentConversation !== 'function') throw new Error('Agent conversation sync bridge unavailable')
        await syncAgentConversation(sessionId)
      } catch (error) {
        // Renderer HMR can leave an older preload/main process alive. Fall back
        // to presentation APIs that already existed before the sync bridge:
        // focus delivers the intent to Full, dock restores visible Panel state.
        console.warn('[AgentPanel] Direct conversation sync failed; using presentation fallback', error)
        await window.electronAPI.focusAgentTab({ type: 'conversation', sessionId })
        await window.electronAPI.dockAgentAsPanel()
      }
    }

    navigate(routes.view.allSessions(sessionId))
    setShowAllSessions(false)
    void syncSelection()
  }, [])

  const handleDeleteSession = useCallback(async (sessionId: string, skipConfirmation?: boolean) => {
    return context.onDeleteSession(sessionId, skipConfirmation)
  }, [context])

  const hasPendingPrompt = useCallback((sessionId: string) => {
    return (context.pendingPermissions.get(sessionId)?.length ?? 0) > 0
  }, [context.pendingPermissions])

  const handleSessionProjectChange = useCallback((sessionId: string, projectId: string | null) => {
    void window.electronAPI.sessionCommand(sessionId, { type: 'setProjectId', projectId })
  }, [])

  const filterAction = useMemo(() => (
    <SessionListFilterDropdown
      listFilter={listFilter}
      setListFilter={setListFilter}
      labelFilter={labelFilter}
      setLabelFilter={setLabelFilter}
      projectFilter={projectFilter}
      setProjectFilter={setProjectFilter}
      pinnedFilters={{ pinnedStatusId: null, pinnedLabelId: null, pinnedFlagged: false }}
      sessionStatuses={sessionStatuses}
      displayLabelConfigs={labels}
      labelConfigs={labelConfigs}
      projects={projectOptions}
      groupingMode={chatGroupingMode}
      setGroupingMode={setChatGroupingMode}
      isStateSubView={false}
      onOpenSearch={() => setSearchActive(true)}
    />
  ), [listFilter, labelFilter, projectFilter, sessionStatuses, labels, labelConfigs, projectOptions, chatGroupingMode])

  return (
    <div
      data-agent-presentation="panel"
      data-agent-component="panel"
      className="h-full w-full min-w-0 overflow-hidden bg-background @container/shell"
    >
      <AppShellProvider value={panelContext}>
        <div className="h-full w-full min-w-0 overflow-hidden @container/panel">
          {showAllSessions ? (
            <AllSessionsPanel
              header={(
                <PanelHeader
                  title={t('sidebar.allSessions')}
                  leadingAction={false}
                  actions={filterAction}
                  rightSidebarButton={exitAllSessionsButton}
                />
              )}
              items={filteredSessionMetas}
              onDelete={handleDeleteSession}
              onFlag={context.onFlagSession}
              onUnflag={context.onUnflagSession}
              onArchive={context.onArchiveSession}
              onUnarchive={context.onUnarchiveSession}
              onMarkUnread={context.onMarkSessionUnread}
              onSessionStatusChange={context.onSessionStatusChange}
              onRename={context.onRenameSession}
              onOpenInNewWindow={(meta: SessionMeta) => {
                if (activeWorkspaceId) void window.electronAPI.openSessionInNewWindow(activeWorkspaceId, meta.id)
              }}
              sessionOptions={context.sessionOptions}
              searchActive={searchActive}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              onSearchClose={() => {
                setSearchActive(false)
                setSearchQuery('')
              }}
              sessionStatuses={sessionStatuses}
              labels={labels}
              onLabelsChange={handleSessionLabelsChange}
              projects={projectOptions}
              onSetProjectId={handleSessionProjectChange}
              groupingMode={chatGroupingMode}
              workspaceId={activeWorkspaceId ?? undefined}
              statusFilter={listFilter}
              labelFilterMap={labelFilter}
              focusedSessionId={currentSessionId}
              onNavigateToSession={handleSelectSession}
              hasPendingPrompt={hasPendingPrompt}
            />
          ) : (
            <MainContentPanel
              navStateOverride={navState}
              isSidebarAndNavigatorHidden
            />
          )}
        </div>
      </AppShellProvider>
    </div>
  )
}
