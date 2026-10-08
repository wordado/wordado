import { browserStorage, type KeyValue } from '../account/storage'

/** "Continue automatically after a right answer", per device: `off` once the learner switched it off; absent means on (spec §11.1). */
export const AUTO_CONTINUE_KEY = 'wordado.autoContinue'

/** How long a right answer stays on screen before the next item comes by itself. Tuning (§15). */
export const AUTO_CONTINUE_MS = 1_200

/** The choice for this visit, where the browser would not keep it. */
let unkept: boolean | null = null

/** Whether a right answer moves on by itself. On when nothing says otherwise, or the browser's storage cannot be read. */
export function readAutoContinue(storage: KeyValue = browserStorage('localStorage')): boolean {
  if (unkept !== null) return unkept
  try {
    return storage.getItem(AUTO_CONTINUE_KEY) !== 'off'
  } catch {
    return true
  }
}

/** Switches it on or off, on this device. False when the browser would not keep the choice: it then lasts for this visit. */
export function setAutoContinue(on: boolean, storage: KeyValue = browserStorage('localStorage')): boolean {
  let kept = true
  try {
    if (on) storage.removeItem(AUTO_CONTINUE_KEY)
    else storage.setItem(AUTO_CONTINUE_KEY, 'off')
    kept = (storage.getItem(AUTO_CONTINUE_KEY) !== 'off') === on
  } catch {
    kept = false
  }
  unkept = kept ? null : on
  return kept
}
