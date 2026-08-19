import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import type { AuthState } from '../shared/auth'
import { AUTH_CHANNELS } from '../shared/auth'

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

export class AuthWindowController {
  private window: BrowserWindow | null = null
  private allowClose = false

  show(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) {
      if (this.window.isMinimized()) this.window.restore()
      this.window.show()
      this.window.focus()
      return this.window
    }

    this.allowClose = false
    const isMac = process.platform === 'darwin'
    const authWindow = new BrowserWindow({
      width: 1080,
      height: 680,
      minWidth: 800,
      minHeight: 600,
      center: true,
      show: false,
      title: '华小竹',
      backgroundColor: '#f9f9fb',
      ...(isMac && {
        titleBarStyle: 'hiddenInset' as const,
        trafficLightPosition: { x: 18, y: 16 },
      }),
      ...(!isMac && { autoHideMenuBar: true }),
      webPreferences: {
        preload: join(__dirname, 'auth-preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    })
    this.window = authWindow

    authWindow.once('ready-to-show', () => authWindow.show())
    authWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    authWindow.webContents.on('will-navigate', event => event.preventDefault())
    authWindow.on('closed', () => {
      if (this.window === authWindow) this.window = null
      if (!this.allowClose) app.quit()
    })

    if (VITE_DEV_SERVER_URL) {
      authWindow.loadURL(new URL('/login.html', VITE_DEV_SERVER_URL).toString())
    } else {
      authWindow.loadFile(join(__dirname, 'renderer/login.html'))
    }
    return authWindow
  }

  focus(): boolean {
    if (!this.window || this.window.isDestroyed()) return false
    if (this.window.isMinimized()) this.window.restore()
    this.window.show()
    this.window.focus()
    return true
  }

  isSender(webContentsId: number): boolean {
    return !!this.window && !this.window.isDestroyed() && this.window.webContents.id === webContentsId
  }

  sendState(state: AuthState): void {
    if (!this.window || this.window.isDestroyed()) return
    this.window.webContents.send(AUTH_CHANNELS.STATE_CHANGED, state)
  }

  dismiss(): void {
    if (!this.window || this.window.isDestroyed()) return
    this.allowClose = true
    this.window.destroy()
    this.window = null
  }
}
