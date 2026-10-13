import { describe, expect, it } from 'vitest'
import { allowOnTap, refusedByBrowser, sharedPlayer, SILENCE, type TapPlayer } from './player'

function fakePlayer(play: () => Promise<void> = async () => undefined): TapPlayer & { played: string[]; paused: boolean; ended: boolean } {
  const player = {
    src: '',
    paused: true,
    ended: false,
    played: [] as string[],
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    pause: () => undefined,
    play: () => {
      player.played.push(player.src)
      return play()
    },
  }
  return player
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('sharedPlayer (issue 266)', () => {
  it('gives the same element every time, made at the first ask', () => {
    let made = 0
    const player = sharedPlayer(() => {
      made += 1
      return fakePlayer()
    })
    expect(made).toBe(0)
    expect(player()).toBe(player())
    expect(made).toBe(1)
  })
})

describe('allowOnTap (issue 266)', () => {
  it('starts the element on silence inside the first tap, and listens no more once the browser took it', async () => {
    const target = new EventTarget()
    const player = fakePlayer()
    allowOnTap(() => player, target)
    expect(player.played).toEqual([])
    target.dispatchEvent(new Event('touchend'))
    expect(player.played).toEqual([SILENCE]) // inside the event, before anything is awaited
    await settled()
    target.dispatchEvent(new Event('click'))
    target.dispatchEvent(new Event('keydown'))
    expect(player.played).toEqual([SILENCE])
  })

  it('tries again at the next tap when the browser refused', async () => {
    const target = new EventTarget()
    let refuse = true
    const player = fakePlayer(async () => {
      if (refuse) throw new DOMException('not from a tap', 'NotAllowedError')
    })
    allowOnTap(() => player, target)
    target.dispatchEvent(new Event('keydown'))
    await settled()
    refuse = false
    target.dispatchEvent(new Event('click'))
    await settled()
    target.dispatchEvent(new Event('click'))
    expect(player.played).toEqual([SILENCE, SILENCE])
  })

  it('counts a silence a clip took over as taken', async () => {
    const target = new EventTarget()
    const player = fakePlayer(async () => {
      throw new DOMException('interrupted by a new load', 'AbortError')
    })
    allowOnTap(() => player, target)
    target.dispatchEvent(new Event('click'))
    await settled()
    target.dispatchEvent(new Event('click'))
    expect(player.played).toEqual([SILENCE])
  })

  it('leaves a clip that is playing alone', () => {
    const target = new EventTarget()
    const player = fakePlayer()
    player.paused = false
    player.src = 'blob:clip'
    allowOnTap(() => player, target)
    target.dispatchEvent(new Event('click'))
    target.dispatchEvent(new Event('click'))
    expect(player.played).toEqual([])
    expect(player.src).toBe('blob:clip')
  })

  it('stops listening when asked', () => {
    const target = new EventTarget()
    const player = fakePlayer()
    allowOnTap(() => player, target)()
    target.dispatchEvent(new Event('click'))
    expect(player.played).toEqual([])
  })
})

describe('refusedByBrowser', () => {
  it('is the browser’s "not allowed", and no other failure', () => {
    expect(refusedByBrowser(new DOMException('no', 'NotAllowedError'))).toBe(true)
    expect(refusedByBrowser(new DOMException('no', 'NotSupportedError'))).toBe(false)
    expect(refusedByBrowser(new Error('The clip could not be played'))).toBe(false)
    expect(refusedByBrowser('NotAllowedError')).toBe(false)
  })
})
