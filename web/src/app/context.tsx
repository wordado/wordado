import type { ClientEnv } from '@wordado/client-data'
import { createContext, useContext, type ReactNode } from 'react'
import type { AudioPort } from '../content/audio'
import type { Backend } from '../storage/protocol'

/** What the screens need beside the Client. */
export interface AppServices {
  readonly env: ClientEnv
  readonly audio: AudioPort
  /** Which storage the database opened on (spec §9.1): memory shows a banner. */
  readonly backend: Backend
  /**
   * Called when a run ends: fetches the clips of the words about to be met
   * (spec §9.3), and asks once for persistent storage (spec §9.1) — after the
   * learner has studied, because some browsers ask the learner to allow it.
   */
  afterRun(): void
}

const AppContext = createContext<AppServices | null>(null)

export function AppProvider(props: { readonly value: AppServices; readonly children?: ReactNode }) {
  return <AppContext.Provider value={props.value}>{props.children}</AppContext.Provider>
}

export function useApp(): AppServices {
  const value = useContext(AppContext)
  if (!value) throw new Error('useApp must be used inside an AppProvider')
  return value
}
