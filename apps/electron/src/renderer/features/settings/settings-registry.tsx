import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import { FEATURE_FLAGS } from '@craft-agent/shared/feature-flags'
import type { SettingsSubpage } from '../../../shared/settings-registry'
import { SETTINGS_ICONS } from './SettingsIcons'

export interface SettingsPageDefinition {
  id: SettingsSubpage
  labelKey: string
  descriptionKey: string
  icon: ComponentType<{ className?: string }>
  order: number
  component: LazyExoticComponent<ComponentType>
  isVisible?: () => boolean
}

export const SETTINGS_PAGES: readonly SettingsPageDefinition[] = [
  { id: 'app', labelKey: 'settings.app.title', descriptionKey: 'settings.app.description', icon: SETTINGS_ICONS.app, order: 10, component: lazy(() => import('./pages/AppSettingsPage')) },
  { id: 'ai', labelKey: 'settings.ai.title', descriptionKey: 'settings.ai.description', icon: SETTINGS_ICONS.ai, order: 20, component: lazy(() => import('./pages/AiSettingsPage')) },
  { id: 'appearance', labelKey: 'settings.appearance.title', descriptionKey: 'settings.appearance.description', icon: SETTINGS_ICONS.appearance, order: 30, component: lazy(() => import('./pages/AppearanceSettingsPage')) },
  { id: 'input', labelKey: 'settings.input.title', descriptionKey: 'settings.input.description', icon: SETTINGS_ICONS.input, order: 40, component: lazy(() => import('./pages/InputSettingsPage')) },
  { id: 'workspace', labelKey: 'settings.workspace.title', descriptionKey: 'settings.workspace.description', icon: SETTINGS_ICONS.workspace, order: 50, component: lazy(() => import('./pages/WorkspaceSettingsPage')) },
  { id: 'permissions', labelKey: 'settings.permissions.title', descriptionKey: 'settings.permissions.description', icon: SETTINGS_ICONS.permissions, order: 60, component: lazy(() => import('./pages/PermissionsSettingsPage')) },
  { id: 'labels', labelKey: 'settings.labels.title', descriptionKey: 'settings.labels.description', icon: SETTINGS_ICONS.labels, order: 70, component: lazy(() => import('./pages/LabelsSettingsPage')) },
  { id: 'messaging', labelKey: 'settings.messaging.title', descriptionKey: 'settings.messaging.description', icon: SETTINGS_ICONS.messaging, order: 80, component: lazy(() => import('./pages/MessagingSettingsPage')) },
  { id: 'server', labelKey: 'settings.server.title', descriptionKey: 'settings.server.description', icon: SETTINGS_ICONS.server, order: 90, component: lazy(() => import('./pages/ServerSettingsPage')), isVisible: () => FEATURE_FLAGS.embeddedServer },
  { id: 'shortcuts', labelKey: 'settings.shortcuts.title', descriptionKey: 'settings.shortcuts.description', icon: SETTINGS_ICONS.shortcuts, order: 100, component: lazy(() => import('./pages/ShortcutsPage')) },
  { id: 'preferences', labelKey: 'settings.preferences.title', descriptionKey: 'settings.preferences.description', icon: SETTINGS_ICONS.preferences, order: 110, component: lazy(() => import('./pages/PreferencesPage')) },
]

export function getVisibleSettingsPages(): readonly SettingsPageDefinition[] {
  return SETTINGS_PAGES.filter(page => page.isVisible?.() ?? true).sort((left, right) => left.order - right.order)
}

export function getSettingsPage(id: SettingsSubpage): SettingsPageDefinition | null {
  return getVisibleSettingsPages().find(page => page.id === id) ?? null
}
