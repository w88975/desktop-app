/**
 * Sidebar Mode Types
 *
 * Defines the different content modes for the 2nd sidebar.
 * The left sidebar navigation items control which mode is active.
 */

// Import shared types - single source of truth
import type { SessionFilter } from '../../../shared/types'
export type { SessionFilter }

/**
 * Sidebar mode - determines what content is shown in the 2nd sidebar
 *
 */
export type SidebarMode =
  | { type: 'sessions'; filter: SessionFilter }
  | { type: 'sources' }

/**
 * Type guard to check if mode is sessions mode
 */
export const isSessionsMode = (
  mode: SidebarMode
): mode is { type: 'sessions'; filter: SessionFilter } => mode.type === 'sessions'

/**
 * Type guard to check if mode is sources mode
 */
export const isSourcesMode = (
  mode: SidebarMode
): mode is { type: 'sources' } => mode.type === 'sources'

/**
 * Get a persistence key for localStorage
 * Used to save/restore the last selected sidebar mode
 */
export const getSidebarModeKey = (mode: SidebarMode): string => {
  if (mode.type === 'sources') return 'sources'
  const f = mode.filter
  if (f.kind === 'state') return `state:${f.stateId}`
  return f.kind
}

/**
 * Parse a persistence key back to a SidebarMode
 * Returns null if the key is invalid or requires validation (state)
 */
export const parseSidebarModeKey = (key: string): SidebarMode | null => {
  if (key === 'sources') return { type: 'sources' }
  if (key === 'allSessions') return { type: 'sessions', filter: { kind: 'allSessions' } }
  if (key === 'flagged') return { type: 'sessions', filter: { kind: 'flagged' } }
  if (key.startsWith('state:')) {
    const stateId = key.slice(6)
    if (stateId) return { type: 'sessions', filter: { kind: 'state', stateId } }
  }
  return null
}

/**
 * Default sidebar mode - all sessions view
 */
export const DEFAULT_SIDEBAR_MODE: SidebarMode = {
  type: 'sessions',
  filter: { kind: 'allSessions' },
}
