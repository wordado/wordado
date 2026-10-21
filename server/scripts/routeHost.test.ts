import { describe, expect, it } from 'vitest'
import { originHost, productionPasskeyRpId, productionRouteHost, stripJsonComments } from './routeHost'

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

describe('productionPasskeyRpId: the passkey relying party a production deploy carries (#304)', () => {
  it('reads PASSKEY_RP_ID from the production vars', () => {
    expect(productionPasskeyRpId('{"env":{"production":{"vars":{"BASE_URL":"", "PASSKEY_RP_ID":"wordado.com",}}}}')).toBe('wordado.com')
  })
  it('is null when production sets none, and the Worker takes BASE_URL\'s host', () => {
    expect(productionPasskeyRpId('{"env":{"production":{"vars":{"PASSKEY_RP_ID":" "}}}}')).toBeNull()
    expect(productionPasskeyRpId('{"env":{"production":{}}}')).toBeNull()
  })
})
