import { afterEach, describe, expect, it } from 'vitest'
import { memoryStorage, type KeyValue } from '../account/storage'
import { AUTO_CONTINUE_KEY, readAutoContinue, setAutoContinue } from './autoContinue'

const refusing: KeyValue = {
  getItem: () => {
    throw new Error('refused')
  },
  setItem: () => {
    throw new Error('refused')
  },
  removeItem: () => {
    throw new Error('refused')
  },
}

// A choice the browser did not keep is remembered for the visit: a kept one clears it.
afterEach(() => void setAutoContinue(true, memoryStorage()))

describe('automatic continue, per device', () => {
  it('is on until the learner switches it off, and on again when they switch it back', () => {
    const storage = memoryStorage()
    expect(readAutoContinue(storage)).toBe(true)
    expect(setAutoContinue(false, storage)).toBe(true)
    expect(storage.getItem(AUTO_CONTINUE_KEY)).toBe('off')
    expect(readAutoContinue(storage)).toBe(false)
    expect(setAutoContinue(true, storage)).toBe(true)
    expect(storage.getItem(AUTO_CONTINUE_KEY)).toBeNull()
    expect(readAutoContinue(storage)).toBe(true)
  })

  it('reads anything but "off" as on', () => {
    const storage = memoryStorage()
    storage.setItem(AUTO_CONTINUE_KEY, 'nonsense')
    expect(readAutoContinue(storage)).toBe(true)
  })

  it('is on when the browser’s storage throws or is missing', () => {
    expect(readAutoContinue(refusing)).toBe(true)
    expect(readAutoContinue(null as unknown as KeyValue)).toBe(true)
  })

  it('follows the switch for this visit when the browser will not keep it, and says it was not kept', () => {
    expect(setAutoContinue(false, refusing)).toBe(false)
    expect(readAutoContinue(refusing)).toBe(false)
    expect(setAutoContinue(true, refusing)).toBe(false)
    expect(readAutoContinue(refusing)).toBe(true)
  })

  it('uses the browser’s own storage by default', () => {
    expect(setAutoContinue(false)).toBe(true)
    expect(window.localStorage.getItem(AUTO_CONTINUE_KEY)).toBe('off')
    expect(readAutoContinue()).toBe(false)
    setAutoContinue(true)
    expect(window.localStorage.getItem(AUTO_CONTINUE_KEY)).toBeNull()
  })
})
