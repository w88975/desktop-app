import type { SurfaceKind, SurfaceRegistration } from '../shared/app-platform'

export class SurfaceRegistry {
  private readonly surfaces = new Map<number, SurfaceRegistration>()

  register(registration: SurfaceRegistration): void {
    const existing = this.surfaces.get(registration.webContentsId)
    if (existing) {
      throw new Error(
        `Surface ${registration.webContentsId} already registered as ${existing.kind}`
      )
    }

    if (registration.kind === 'shell' && registration.webContentsId !== registration.shellWebContentsId) {
      throw new Error('Shell surface must own itself')
    }

    if (registration.kind !== 'app' && registration.tabId !== undefined) {
      throw new Error(`Only app surfaces may declare tabId`)
    }

    if (registration.kind === 'app' && !registration.tabId) {
      throw new Error('App surface requires tabId')
    }
    if (registration.kind !== 'app' && registration.appId !== undefined) {
      throw new Error(`Only app surfaces may declare appId`)
    }
    if (registration.kind === 'app' && !registration.appId) {
      throw new Error('App surface requires appId')
    }

    this.surfaces.set(registration.webContentsId, { ...registration })
  }

  unregister(webContentsId: number): boolean {
    return this.surfaces.delete(webContentsId)
  }

  unregisterShell(shellWebContentsId: number): number {
    let removed = 0
    for (const [webContentsId, surface] of this.surfaces) {
      if (surface.shellWebContentsId !== shellWebContentsId) continue
      this.surfaces.delete(webContentsId)
      removed++
    }
    return removed
  }

  get(webContentsId: number): SurfaceRegistration | null {
    return this.surfaces.get(webContentsId) ?? null
  }

  getWorkspaceId(webContentsId: number): string | null {
    return this.surfaces.get(webContentsId)?.workspaceId ?? null
  }

  getShellWebContentsId(webContentsId: number): number | null {
    return this.surfaces.get(webContentsId)?.shellWebContentsId ?? null
  }

  getForShell(shellWebContentsId: number): SurfaceRegistration[] {
    return Array.from(this.surfaces.values()).filter(
      surface => surface.shellWebContentsId === shellWebContentsId
    )
  }

  getByKind(shellWebContentsId: number, kind: SurfaceKind): SurfaceRegistration[] {
    return this.getForShell(shellWebContentsId).filter(surface => surface.kind === kind)
  }

  updateWorkspace(shellWebContentsId: number, workspaceId: string): number {
    let updated = 0
    for (const [webContentsId, surface] of this.surfaces) {
      if (surface.shellWebContentsId !== shellWebContentsId) continue
      this.surfaces.set(webContentsId, { ...surface, workspaceId })
      updated++
    }
    return updated
  }
}
