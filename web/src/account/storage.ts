/** The demo's database file (6a decision of 2026-09-24). */
export const DEMO_FILE = 'demo'
/** Which account this device is signed in to: the one record that decides which file opens. */
export const ACCOUNT_KEY = 'wordado.account'

export type KeyValue = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export interface AccountRecord {
  readonly userId: string
  readonly email: string
  /**
   * The demo was attached to this account but not every answer reached the
   * server yet: `Boot` pushes it before opening the learner's file (spec §8.6).
   */
  readonly carryOver?: boolean
  /**
   * The demo was carried into this account and its learner has not been asked for a level yet. The app asks once,
   * when the course it opens has more than one level (`LevelAsk`): the trial's level comes preselected, so the learner
   * can confirm it or take the test again on the whole course (owner's decision, 2026-10-12).
   */
  readonly askLevel?: boolean
}

export interface AccountStorage {
  read(): AccountRecord | null
  save(record: AccountRecord): void
  clear(): void
}

/** Storage that lasts as long as the page, for a browser that refuses the real thing. */
export function memoryStorage(): KeyValue {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    },
    removeItem: (key) => {
      values.delete(key)
    },
  }
}

/** A key of `storage` holding JSON; a refused or damaged value reads as absent. */
function jsonKey<T>(storage: KeyValue, key: string, valid: (value: unknown) => value is T) {
  return {
    read(): T | null {
      try {
        const raw = storage.getItem(key)
        if (raw === null) return null
        const value: unknown = JSON.parse(raw)
        return valid(value) ? value : null
      } catch {
        return null
      }
    },
    save(value: T): void {
      try {
        storage.setItem(key, JSON.stringify(value))
      } catch {
        // A private window may refuse storage: the sign-in then lasts for this visit.
      }
    },
    clear(): void {
      try {
        storage.removeItem(key)
      } catch {
        // Nothing was stored.
      }
    },
  }
}

const isRecord = (v: unknown): v is AccountRecord =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as AccountRecord).userId === 'string' &&
  typeof (v as AccountRecord).email === 'string' &&
  ['boolean', 'undefined'].includes(typeof (v as AccountRecord).carryOver) &&
  ['boolean', 'undefined'].includes(typeof (v as AccountRecord).askLevel)

/** The browser's storage of that kind, or page-lifetime storage when the browser refuses it. */
export function browserStorage(kind: 'localStorage' | 'sessionStorage'): KeyValue {
  try {
    return window[kind]
  } catch {
    return memoryStorage()
  }
}

export function accountStorage(storage: KeyValue = browserStorage('localStorage')): AccountStorage {
  return jsonKey(storage, ACCOUNT_KEY, isRecord)
}

/** That this device asked a visitor for a level (spec 2026-10-12 §4.6). */
export const TRIAL_LEVEL_ASKED_KEY = 'wordado.trialLevelAsked'

export interface TrialLevelMark {
  read(): boolean
  set(): void
}

/**
 * Whether a visitor on this device has been through the level step: in the first-run setup, or on the home screen
 * when the trial pack came to a device that had finished its setup on the bundled sample (`LevelAsk`). It is never
 * cleared: leaving the demo, signing out and deleting an account all start a new demo, which opens in the setup.
 * Without `storage`, the browser's own, reached at each call: where the browser refuses it, the mark reads as set
 * rather than falling back to a memory that each load would forget (#234).
 */
export function trialLevelMark(storage?: KeyValue): TrialLevelMark {
  const store = (): KeyValue => storage ?? window.localStorage
  return {
    read(): boolean {
      try {
        return store().getItem(TRIAL_LEVEL_ASKED_KEY) === '1'
      } catch {
        // A private window may refuse storage: asked, or the question would come back on every load.
        return true
      }
    },
    set(): void {
      try {
        store().setItem(TRIAL_LEVEL_ASKED_KEY, '1')
      } catch {
        // Refused: `read` answers as if it were set.
      }
    },
  }
}

/** The step a visitor's first-run setup has reached, once its words are installed (#234). */
export const SETUP_STEP_KEY = 'wordado.setupStep'

export interface SetupStepMark {
  read(): string | null
  set(step: string): void
  clear(): void
}

/**
 * Where a visitor's first-run setup stands while it is not over: the step shown, set from the step after the language
 * on and cleared when the setup ends. The language's words are installed by then, so a reload opens the app without
 * the setup (`Boot`); this says that it is owed, and where. Without `storage`, the browser's own: where the browser
 * refuses it, nothing is remembered and a reload opens the app as before.
 */
export function setupStepMark(storage?: KeyValue): SetupStepMark {
  const store = (): KeyValue => storage ?? window.localStorage
  return {
    read(): string | null {
      try {
        return store().getItem(SETUP_STEP_KEY)
      } catch {
        return null
      }
    },
    set(step: string): void {
      try {
        store().setItem(SETUP_STEP_KEY, step)
      } catch {
        // Refused: a reload opens the app, as before.
      }
    },
    clear(): void {
      try {
        store().removeItem(SETUP_STEP_KEY)
      } catch {
        // Nothing was stored.
      }
    },
  }
}

/** A learner's own database file: a name safe for OPFS and IndexedDB whatever the server's id looks like. */
export function learnerFile(userId: string): string {
  return `user-${userId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64)}`
}
