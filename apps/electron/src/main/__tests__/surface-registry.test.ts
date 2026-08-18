import { describe, expect, it } from 'bun:test'
import { SurfaceRegistry } from '../surface-registry'

describe('SurfaceRegistry', () => {
  it('resolves child surfaces to shell and workspace', () => {
    const registry = new SurfaceRegistry()
    registry.register({
      webContentsId: 1,
      shellWebContentsId: 1,
      workspaceId: 'ws-1',
      kind: 'shell',
    })
    registry.register({
      webContentsId: 2,
      shellWebContentsId: 1,
      workspaceId: 'ws-1',
      kind: 'agent',
    })
    registry.register({
      webContentsId: 3,
      shellWebContentsId: 1,
      workspaceId: 'ws-1',
      kind: 'home',
    })
    registry.register({
      webContentsId: 4,
      shellWebContentsId: 1,
      workspaceId: 'ws-1',
      kind: 'app',
      tabId: 'todo-tab',
      appId: 'todo-placeholder',
    })

    expect(registry.getShellWebContentsId(4)).toBe(1)
    expect(registry.getWorkspaceId(2)).toBe('ws-1')
    expect(registry.getForShell(1)).toHaveLength(4)
    expect(registry.getByKind(1, 'app')[0]?.tabId).toBe('todo-tab')
  })

  it('updates workspace for every surface owned by shell', () => {
    const registry = new SurfaceRegistry()
    registry.register({ webContentsId: 1, shellWebContentsId: 1, workspaceId: 'old', kind: 'shell' })
    registry.register({ webContentsId: 2, shellWebContentsId: 1, workspaceId: 'old', kind: 'agent' })
    registry.register({ webContentsId: 9, shellWebContentsId: 9, workspaceId: 'other', kind: 'shell' })

    expect(registry.updateWorkspace(1, 'new')).toBe(2)
    expect(registry.getWorkspaceId(1)).toBe('new')
    expect(registry.getWorkspaceId(2)).toBe('new')
    expect(registry.getWorkspaceId(9)).toBe('other')
  })

  it('removes shell and all owned child surfaces together', () => {
    const registry = new SurfaceRegistry()
    registry.register({ webContentsId: 1, shellWebContentsId: 1, workspaceId: 'ws', kind: 'shell' })
    registry.register({ webContentsId: 2, shellWebContentsId: 1, workspaceId: 'ws', kind: 'home' })

    expect(registry.unregisterShell(1)).toBe(2)
    expect(registry.get(1)).toBeNull()
    expect(registry.get(2)).toBeNull()
  })

  it('rejects duplicate and malformed registrations', () => {
    const registry = new SurfaceRegistry()
    registry.register({ webContentsId: 1, shellWebContentsId: 1, workspaceId: 'ws', kind: 'shell' })

    expect(() => registry.register({
      webContentsId: 1,
      shellWebContentsId: 1,
      workspaceId: 'ws',
      kind: 'shell',
    })).toThrow('Surface 1 already registered as shell')

    expect(() => registry.register({
      webContentsId: 2,
      shellWebContentsId: 1,
      workspaceId: 'ws',
      kind: 'app',
    })).toThrow('App surface requires tabId')
  })
})
