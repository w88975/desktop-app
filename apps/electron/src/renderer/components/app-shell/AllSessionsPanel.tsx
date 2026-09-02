import type * as React from 'react'
import { SessionList } from './SessionList'

export type AllSessionsPanelProps = React.ComponentProps<typeof SessionList> & {
  /** Optional header lets compact presentations reuse list without changing Full Agent markup. */
  header?: React.ReactNode
}

/** Shared All Sessions surface used by Full Agent navigator and docked Agent Panel. */
export function AllSessionsPanel({ header, ...sessionListProps }: AllSessionsPanelProps) {
  if (!header) return <SessionList {...sessionListProps} />

  return (
    <div className="flex h-full min-h-0 flex-col">
      {header}
      <SessionList {...sessionListProps} />
    </div>
  )
}
