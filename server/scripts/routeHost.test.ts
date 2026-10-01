import { describe, expect, it } from 'vitest'
import { originHost, productionRouteHost, stripJsonComments } from './routeHost'

describe('productionRouteHost: the host a production deploy attaches', () => {
  it('reads the first production route through comments and trailing commas', () => {
    const text = `{
      // a comment with "quotes"
      "env": { "production": {
        "routes": [{ "pattern": "app.wordado.com", "custom_domain": true },], /* x */
      } }
    }`
    expect(productionRouteHost(text)).toBe('app.wordado.com')
  })
  it('keeps // inside strings', () => {
    expect(JSON.parse(stripJsonComments('{"u": "https://a.b/c" // c\n}'))).toEqual({ u: 'https://a.b/c' })
  })
  it('is null when there is no production route', () => {
    expect(productionRouteHost('{"env":{"preview":{}}}')).toBeNull()
  })
  it('compares against the origin host', () => {
    expect(originHost('https://app.wordado.com')).toBe('app.wordado.com')
    expect(originHost('nonsense')).toBeNull()
  })
})
