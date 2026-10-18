import type { Api, CodeOutcome, FeedbackBody, Me } from '../account/api'

export interface FakeApi extends Api {
  /** Every call, by name. */
  readonly calls: string[]
  /** Every feedback body sent. */
  readonly feedback: FeedbackBody[]
  /** Whom the "server" has a session for; null for none. Set it to sign in. */
  session: Me | null
  /** What a code leads to (#293): an account that exists, by default, or the ticket of a new one. */
  codeOutcome: CodeOutcome
}

/** The account endpoints as a test needs them. Override any method to make it fail. */
export function fakeApi(over: Partial<Api> = {}, session: Me | null = null): FakeApi {
  const calls: string[] = []
  const feedback: FeedbackBody[] = []
  const api: FakeApi = {
    calls,
    feedback,
    session,
    codeOutcome: { kind: 'signed-in' },
    sendCode: async (email) => {
      calls.push(`sendCode ${email}`)
    },
    verifyCode: async (email, code) => {
      calls.push(`verifyCode ${email} ${code}`)
      return api.codeOutcome
    },
    createAccount: async (email, ticket, newsConsent) => {
      calls.push(`createAccount ${email} ${ticket}${newsConsent === null ? '' : ` ${newsConsent}`}`)
    },
    discardSignUp: async (email, ticket) => {
      calls.push(`discardSignUp ${email} ${ticket}`)
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
    setNewsConsent: async (consent, text) => {
      calls.push(`setNewsConsent ${consent}${consent ? ` ${text}` : ''}`)
      const newsConsent = consent ? 'given' : api.session?.newsConsent === 'given' ? 'withdrawn' : (api.session?.newsConsent ?? 'none')
      if (api.session) api.session = { ...api.session, newsConsent }
      return newsConsent
    },
    setInterfaceLanguage: async (language) => {
      calls.push(`setInterfaceLanguage ${language}`)
      if (api.session) api.session = { ...api.session, interfaceLanguage: language }
      return language
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
    passkeyRegister: async () => {
      calls.push('passkeyRegister')
    },
    passkeySignIn: async ({ conditional }) => {
      calls.push(`passkeySignIn ${conditional ? 'conditional' : 'button'}`)
    },
    listPasskeys: async () => {
      calls.push('listPasskeys')
      return []
    },
    deletePasskey: async (id) => {
      calls.push(`deletePasskey ${id}`)
    },
    signalGone: async (credentialId) => {
      calls.push(`signalGone ${credentialId}`)
    },
  }
  return Object.assign(api, over)
}
