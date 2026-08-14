import { describe, expect, it } from 'bun:test'
import {
  BUILT_IN_APPS,
  DEFAULT_AGENT_PRESENTATION_STATE,
  clampAgentPanelWidth,
  getDefaultAgentPanelWidth,
  reduceAgentPresentation,
  type AgentPresentationState,
  type AppDefinition,
} from '../app-platform'

describe('app platform shared model', () => {
  it('starts on Home with Agent hidden and panel as last mode', () => {
    expect(DEFAULT_AGENT_PRESENTATION_STATE).toEqual({
      visible: false,
      lastMode: 'panel',
      panelWidthPx: 360,
    })
  })

  it('follows Agent visibility and presentation transitions', () => {
    const initial = { ...DEFAULT_AGENT_PRESENTATION_STATE, panelWidthPx: 560 }
    const panel = reduceAgentPresentation(initial, { type: 'agent-icon' })
    const full = reduceAgentPresentation(panel, { type: 'header-toggle' })
    const hiddenFull = reduceAgentPresentation(full, { type: 'agent-icon' })

    expect(panel).toEqual({ visible: true, lastMode: 'panel', panelWidthPx: 560 })
    expect(full).toEqual({ visible: true, lastMode: 'full', panelWidthPx: 560 })
    expect(hiddenFull).toEqual({ visible: false, lastMode: 'full', panelWidthPx: 560 })
    expect(reduceAgentPresentation(hiddenFull, { type: 'agent-icon' }).lastMode).toBe('full')
    expect(reduceAgentPresentation(full, { type: 'panel-close' })).toEqual(full)
    expect(reduceAgentPresentation(panel, { type: 'panel-close' }).visible).toBe(false)
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
      visible: true,
      lastMode: 'full',
      panelWidthPx: 480,
    }

    expect(app.instancePolicy).toBe('single')
    expect(state.lastMode).toBe('full')
  })
})
