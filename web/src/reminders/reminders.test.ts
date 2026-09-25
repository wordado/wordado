import { describe, expect, it } from 'vitest'
import { memoryStorage } from '../account/storage'
import { fakeApi } from '../test/fakeApi'
import { DEFAULT_REMINDER_MINUTE, ReminderService, type PushPlatform, type PushSub } from './reminders'

/** A browser's push machinery, as far as the service uses it. */
function platform(over: Partial<PushPlatform> = {}) {
  let permission: NotificationPermission = 'default'
  let current: PushSub | null = null
  const log: string[] = []
  const p: PushPlatform & { log: string[] } = {
    log,
    supported: () => true,
    needsInstall: () => false,
    permission: () => permission,
    requestPermission: async () => {
      permission = 'granted'
      return permission
    },
    subscription: async () => current,
    subscribe: async (key) => {
      log.push(`subscribe ${key.length}`)
      current = {
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
        toJSON: () => ({ keys: { p256dh: 'p', auth: 'a' } }),
        unsubscribe: async () => {
          log.push('unsubscribe')
          current = null
          return true
        },
      }
      return current
    },
    ...over,
  }
  return p
}

function service(options: { platform?: PushPlatform; key?: string | null; language?: 'bg' | 'en'; offset?: number } = {}) {
  const puts: unknown[] = []
  const api = fakeApi({
    pushPublicKey: async () => (options.key === undefined ? 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U' : options.key),
    putSubscription: async (body) => {
      puts.push(body)
    },
  })
  const storage = memoryStorage()
  const s = new ReminderService({
    api,
    platform: options.platform ?? platform(),
    storage,
    tzOffsetMin: () => options.offset ?? 180,
    language: () => options.language ?? 'bg',
  })
  return { s, api, puts, storage }
}

describe('ReminderService (spec §8.11, plan 5 contract)', () => {
  it('is off until the learner turns it on', () => {
    expect(service().s.prefs()).toBeNull()
  })

  it('asks permission, subscribes with the server’s key, and sends the minute, offset and language', async () => {
    const { s, puts } = service()
    expect(await s.enable({ minute: 7 * 60 + 30, streakNudge: true })).toBe('on')
    expect(puts).toEqual([
      {
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
        keys: { p256dh: 'p', auth: 'a' },
        reminderMinute: 450,
        tzOffsetMin: 180,
        language: 'bg',
        streakNudge: true,
      },
    ])
    expect(s.prefs()).toEqual({ minute: 450, streakNudge: true })
  })

  it('asks for permission before asking the server for a key, so the request stays inside the gesture (iOS WebKit, Firefox)', async () => {
    const order: string[] = []
    const p = platform({
      requestPermission: async () => {
        order.push('requestPermission')
        return 'granted'
      },
    })
    const puts: unknown[] = []
    const api = fakeApi({
      pushPublicKey: async () => {
        order.push('pushPublicKey')
        return 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'
      },
      putSubscription: async (body) => {
        puts.push(body)
      },
    })
    const s = new ReminderService({ api, platform: p, storage: memoryStorage(), tzOffsetMin: () => 0, language: () => 'bg' })
    expect(await s.enable({ minute: DEFAULT_REMINDER_MINUTE, streakNudge: false })).toBe('on')
    expect(order).toEqual(['requestPermission', 'pushPublicKey'])
  })

  it('leaves the toggle off, without blaming the browser, when the prompt is dismissed rather than answered', async () => {
    const { s, puts } = service({ platform: platform({ requestPermission: async () => 'default' }) })
    expect(await s.enable({ minute: DEFAULT_REMINDER_MINUTE, streakNudge: false })).toBe('dismissed')
    expect(puts).toEqual([])
    expect(s.prefs()).toBeNull()
  })

  it('says so and keeps nothing when permission is refused', async () => {
    const { s, puts } = service({ platform: platform({ requestPermission: async () => 'denied' }) })
    expect(await s.enable({ minute: DEFAULT_REMINDER_MINUTE, streakNudge: false })).toBe('denied')
    expect(puts).toEqual([])
    expect(s.prefs()).toBeNull()
  })

  it('is unavailable when the server sends no reminders', async () => {
    const { s } = service({ key: null })
    expect(await s.enable({ minute: DEFAULT_REMINDER_MINUTE, streakNudge: false })).toBe('unavailable')
  })

  it('sends the subscription again at launch, with the offset and language of now', async () => {
    const p = platform()
    const first = service({ platform: p })
    await first.s.enable({ minute: 600, streakNudge: false })
    const later = new ReminderService({
      api: first.api,
      platform: p,
      storage: first.storage,
      tzOffsetMin: () => 120,
      language: () => 'en',
    })
    await later.refresh()
    expect(first.puts.at(-1)).toMatchObject({ reminderMinute: 600, tzOffsetMin: 120, language: 'en' })
  })

  it('does nothing at launch when reminders are off or permission was withdrawn', async () => {
    const { s, puts } = service({ platform: platform({ permission: () => 'denied' }) })
    await s.refresh()
    expect(puts).toEqual([])
  })

  it('turns off: forgets the subscription on the server and in the browser', async () => {
    const p = platform()
    const { s, api } = service({ platform: p })
    await s.enable({ minute: 600, streakNudge: false })
    await s.disable()
    expect(api.calls).toContain('deleteSubscription https://fcm.googleapis.com/fcm/send/abc')
    expect(p.log).toContain('unsubscribe')
    expect(s.prefs()).toBeNull()
  })

  it('stops for a deleted account without asking the server', async () => {
    const p = platform()
    const { s, api } = service({ platform: p })
    await s.enable({ minute: 600, streakNudge: false })
    await s.stop({ server: false })
    expect(api.calls.some((c) => c.startsWith('deleteSubscription'))).toBe(false)
    expect(p.log).toContain('unsubscribe')
  })

  it('stops without asking the push manager when permission was never granted (it can hang in WebKit)', async () => {
    const p = platform({
      subscription: () => new Promise<never>(() => undefined),
    })
    const { s, storage } = service({ platform: p })
    storage.setItem('wordado.reminder', JSON.stringify({ minute: 540, streakNudge: false }))
    await s.stop({ server: true })
    expect(s.prefs()).toBeNull()
  })

  it('names what stands in the way', () => {
    expect(service({ platform: platform({ supported: () => false }) }).s.support()).toBe('unsupported')
    expect(service({ platform: platform({ needsInstall: () => true }) }).s.support()).toBe('needs-install')
    expect(service({ platform: platform({ permission: () => 'denied' }) }).s.support()).toBe('denied')
    expect(service().s.support()).toBe('supported')
  })
})
