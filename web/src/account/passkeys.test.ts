import { afterEach, describe, expect, it, vi } from 'vitest'
import { conditionalSignIn, markOfferAnswered, offerAnswered, passkeysSupported, platformAuthenticator } from './passkeys'
import { memoryStorage } from './storage'

afterEach(() => vi.unstubAllGlobals())

describe('passkey support', () => {
  it('is absent where PublicKeyCredential is undefined', async () => {
    vi.stubGlobal('PublicKeyCredential', undefined)
    expect(passkeysSupported()).toBe(false)
    expect(await platformAuthenticator()).toBe(false)
    expect(await conditionalSignIn()).toBe(false)
  })

  it('reads the browser, and takes a failing check as no', async () => {
    vi.stubGlobal('PublicKeyCredential', {
      isUserVerifyingPlatformAuthenticatorAvailable: async () => true,
      isConditionalMediationAvailable: async () => true,
    })
    expect(passkeysSupported()).toBe(true)
    expect(await platformAuthenticator()).toBe(true)
    expect(await conditionalSignIn()).toBe(true)
    vi.stubGlobal('PublicKeyCredential', {
      isUserVerifyingPlatformAuthenticatorAvailable: async () => {
        throw new Error('x')
      },
    })
    expect(await platformAuthenticator()).toBe(false)
    expect(await conditionalSignIn()).toBe(false)
  })
})

describe('the offer', () => {
  it('is unanswered until marked, and the mark is kept under its key', () => {
    const store = memoryStorage()
    expect(offerAnswered(store)).toBe(false)
    markOfferAnswered(store)
    expect(offerAnswered(store)).toBe(true)
    expect(store.getItem('wordado.passkeyOffer')).not.toBeNull()
  })

  it('takes a refusing store quietly', () => {
    const broken = {
      getItem: () => {
        throw new Error('no')
      },
      setItem: () => {
        throw new Error('no')
      },
      removeItem: () => {},
    }
    expect(offerAnswered(broken)).toBe(false)
    expect(() => markOfferAnswered(broken)).not.toThrow()
  })
})
