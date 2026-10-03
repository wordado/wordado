import { describe, expect, it } from 'vitest'
import { AnswerDoesNotFit, BudgetExceeded, LlmError, openRouterLlm, ParseError, type LlmRequest } from './llm'

const req: LlmRequest<{ n: number }> = {
  name: 'count',
  system: 'Count.',
  input: { words: ['a'] },
  schema: { type: 'object', properties: { n: { type: 'number' } }, required: ['n'], additionalProperties: false },
  parse: (v) => {
    if (typeof v !== 'object' || v === null || typeof (v as { n?: unknown }).n !== 'number') throw new ParseError('n must be a number')
    return v as { n: number }
  },
}

function reply(content: string, cost = 0.01, status = 200): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { cost } }), { status })
}

function client(responses: (Response | Error)[], maxUsd = 1) {
  const bodies: Record<string, unknown>[] = []
  const llm = openRouterLlm({
    apiKey: 'k',
    model: 'anthropic/claude-sonnet-5',
    maxUsd,
    sleep: async () => {},
    fetch: async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      const next = responses.shift()
      if (!next) throw new Error('no more responses')
      if (next instanceof Error) throw next
      return next
    },
  })
  return { llm, bodies }
}

describe('openRouterLlm', () => {
  it('asks for strict structured output with data collection denied, and parses the reply', async () => {
    const { llm, bodies } = client([reply('{"n":3}')])
    expect(await llm.json(req)).toEqual({ n: 3 })
    expect(bodies[0]).toMatchObject({
      model: 'anthropic/claude-sonnet-5',
      messages: [
        { role: 'system', content: 'Count.' },
        { role: 'user', content: '{"words":["a"]}' },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'count', strict: true, schema: req.schema } },
      provider: { require_parameters: true, data_collection: 'deny' },
    })
    // Claude Sonnet 5 accepts no sampling parameters; with require_parameters, sending one leaves no endpoint (HTTP 404).
    expect(bodies[0]).not.toHaveProperty('temperature')
  })

  it('retries a malformed, a truncated or an unparseable reply, then succeeds', async () => {
    const { llm } = client([reply('{"n":'), reply('{"m":1}'), reply('{"n":4}')])
    expect(await llm.json(req)).toEqual({ n: 4 })
  })

  it('retries rate limits, server errors and network failures, but not a client error', async () => {
    const ok = client([new Response('', { status: 429 }), new Response('', { status: 502 }), new Error('socket'), reply('{"n":1}')])
    expect(await ok.llm.json(req)).toEqual({ n: 1 })
    const bad = client([new Response('{"error":{"message":"bad model"}}', { status: 400 })])
    await expect(bad.llm.json(req)).rejects.toThrow(LlmError)
  })

  it('gives up after four attempts, naming the last problem', async () => {
    const { llm } = client([reply('x'), reply('x'), reply('x'), reply('x')])
    await expect(llm.json(req)).rejects.toThrow(/count: .*not JSON/)
  })

  it('gives up with AnswerDoesNotFit only when the last answer parsed but did not fit', async () => {
    const unfit = client([reply('{"m":1}'), reply('{"m":1}'), reply('{"m":1}'), reply('{"m":1}')])
    await expect(unfit.llm.json(req)).rejects.toThrow(AnswerDoesNotFit)
    const busy = client([reply('{"m":1}'), reply('', 0, 503), reply('', 0, 503), reply('', 0, 503)])
    const err = await busy.llm.json(req).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(LlmError)
    expect(err).not.toBeInstanceOf(AnswerDoesNotFit)
  })

  it('adds up usage.cost, and stops before a call that would exceed the budget', async () => {
    const { llm, bodies } = client([reply('{"n":1}', 0.6), reply('{"n":2}', 0.6), reply('{"n":3}')], 1)
    await llm.json(req)
    await llm.json(req)
    expect(llm.spentUsd()).toBeCloseTo(1.2)
    await expect(llm.json(req)).rejects.toThrow(BudgetExceeded)
    expect(bodies).toHaveLength(2)
  })
})
