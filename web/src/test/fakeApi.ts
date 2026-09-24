import type { Api, Me } from '../account/api'

export interface FakeApi extends Api {
  /** Every call, by name. */
  readonly calls: string[]
  /** Whom the "server" has a session for; null for none. Set it to sign in. */
  session: Me | null
}

/** The account endpoints as a test needs them. Override any method to make it fail. */
export function fakeApi(over: Partial<Api> = {}, session: Me | null = null): FakeApi {
  const calls: string[] = []
  const api: FakeApi = {
    calls,
    session,
    sendCode: async (email) => {
      calls.push(`sendCode ${email}`)
    },
    verifyCode: async (email, code) => {
      calls.push(`verifyCode ${email} ${code}`)
    },
    googleUrl: async () => {
      calls.push('googleUrl')
      return 'https://accounts.google.com/o/oauth2/auth'
    },
    me: async () => {
      calls.push('me')
      return api.session
    },
    requestCountry: async () => {
      calls.push('requestCountry')
      return 'BG'
    },
    setCountry: async (country) => {
      calls.push(`setCountry ${country}`)
    },
    signOut: async () => {
      calls.push('signOut')
    },
    deleteAccount: async () => {
      calls.push('deleteAccount')
    },
    pushPublicKey: async () => null,
    putSubscription: async () => {
      calls.push('putSubscription')
    },
    deleteSubscription: async (endpoint) => {
      calls.push(`deleteSubscription ${endpoint}`)
    },
  }
  return Object.assign(api, over)
}
