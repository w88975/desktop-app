import React from 'react'
import { Provider as JotaiProvider, useAtomValue } from 'jotai'
import App from './App'
import { ThemeProvider } from './context/ThemeContext'
import { windowWorkspaceIdAtom } from './atoms/sessions'
import { Toaster } from '@/components/ui/sonner'
import { AgentPresentationProvider } from './context/AgentPresentationContext'
import { AuthProvider } from './context/AuthContext'
import type { AgentPresentation } from '../shared/app-platform'

function AgentThemeRoot({ showToaster }: { showToaster: boolean }) {
  const workspaceId = useAtomValue(windowWorkspaceIdAtom)
  return (
    <ThemeProvider activeWorkspaceId={workspaceId}>
      <App />
      {showToaster && <Toaster />}
    </ThemeProvider>
  )
}

export function AgentRendererRoot({
  forcePresentation,
  showToaster = true,
}: {
  forcePresentation?: AgentPresentation
  showToaster?: boolean
}) {
  return (
    <JotaiProvider>
      <AuthProvider>
        <AgentPresentationProvider forcePresentation={forcePresentation}>
          <AgentThemeRoot showToaster={showToaster} />
        </AgentPresentationProvider>
      </AuthProvider>
    </JotaiProvider>
  )
}
