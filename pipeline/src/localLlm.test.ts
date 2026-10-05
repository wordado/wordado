import { describe, expect, it } from 'vitest'
import { AnswerDoesNotFit, LlmError, ParseError, type LlmRequest } from './llm'
import { localLlm } from './localLlm'

const req: LlmRequest<{ n: number }> = {
  name: 'review',
  system: 'Count.',
  input: { rows: [] },
  schema: { type: 'object' },
  parse: (v) => {
    if (typeof (v as { n?: unknown }).n !== 'number') throw new ParseError('n must be a number')
    return v as { n: number }
  },
}
const reply = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })

function server(replies: (Response | Error)[]) {
  const bodies: Record<string, unknown>[] = []
  const urls: string[] = []
  const fetchFn = (async (url: string, init?: RequestInit) => {
    urls.push(url)
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
    const next = replies.shift()
    if (!next) throw new Error('no more replies')
    if (next instanceof Error) throw next
    return next
  }) as typeof fetch
  return { fetchFn, bodies, urls }
}

describe('localLlm', () => {
  it('asks /v1/chat/completions with the schema held by response_format, and parses the answer', async () => {
    const s = server([reply('{"n":3}')])
    const llm = localLlm({ url: 'http://127.0.0.1:8091', model: 'bggpt', fetch: s.fetchFn, sleep: async () => {} })
    expect(await llm.json(req)).toEqual({ n: 3 })
    expect(s.urls).toEqual(['http://127.0.0.1:8091/v1/chat/completions'])
    expect(s.bodies[0]).toMatchObject({
      model: 'bggpt',
      messages: [{ role: 'system', content: 'Count.' }, { role: 'user', content: '{"rows":[]}' }],
      response_format: { type: 'json_schema', schema: { type: 'object' }, json_schema: { name: 'review', schema: { type: 'object' } } },
    })
    expect(llm.model).toBe('local:bggpt')
    expect(llm.spentUsd()).toBe(0)
  })

  it('retries an answer that does not fit, then gives up with AnswerDoesNotFit', async () => {
    const s = server([reply('{"m":1}'), reply('{"m":1}'), reply('{"m":1}'), reply('{"m":1}')])
    await expect(localLlm({ url: 'http://x', model: 'm', fetch: s.fetchFn, sleep: async () => {} }).json(req)).rejects.toThrow(AnswerDoesNotFit)
    expect(s.urls).toHaveLength(4)
  })

  it('fails at once, naming the URL, when no server answers', async () => {
    const s = server([new TypeError('fetch failed')])
    const err = await localLlm({ url: 'http://127.0.0.1:8091', model: 'm', fetch: s.fetchFn, sleep: async () => {} }).json(req).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(LlmError)
    expect(String(err)).toMatch(/no server answers at http:\/\/127\.0\.0\.1:8091/)
    expect(s.urls).toHaveLength(1)
  })
})
