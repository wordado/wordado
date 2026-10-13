import type { PlayerLike } from './audio'

/** What the tap rule reads of an audio element, besides playing it. */
export type TapPlayer = PlayerLike & { readonly paused: boolean; readonly ended: boolean }

/** What the tap rule listens on: the document. */
export type TapTarget = Pick<Document, 'addEventListener' | 'removeEventListener'>

/** Two samples of silence: enough for a browser to count the element as started by the learner. */
export const SILENCE = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA'

/** What a browser says when sound may not start without a tap (a phone's rule, strictest on an iPhone). */
export function refusedByBrowser(err: unknown): boolean {
  return err instanceof Error && err.name === 'NotAllowedError'
}

/**
 * The one audio element every clip plays on (issue 266). A phone lets sound start by itself only on an element a
 * tap has already started, and a listening card starts its clip when it appears: a new element for each clip was
 * never such an element, so on an iPhone the card stayed silent until Play was pressed.
 */
export function sharedPlayer<P extends PlayerLike = HTMLAudioElement>(make: () => P = () => new Audio() as unknown as P): () => P {
  let player: P | null = null
  return () => (player ??= make())
}

const TAPS = ['touchend', 'click', 'keydown'] as const

/**
 * Starts `player` on silence at the learner's first tap or key, inside that event, so the browser lets the clips
 * after it start by themselves. It stops listening once the browser took it; a refusal waits for the next tap. An
 * element that is already playing a clip is left alone: nothing was refused there. Returns what stops the listening.
 */
export function allowOnTap(player: () => TapPlayer, target: TapTarget = document): () => void {
  const stop = () => {
    for (const type of TAPS) target.removeEventListener(type, tap, true)
  }
  const tap = () => {
    const element = player()
    if (!element.paused && !element.ended) return stop()
    element.src = SILENCE
    element.play().then(stop, (err: unknown) => {
      // A clip that took the element over ends the silence, not the permission.
      if (!refusedByBrowser(err)) stop()
    })
  }
  for (const type of TAPS) target.addEventListener(type, tap, true)
  return stop
}
