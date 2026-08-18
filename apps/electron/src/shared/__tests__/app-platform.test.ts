import { describe, expect, it } from 'bun:test'
import {
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

  it('keeps manifest and Agent state unions narrow', () => {
    const app: AppDefinition = {
      id: 'todo-placeholder',
      title: 'TODO',
      entry: 'hxsy-app://todo-placeholder/index.html',
      kind: 'external',
      instancePolicy: 'single',
      capabilities: [],
    }
    const state: AgentPresentationState = {
      presentation: 'full',
      panelWidthPx: 480,
    }

    expect(app.instancePolicy).toBe('single')
    expect(state.presentation).toBe('full')
  })
})
