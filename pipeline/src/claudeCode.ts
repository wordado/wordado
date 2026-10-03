import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AnswerDoesNotFit, LlmError, ParseError, type Llm, type LlmRequest } from './llm'

/** The Claude plan's usage limit stopped the run; everything answered so far is cached, so rerun after it resets. */
export class UsageLimitReached extends Error {
  constructor(detail: string) {
    super(`the Claude plan's usage limit is reached (${detail}); rerun after it resets: everything answered so far is cached`)
    this.name = 'UsageLimitReached'
  }
}

export interface ExecResult {
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
}

export type Exec = (args: readonly string[], input: string) => Promise<ExecResult>

export interface ClaudeCodeOptions {
  /** An exact model ID (`claude-sonnet-5`), so answers match the caches made through OpenRouter. */
  readonly model: string
  readonly exec?: Exec
  readonly sleep?: (ms: number) => Promise<void>
}

const ATTEMPTS = 4
class Retryable extends Error {
  /** The answer came back but did not fit its request. */
  constructor(message: string, readonly unfit = false) {
    super(message)
  }
}

/**
 * Runs `claude` in an empty directory, so no project's CLAUDE.md or settings join the question, and without an
 * API key in its environment, so it answers on the signed-in Claude plan.
 */
export function claudeExec(): Exec {
  const cwd = mkdtempSync(join(tmpdir(), 'corpus-claude-'))
  const env = { ...process.env }
  delete env['ANTHROPIC_API_KEY']
  delete env['ANTHROPIC_AUTH_TOKEN']
  return (args, input) =>
    new Promise((resolve, reject) => {
      const child = spawn('claude', args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf8')))
      child.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')))
      child.on('error', reject)
      child.on('close', (code) => resolve({ code, stdout, stderr }))
      child.stdin.end(input)
    })
}

const LIMIT = /usage limit|limit reached|hit your limit|out of extra usage/i

/**
 * The LLM port on the user's own Claude plan, through Claude Code's print mode (`claude -p`), for local runs.
 * Each request is one `claude -p` call: the stage's instructions as the system prompt, no tools, and the stage's
 * schema as `--json-schema`, whose checked answer comes back as `structured_output`. `spentUsd` is Claude Code's
 * estimate of what the calls would cost on the API; the plan is not billed per call, so no budget applies.
 */
export function claudeCodeLlm(opts: ClaudeCodeOptions): Llm {
  const exec = opts.exec ?? claudeExec()
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  let spent = 0

  async function attempt<T>(req: LlmRequest<T>): Promise<T> {
    const args = [
      '-p',
      '--model', opts.model,
      '--system-prompt', req.system,
      '--json-schema', JSON.stringify(req.schema),
      '--output-format', 'json',
      '--tools', '',
      '--no-session-persistence',
    ]
    let out: ExecResult
    try {
      out = await exec(args, JSON.stringify(req.input))
    } catch (err) {
      throw new LlmError(`${req.name}: could not run claude (${err instanceof Error ? err.message : String(err)}); is Claude Code installed and signed in?`)
    }
    let body: { is_error?: unknown; result?: unknown; structured_output?: unknown; total_cost_usd?: unknown; api_error_status?: unknown; subtype?: unknown }
    try {
      body = JSON.parse(out.stdout) as typeof body
    } catch {
      const said = `${out.stdout} ${out.stderr}`.trim().slice(0, 300)
      if (LIMIT.test(said)) throw new UsageLimitReached(said)
      throw new Retryable(`claude exited ${out.code} without a JSON answer: ${said}`)
    }
    if (typeof body.total_cost_usd === 'number') spent += body.total_cost_usd
    if (body.is_error === true) {
      const said = String(body.result ?? body.subtype ?? '').slice(0, 300)
      if (LIMIT.test(said)) throw new UsageLimitReached(said)
      const status = typeof body.api_error_status === 'number' ? body.api_error_status : 0
      if (status === 429 || status >= 500 || body.subtype === 'error_max_turns') throw new Retryable(`${status || body.subtype}: ${said}`)
      throw new LlmError(`${req.name}: ${said}`)
    }
    if (body.structured_output === undefined || body.structured_output === null) throw new Retryable('the answer has no structured output')
    try {
      return req.parse(body.structured_output)
    } catch (err) {
      if (err instanceof ParseError) throw new Retryable(`the answer does not fit: ${err.message}`, true)
      throw err
    }
  }

  return {
    model: `claude-code:${opts.model}`,
    spentUsd: () => spent,
    async json<T>(req: LlmRequest<T>): Promise<T> {
      let last = ''
      let unfit = false
      for (let i = 0; i < ATTEMPTS; i += 1) {
        try {
          return await attempt(req)
        } catch (err) {
          if (!(err instanceof Retryable)) throw err
          last = err.message
          unfit = err.unfit
          if (i < ATTEMPTS - 1) await sleep(1000 * 2 ** i)
        }
      }
      const message = `${req.name}: gave up after ${ATTEMPTS} attempts: ${last}`
      throw unfit ? new AnswerDoesNotFit(message) : new LlmError(message)
    },
  }
}
