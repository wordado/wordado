import { describe, expect, it } from 'vitest'
import { accountStorage, DEMO_FILE, learnerFile, memoryStorage, pendingSignIn } from './storage'

describe('the account record', () => {
  it('round-trips, and clears', () => {
    const store = accountStorage(memoryStorage())
    expect(store.read()).toBeNull()
    store.save({ userId: 'u1', email: 'ana@example.com' })
    expect(store.read()).toEqual({ userId: 'u1', email: 'ana@example.com' })
    store.save({ userId: 'u1', email: 'ana@example.com', carryOver: true })
    expect(store.read()?.carryOver).toBe(true)
    store.clear()
    expect(store.read()).toBeNull()
  })

  it('reads a damaged record as signed out rather than crashing', () => {
    const raw = memoryStorage()
    raw.setItem('wordado.account', '{not json')
    expect(accountStorage(raw).read()).toBeNull()
    raw.setItem('wordado.account', JSON.stringify({ userId: 3 }))
    expect(accountStorage(raw).read()).toBeNull()
  })

  it('keeps working when the browser refuses storage', () => {
    const refusing = {
      getItem: () => {
        throw new DOMException('denied', 'SecurityError')
      },
      setItem: () => {
        throw new DOMException('denied', 'SecurityError')
      },
      removeItem: () => {
        throw new DOMException('denied', 'SecurityError')
      },
    }
    const store = accountStorage(refusing)
    expect(store.read()).toBeNull()
    expect(() => store.save({ userId: 'u1', email: 'a@b.c' })).not.toThrow()
  })
})

describe('the pending sign-in', () => {
  it('carries the age gate’s country across a redirect', () => {
    const pending = pendingSignIn(memoryStorage())
    pending.save({ country: 'BG' })
    expect(pending.read()).toEqual({ country: 'BG' })
    pending.clear()
    expect(pending.read()).toBeNull()
  })
})

describe('file names', () => {
  it('gives each account its own file, safe as a file and database name', () => {
    expect(DEMO_FILE).toBe('demo')
    expect(learnerFile('AbC123')).toBe('user-AbC123')
    expect(learnerFile('a/b..c d')).toBe('user-a_b__c_d')
    expect(learnerFile('x'.repeat(200))).toHaveLength(69)
  })
})
