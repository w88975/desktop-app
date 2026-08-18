import { describe, expect, it } from 'bun:test'
import {
  BUILT_IN_APPS,
  clampAgentPanelWidth,
  deriveAgentPresentationState,
  getActiveContentTabId,
  getDefaultAgentPanelWidth,
  type AgentPresentationState,
  type AppDefinition,
} from '../app-platform'

describe('app platform shared model', () => {
  it('derives Agent presentation and underlying content from explicit shell state', () => {
    const base = {
      activeTarget: { kind: 'home' as const },
      tabs: [],
      agentPanelVisible: false,
      previousContentTabId: null,
      agentPanelWidthPx: 560,
    }
    expect(deriveAgentPresentationState(base)).toEqual({ presentation: 'hidden', panelWidthPx: 560 })
    expect(deriveAgentPresentationState({ ...base, agentPanelVisible: true })).toEqual({ presentation: 'panel', panelWidthPx: 560 })
    expect(deriveAgentPresentationState({ ...base, activeTarget: { kind: 'agent' } })).toEqual({ presentation: 'full', panelWidthPx: 560 })
    expect(getActiveContentTabId(base)).toBeNull()
  })

  it('defaults panel to 40% and clamps split width', () => {
    expect(getDefaultAgentPanelWidth(1400)).toBe(560)
    expect(clampAgentPanelWidth(1400, 200)).toBe(360)
    expect(clampAgentPanelWidth(1400, 1200)).toBe(980)
    expect(clampAgentPanelWidth(800, 700)).toBe(440)
  })

  it('registers TODO placeholder as singleton with no capabilities', () => {
    expect(BUILT_IN_APPS.TODO_PLACEHOLDER).toEqual({
      id: 'todo-placeholder',
      title: 'TODO',
      entry: 'app-host.html?appId=todo-placeholder',
      instancePolicy: 'single',
      capabilities: [],
    })
  })

  it('keeps manifest and Agent state unions narrow', () => {
    const app: AppDefinition = BUILT_IN_APPS.TODO_PLACEHOLDER
    const state: AgentPresentationState = {
      presentation: 'full',
      panelWidthPx: 480,
    }

    expect(app.instancePolicy).toBe('single')
    expect(state.presentation).toBe('full')
  })
})
