import type { WebContents } from 'electron'
import type { BrowserInstanceInfo } from '@craft-agent/shared/protocol'

/** Shell-side presentation contract used by BrowserPaneManager's tab backend. */
export interface BrowserTabHost {
  readonly tabId: string
  show(): void
  hide(): void
  close(): void
  update(info: BrowserInstanceInfo, agentControlLabel?: string): void
  setViewport(width: number, height: number): { width: number; height: number }
  getViewport(): { width: number; height: number }
}

export interface BrowserTabBackend {
  createManualBrowser(workspaceId: string): string
  attachTabWebContents(instanceId: string, contents: WebContents, host: BrowserTabHost): void
  detachTabWebContents(instanceId: string, webContentsId: number): void
  setTabVisibility(instanceId: string, visible: boolean): void
}
