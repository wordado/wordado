import type { KeyValue } from './storage'

/** The device's answer to the offer after a code sign-in (#287): kept on the device only, never synced. */
export const PASSKEY_OFFER_KEY = 'wordado.passkeyOffer'

/** Whether the browser can do passkeys at all; where it cannot, nothing about them is shown. */
export const passkeysSupported = (): boolean => typeof window !== 'undefined' && typeof window.PublicKeyCredential !== 'undefined'

/** Whether this device has its own unlock (fingerprint, face, PIN) to hold a passkey. */
export async function platformAuthenticator(): Promise<boolean> {
  if (!passkeysSupported()) return false
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
  } catch {
    return false
  }
}

/** Whether the browser can list passkeys in the email field's autofill. */
export async function conditionalSignIn(): Promise<boolean> {
  if (!passkeysSupported()) return false
  try {
    return (await window.PublicKeyCredential.isConditionalMediationAvailable?.()) === true
  } catch {
    return false
  }
}

/** Whether this device has answered the offer, either way. */
export function offerAnswered(store: KeyValue): boolean {
  try {
    return store.getItem(PASSKEY_OFFER_KEY) !== null
  } catch {
    return false
  }
}

export function markOfferAnswered(store: KeyValue): void {
  try {
    store.setItem(PASSKEY_OFFER_KEY, '1')
  } catch {
    // A browser that refuses storage asks again next time; harmless.
  }
}
