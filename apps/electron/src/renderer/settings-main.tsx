import React from 'react'
import ReactDOM from 'react-dom/client'
import { Provider as JotaiProvider } from 'jotai'
import { PlatformProvider, TooltipProvider } from '@craft-agent/ui'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { setupI18n } from '@craft-agent/shared/i18n'
import { ThemeProvider } from './context/ThemeContext'
import { ActionRegistryProvider } from './actions'
import { DismissibleLayerProvider } from './context/DismissibleLayerContext'
import { ModalProvider } from './context/ModalContext'
import { EscapeInterruptProvider } from './context/EscapeInterruptContext'
import { Toaster } from './components/ui/sonner'
import SettingsApp from './features/settings/SettingsApp'
import { SettingsRuntimeProvider, useSettingsRuntime } from './features/settings/SettingsRuntimeContext'
import './index.css'
import './settings.css'

setupI18n([LanguageDetector, initReactI18next])

function SettingsRoot() {
  const { workspaceId } = useSettingsRuntime()
  const platformActions = React.useMemo(() => ({
    onOpenFile: (path: string) => { void window.electronAPI.openFile(path) },
    onOpenUrl: (url: string) => { void window.electronAPI.openUrl(url) },
    onOpenFileExternal: (path: string) => { void window.electronAPI.openFile(path) },
    onReadFile: (path: string) => window.electronAPI.readFile(path),
    onReadFileDataUrl: (path: string) => window.electronAPI.readFileDataUrl(path),
    onReadFileBinary: (path: string) => window.electronAPI.readFileBinary(path),
    onRevealInFinder: (path: string) => { void window.electronAPI.showInFolder(path) },
    fileManagerName: '文件管理器',
    onSetTrafficLightsVisible: () => {},
  }), [])
  return (
    <PlatformProvider actions={platformActions}>
      <ThemeProvider activeWorkspaceId={workspaceId}>
        <ActionRegistryProvider>
          <DismissibleLayerProvider>
            <ModalProvider>
              <TooltipProvider delayDuration={0}>
                <EscapeInterruptProvider>
                  <SettingsApp />
                  <Toaster />
                </EscapeInterruptProvider>
              </TooltipProvider>
            </ModalProvider>
          </DismissibleLayerProvider>
        </ActionRegistryProvider>
      </ThemeProvider>
    </PlatformProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <JotaiProvider>
      <SettingsRuntimeProvider>
        <SettingsRoot />
      </SettingsRuntimeProvider>
    </JotaiProvider>
  </React.StrictMode>,
)
