import type { Api, FeedbackBody, Me } from '../account/api'

export interface FakeApi extends Api {
  /** Every call, by name. */
  readonly calls: string[]
  /** Every feedback body sent. */
  readonly feedback: FeedbackBody[]
  /** Whom the "server" has a session for; null for none. Set it to sign in. */
  session: Me | null
}

/** The account endpoints as a test needs them. Override any method to make it fail. */
export function fakeApi(over: Partial<Api> = {}, session: Me | null = null): FakeApi {
  const calls: string[] = []
  const feedback: FeedbackBody[] = []
  const api: FakeApi = {
    calls,
    feedback,
    session,
    sendCode: async (email) => {
      calls.push(`sendCode ${email}`)
    },
    verifyCode: async (email, code) => {
      calls.push(`verifyCode ${email} ${code}`)
    },
    me: async () => {
      calls.push('me')
      return api.session
    },
    requestCountry: async () => {
      calls.push('requestCountry')
      return 'BG'
    },
    signOut: async () => {
      calls.push('signOut')
    },
    deleteAccount: async () => {
      calls.push('deleteAccount')
    },
    exportData: async () => {
      calls.push('exportData')
      return { name: 'wordado-export-2026-09-25.json', json: '{"format":"wordado-export-1"}' }
    },
    pushPublicKey: async () => null,
    putSubscription: async () => {
      calls.push('putSubscription')
    },
    deleteSubscription: async (endpoint) => {
      calls.push(`deleteSubscription ${endpoint}`)
    },
    sendFeedback: async (body) => {
      calls.push('sendFeedback')
      feedback.push(body)
    },
  }
  return Object.assign(api, over)
}
