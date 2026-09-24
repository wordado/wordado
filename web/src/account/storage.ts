/** The demo's database file (6a decision of 2026-09-24). */
export const DEMO_FILE = 'demo'
/** Which account this device is signed in to: the one record that decides which file opens. */
export const ACCOUNT_KEY = 'wordado.account'
/** The age gate's country, carried across the Google redirect in this tab only. */
export const SIGNIN_KEY = 'wordado.signin'

export type KeyValue = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export interface AccountRecord {
  readonly userId: string
  readonly email: string
  /**
   * The demo was attached to this account but not every answer reached the
   * server yet: `Boot` pushes it before opening the learner's file (spec §8.6).
   */
  readonly carryOver?: boolean
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
  ['boolean', 'undefined'].includes(typeof (v as AccountRecord).carryOver)

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

export interface PendingSignIn {
  readonly country: string | null
}

const isPending = (v: unknown): v is PendingSignIn =>
  typeof v === 'object' && v !== null && ((v as PendingSignIn).country === null || typeof (v as PendingSignIn).country === 'string')

export function pendingSignIn(storage: KeyValue = browserStorage('sessionStorage')) {
  return jsonKey(storage, SIGNIN_KEY, isPending)
}

/** A learner's own database file: a name safe for OPFS and IndexedDB whatever the server's id looks like. */
export function learnerFile(userId: string): string {
  return `user-${userId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64)}`
}
