import { useClient } from '@wordado/client-data'
import { useEffect } from 'react'
import { useRoute, type Route } from '../router'
import type { Backend } from '../storage/protocol'
import { useApp } from './context'

/**
 * Screens whose state lives only in memory until they are left: a study or practice run (its queue and place,
 * and its end screen), a matching board, the placement test, the sign-in (the email, the code, the step), and the
 * native language being changed.
 */
const BUSY: ReadonlySet<Route['name']> = new Set(['study', 'practice-words', 'matching', 'placement', 'signin', 'native-language'])

/** Where the caret is in something the learner types or picks from. */
const TYPING = 'textarea, select, [contenteditable]:not([contenteditable="false"]), input:not([type="checkbox"], [type="radio"], [type="button"], [type="submit"])'

export interface Surroundings {
  readonly route: Route['name']
  /** The first-run setup is showing (its step and choices are in memory). */
  readonly setup: boolean
  readonly backend: Backend
  /** A language's pack is being installed. */
  readonly installingPack: boolean
  /** A push or a pull is in flight. */
  readonly syncing: boolean
  /** A notice about the account is showing, not yet dismissed (it is kept nowhere). */
  readonly notice: boolean
  readonly document: Pick<Document, 'querySelector' | 'activeElement'>
}

/**
 * Whether reloading the page now would cost the learner nothing (spec §9.1): nothing in progress, nothing open,
 * nothing being typed, nothing held only in memory. An in-memory database (spec §9.1's last fallback) is all
 * memory, so it is never safe there: that learner updates from the banner.
 */
export function safeToUpdate(s: Surroundings): boolean {
  if (s.setup || s.backend === 'memory' || BUSY.has(s.route)) return false
  if (s.installingPack || s.syncing || s.notice) return false
  // A dialog, an open menu (the masthead's, a word's on the path), or a field whose value was refused and not yet corrected.
  if (s.document.querySelector('dialog[open], .masthead [aria-expanded="true"], .word-menu-button[aria-expanded="true"], [aria-invalid="true"]')) return false
  return !s.document.activeElement?.matches(TYPING)
}

/**
 * The shell's part of the automatic update (spec §9.1): while the app is open in this tab, tells the lifecycle
 * when a reload is safe, has it look again whenever the screen changes, and passes on that the server refused
 * this build. Unmounted (the app closed, or open in another tab), no reload is safe.
 */
export function useUpdateSafety(setup: boolean): void {
  const client = useClient()
  const route = useRoute().name
  const { lifecycle, backend, packs, accounts } = useApp()
  useEffect(
    () =>
      lifecycle.watchSafety(() =>
        safeToUpdate({
          route,
          setup,
          backend,
          installingPack: packs.store.get().phase === 'downloading',
          syncing: client.snapshot.sync.phase !== 'idle',
          notice: accounts.store.get().notice !== null,
          document,
        }),
      ),
    [lifecycle, client, route, setup, backend, packs, accounts],
  )
  useEffect(() => {
    const note = () => {
      if (client.snapshot.sync.upgradeRequired) lifecycle.markAppTooOld()
    }
    note()
    return client.store.subscribe(note)
  }, [lifecycle, client])
}

/** While `busy`, no automatic update: work is in flight that a reload would cut short. */
export function useUpdateHold(busy: boolean): void {
  const { lifecycle } = useApp()
  useEffect(() => (busy ? lifecycle.hold() : undefined), [lifecycle, busy])
}
