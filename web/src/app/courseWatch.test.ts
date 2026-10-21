import { Client, createStore, type ChangeL1Outcome } from '@wordado/client-data'
import { nodeSqliteDriver } from '@wordado/client-data/src/drivers/nodeSqlite'
import { sampleFetcher, sampleManifest } from '@wordado/client-data/src/testing/sample'
import { testEnv } from '@wordado/client-data/src/testing/testEnv'
import type { Course, L1, Target } from '@wordado/core'
import { describe, expect, it } from 'vitest'
import { watchCourse } from './courseWatch'

interface Shape {
  readonly course: Course
  readonly settings: { readonly course: Target; readonly l1: L1 | null }
}

/** The English course from `l1`, and the German one. */
const en = (l1: L1): Course => ({ target: 'en', l1 })
const de = (l1: L1): Course => ({ target: 'de', l1 })

/** A fake client's store, a fake install whose outcomes the test settles, and a fake `online` event. */
function harness(initial: Shape = { course: en('bg'), settings: { course: 'en', l1: null } }) {
  const store = createStore<Shape>(initial)
  const calls: Course[] = []
  const settle: ((outcome: ChangeL1Outcome | Error) => Promise<void>)[] = []
  const install = (course: Course) => {
    calls.push(course)
    return new Promise<ChangeL1Outcome>((resolve, reject) => {
      settle.push(async (outcome) => {
        if (outcome instanceof Error) reject(outcome)
        else {
          if (outcome.ok) store.set({ ...store.get(), course })
          resolve(outcome)
        }
        // Let the watcher's `.then`/`.finally` run.
        for (let i = 0; i < 5; i += 1) await Promise.resolve()
      })
    })
  }
  let retry: (() => void) | null = null
  let online = true
  const stop = watchCourse(
    { store },
    install,
    () => online,
    (r) => {
      retry = r
      return () => {
        retry = null
      }
    },
  )
  return {
    store,
    calls,
    stop,
    settle: (outcome: ChangeL1Outcome | Error) => settle.at(-1)!(outcome),
    choose: (l1: L1 | null) => store.set({ ...store.get(), settings: { ...store.get().settings, l1 } }),
    /** A course switch (`Client.switchCourse`): the course and its language, `null` for a course never started. */
    switchTo: (course: Target, l1: L1 | null) => store.set({ ...store.get(), settings: { course, l1 } }),
    goOnline: () => retry?.(),
    setOnline: (value: boolean) => {
      online = value
    },
    listening: () => retry !== null,
  }
}

describe('watchCourse (plan 10, Decision 2; spec §8.6)', () => {
  it('installs nothing while the setting is unset, or names the installed L1', () => {
    const h = harness()
    h.choose(null)
    h.choose('bg')
    expect(h.calls).toEqual([])
  })

  it('installs the chosen L1 once when the setting names another', async () => {
    const h = harness()
    h.choose('de')
    expect(h.calls).toEqual([en('de')])
    await h.settle({ ok: true })
    h.choose('de')
    expect(h.calls).toEqual([en('de')])
  })

  it('installs at once when the setting already differs at the start (chosen on another device)', () => {
    const h = harness({ course: en('bg'), settings: { course: 'en', l1: 'de' } })
    expect(h.calls).toEqual([en('de')])
  })

  it('tries again when the device comes back online after an unavailable pack', async () => {
    const h = harness()
    h.choose('de')
    await h.settle({ ok: false, reason: 'unavailable' })
    h.goOnline()
    expect(h.calls).toEqual([en('de'), en('de')])
    await h.settle({ ok: true })
    expect(h.store.get().course).toEqual(en('de'))
  })

  it('after a failed install, does not retry the same L1 on later store changes, only when online fires', async () => {
    const h = harness()
    h.choose('de')
    await h.settle({ ok: false, reason: 'unavailable' })
    // Every answer refreshes the snapshot: none of them may refetch.
    h.store.set({ ...h.store.get() })
    h.store.set({ ...h.store.get() })
    expect(h.calls).toEqual([en('de')])
    h.goOnline()
    expect(h.calls).toEqual([en('de'), en('de')])
  })

  it('treats a thrown install as a failure too', async () => {
    const h = harness()
    h.choose('de')
    await h.settle(new Error('The manifest could not be fetched (503)'))
    h.store.set({ ...h.store.get() })
    expect(h.calls).toEqual([en('de')])
    h.goOnline()
    expect(h.calls).toEqual([en('de'), en('de')])
  })

  it('tries a different L1 after a failure without waiting for online', async () => {
    const h = harness({ course: en('de'), settings: { course: 'en', l1: 'bg' } })
    await h.settle({ ok: false, reason: 'unavailable' })
    h.choose('de')
    h.choose('bg')
    expect(h.calls).toEqual([en('bg'), en('bg')])
  })

  it('never runs two installs at once, and follows a change made meanwhile once the first is done', async () => {
    const h = harness()
    h.choose('de')
    h.store.set({ ...h.store.get() })
    h.goOnline()
    expect(h.calls).toEqual([en('de')])
    // The learner changes their mind while the German pack is still coming.
    h.choose('bg')
    expect(h.calls).toEqual([en('de')])
    await h.settle({ ok: true })
    expect(h.calls).toEqual([en('de'), en('bg')])
  })

  it('waits while offline, then installs when the device comes back', () => {
    const h = harness()
    h.setOnline(false)
    h.choose('de')
    expect(h.calls).toEqual([])
    h.setOnline(true)
    h.goOnline()
    expect(h.calls).toEqual([en('de')])
  })

  it('stops watching the store and the online event when stopped', () => {
    const h = harness()
    h.stop()
    expect(h.listening()).toBe(false)
    h.choose('de')
    expect(h.calls).toEqual([])
  })

  it('keeps an online event that arrives while an install runs, and retries a failure once', async () => {
    const h = harness()
    h.choose('de')
    // The device drops and comes back while the first attempt is still running.
    h.goOnline()
    expect(h.calls).toEqual([en('de')])
    await h.settle({ ok: false, reason: 'unavailable' })
    expect(h.calls).toEqual([en('de'), en('de')])
    await h.settle({ ok: false, reason: 'unavailable' })
    h.store.set({ ...h.store.get() })
    expect(h.calls).toEqual([en('de'), en('de')])
  })

  it('does nothing more once stopped while an install is pending', async () => {
    const h = harness()
    h.choose('de')
    h.stop()
    await h.settle({ ok: false, reason: 'unavailable' })
    h.choose('bg')
    h.choose('de')
    expect(h.calls).toEqual([en('de')])
  })

  it('installs at start after a relaunch when a change made offline is still pending (final review)', async () => {
    const driver = nodeSqliteDriver()
    const env = testEnv()
    const before = await Client.open({ driver, env, l1: 'bg' })
    await before.installPacks(sampleManifest, sampleFetcher)
    await before.startSession()
    await before.updateSettings({ l1: 'de' })
    await before.changeCourse({ target: 'en', l1: 'de' }, sampleManifest, () => Promise.reject(new Error('offline')))

    // The relaunch: `settings.l1` names German while the Bulgarian pack is still the installed one.
    const client = await Client.open({ driver, env, l1: 'bg' })
    const calls: Course[] = []
    let done!: Promise<ChangeL1Outcome>
    const stop = watchCourse(
      client,
      (course) => {
        calls.push(course)
        done = client.changeCourse(course, sampleManifest, sampleFetcher)
        return done
      },
      () => true,
      () => () => undefined,
    )
    expect(calls).toEqual([en('de')])
    expect(await done).toEqual({ ok: true })
    expect(client.snapshot.l1).toBe('de')
    expect(client.snapshot.corpus?.l1).toBe('de')
    stop()
  })

  it('installs the other course when the setting names it (Review Focus 1)', () => {
    // A course started before: `switchCourse` restored its language, while the other course's pack is still installed.
    const h = harness({ course: en('bg'), settings: { course: 'de', l1: 'bg' } })
    expect(h.calls).toEqual([de('bg')])
  })

  it('installs the other course when the learner switches to it while the app is open', async () => {
    const h = harness({ course: en('bg'), settings: { course: 'en', l1: 'bg' } })
    expect(h.calls).toEqual([])
    h.switchTo('de', 'bg')
    expect(h.calls).toEqual([de('bg')])
    await h.settle({ ok: true })
    expect(h.store.get().course).toEqual(de('bg'))
    h.store.set({ ...h.store.get() })
    expect(h.calls).toEqual([de('bg')])
  })

  it('waits while the new course has no language yet', () => {
    const h = harness({ course: en('bg'), settings: { course: 'de', l1: null } })
    expect(h.calls).toEqual([])
    // The course's setup chooses its language: then it is installed.
    h.choose('en')
    expect(h.calls).toEqual([de('en')])
  })

  it('tries the same language in another course after a failure without waiting for online', async () => {
    // A failure is remembered for its course, not its language alone.
    const h = harness({ course: en('de'), settings: { course: 'de', l1: 'bg' } })
    await h.settle({ ok: false, reason: 'unavailable' })
    h.store.set({ ...h.store.get() })
    expect(h.calls).toEqual([de('bg')])
    h.switchTo('en', 'bg')
    expect(h.calls).toEqual([de('bg'), en('bg')])
  })
})
