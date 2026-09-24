import type { Api } from '../account/api'
import type { ReminderPort } from '../account/controller'
import type { KeyValue } from '../account/storage'

/** The learner's reminder choices on this browser (a subscription belongs to one browser). */
export const REMINDER_KEY = 'wordado.reminder'
/** 19:00 local. Tuning (§15). */
export const DEFAULT_REMINDER_MINUTE = 19 * 60

export interface ReminderPrefs {
  /** Minute of the local day, 0–1439. */
  readonly minute: number
  /** The evening nudge when the streak needs today (spec §8.11). */
  readonly streakNudge: boolean
}

export type ReminderSupport = 'supported' | 'needs-install' | 'unsupported' | 'denied'

/** A push subscription, as far as the service uses it. */
export interface PushSub {
  readonly endpoint: string
  toJSON(): { keys?: { p256dh?: string; auth?: string } }
  unsubscribe(): Promise<boolean>
}

/** The browser's push machinery; `browserPushPlatform()` is the real one. */
export interface PushPlatform {
  supported(): boolean
  /** iOS delivers Web Push only to an installed app (spec §8.11). */
  needsInstall(): boolean
  permission(): NotificationPermission
  requestPermission(): Promise<NotificationPermission>
  subscription(): Promise<PushSub | null>
  subscribe(applicationServerKey: string): Promise<PushSub>
}

export interface ReminderDeps {
  readonly api: Api
  readonly platform: PushPlatform
  readonly storage: KeyValue
  tzOffsetMin(): number
  language(): 'bg' | 'en'
}

const isPrefs = (v: unknown): v is ReminderPrefs =>
  typeof v === 'object' &&
  v !== null &&
  Number.isInteger((v as ReminderPrefs).minute) &&
  (v as ReminderPrefs).minute >= 0 &&
  (v as ReminderPrefs).minute <= 1439 &&
  typeof (v as ReminderPrefs).streakNudge === 'boolean'

/**
 * Opt-in reminders (spec §8.11). The server sends them (plan 5); this
 * subscribes the browser and keeps the server's copy current: the offset and
 * language travel with every send, so a trip or a change of language follows
 * the learner.
 */
export class ReminderService implements ReminderPort {
  constructor(private readonly deps: ReminderDeps) {}

  prefs(): ReminderPrefs | null {
    try {
      const raw = this.deps.storage.getItem(REMINDER_KEY)
      const value: unknown = raw === null ? null : JSON.parse(raw)
      return isPrefs(value) ? value : null
    } catch {
      return null
    }
  }

  private save(prefs: ReminderPrefs | null): void {
    try {
      if (prefs === null) this.deps.storage.removeItem(REMINDER_KEY)
      else this.deps.storage.setItem(REMINDER_KEY, JSON.stringify(prefs))
    } catch {
      // Refused storage: reminders then last until the page closes.
    }
  }

  support(): ReminderSupport {
    const { platform } = this.deps
    if (!platform.supported()) return platform.needsInstall() ? 'needs-install' : 'unsupported'
    if (platform.needsInstall()) return 'needs-install'
    return platform.permission() === 'denied' ? 'denied' : 'supported'
  }

  private async send(sub: PushSub, prefs: ReminderPrefs): Promise<void> {
    const keys = sub.toJSON().keys ?? {}
    await this.deps.api.putSubscription({
      endpoint: sub.endpoint,
      keys: { p256dh: keys.p256dh ?? '', auth: keys.auth ?? '' },
      reminderMinute: prefs.minute,
      tzOffsetMin: this.deps.tzOffsetMin(),
      language: this.deps.language(),
      streakNudge: prefs.streakNudge,
    })
  }

  /**
   * Turns reminders on, or changes their time or nudge. Needs a gesture: a
   * default permission is asked first, before the server is asked for a key,
   * so the request stays inside the browser's user-activation window (iOS
   * WebKit, Firefox refuse a prompt raised after an `await` of something
   * else). A dismissed prompt (still 'default' afterwards) is neither
   * granted nor refused, so it is reported as 'dismissed', not 'denied'.
   */
  async enable(prefs: ReminderPrefs): Promise<'on' | 'denied' | 'dismissed' | 'unavailable'> {
    const { api, platform } = this.deps
    let permission = platform.permission()
    if (permission === 'default') {
      permission = await platform.requestPermission()
      if (permission === 'default') return 'dismissed'
    }
    if (permission !== 'granted') return 'denied'
    const key = await api.pushPublicKey()
    if (key === null) return 'unavailable'
    const sub = (await platform.subscription()) ?? (await platform.subscribe(key))
    await this.send(sub, prefs)
    this.save(prefs)
    return 'on'
  }

  /** At launch and when the language changes (plan 5 contract). Quiet: nothing is asked of the learner. */
  async refresh(): Promise<void> {
    const prefs = this.prefs()
    if (prefs === null || this.deps.platform.permission() !== 'granted') return
    const sub = await this.deps.platform.subscription()
    if (sub) await this.send(sub, prefs)
  }

  async disable(): Promise<void> {
    await this.stop({ server: true })
  }

  /** Task 7's ReminderPort: on sign-out the server is told; after deletion it has nothing left to forget. */
  async stop(options: { readonly server: boolean }): Promise<void> {
    const sub = await this.deps.platform.subscription().catch(() => null)
    if (sub) {
      if (options.server) await this.deps.api.deleteSubscription(sub.endpoint).catch(() => undefined)
      await sub.unsubscribe().catch(() => false)
    }
    this.save(null)
  }
}

/** What settings uses; its tests pass a fake. */
export type ReminderActions = Pick<ReminderService, 'prefs' | 'support' | 'enable' | 'disable'>

/** The VAPID key, from base64url to the bytes `PushManager.subscribe` takes. */
export function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64url.length / 4) * 4, '=')
  const binary = atob(base64)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** The real browser, through the registered service worker. */
export function browserPushPlatform(): PushPlatform {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
  const registration = () => navigator.serviceWorker.ready
  return {
    supported: () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window,
    needsInstall: () => ios && !standalone,
    permission: () => ('Notification' in window ? Notification.permission : 'denied'),
    requestPermission: () => Notification.requestPermission(),
    subscription: async () => (await registration()).pushManager.getSubscription(),
    subscribe: async (key) => (await registration()).pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }),
  }
}
