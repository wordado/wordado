import { afterEach, describe, expect, it } from 'vitest'
import { appVersion } from './version'

afterEach(() => {
  document.head.innerHTML = ''
})

const withScript = (src: string): void => {
  const script = document.createElement('script')
  script.setAttribute('type', 'module')
  script.setAttribute('src', src)
  document.head.append(script)
}

describe('appVersion', () => {
  it('is the hash in the built entry script’s name', () => {
    withScript('/assets/index-B3kq_9x-.js')
    expect(appVersion()).toBe('B3kq_9x-')
  })

  it('is dev when the page was not built', () => {
    expect(appVersion()).toBe('dev')
    withScript('/src/main.tsx')
    expect(appVersion()).toBe('dev')
  })
})
