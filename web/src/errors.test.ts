import { ClientClosed } from '@wordado/client-data'
import { describe, expect, it } from 'vitest'
import { ApiError, OfflineError } from './account/api'
import { NotReady, SignOutOffline } from './account/controller'
import { SyncHttpError } from './account/transport'
import { errorMessageKey } from './errors'

describe('errorMessageKey (spec §11.2: no raw English in the interface)', () => {
  it('maps every known failure to its own key', () => {
    expect(errorMessageKey(new NotReady())).toBe('error.notReady')
    expect(errorMessageKey(new ClientClosed())).toBe('error.notReady')
    expect(errorMessageKey(new SignOutOffline(new Error('x')))).toBe('settings.signOutOffline')
    expect(errorMessageKey(new OfflineError(new TypeError('Failed to fetch')))).toBe('error.offline')
    expect(errorMessageKey(new ApiError(401, 'unauthorized'))).toBe('error.signIn')
    expect(errorMessageKey(new SyncHttpError(409))).toBe('error.signIn')
    expect(errorMessageKey(new ApiError(429, null))).toBe('error.tooMany')
    expect(errorMessageKey(new ApiError(503, null))).toBe('error.server')
  })

  it('says something generic about anything else', () => {
    expect(errorMessageKey(new ApiError(400, 'invalid'))).toBe('error.unknown')
    expect(errorMessageKey(new Error('SQLITE_FULL'))).toBe('error.unknown')
    expect(errorMessageKey('a string')).toBe('error.unknown')
  })
})
