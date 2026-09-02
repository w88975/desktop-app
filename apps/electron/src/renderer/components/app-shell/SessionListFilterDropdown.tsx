import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Calendar, Check, Flag, FolderKanban, Inbox, Layers, ListFilter, MailOpen, Search, Tag, Trash2, X } from 'lucide-react'
import type { LabelConfig } from '@craft-agent/shared/labels'
import { findLabelById } from '@craft-agent/shared/labels'
import { HeaderIconButton } from '@/components/ui/HeaderIconButton'
import { LabelIcon } from '@/components/ui/label-icon'
import { filterSessionStatuses } from '@/components/ui/label-menu'
import { createLabelMenuItems, filterItems as filterLabelItems } from '@/components/ui/label-menu-utils'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuSub,
  StyledDropdownMenuContent, StyledDropdownMenuItem, StyledDropdownMenuSeparator,
  StyledDropdownMenuSubContent, StyledDropdownMenuSubTrigger,
} from '@/components/ui/styled-dropdown'
import { cn } from '@/lib/utils'
import type { SessionStatus, SessionStatusId } from '@/config/session-status-config'
import type { FilterMode } from './inherited-filter-params'
import type { ChatGroupingMode } from './SessionList'

type Setter<T> = (next: Map<T, FilterMode> | ((prev: Map<T, FilterMode>) => Map<T, FilterMode>)) => void
type ProjectOption = { id: string; name: string }

export interface SessionListFilterDropdownProps {
  listFilter: Map<SessionStatusId, FilterMode>
  setListFilter: Setter<SessionStatusId>
  labelFilter: Map<string, FilterMode>
  setLabelFilter: Setter<string>
  projectFilter: Map<string, FilterMode>
  setProjectFilter: Setter<string>
  pinnedFilters: { pinnedStatusId: string | null; pinnedLabelId: string | null; pinnedFlagged: boolean }
  sessionStatuses: SessionStatus[]
  displayLabelConfigs: LabelConfig[]
  labelConfigs: LabelConfig[]
  projects: ProjectOption[]
  groupingMode: ChatGroupingMode
  setGroupingMode: (mode: ChatGroupingMode) => void
  isStateSubView: boolean
  onOpenSearch: () => void
}

function setMode<T>(setter: Setter<T>, id: T, mode: FilterMode | null) {
  setter(prev => {
    const next = new Map(prev)
    if (mode === null) next.delete(id)
    else next.set(id, mode)
    return next
  })
}

function ModeBadge({ mode }: { mode: FilterMode }) {
  return (
    <span className={cn('flex size-5 -mr-1 items-center justify-center rounded-[4px]', mode === 'include' ? 'bg-background shadow-minimal' : 'bg-destructive/10 text-destructive shadow-tinted')}>
      {mode === 'include' ? <Check className="!size-2.5" /> : <X className="!size-2.5" />}
    </span>
  )
}

function Row({ icon, label, accessory, color }: { icon: React.ReactNode; label: React.ReactNode; accessory?: React.ReactNode; color?: string }) {
  return (
    <>
      <span className="flex size-3.5 shrink-0 items-center justify-center" style={color ? { color } : undefined}>{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0">{accessory}</span>
    </>
  )
}

function ModeMenu({ mode, onChange, onRemove }: { mode: FilterMode; onChange: (mode: FilterMode) => void; onRemove: () => void }) {
  const { t } = useTranslation()
  return (
    <>
      <StyledDropdownMenuItem onClick={e => { e.preventDefault(); onChange('include') }} className={cn(mode === 'include' && 'bg-foreground/[0.03]')}>
        <Check className="size-3.5" /><span className="flex-1">{t('filter.include')}</span>
      </StyledDropdownMenuItem>
      <StyledDropdownMenuItem onClick={e => { e.preventDefault(); onChange('exclude') }} className={cn(mode === 'exclude' && 'bg-foreground/[0.03]')}>
        <X className="size-3.5" /><span className="flex-1">{t('filter.exclude')}</span>
      </StyledDropdownMenuItem>
      <StyledDropdownMenuSeparator />
      <StyledDropdownMenuItem onClick={e => { e.preventDefault(); onRemove() }}>
        <Trash2 className="size-3.5" /><span className="flex-1">{t('common.clear')}</span>
      </StyledDropdownMenuItem>
    </>
  )
}

function FilterOption<T>({ id, label, icon, mode, pinned, setter, altKey, color }: {
  id: T; label: React.ReactNode; icon: React.ReactNode; mode?: FilterMode; pinned?: boolean
  setter: Setter<T>; altKey: boolean; color?: string
}) {
  if (mode && !pinned) {
    return (
      <DropdownMenuSub>
        <StyledDropdownMenuSubTrigger onClick={e => { e.preventDefault(); setMode(setter, id, null) }}>
          <Row icon={icon} label={label} accessory={<ModeBadge mode={mode} />} color={color} />
        </StyledDropdownMenuSubTrigger>
        <StyledDropdownMenuSubContent minWidth="min-w-[140px]">
          <ModeMenu mode={mode} onChange={next => setMode(setter, id, next)} onRemove={() => setMode(setter, id, null)} />
        </StyledDropdownMenuSubContent>
      </DropdownMenuSub>
    )
  }
  return (
    <StyledDropdownMenuItem disabled={pinned} onClick={e => { if (!pinned) { e.preventDefault(); setMode(setter, id, altKey ? 'exclude' : 'include') } }}>
      <Row icon={icon} label={label} accessory={pinned ? <Check className="size-3 text-muted-foreground" /> : undefined} color={color} />
    </StyledDropdownMenuItem>
  )
}

function LabelOptions({ labels, filter, setter, pinnedId, altHeld }: {
  labels: LabelConfig[]
  filter: Map<string, FilterMode>
  setter: Setter<string>
  pinnedId: string | null
  altHeld: boolean
}) {
  return labels.map(label => {
    const children = label.children ?? []
    const option = (
      <FilterOption
        id={label.id}
        label={label.name}
        icon={<LabelIcon label={label} size="lg" hasChildren={children.length > 0} />}
        mode={filter.get(label.id)}
        pinned={label.id === pinnedId}
        setter={setter}
        altKey={altHeld}
      />
    )
    if (!children.length) return <React.Fragment key={label.id}>{option}</React.Fragment>

    const hasActiveChild = children.some(child => filter.has(child.id) || child.id === pinnedId)
    return (
      <DropdownMenuSub key={label.id}>
        <StyledDropdownMenuSubTrigger>
          <Row
            icon={<LabelIcon label={label} size="lg" hasChildren />}
            label={label.name}
            accessory={(filter.has(label.id) || label.id === pinnedId || hasActiveChild) ? <Check className="size-3 text-muted-foreground" /> : undefined}
          />
        </StyledDropdownMenuSubTrigger>
        <StyledDropdownMenuSubContent minWidth="min-w-[160px]">
          {option}
          <StyledDropdownMenuSeparator />
          <LabelOptions labels={children} filter={filter} setter={setter} pinnedId={pinnedId} altHeld={altHeld} />
        </StyledDropdownMenuSubContent>
      </DropdownMenuSub>
    )
  })
}

/** Canonical filter menu. Full Agent + Agent Panel render same component. */
export function SessionListFilterDropdown(props: SessionListFilterDropdownProps) {
  const { t } = useTranslation()
  const {
    listFilter, setListFilter, labelFilter, setLabelFilter, projectFilter, setProjectFilter,
    pinnedFilters, sessionStatuses, displayLabelConfigs, labelConfigs, projects,
    groupingMode, setGroupingMode, isStateSubView, onOpenSearch,
  } = props
  const [query, setQuery] = React.useState('')
  const [altHeld, setAltHeld] = React.useState(false)
  const labelSearchItems = React.useMemo(() => createLabelMenuItems(displayLabelConfigs), [displayLabelConfigs])
  const statusResults = React.useMemo(() => query.trim() ? filterSessionStatuses(sessionStatuses, query) : [], [sessionStatuses, query])
  const labelResults = React.useMemo(() => query.trim() ? filterLabelItems(labelSearchItems, query) : [], [labelSearchItems, query])
  const hasUserFilters = listFilter.size > 0 || labelFilter.size > 0 || projectFilter.size > 0
  const hasPinned = pinnedFilters.pinnedFlagged || !!pinnedFilters.pinnedStatusId || !!pinnedFilters.pinnedLabelId

  const clear = () => {
    setListFilter(new Map())
    setLabelFilter(new Map())
    setProjectFilter(new Map())
  }

  const selectedRows = (
    <>
      {pinnedFilters.pinnedFlagged && <StyledDropdownMenuItem disabled><Row icon={<Flag className="size-3.5" />} label={t('sidebar.flagged')} accessory={<Check className="size-3 text-muted-foreground" />} /></StyledDropdownMenuItem>}
      {pinnedFilters.pinnedStatusId && (() => {
        const status = sessionStatuses.find(item => item.id === pinnedFilters.pinnedStatusId)
        return status ? <StyledDropdownMenuItem disabled><Row icon={status.icon} label={status.label} accessory={<Check className="size-3 text-muted-foreground" />} color={status.iconColorable ? status.resolvedColor : undefined} /></StyledDropdownMenuItem> : null
      })()}
      {pinnedFilters.pinnedLabelId && (() => {
        const label = findLabelById(labelConfigs, pinnedFilters.pinnedLabelId)
        return label ? <StyledDropdownMenuItem disabled><Row icon={<LabelIcon label={label} size="lg" />} label={label.name} accessory={<Check className="size-3 text-muted-foreground" />} /></StyledDropdownMenuItem> : null
      })()}
      {sessionStatuses.filter(item => listFilter.has(item.id)).map(item => <FilterOption key={item.id} id={item.id} label={item.label} icon={item.icon} color={item.iconColorable ? item.resolvedColor : undefined} mode={listFilter.get(item.id)} setter={setListFilter} altKey={altHeld} />)}
      {Array.from(labelFilter).map(([id, mode]) => {
        const label = findLabelById(labelConfigs, id)
        return label ? <FilterOption key={id} id={id} label={label.name} icon={<LabelIcon label={label} size="lg" />} mode={mode} setter={setLabelFilter} altKey={altHeld} /> : null
      })}
      {Array.from(projectFilter).map(([id, mode]) => {
        const project = projects.find(item => item.id === id)
        return project ? <FilterOption key={id} id={id} label={project.name} icon={<FolderKanban className="size-3.5" />} mode={mode} setter={setProjectFilter} altKey={altHeld} /> : null
      })}
      {(hasUserFilters || hasPinned) && <StyledDropdownMenuSeparator />}
    </>
  )

  return (
    <DropdownMenu onOpenChange={open => { if (!open) { setQuery(''); setAltHeld(false) } }}>
      <DropdownMenuTrigger asChild>
        <HeaderIconButton
          icon={<ListFilter className="size-4" />}
          aria-label={t('sidebar.filterChats')}
          className={hasUserFilters ? 'rounded-[8px] bg-accent/5 text-accent shadow-tinted' : 'rounded-[8px]'}
          style={hasUserFilters ? { '--shadow-color': 'var(--accent-rgb)' } as React.CSSProperties : undefined}
        />
      </DropdownMenuTrigger>
      <StyledDropdownMenuContent align="end" light minWidth="min-w-[200px]" onKeyDown={e => { if (e.key === 'Alt') setAltHeld(true) }} onKeyUp={e => { if (e.key === 'Alt') setAltHeld(false) }}>
        <div className="flex items-center justify-between px-2 py-1.5">
          <span className="text-xs font-medium text-muted-foreground">{t('sidebar.filterChats')}</span>
          {hasUserFilters && <button type="button" onClick={e => { e.preventDefault(); clear() }} className="text-xs text-muted-foreground hover:text-foreground">Clear</button>}
        </div>
        <div className="border-b border-foreground/5 px-1 pb-3">
          <div className="rounded-[6px] bg-background px-2 py-1.5 shadow-minimal">
            <input autoFocus value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.stopPropagation()} placeholder={t('sidebar.searchStatusesLabels')} className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground" />
          </div>
        </div>
        {query.trim() ? (
          <div className="max-h-[240px] overflow-y-auto py-1">
            {!statusResults.length && !labelResults.length && <div className="px-3 py-4 text-center text-xs text-muted-foreground">No matching statuses or labels</div>}
            {statusResults.length > 0 && <div className="px-3 pt-1.5 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">Statuses</div>}
            {statusResults.map(status => <FilterOption key={status.id} id={status.id} label={status.label} icon={status.icon} color={status.iconColorable ? status.resolvedColor : undefined} mode={listFilter.get(status.id)} pinned={status.id === pinnedFilters.pinnedStatusId} setter={setListFilter} altKey={altHeld} />)}
            {!!statusResults.length && !!labelResults.length && <StyledDropdownMenuSeparator />}
            {labelResults.length > 0 && <div className="px-3 pt-1.5 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">Labels</div>}
            {labelResults.map(item => <FilterOption key={item.id} id={item.id} label={<>{item.parentPath && <span className="text-muted-foreground">{item.parentPath}</span>}{item.label}</>} icon={<LabelIcon label={item.config} size="lg" />} mode={labelFilter.get(item.id)} pinned={item.id === pinnedFilters.pinnedLabelId} setter={setLabelFilter} altKey={altHeld} />)}
          </div>
        ) : (
          <>
            {selectedRows}
            <DropdownMenuSub>
              <StyledDropdownMenuSubTrigger><Inbox className="size-3.5" /><span className="flex-1">{t('sidebar.statuses')}</span></StyledDropdownMenuSubTrigger>
              <StyledDropdownMenuSubContent minWidth="min-w-[180px]">
                {sessionStatuses.map(status => <FilterOption key={status.id} id={status.id} label={status.label} icon={status.icon} color={status.iconColorable ? status.resolvedColor : undefined} mode={listFilter.get(status.id)} pinned={status.id === pinnedFilters.pinnedStatusId} setter={setListFilter} altKey={altHeld} />)}
              </StyledDropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <StyledDropdownMenuSubTrigger><Tag className="size-3.5" /><span className="flex-1">{t('sidebar.labels')}</span></StyledDropdownMenuSubTrigger>
              <StyledDropdownMenuSubContent minWidth="min-w-[180px]">
                {displayLabelConfigs.length ? (
                  <LabelOptions labels={displayLabelConfigs} filter={labelFilter} setter={setLabelFilter} pinnedId={pinnedFilters.pinnedLabelId} altHeld={altHeld} />
                ) : <StyledDropdownMenuItem disabled>{t('table.noLabelsConfigured')}</StyledDropdownMenuItem>}
              </StyledDropdownMenuSubContent>
            </DropdownMenuSub>
            {projects.length > 0 && (
              <DropdownMenuSub>
                <StyledDropdownMenuSubTrigger><FolderKanban className="size-3.5" /><span className="flex-1">{t('sidebar.projects')}</span></StyledDropdownMenuSubTrigger>
                <StyledDropdownMenuSubContent minWidth="min-w-[180px]">
                  {projects.map(project => <FilterOption key={project.id} id={project.id} label={project.name} icon={<FolderKanban className="size-3.5" />} mode={projectFilter.get(project.id)} setter={setProjectFilter} altKey={altHeld} />)}
                </StyledDropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            {!isStateSubView && (
              <><StyledDropdownMenuSeparator /><DropdownMenuSub>
                <StyledDropdownMenuSubTrigger><Layers className="size-3.5" /><span className="flex-1">{t('sidebar.group')}</span></StyledDropdownMenuSubTrigger>
                <StyledDropdownMenuSubContent minWidth="min-w-[140px]">
                  {([['date', Calendar, t('sidebar.groupByDate')], ['status', Inbox, t('sidebar.groupByStatus')], ['unread', MailOpen, t('sidebar.groupByUnread')], ...(projects.length ? [['project', FolderKanban, t('sidebar.groupByProject')] as const] : [])] as const).map(([mode, Icon, label]) => <StyledDropdownMenuItem key={mode} onClick={() => setGroupingMode(mode)}><Icon className="size-3.5" /><span className="flex-1">{label}</span>{groupingMode === mode && <Check className="size-3 text-muted-foreground" />}</StyledDropdownMenuItem>)}
                </StyledDropdownMenuSubContent>
              </DropdownMenuSub></>
            )}
            <StyledDropdownMenuSeparator />
            <StyledDropdownMenuItem onClick={onOpenSearch}><Search className="size-3.5" /><span className="flex-1">{t('sidebar.search')}</span></StyledDropdownMenuItem>
          </>
        )}
      </StyledDropdownMenuContent>
    </DropdownMenu>
  )
}
