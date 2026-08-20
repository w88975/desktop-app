/**
 * MainContentPanel - Right panel component for displaying content
 *
 * Renders content based on the unified NavigationState:
 * - Chats navigator: ChatPage for selected session, or empty state
 * - Sources navigator: SourceInfoPage for selected source, or empty state
 * - Settings navigator: Settings, Preferences, or Shortcuts page
 *
 * The NavigationState is the single source of truth for what to display.
 *
 * In focused mode (single window), wraps content with StoplightProvider
 * so PanelHeader components automatically compensate for macOS traffic lights.
 *
 * When multiple sessions are selected (multi-select mode), shows the
 * MultiSelectPanel with batch action buttons instead of a single chat.
 */

import * as React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { Panel } from './Panel'
import { MultiSelectPanel } from './MultiSelectPanel'
import { useAppShellContext } from '@/context/AppShellContext'
import { sessionMetaMapAtom, type SessionMeta } from '@/atoms/sessions'
import { StoplightProvider } from '@/context/StoplightContext'
import {
  useNavigationState,
  isSessionsNavigation,
  isSourcesNavigation,
  isSkillsNavigation,
  isAutomationsNavigation,
  isProjectsNavigation,
} from '@/contexts/NavigationContext'
import { useSessionSelection, useIsMultiSelectActive, useSelectedIds, useSelectionCount } from '@/hooks/useSession'
import { sourceSelection, skillSelection, automationSelection } from '@/hooks/useEntitySelection'
import { extractLabelId } from '@craft-agent/shared/labels'
import type { SessionStatusId } from '@/config/session-status-config'
import { SourceInfoPage, ChatPage } from '@/pages'
import SkillInfoPage from '@/pages/SkillInfoPage'
import { AutomationInfoPage } from '../automations/AutomationInfoPage'
import ProjectInfoPage from '@/pages/ProjectInfoPage'
import { KanbanBoardContainer } from './kanban/KanbanBoardContainer'
import type { ExecutionEntry } from '../automations/types'
import { automationsAtom } from '@/atoms/automations'
import { SendResourceToWorkspaceDialog, type SendResourceType } from './SendResourceToWorkspaceDialog'
import { PanelHeader } from './PanelHeader'
import { PanelHeaderCenterButton } from '@/components/ui/PanelHeaderCenterButton'
import { Maximize2 } from 'lucide-react'
import { useAgentPresentation } from '@/context/AgentPresentationContext'
import { navigate, routes } from '@/lib/navigate'
import { ChatInputZone } from './input/ChatInputZone'
import { DEFAULT_MODEL } from '@config/models'
import type { FileAttachment, PermissionMode } from '../../../shared/types'

function AgentNewConversationState() {
  const { openFullView } = useAgentPresentation()
  const {
    rightSidebarButton,
    activeWorkspaceId,
    llmConnections,
    workspaceDefaultLlmConnection,
    enabledModes,
    enabledSources,
    skills,
    labels,
    sessionStatuses,
    onCreateSession,
    onSendMessage,
    onSessionSourcesChange,
  } = useAppShellContext()
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<FileAttachment[]>([])
  const [model, setModel] = useState(DEFAULT_MODEL)
  const [connection, setConnection] = useState(workspaceDefaultLlmConnection)
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('ask')
  const [enabledSourceSlugs, setEnabledSourceSlugs] = useState<string[]>([])
  const [sessionLabels, setSessionLabels] = useState<string[]>([])
  const [sessionStatus, setSessionStatus] = useState('todo')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!workspaceDefaultLlmConnection) return
    setConnection(workspaceDefaultLlmConnection)
    const defaultConnection = llmConnections.find(item => item.slug === workspaceDefaultLlmConnection)
    if (defaultConnection?.defaultModel) setModel(defaultConnection.defaultModel)
  }, [workspaceDefaultLlmConnection, llmConnections])

  const submit = async (message: string, submittedAttachments?: FileAttachment[], skillSlugs?: string[]) => {
    const trimmed = message.trim()
    if (!trimmed || !activeWorkspaceId || submitting) return
    setSubmitting(true)
    try {
      const session = await onCreateSession(activeWorkspaceId, {
        model,
        llmConnection: connection,
        permissionMode,
        labels: sessionLabels,
        sessionStatus,
      })
      if (enabledSourceSlugs.length > 0) {
        onSessionSourcesChange?.(session.id, enabledSourceSlugs)
      }
      navigate(routes.view.allSessions(session.id))
      onSendMessage(session.id, trimmed, submittedAttachments, skillSlugs)
      setInput('')
      setAttachments([])
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="h-full flex flex-col">
      <PanelHeader
        title="New Conversation"
        actions={(
          <PanelHeaderCenterButton
            icon={<Maximize2 className="h-4 w-4" />}
            tooltip="Open Agent full view"
            onClick={() => { void openFullView() }}
          />
        )}
        rightSidebarButton={rightSidebarButton}
      />
      <div className="flex-1 min-h-0" />
      <ChatInputZone
        compactMode={false}
        permissionMode={permissionMode}
        onPermissionModeChange={setPermissionMode}
        sessionId="agent-new-conversation"
        sessionLabels={sessionLabels}
        labels={labels}
        onLabelsChange={setSessionLabels}
        sessionStatuses={sessionStatuses}
        currentSessionStatus={sessionStatus}
        onSessionStatusChange={setSessionStatus}
        inputProps={{
          disabled: submitting || !activeWorkspaceId,
          isProcessing: submitting,
          onSubmit: submit,
          currentModel: model,
          onModelChange: (nextModel, nextConnection) => {
            setModel(nextModel)
            if (nextConnection) setConnection(nextConnection)
          },
          currentConnection: connection,
          onConnectionChange: nextConnection => {
            setConnection(nextConnection)
            const selected = llmConnections.find(item => item.slug === nextConnection)
            if (selected?.defaultModel) setModel(selected.defaultModel)
          },
          enabledModes,
          inputValue: input,
          onInputChange: setInput,
          attachmentsValue: attachments,
          onAttachmentsChange: setAttachments,
          sources: enabledSources,
          enabledSourceSlugs,
          onSourcesChange: setEnabledSourceSlugs,
          skills,
          workspaceId: activeWorkspaceId ?? undefined,
          isEmptySession: true,
        }}
      />
    </div>
  )
}

export interface MainContentPanelProps {
  /** Whether both sidebar and navigator are hidden (focus mode / CMD+.) */
  isSidebarAndNavigatorHidden?: boolean
  /** Optional className for the container */
  className?: string
  /**
   * Override the navigation state for this panel.
   * When provided, this panel renders based on the override instead of the global NavigationState.
   * Used by PanelSlot to render panels in the panel stack.
   */
  navStateOverride?: import('../../../shared/types').NavigationState | null
}

export function MainContentPanel({
  isSidebarAndNavigatorHidden = false,
  className,
  navStateOverride,
}: MainContentPanelProps) {
  const { t } = useTranslation()
  const { isPanel } = useAgentPresentation()
  const globalNavState = useNavigationState()
  const navState = navStateOverride ?? globalNavState
  const {
    activeWorkspaceId,
    workspaces,
    onSessionStatusChange,
    onArchiveSession,
    onSessionLabelsChange,
    sessionStatuses,
    labels,
    onTestAutomation,
    onToggleAutomation,
    onDuplicateAutomation,
    onDeleteAutomation,
    onReplayAutomation,
    automationTestResults,
    getAutomationHistory,
    activeSessionWorkingDirectory,
  } = useAppShellContext()

  // Session multi-select state
  const isMultiSelectActive = useIsMultiSelectActive()
  const selectedIds = useSelectedIds()
  const selectionCount = useSelectionCount()
  const { clearMultiSelect } = useSessionSelection()
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const automations = useAtomValue(automationsAtom)

  // Execution history for the selected automation
  const selectedAutomationId = isAutomationsNavigation(navState) ? navState.details?.automationId : undefined
  const [executions, setExecutions] = useState<ExecutionEntry[]>([])

  useEffect(() => {
    if (!selectedAutomationId || !getAutomationHistory) {
      setExecutions([])
      return
    }
    let stale = false

    // Initial fetch
    getAutomationHistory(selectedAutomationId).then(entries => {
      if (!stale) setExecutions(entries)
    })

    // Re-fetch on automation changes (live updates when automations fire)
    const cleanup = window.electronAPI.onAutomationsChanged(() => {
      if (!stale) {
        getAutomationHistory(selectedAutomationId).then(entries => {
          if (!stale) setExecutions(entries)
        })
      }
    })

    return () => { stale = true; cleanup() }
  }, [selectedAutomationId, getAutomationHistory])

  // Source multi-select state
  const isSourceMultiSelectActive = sourceSelection.useIsMultiSelectActive()
  const sourceSelectionCount = sourceSelection.useSelectionCount()
  const selectedSourceIds = sourceSelection.useSelectedIds()
  const { clearMultiSelect: clearSourceSelection } = sourceSelection.useSelection()

  // Skill multi-select state
  const isSkillMultiSelectActive = skillSelection.useIsMultiSelectActive()
  const skillSelectionCount = skillSelection.useSelectionCount()
  const selectedSkillIds = skillSelection.useSelectedIds()
  const { clearMultiSelect: clearSkillSelection } = skillSelection.useSelection()

  // Automation multi-select state
  const isAutomationMultiSelectActive = automationSelection.useIsMultiSelectActive()
  const automationSelectionCount = automationSelection.useSelectionCount()
  const selectedAutomationIds = automationSelection.useSelectedIds()
  const { clearMultiSelect: clearAutomationSelection } = automationSelection.useSelection()

  // Send to Workspace dialog state (shared across resource types)
  const [sendDialogOpen, setSendDialogOpen] = useState(false)
  const [sendResourceType, setSendResourceType] = useState<SendResourceType>('source')
  const [sendResourceIds, setSendResourceIds] = useState<string[]>([])
  const [sendResourceLabel, setSendResourceLabel] = useState('')
  const hasOtherWorkspaces = workspaces.length > 1

  const openSendDialog = useCallback((type: SendResourceType, ids: Set<string>) => {
    const count = ids.size
    setSendResourceType(type)
    setSendResourceIds([...ids])
    setSendResourceLabel(`${count} ${type}${count !== 1 ? 's' : ''}`)
    setSendDialogOpen(true)
  }, [])

  const selectedMetas = useMemo(() => {
    const metas: SessionMeta[] = []
    selectedIds.forEach((id) => {
      const meta = sessionMetaMap.get(id)
      if (meta) metas.push(meta)
    })
    return metas
  }, [selectedIds, sessionMetaMap])

  const activeStatusId = useMemo((): SessionStatusId | null => {
    if (selectedMetas.length === 0) return null
    const first = (selectedMetas[0].sessionStatus || 'todo') as SessionStatusId
    const allSame = selectedMetas.every(meta => (meta.sessionStatus || 'todo') === first)
    return allSame ? first : null
  }, [selectedMetas])

  const appliedLabelIds = useMemo(() => {
    if (selectedMetas.length === 0) return new Set<string>()
    const toLabelSet = (meta: SessionMeta) =>
      new Set((meta.labels || []).map(entry => extractLabelId(entry)))
    const [first, ...rest] = selectedMetas.map(toLabelSet)
    const intersection = new Set(first)
    for (const labelSet of rest) {
      for (const id of [...intersection]) {
        if (!labelSet.has(id)) intersection.delete(id)
      }
    }
    return intersection
  }, [selectedMetas])

  // Batch operations for multi-select
  const handleBatchSetStatus = useCallback((status: SessionStatusId) => {
    selectedIds.forEach(sessionId => {
      onSessionStatusChange(sessionId, status)
    })
  }, [selectedIds, onSessionStatusChange])

  const handleBatchArchive = useCallback(() => {
    selectedIds.forEach(sessionId => {
      onArchiveSession(sessionId)
    })
    clearMultiSelect()
  }, [selectedIds, onArchiveSession, clearMultiSelect])

  const handleBatchToggleLabel = useCallback((labelId: string) => {
    if (!onSessionLabelsChange) return
    const allHaveLabel = selectedMetas.every(meta =>
      (meta.labels || []).some(entry => extractLabelId(entry) === labelId)
    )

    selectedMetas.forEach(meta => {
      const labels = meta.labels || []
      const hasLabel = labels.some(entry => extractLabelId(entry) === labelId)
      const filtered = labels.filter(entry => extractLabelId(entry) !== labelId)
      const nextLabels = allHaveLabel
        ? filtered
        : (hasLabel ? labels : [...labels, labelId])
      onSessionLabelsChange(meta.id, nextLabels)
    })
  }, [selectedMetas, onSessionLabelsChange])

  // Wrap content with StoplightProvider so PanelHeaders auto-compensate in focused mode.
  // Also renders the Send to Workspace dialog (portal-based, so it overlays regardless of position).
  const wrapWithStoplight = (content: React.ReactNode) => (
    <StoplightProvider value={isSidebarAndNavigatorHidden}>
      {content}
      <SendResourceToWorkspaceDialog
        open={sendDialogOpen}
        onOpenChange={setSendDialogOpen}
        resourceType={sendResourceType}
        resourceIds={sendResourceIds}
        resourceLabel={sendResourceLabel}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId || ''}
      />
    </StoplightProvider>
  )

  // Sources navigator - show source info, multi-select panel, or empty state
  if (isSourcesNavigation(navState)) {
    if (isSourceMultiSelectActive) {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <MultiSelectPanel
            count={sourceSelectionCount}
            entityType="source"
            onSendToWorkspace={hasOtherWorkspaces ? () => openSendDialog('source', selectedSourceIds) : undefined}
            onClearSelection={clearSourceSelection}
          />
        </Panel>
      )
    }
    if (navState.details) {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <SourceInfoPage
            sourceSlug={navState.details.sourceSlug}
            workspaceId={activeWorkspaceId || ''}
          />
        </Panel>
      )
    }
    // No source selected - empty state
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <p className="text-sm">{t("sourcesList.noSourcesConfigured")}</p>
        </div>
      </Panel>
    )
  }

  // Skills navigator - show skill info, multi-select panel, or empty state
  if (isSkillsNavigation(navState)) {
    if (isSkillMultiSelectActive) {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <MultiSelectPanel
            count={skillSelectionCount}
            entityType="skill"
            onSendToWorkspace={hasOtherWorkspaces ? () => openSendDialog('skill', selectedSkillIds) : undefined}
            onClearSelection={clearSkillSelection}
          />
        </Panel>
      )
    }
    if (navState.details?.type === 'skill') {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <SkillInfoPage
            skillSlug={navState.details.skillSlug}
            workspaceId={activeWorkspaceId || ''}
            workingDirectory={activeSessionWorkingDirectory}
          />
        </Panel>
      )
    }
    // No skill selected - empty state
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <p className="text-sm">{t("skillsList.noSkillsConfigured")}</p>
        </div>
      </Panel>
    )
  }

  // Automations navigator - show automation info, multi-select panel, or empty state
  if (isAutomationsNavigation(navState)) {
    if (isAutomationMultiSelectActive) {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <MultiSelectPanel
            count={automationSelectionCount}
            entityType="automation"
            onSendToWorkspace={hasOtherWorkspaces ? () => openSendDialog('automation', selectedAutomationIds) : undefined}
            onClearSelection={clearAutomationSelection}
          />
        </Panel>
      )
    }
    if (navState.details) {
      const automation = automations.find(h => h.id === navState.details!.automationId)
      if (automation) {
        return wrapWithStoplight(
          <Panel variant="grow" className={className}>
            <AutomationInfoPage
              automation={automation}
              executions={executions}
              testResult={automationTestResults?.[automation.id]}
              onTest={onTestAutomation ? () => onTestAutomation(automation.id) : undefined}
              onToggleEnabled={onToggleAutomation ? () => onToggleAutomation(automation.id) : undefined}
              onDuplicate={onDuplicateAutomation ? () => onDuplicateAutomation(automation.id) : undefined}
              onDelete={onDeleteAutomation ? () => onDeleteAutomation(automation.id) : undefined}
              onReplay={onReplayAutomation}
            />
          </Panel>
        )
      }
    }
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <p className="text-sm">{t("automations.noAutomationsConfigured")}</p>
        </div>
      </Panel>
    )
  }

  // Projects navigator - show project detail page or empty state
  if (isProjectsNavigation(navState)) {
    const projectDetails = navState.details
    if (projectDetails && projectDetails.type === 'project') {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <ProjectInfoPage projectSlug={projectDetails.projectSlug} />
        </Panel>
      )
    }
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <p className="text-sm">{t("projectsList.noProjectSelected")}</p>
        </div>
      </Panel>
    )
  }

  // Chats navigator - show chat, multi-select panel, or empty state
  if (isSessionsNavigation(navState)) {
    // Board view: full-width Kanban over all sessions (placement independent of status)
    if (navState.viewMode === 'board') {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <KanbanBoardContainer />
        </Panel>
      )
    }

    // Multi-select mode: show batch actions panel
    if (isMultiSelectActive) {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <MultiSelectPanel
            count={selectionCount}
            sessionStatuses={sessionStatuses}
            activeStatusId={activeStatusId}
            onSetStatus={handleBatchSetStatus}
            labels={labels}
            appliedLabelIds={appliedLabelIds}
            onToggleLabel={handleBatchToggleLabel}
            onArchive={handleBatchArchive}
            onClearSelection={clearMultiSelect}
          />
        </Panel>
      )
    }

    if (navState.details) {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <ChatPage sessionId={navState.details.sessionId} />
        </Panel>
      )
    }
    // No session selected - empty state
    if (isPanel) {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <AgentNewConversationState />
        </Panel>
      )
    }
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <p className="text-sm">{t("session.noSessionSelected")}</p>
        </div>
      </Panel>
    )
  }

  // Fallback (should not happen with proper NavigationState)
  return wrapWithStoplight(
    <Panel variant="grow" className={className}>
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <p className="text-sm">{t("session.selectConversation")}</p>
      </div>
    </Panel>
  )
}
