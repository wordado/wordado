import type { ClientEnv } from '@wordado/client-data'
import { createContext, useContext, type ReactNode } from 'react'
import type { Api } from '../account/api'
import type { AccountActions } from '../account/controller'
import type { AccountRecord } from '../account/storage'
import type { AudioPort } from '../content/audio'
import type { ReminderActions } from '../reminders/reminders'
import type { Backend } from '../storage/protocol'
import type { LifecyclePort } from './lifecycle'

/** What the screens need beside the Client. */
export interface AppServices {
  readonly env: ClientEnv
  readonly audio: AudioPort
  /** Which storage the database opened on (spec §9.1): memory shows a banner. */
  readonly backend: Backend
  /** The signed-in learner, or null in the demo. */
  readonly account: AccountRecord | null
  /** Sign-in, sign-out, deletion, leaving the demo (spec §8.6). */
  readonly accounts: AccountActions
  /** The server's endpoints beside sync. */
  readonly api: Api
  /** Opt-in reminders on this device (spec §8.11). */
  readonly reminders: ReminderActions
  /** Installation and updates (spec §9.1). */
  readonly lifecycle: LifecyclePort
  /**
   * Called when a run ends: fetches the clips of the words about to be met
   * (spec §9.3), flushes the outbox (spec §9.1), and asks once for persistent
   * storage (spec §9.1) — after the learner has studied, because some
   * browsers ask the learner to allow it.
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
