import { describe, expect, it } from 'vitest'
import { claudeCodeLlm, UsageLimitReached, type Exec, type ExecResult } from './claudeCode'
import { LlmError, ParseError, type LlmRequest } from './llm'

const req: LlmRequest<string[]> = {
  name: 'translate',
  system: 'Translate.',
  input: { items: ['water'] },
  schema: { type: 'object' },
  parse: (v) => {
    const items = (v as { items?: unknown }).items
    if (!Array.isArray(items)) throw new ParseError('no items')
    return items.map(String)
  },
}

const answer = (body: Record<string, unknown>): ExecResult => ({ code: 0, stdout: JSON.stringify(body), stderr: '' })

function fakeExec(results: ExecResult[]): Exec & { calls: { args: readonly string[]; input: string }[] } {
  const calls: { args: readonly string[]; input: string }[] = []
  const exec = (async (args: readonly string[], input: string) => {
    calls.push({ args, input })
    return results.shift() ?? answer({ is_error: false, structured_output: { items: [] } })
  }) as Exec & { calls: typeof calls }
  exec.calls = calls
  return exec
}

const noSleep = async () => {}

describe('claudeCodeLlm', () => {
  it('asks claude -p with the stage’s system prompt, schema and input, and returns the checked structured output', async () => {
    const exec = fakeExec([answer({ is_error: false, structured_output: { items: ['вода'] }, total_cost_usd: 0.02 })])
    const llm = claudeCodeLlm({ model: 'claude-sonnet-5', exec, sleep: noSleep })
    expect(await llm.json(req)).toEqual(['вода'])
    expect(llm.model).toBe('claude-code:claude-sonnet-5')
    expect(llm.spentUsd()).toBe(0.02)
    const { args, input } = exec.calls[0]!
    expect(args).toEqual([
      '-p', '--model', 'claude-sonnet-5', '--system-prompt', 'Translate.', '--json-schema', '{"type":"object"}',
      '--output-format', 'json', '--tools', '', '--no-session-persistence',
    ])
    expect(JSON.parse(input)).toEqual({ items: ['water'] })
  })

  it('retries an overloaded API, an answer that does not fit, and output that is not JSON', async () => {
    const exec = fakeExec([
      answer({ is_error: true, api_error_status: 529, result: 'Overloaded' }),
      answer({ is_error: false, structured_output: { wrong: true } }),
      { code: 1, stdout: 'not json', stderr: '' },
      answer({ is_error: false, structured_output: { items: ['вода'] } }),
    ])
    expect(await claudeCodeLlm({ model: 'm', exec, sleep: noSleep }).json(req)).toEqual(['вода'])
    expect(exec.calls).toHaveLength(4)
  })

  it('stops at once, without retrying, when the plan’s usage limit is reached', async () => {
    const exec = fakeExec([answer({ is_error: true, result: 'Claude AI usage limit reached|1759140000' })])
    await expect(claudeCodeLlm({ model: 'm', exec, sleep: noSleep }).json(req)).rejects.toThrow(UsageLimitReached)
    expect(exec.calls).toHaveLength(1)
  })

  it('does not retry any other error, and names the stage', async () => {
    const exec = fakeExec([answer({ is_error: true, api_error_status: 400, result: 'Invalid model' })])
    await expect(claudeCodeLlm({ model: 'm', exec, sleep: noSleep }).json(req)).rejects.toThrow(new LlmError('translate: Invalid model'))
  })

  it('gives up after four attempts', async () => {
    const exec = fakeExec(Array.from({ length: 4 }, () => answer({ is_error: false })))
    await expect(claudeCodeLlm({ model: 'm', exec, sleep: noSleep }).json(req)).rejects.toThrow(/gave up after 4 attempts/)
  })
})
