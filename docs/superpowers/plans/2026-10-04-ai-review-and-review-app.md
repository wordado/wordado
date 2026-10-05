# AI Review and Review App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `corpus ai-review` command that has a second model review the open review rows, a release gate that enforces the AI review, and a local web app in which a native speaker decides each flagged row beside the reviewer's objections and learner reports.

**Architecture:** The command, its prompts, its store (`ai-review/<queue>.jsonl` in the content repository) and the gate live in `pipeline/src/aiReview/` and reuse the pipeline's queues, decisions, LLM clients and draft. A new package `review-app/` is a Node HTTP server (run by `tsx`) over a content checkout, importing pipeline modules for every read and write, plus a React UI built with Vite that talks only to the server's JSON API.

**Tech Stack:** TypeScript (strict, `exactOptionalPropertyTypes`), Node 24, pnpm 12 workspace, Vitest 5, React 19, Vite 8, Testing Library + happy-dom, Playwright (Chromium) for one end-to-end run.

**Spec:** `docs/superpowers/specs/2026-10-04-ai-review-and-review-app-design.md`

## Global Constraints

- Node `>=24`, pnpm `12.4.2` (root `packageManager`); every package extends `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`).
- `pnpm lint` is `oxlint --deny-warnings`: no warnings allowed.
- The default reviewer is `google/gemini-3.8-flash` through OpenRouter (`OPENROUTER_API_KEY`). `CORPUS_LLM=claude-code` must not apply to `ai-review`.
- Queues the AI review may cover: `translation-<l1>`, `title-<l1>`, `level`. Not `english`, not `audio`.
- Store: `ai-review/<queue>.jsonl` in the content directory, append-only, one verdict per line with `key, reviewer, model, prompt_version, content, verdict, objections, at`.
- A row is AI-reviewed when every `required` reviewer (default `[default]`) has a verdict on its current content; flagged when at least `flag_when` of those are `minor` or `major`.
- The gate applies to every queue in `ai_review.queues`, including queues in `accept_unreviewed`. Being reported does not block by itself.
- The app writes exactly what a human would type into the review CSV (verdict, edited cells, note) through the pipeline's `formatCsv`, and never rewrites a file that changed on disk since it was loaded.
- The app's server listens on `127.0.0.1` only. Nothing private is written to the main repository; fixtures are invented words.
- Commits use the noreply author email already configured; British English in docs and UI text.

## Review Focus

1. **A review file edited elsewhere while the app is open** (a spreadsheet save, a new `corpus queues`, an import that deleted it): saving must not overwrite it; the app answers 409 and the UI reloads the list. Test in Task 9.
2. **A local reviewer whose server is not running**: the run fails at once naming the URL, without retries, and no verdicts are written. Test in Task 2.
3. **A row changed after it was reviewed** (a new draft proposal, or a new learner report): its old verdict stops counting, `status` lists it as not yet AI-reviewed, and `ai-review` asks again. Test in Tasks 4 and 6.
4. **Bulgarian cells with commas, quotes and ` | ` lists**: accepting a fix to alternates writes a CSV that `corpus import` parses back to the same list. Test in Task 9.
5. **A model objection that is not a change** (fix equal to the current value, or a level that is not a CEFR level): it is dropped; a row left with no objections counts as `ok`. Test in Task 3.

---

## File Structure

```
pipeline/src/
  config.ts                      + AiReviewer, AiReviewConfig, ai_review validation, aiReviewRequired()
  content.ts                     + aiReviewDir, aiReview(queue)
  localLlm.ts (+ .test.ts)       OpenAI-compatible local server as an Llm
  aiReview/
    prompts.ts (+ .test.ts)      queue kinds, per-kind system prompt, schema, request, parse
    store.ts (+ .test.ts)        rowContent hash, AiVerdict, AiReviewStore
    vote.ts (+ .test.ts)         aiState(): unreviewed | passed | flagged
    reviewers.ts (+ .test.ts)    reviewerLlm(): an Llm per configured reviewer
    rows.ts (+ .test.ts)         reviewRows(): QueueItems → ReviewRows with context from the draft
    run.ts (+ .test.ts)          runAiReview()
    gate.ts (+ .test.ts)         aiGate(): the lines planRelease adds to pending
  release.ts                     planRelease calls aiGate
  cli.ts                         ai-review command, usage, --queue/--reviewer
  template/.github/workflows/corpus.yml   + ai-review action
pipeline/README.md               + "AI review" section
pipeline/package.json            + "exports": { "./*": "./src/*.ts" }

review-app/
  package.json, tsconfig.json, vite.config.ts, vitest.config.ts, index.html, README.md
  server/
    model.ts (+ .test.ts)        listQueues(), listRows(): rows, objections, context, order
    decisions.ts (+ .test.ts)    saveDecision() with the version check; runImport()
    settings.ts (+ .test.ts)     reviewer name in ~/.config/wordado/review-app.json
    http.ts (+ .test.ts)         the JSON API and static files
    main.ts                      `review <content-dir>`: start, print URL, open browser
  src/
    api.ts                       fetch wrappers, shared types re-exported from server/types.ts
    App.tsx, main.tsx, app.css
    RowList.tsx, RowView.tsx, Objections.tsx, useKeys.ts  (+ .test.tsx)
  server/types.ts                types shared by server and UI (no Node imports)
  e2e/review.spec.ts, playwright.config.ts
.github/workflows/ci.yml         + review-app e2e step in the test job
pnpm-workspace.yaml              + review-app
```

---

### Task 1: The `ai_review` configuration

**Files:**
- Modify: `pipeline/src/config.ts`, `pipeline/src/content.ts`
- Test: `pipeline/src/config.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface AiReviewer { readonly provider: 'openrouter' | 'local'; readonly model: string; readonly url?: string }
  export interface AiReviewConfig {
    readonly queues: readonly string[]
    readonly reviewers: Readonly<Record<string, AiReviewer>>
    readonly default: string
    readonly required?: readonly string[]
    readonly flag_when: number
  }
  // PipelineConfig gains: readonly ai_review?: AiReviewConfig
  export function aiReviewRequired(cfg: AiReviewConfig): readonly string[]   // cfg.required ?? [cfg.default]
  export const AI_REVIEW_QUEUE = /^(translation|title)-[a-z]{2}$|^level$/
  // contentPaths(dir) gains: aiReviewDir: string; aiReview: (queue: string) => string   // <dir>/ai-review/<queue>.jsonl
  ```

- [ ] **Step 1: Write the failing tests** (append to `pipeline/src/config.test.ts`; `validConfig` already exists there)

```ts
describe('ai_review', () => {
  const ai = {
    queues: ['translation-bg', 'title-bg', 'level'],
    reviewers: { flash: { provider: 'openrouter', model: 'google/gemini-3.8-flash' }, bggpt: { provider: 'local', url: 'http://127.0.0.1:8091', model: 'bggpt' } },
    default: 'flash',
    flag_when: 1,
  }
  it('accepts a valid block, and required defaults to the default reviewer', () => {
    expect(configProblems({ ...validConfig, l1s: ['bg'], ai_review: ai })).toEqual([])
    expect(aiReviewRequired(ai as AiReviewConfig)).toEqual(['flash'])
    expect(aiReviewRequired({ ...ai, required: ['flash', 'bggpt'] } as AiReviewConfig)).toEqual(['flash', 'bggpt'])
  })
  it('names every problem', () => {
    expect(
      configProblems({
        ...validConfig,
        l1s: ['bg'],
        ai_review: {
          queues: ['english', 'translation-de'],
          reviewers: { x: { provider: 'cloud', model: '' }, y: { provider: 'local', model: 'm' } },
          default: 'z',
          required: ['x', 'q'],
          flag_when: 3,
        },
      }),
    ).toEqual([
      'ai_review.queues[0]: english is not a queue AI review covers (translation-<l1>, title-<l1>, level)',
      'ai_review.queues[1]: translation-de is not a queue of this content (l1s)',
      'ai_review.reviewers.x.provider: must be openrouter or local',
      'ai_review.reviewers.x.model: must be a non-empty string',
      'ai_review.reviewers.y.url: a local reviewer needs an http(s) URL',
      'ai_review.default: z is not a reviewer',
      'ai_review.required[1]: q is not a reviewer',
      'ai_review.flag_when: must be a whole number from 1 to 2 (the required reviewers)',
    ])
  })
  it('is optional', () => {
    expect(configProblems({ ...validConfig })).toEqual([])
  })
})
```

Also add, near the existing `contentPaths` tests (or in `fs.test.ts` if that is where paths are tested; if neither, add here):

```ts
it('keeps AI-review verdicts under ai-review/', () => {
  expect(contentPaths('/c').aiReview('translation-bg')).toBe('/c/ai-review/translation-bg.jsonl')
})
```

Update the file's imports: `aiReviewRequired, configProblems, type AiReviewConfig` from `./config`, and `contentPaths` from `./content`.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @wordado/pipeline exec vitest run src/config.test.ts`
Expected: FAIL (`aiReviewRequired` is not exported; `ai_review` problems missing).

- [ ] **Step 3: Implement**

In `pipeline/src/content.ts`, add to the returned object:

```ts
    aiReviewDir: join(dir, 'ai-review'),
    aiReview: (queue: string) => join(dir, 'ai-review', `${queue}.jsonl`),
```

In `pipeline/src/config.ts`, add the types above, `ai_review?: AiReviewConfig` to `PipelineConfig` (with a doc comment: "Second-model review of the review queues (spec 2026-10-04 §3). Absent: no AI review and no AI gate."), and:

```ts
export const AI_REVIEW_QUEUE = /^(translation|title)-[a-z]{2}$|^level$/

export function aiReviewRequired(cfg: AiReviewConfig): readonly string[] {
  return cfg.required ?? [cfg.default]
}

function aiReviewProblems(raw: unknown, l1s: readonly string[]): string[] {
  const p: string[] = []
  if (!isRecord(raw)) return ['ai_review: must be an object']
  const queues = raw['queues']
  const known = reviewQueues(l1s)
  if (!Array.isArray(queues) || queues.length === 0) p.push('ai_review.queues: must list at least one queue')
  else
    queues.forEach((q, i) => {
      if (typeof q !== 'string' || !AI_REVIEW_QUEUE.test(q)) p.push(`ai_review.queues[${i}]: ${String(q)} is not a queue AI review covers (translation-<l1>, title-<l1>, level)`)
      else if (!known.includes(q)) p.push(`ai_review.queues[${i}]: ${q} is not a queue of this content (l1s)`)
    })
  const reviewers = raw['reviewers']
  const names = isRecord(reviewers) ? Object.keys(reviewers) : []
  if (!isRecord(reviewers) || names.length === 0) p.push('ai_review.reviewers: must name at least one reviewer')
  else
    for (const [name, r] of Object.entries(reviewers)) {
      const path = `ai_review.reviewers.${name}`
      if (!isRecord(r)) {
        p.push(`${path}: must be an object`)
        continue
      }
      if (r['provider'] !== 'openrouter' && r['provider'] !== 'local') p.push(`${path}.provider: must be openrouter or local`)
      if (typeof r['model'] !== 'string' || r['model'].trim() === '') p.push(`${path}.model: must be a non-empty string`)
      if (r['provider'] === 'local' && !(typeof r['url'] === 'string' && /^https?:\/\//.test(r['url']))) p.push(`${path}.url: a local reviewer needs an http(s) URL`)
    }
  const def = raw['default']
  if (typeof def !== 'string' || !names.includes(def)) p.push(`ai_review.default: ${String(def)} is not a reviewer`)
  const required = raw['required'] === undefined ? (typeof def === 'string' ? [def] : []) : raw['required']
  if (!Array.isArray(required) || required.length === 0) p.push('ai_review.required: must list at least one reviewer')
  else if (raw['required'] !== undefined)
    required.forEach((r, i) => {
      if (typeof r !== 'string' || !names.includes(r)) p.push(`ai_review.required[${i}]: ${String(r)} is not a reviewer`)
    })
  const n = Array.isArray(required) ? required.length : 1
  const fw = raw['flag_when']
  if (typeof fw !== 'number' || !Number.isInteger(fw) || fw < 1 || fw > n) p.push(`ai_review.flag_when: must be a whole number from 1 to ${n} (the required reviewers)`)
  return p
}
```

and in `configProblems`, before `return p`:

```ts
  if (raw['ai_review'] !== undefined) p.push(...aiReviewProblems(raw['ai_review'], Array.isArray(l1s) ? l1s.filter((l): l is string => typeof l === 'string') : []))
```

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm --filter @wordado/pipeline exec vitest run src/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/config.ts pipeline/src/content.ts pipeline/src/config.test.ts
git commit -m "feat(pipeline): the ai_review block in pipeline.json"
```

---

### Task 2: A local OpenAI-compatible reviewer, and one Llm per reviewer

**Files:**
- Create: `pipeline/src/localLlm.ts`, `pipeline/src/localLlm.test.ts`, `pipeline/src/aiReview/reviewers.ts`, `pipeline/src/aiReview/reviewers.test.ts`

**Interfaces:**
- Consumes: `Llm`, `LlmRequest`, `LlmError`, `ParseError`, `AnswerDoesNotFit`, `openRouterLlm` from `../llm`; `AiReviewer` from `../config` (Task 1).
- Produces:
  ```ts
  export function localLlm(opts: { url: string; model: string; fetch?: typeof fetch; sleep?: (ms: number) => Promise<void> }): Llm
  // model: `local:${opts.model}`; spentUsd() always 0
  export function reviewerLlm(r: AiReviewer, opts: { maxUsd: number; apiKey: () => string; fetch?: typeof fetch }): Llm
  ```

- [ ] **Step 1: Write the failing tests**

`pipeline/src/localLlm.test.ts`:

```ts
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
```

`pipeline/src/aiReview/reviewers.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { reviewerLlm } from './reviewers'

describe('reviewerLlm', () => {
  it('makes an OpenRouter client for an openrouter reviewer and a local one for a local reviewer', () => {
    const key = () => 'k'
    expect(reviewerLlm({ provider: 'openrouter', model: 'google/gemini-3.8-flash' }, { maxUsd: 1, apiKey: key }).model).toBe('google/gemini-3.8-flash')
    expect(reviewerLlm({ provider: 'local', model: 'bggpt', url: 'http://127.0.0.1:8091' }, { maxUsd: 1, apiKey: key }).model).toBe('local:bggpt')
  })
  it('does not ask for the OpenRouter key for a local reviewer', () => {
    const key = () => {
      throw new Error('no key')
    }
    expect(() => reviewerLlm({ provider: 'local', model: 'm', url: 'http://x' }, { maxUsd: 1, apiKey: key })).not.toThrow()
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @wordado/pipeline exec vitest run src/localLlm.test.ts src/aiReview/reviewers.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement**

`pipeline/src/localLlm.ts`:

```ts
import { AnswerDoesNotFit, LlmError, ParseError, type Llm, type LlmRequest } from './llm'

const ATTEMPTS = 4

/**
 * A model served by a local OpenAI-compatible server (llama.cpp's llama-server, Ollama, vLLM): no key, no spend.
 * The answer is held to the schema by `response_format`, sent in both the llama.cpp shape (`schema`) and the
 * OpenAI shape (`json_schema.schema`). A server that does not answer fails the run at once.
 */
export function localLlm(opts: { url: string; model: string; fetch?: typeof fetch; sleep?: (ms: number) => Promise<void> }): Llm {
  const doFetch = opts.fetch ?? fetch
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const endpoint = `${opts.url.replace(/\/+$/, '')}/v1/chat/completions`
  return {
    model: `local:${opts.model}`,
    spentUsd: () => 0,
    async json<T>(req: LlmRequest<T>): Promise<T> {
      let last = ''
      for (let i = 0; i < ATTEMPTS; i += 1) {
        let res: Response
        try {
          res = await doFetch(endpoint, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              model: opts.model,
              messages: [
                { role: 'system', content: req.system },
                { role: 'user', content: JSON.stringify(req.input) },
              ],
              response_format: { type: 'json_schema', schema: req.schema, json_schema: { name: req.name, schema: req.schema } },
              temperature: 0.1,
            }),
          })
        } catch (err) {
          throw new LlmError(`${req.name}: no server answers at ${opts.url} (${err instanceof Error ? err.message : String(err)}); start it first`)
        }
        if (!res.ok) throw new LlmError(`${req.name}: ${opts.url} answered HTTP ${res.status}`)
        const body = (await res.json()) as { choices?: { message?: { content?: unknown } }[] }
        const content = body.choices?.[0]?.message?.content
        try {
          if (typeof content !== 'string') throw new ParseError('the response has no message content')
          let value: unknown
          try {
            value = JSON.parse(content)
          } catch {
            throw new ParseError('the answer is not JSON')
          }
          return req.parse(value)
        } catch (err) {
          if (!(err instanceof ParseError)) throw err
          last = err.message
          if (i < ATTEMPTS - 1) await sleep(500 * 2 ** i)
        }
      }
      throw new AnswerDoesNotFit(`${req.name}: gave up after ${ATTEMPTS} attempts: the answer does not fit: ${last}`)
    },
  }
}
```

`pipeline/src/aiReview/reviewers.ts`:

```ts
import type { AiReviewer } from '../config'
import { openRouterLlm, type Llm } from '../llm'
import { localLlm } from '../localLlm'

/** The Llm for one configured reviewer. The OpenRouter key is asked for only when the reviewer needs it. */
export function reviewerLlm(r: AiReviewer, opts: { maxUsd: number; apiKey: () => string; fetch?: typeof fetch }): Llm {
  if (r.provider === 'local') return localLlm({ url: r.url ?? '', model: r.model, ...(opts.fetch ? { fetch: opts.fetch } : {}) })
  return openRouterLlm({ apiKey: opts.apiKey(), model: r.model, maxUsd: opts.maxUsd, ...(opts.fetch ? { fetch: opts.fetch } : {}) })
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm --filter @wordado/pipeline exec vitest run src/localLlm.test.ts src/aiReview/reviewers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/localLlm.ts pipeline/src/localLlm.test.ts pipeline/src/aiReview/reviewers.ts pipeline/src/aiReview/reviewers.test.ts
git commit -m "feat(pipeline): a local OpenAI-compatible reviewer, and an Llm per configured reviewer"
```

---

### Task 3: The reviewer instructions and answers, per queue kind

**Files:**
- Create: `pipeline/src/aiReview/prompts.ts`, `pipeline/src/aiReview/prompts.test.ts`

**Interfaces:**
- Consumes: `LlmRequest`, `ParseError` from `../llm`; `L1_GUIDES` from `../stages/translate`; `CEFR_LEVELS` from `@wordado/core`.
- Produces:
  ```ts
  export type QueueKind = 'translation' | 'title' | 'level'
  export function queueKind(queue: string): QueueKind | null
  export const AI_REVIEW_VERSION: Readonly<Record<QueueKind, number>>   // all 1
  export const FIELDS: Readonly<Record<QueueKind, readonly string[]>>  // translation: translation, alternates, sense; title: title_en, title_l1; level: level
  export interface Objection { readonly field: string; readonly category: string; readonly severity: 'minor' | 'major'; readonly reason: string; readonly fix: string }
  export type AiVerdictKind = 'ok' | 'minor' | 'major'
  export interface RowVerdict { readonly key: string; readonly verdict: AiVerdictKind; readonly objections: readonly Objection[] }
  /** One row as the reviewer sees it: its editable cells as the review CSV shows them, and read-only context. */
  export interface ReviewRow { readonly key: string; readonly cells: Readonly<Record<string, string>>; readonly context: Readonly<Record<string, unknown>> }
  export function reviewRequest(queue: string, rows: readonly ReviewRow[]): LlmRequest<RowVerdict[]>
  ```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest'
import { ParseError } from '../llm'
import { AI_REVIEW_VERSION, queueKind, reviewRequest, type ReviewRow } from './prompts'

const row = (key: string, cells: Record<string, string>, context: Record<string, unknown> = {}): ReviewRow => ({ key, cells, context })
const answer = (items: unknown[]) => ({ items })
const err = (field: string, category: string, severity: string, fix: string) => ({ field, category, severity, reason: 'because', fix })

describe('queueKind', () => {
  it('knows the three kinds AI review covers', () => {
    expect([queueKind('translation-bg'), queueKind('title-de'), queueKind('level'), queueKind('english'), queueKind('audio')]).toEqual(['translation', 'title', 'level', null, null])
    expect(AI_REVIEW_VERSION).toEqual({ translation: 1, title: 1, level: 1 })
  })
})

describe('reviewRequest', () => {
  it('gives the translation reviewer the L1 guide and the rows with their context', () => {
    const req = reviewRequest('translation-bg', [row('bank-1', { translation: 'банка', alternates: '', sense: '' }, { headword: 'bank', other_live_senses: [] })])
    expect(req.system).toContain('Translate into Bulgarian')
    expect(req.system).toContain('alternate')
    expect(req.input).toEqual({ rows: [{ key: 'bank-1', translation: 'банка', alternates: '', sense: '', headword: 'bank', other_live_senses: [] }] })
  })

  it('gives the level reviewer the CEFR descriptors', () => {
    expect(reviewRequest('level', [row('x-1', { level: 'B1' })]).system).toContain('handles abstract and technical topics')
  })

  it('refuses an answer about other rows than it asked', () => {
    const req = reviewRequest('level', [row('a-1', { level: 'A1' }), row('b-1', { level: 'A2' })])
    expect(() => req.parse(answer([{ key: 'b-1', errors: [], verdict: 'ok', confidence: 1 }, { key: 'a-1', errors: [], verdict: 'ok', confidence: 1 }]))).toThrow(ParseError)
    expect(() => req.parse(answer([{ key: 'a-1', errors: [], verdict: 'ok', confidence: 1 }]))).toThrow(ParseError)
  })

  it('drops objections that change nothing or are not valid, and sets the verdict from what is left', () => {
    const req = reviewRequest('translation-bg', [
      row('a-1', { translation: 'около', alternates: 'наоколо', sense: '' }),
      row('b-1', { translation: 'час', alternates: '', sense: '' }),
    ])
    const out = req.parse(
      answer([
        { key: 'a-1', errors: [err('alternates', 'alternate-wrong', 'major', ''), err('sense', 'sense', 'minor', '')], verdict: 'minor', confidence: 0.9 },
        { key: 'b-1', errors: [err('translation', 'wrong-sense', 'major', 'час'), err('nonsense', 'other', 'minor', 'x')], verdict: 'major', confidence: 0.4 },
      ]),
    )
    expect(out).toEqual([
      { key: 'a-1', verdict: 'major', objections: [{ field: 'alternates', category: 'alternate-wrong', severity: 'major', reason: 'because', fix: '' }] },
      { key: 'b-1', verdict: 'ok', objections: [] },
    ])
  })

  it('takes a level fix only when it is a CEFR level, in capitals', () => {
    const req = reviewRequest('level', [row('a-1', { level: 'A1' }), row('b-1', { level: 'B1' })])
    const out = req.parse(
      answer([
        { key: 'a-1', errors: [err('level', 'too-low', 'major', 'b2')], verdict: 'major', confidence: 1 },
        { key: 'b-1', errors: [err('level', 'too-high', 'major', 'B3')], verdict: 'major', confidence: 1 },
      ]),
    )
    expect(out).toEqual([
      { key: 'a-1', verdict: 'major', objections: [{ field: 'level', category: 'too-low', severity: 'major', reason: 'because', fix: 'B2' }] },
      { key: 'b-1', verdict: 'ok', objections: [] },
    ])
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @wordado/pipeline exec vitest run src/aiReview/prompts.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `pipeline/src/aiReview/prompts.ts`

```ts
import { CEFR_LEVELS } from '@wordado/core'
import { ParseError, type LlmRequest } from '../llm'
import { L1_GUIDES } from '../stages/translate'

export type QueueKind = 'translation' | 'title' | 'level'
export type AiVerdictKind = 'ok' | 'minor' | 'major'

export interface Objection {
  readonly field: string
  readonly category: string
  readonly severity: 'minor' | 'major'
  readonly reason: string
  /** The field's corrected value, as the review CSV writes it (lists separated by " | "). */
  readonly fix: string
}
export interface RowVerdict {
  readonly key: string
  readonly verdict: AiVerdictKind
  readonly objections: readonly Objection[]
}
export interface ReviewRow {
  readonly key: string
  readonly cells: Readonly<Record<string, string>>
  readonly context: Readonly<Record<string, unknown>>
}

/** Bump a kind's version when its prompt or schema changes: every row of that kind is reviewed again. */
export const AI_REVIEW_VERSION: Readonly<Record<QueueKind, number>> = { translation: 1, title: 1, level: 1 }

export const FIELDS: Readonly<Record<QueueKind, readonly string[]>> = {
  translation: ['translation', 'alternates', 'sense'],
  title: ['title_en', 'title_l1'],
  level: ['level'],
}
const CATEGORIES: Readonly<Record<QueueKind, readonly string[]>> = {
  translation: ['wrong-sense', 'form', 'aspect', 'register', 'alternate-wrong', 'alternate-missing', 'sense', 'unnatural', 'spelling', 'other'],
  title: ['inaccurate', 'unnatural', 'mismatch', 'style', 'other'],
  level: ['too-low', 'too-high', 'other'],
}

export function queueKind(queue: string): QueueKind | null {
  if (/^translation-[a-z]{2}$/.test(queue)) return 'translation'
  if (/^title-[a-z]{2}$/.test(queue)) return 'title'
  return queue === 'level' ? 'level' : null
}

const COMMON = `For each row, in the order given:
1. First list the errors you find, judged against this row's own meaning and context. For each: the field, a category, a severity, a short reason in English, and the corrected value of that field, which must differ from the current one (lists are written separated by " | ").
   - major: a learner would be taught a wrong answer, or marked wrong for a right one.
   - minor: correct, but could be better.
2. Do not flag matters of taste. "No errors" is a normal outcome.
3. Then give the verdict: ok (no errors), minor (only minor ones) or major (at least one major), and your confidence from 0 to 1.
learner_reports, when not empty, is what learners said about this row: check their complaint first.`

function systemPrompt(kind: QueueKind, l1: string): string {
  if (kind === 'translation') {
    return `You are a native-speaker lexicographer reviewing an English vocabulary course for adults whose native language is the one below.
Another model wrote each row's translation, alternates and sense following these rules:

${L1_GUIDES[l1] ?? ''}

Learners are marked correct if they type the translation or any alternate, so a wrong alternate teaches a wrong answer, and a missing common one marks a right answer wrong. Near-synonyms correct in this meaning are fine.
"sense" is two to four words telling this meaning apart from the word's other meanings. It is REQUIRED when other_live_senses is not empty, and must not repeat the translation or an alternate.

${COMMON}`
  }
  if (kind === 'title') {
    return `You review the unit titles of an English vocabulary course. Each unit has about 20 words (words) and a title in English (title_en) and in the learners' native language (title_l1).
A good title is two to four words that say what the words actually have in common; the English in sentence case; the native-language title as a textbook in that language would put it, saying the same as the English. Plain titles such as "Verbs 3" or "More words 1" are fine when the words share no theme.

${COMMON}`
  }
  return `You check the CEFR level of each meaning in an English vocabulary course for adults (A1 to C1; there is no C2 in the course: give C1 and say so in the reason).
The question for each row: at which level does a typical adult learner first need this meaning?
- A1: handles basic personal and everyday needs: greetings, family, food, the home, numbers, time.
- A2: handles routine tasks and familiar topics: shopping, directions, work routines, simple past events.
- B1: handles work, study, leisure and travel; describes experiences, plans and opinions.
- B2: handles abstract and technical topics in their field.
- C1: uses the language flexibly for social, academic and professional purposes.
Judge the meaning, not the word. band is the level by written frequency alone: a strong hint, not the answer. Judge from these descriptors only; do not reproduce published level lists.
The corrected value of level is one of A1, A2, B1, B2, C1.

${COMMON}`
}

function schema(kind: QueueKind): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string' },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  field: { type: 'string', enum: FIELDS[kind] },
                  category: { type: 'string', enum: CATEGORIES[kind] },
                  severity: { type: 'string', enum: ['minor', 'major'] },
                  reason: { type: 'string' },
                  fix: { type: 'string' },
                },
                required: ['field', 'category', 'severity', 'reason', 'fix'],
                additionalProperties: false,
              },
            },
            verdict: { type: 'string', enum: ['ok', 'minor', 'major'] },
            confidence: { type: 'number' },
          },
          required: ['key', 'errors', 'verdict', 'confidence'],
          additionalProperties: false,
        },
      },
    },
    required: ['items'],
    additionalProperties: false,
  }
}

/** What remains of a raw objection: a known field and category, and a fix that changes something. */
function cleanObjection(kind: QueueKind, raw: unknown, cells: Readonly<Record<string, string>>): Objection | null {
  const o = raw as Partial<Record<keyof Objection, unknown>>
  if (typeof o.field !== 'string' || !FIELDS[kind].includes(o.field)) return null
  if (typeof o.category !== 'string' || !CATEGORIES[kind].includes(o.category)) return null
  if (o.severity !== 'minor' && o.severity !== 'major') return null
  let fix = typeof o.fix === 'string' ? o.fix.trim() : ''
  if (kind === 'level') {
    fix = fix.toUpperCase()
    if (!(CEFR_LEVELS as readonly string[]).includes(fix)) return null
  }
  if (fix === (cells[o.field] ?? '').trim()) return null
  return { field: o.field, category: o.category, severity: o.severity, reason: typeof o.reason === 'string' ? o.reason : '', fix }
}

export function reviewRequest(queue: string, rows: readonly ReviewRow[]): LlmRequest<RowVerdict[]> {
  const kind = queueKind(queue)
  if (!kind) throw new Error(`${queue} is not a queue AI review covers`)
  const l1 = queue.split('-')[1] ?? ''
  return {
    name: 'review',
    system: systemPrompt(kind, l1),
    input: { rows: rows.map((r) => ({ key: r.key, ...r.cells, ...r.context })) },
    schema: schema(kind),
    parse: (value) => {
      const items = (value as { items?: unknown }).items
      if (!Array.isArray(items) || items.length !== rows.length) throw new ParseError(`answers other rows than it was asked (${Array.isArray(items) ? items.length : 0} for ${rows.length})`)
      return items.map((raw, i) => {
        const row = rows[i]!
        const item = raw as { key?: unknown; errors?: unknown }
        if (item.key !== row.key) throw new ParseError(`answers other rows than it was asked: item ${i} is ${JSON.stringify(item.key)}, not ${row.key}`)
        const objections = (Array.isArray(item.errors) ? item.errors : []).map((e) => cleanObjection(kind, e, row.cells)).filter((o): o is Objection => o !== null)
        const verdict: AiVerdictKind = objections.length === 0 ? 'ok' : objections.some((o) => o.severity === 'major') ? 'major' : 'minor'
        return { key: row.key, verdict, objections }
      })
    },
  }
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm --filter @wordado/pipeline exec vitest run src/aiReview/prompts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/aiReview/prompts.ts pipeline/src/aiReview/prompts.test.ts
git commit -m "feat(pipeline): AI reviewer instructions and answers for translations, titles and levels"
```

---

### Task 4: The verdict store, the content hash and the vote

**Files:**
- Create: `pipeline/src/aiReview/store.ts`, `pipeline/src/aiReview/store.test.ts`, `pipeline/src/aiReview/vote.ts`, `pipeline/src/aiReview/vote.test.ts`

**Interfaces:**
- Consumes: `contentPaths` (Task 1), `appendJsonl`, `readJsonl` from `../files`, `sha256Hex` from `../checksum`, `canonicalJson` from `@wordado/core`, `AiReviewConfig`, `aiReviewRequired` (Task 1), `queueKind`, `AI_REVIEW_VERSION`, `Objection`, `AiVerdictKind` (Task 3).
- Produces:
  ```ts
  export interface AiVerdict {
    readonly key: string; readonly reviewer: string; readonly model: string; readonly prompt_version: number
    readonly content: string; readonly verdict: AiVerdictKind; readonly objections: readonly Objection[]; readonly at: string
  }
  /** sha256 of what the reviewer judged: the queue, the proposed value as the sidecar holds it, and the learner note. */
  export function rowContent(queue: string, proposed: unknown, reopened: string): string
  export class AiReviewStore {
    static read(dir: string): AiReviewStore
    append(queue: string, verdicts: readonly AiVerdict[]): void
    /** The newest verdict of this reviewer on exactly this content and prompt version, if any. */
    current(queue: string, key: string, reviewer: string, content: string): AiVerdict | undefined
  }
  export type AiState =
    | { readonly status: 'unreviewed'; readonly missing: readonly string[] }
    | { readonly status: 'passed' | 'flagged'; readonly verdicts: readonly AiVerdict[] }
  export function aiState(store: AiReviewStore, cfg: AiReviewConfig, queue: string, key: string, content: string): AiState
  /** Every configured reviewer's current verdict, required or not (what the app shows). */
  export function allVerdicts(store: AiReviewStore, cfg: AiReviewConfig, queue: string, key: string, content: string): AiVerdict[]
  ```

- [ ] **Step 1: Write the failing tests**

`store.test.ts`:

```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AiReviewStore, rowContent, type AiVerdict } from './store'

const dir = () => mkdtempSync(join(tmpdir(), 'ai-store-'))
const v = (over: Partial<AiVerdict> = {}): AiVerdict => ({
  key: 'bank-1', reviewer: 'flash', model: 'google/gemini-3.8-flash', prompt_version: 1,
  content: rowContent('translation-bg', { translation: 'банка', alternates: [], sense: '' }, ''),
  verdict: 'ok', objections: [], at: '2026-10-05T08:00:00Z', ...over,
})

describe('rowContent', () => {
  it('changes when the proposal or the learner note changes, not with key order', () => {
    const a = rowContent('translation-bg', { translation: 'x', alternates: [], sense: '' }, '')
    expect(rowContent('translation-bg', { sense: '', alternates: [], translation: 'x' }, '')).toBe(a)
    expect(rowContent('translation-bg', { translation: 'y', alternates: [], sense: '' }, '')).not.toBe(a)
    expect(rowContent('translation-bg', { translation: 'x', alternates: [], sense: '' }, '1 report: odd')).not.toBe(a)
    expect(rowContent('translation-de', { translation: 'x', alternates: [], sense: '' }, '')).not.toBe(a)
  })
})

describe('AiReviewStore', () => {
  it('keeps verdicts across a reopen, and answers only for the same content, reviewer and prompt version', () => {
    const d = dir()
    AiReviewStore.read(d).append('translation-bg', [v(), v({ verdict: 'major', at: '2026-10-06T08:00:00Z' }), v({ reviewer: 'bggpt' }), v({ prompt_version: 0 })])
    const s = AiReviewStore.read(d)
    expect(s.current('translation-bg', 'bank-1', 'flash', v().content)?.verdict).toBe('major')
    expect(s.current('translation-bg', 'bank-1', 'flash', 'other')).toBeUndefined()
    expect(s.current('title-bg', 'bank-1', 'flash', v().content)).toBeUndefined()
  })
})
```

`vote.test.ts`:

```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AiReviewConfig } from '../config'
import { AiReviewStore, type AiVerdict } from './store'
import { aiState, allVerdicts } from './vote'

const cfg = (over: Partial<AiReviewConfig> = {}): AiReviewConfig => ({
  queues: ['level'],
  reviewers: { flash: { provider: 'openrouter', model: 'f' }, pro: { provider: 'openrouter', model: 'p' }, gpt: { provider: 'openrouter', model: 'g' }, bggpt: { provider: 'local', model: 'b', url: 'http://x' } },
  default: 'flash',
  flag_when: 1,
  ...over,
})
const verdict = (reviewer: string, kind: 'ok' | 'minor' | 'major'): AiVerdict => ({ key: 'a-1', reviewer, model: reviewer, prompt_version: 1, content: 'C', verdict: kind, objections: [], at: '2026-10-05T00:00:00Z' })
function store(...vs: AiVerdict[]) {
  const s = AiReviewStore.read(mkdtempSync(join(tmpdir(), 'vote-')))
  s.append('level', vs)
  return s
}

describe('aiState', () => {
  it('is unreviewed until every required reviewer has a current verdict', () => {
    expect(aiState(store(), cfg(), 'level', 'a-1', 'C')).toEqual({ status: 'unreviewed', missing: ['flash'] })
    expect(aiState(store(verdict('flash', 'ok')), cfg({ required: ['flash', 'pro'], flag_when: 1 }), 'level', 'a-1', 'C')).toEqual({ status: 'unreviewed', missing: ['pro'] })
    expect(aiState(store(verdict('flash', 'ok')), cfg(), 'level', 'a-1', 'OTHER').status).toBe('unreviewed')
  })
  it('flags when at least flag_when required reviewers object', () => {
    expect(aiState(store(verdict('flash', 'minor')), cfg(), 'level', 'a-1', 'C').status).toBe('flagged')
    expect(aiState(store(verdict('flash', 'ok')), cfg(), 'level', 'a-1', 'C').status).toBe('passed')
    const three = cfg({ required: ['flash', 'pro', 'gpt'], flag_when: 2 })
    expect(aiState(store(verdict('flash', 'major'), verdict('pro', 'ok'), verdict('gpt', 'ok')), three, 'level', 'a-1', 'C').status).toBe('passed')
    expect(aiState(store(verdict('flash', 'major'), verdict('pro', 'minor'), verdict('gpt', 'ok')), three, 'level', 'a-1', 'C').status).toBe('flagged')
  })
  it('ignores a reviewer that is not required, but shows it', () => {
    const s = store(verdict('flash', 'ok'), verdict('bggpt', 'major'))
    expect(aiState(s, cfg(), 'level', 'a-1', 'C').status).toBe('passed')
    expect(allVerdicts(s, cfg(), 'level', 'a-1', 'C').map((x) => x.reviewer)).toEqual(['flash', 'bggpt'])
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @wordado/pipeline exec vitest run src/aiReview/store.test.ts src/aiReview/vote.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement**

`store.ts`:

```ts
import { canonicalJson } from '@wordado/core'
import { sha256Hex } from '../checksum'
import { contentPaths } from '../content'
import { appendJsonl, readJsonl } from '../files'
import { AI_REVIEW_VERSION, queueKind, type AiVerdictKind, type Objection } from './prompts'

export interface AiVerdict {
  readonly key: string
  readonly reviewer: string
  readonly model: string
  readonly prompt_version: number
  readonly content: string
  readonly verdict: AiVerdictKind
  readonly objections: readonly Objection[]
  readonly at: string
}

export function rowContent(queue: string, proposed: unknown, reopened: string): string {
  return sha256Hex(new TextEncoder().encode(canonicalJson({ queue, proposed, reopened })))
}

/** ai-review/<queue>.jsonl, append-only (spec 2026-10-04 §3.5). */
export class AiReviewStore {
  private readonly byQueue = new Map<string, AiVerdict[]>()
  private constructor(private readonly dir: string) {}

  static read(dir: string): AiReviewStore {
    return new AiReviewStore(dir)
  }

  private lines(queue: string): AiVerdict[] {
    let lines = this.byQueue.get(queue)
    if (!lines) {
      lines = readJsonl<AiVerdict>(contentPaths(this.dir).aiReview(queue))
      this.byQueue.set(queue, lines)
    }
    return lines
  }

  append(queue: string, verdicts: readonly AiVerdict[]): void {
    if (verdicts.length === 0) return
    appendJsonl(contentPaths(this.dir).aiReview(queue), verdicts)
    this.lines(queue).push(...verdicts)
  }

  current(queue: string, key: string, reviewer: string, content: string): AiVerdict | undefined {
    const kind = queueKind(queue)
    if (!kind) return undefined
    const version = AI_REVIEW_VERSION[kind]
    const lines = this.lines(queue)
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const l = lines[i]!
      if (l.key === key && l.reviewer === reviewer && l.content === content && l.prompt_version === version) return l
    }
    return undefined
  }
}
```

Check `readJsonl` returns `[]` for a missing file and `appendJsonl` creates the directory; if either does not, make the store do it (`existsSync` / `mkdirSync(dirname(file), { recursive: true })`) and keep the test green.

`vote.ts`:

```ts
import { aiReviewRequired, type AiReviewConfig } from '../config'
import type { AiReviewStore, AiVerdict } from './store'

export type AiState =
  | { readonly status: 'unreviewed'; readonly missing: readonly string[] }
  | { readonly status: 'passed' | 'flagged'; readonly verdicts: readonly AiVerdict[] }

export function aiState(store: AiReviewStore, cfg: AiReviewConfig, queue: string, key: string, content: string): AiState {
  const required = aiReviewRequired(cfg)
  const verdicts: AiVerdict[] = []
  const missing: string[] = []
  for (const r of required) {
    const v = store.current(queue, key, r, content)
    if (v) verdicts.push(v)
    else missing.push(r)
  }
  if (missing.length > 0) return { status: 'unreviewed', missing }
  const objecting = verdicts.filter((v) => v.verdict !== 'ok').length
  return { status: objecting >= cfg.flag_when ? 'flagged' : 'passed', verdicts }
}

export function allVerdicts(store: AiReviewStore, cfg: AiReviewConfig, queue: string, key: string, content: string): AiVerdict[] {
  return Object.keys(cfg.reviewers)
    .map((r) => store.current(queue, key, r, content))
    .filter((v): v is AiVerdict => v !== undefined)
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm --filter @wordado/pipeline exec vitest run src/aiReview/store.test.ts src/aiReview/vote.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/aiReview/store.ts pipeline/src/aiReview/store.test.ts pipeline/src/aiReview/vote.ts pipeline/src/aiReview/vote.test.ts
git commit -m "feat(pipeline): the AI-review store, keyed by row content, and the vote"
```

---

### Task 5: `corpus ai-review`

**Files:**
- Create: `pipeline/src/aiReview/rows.ts`, `pipeline/src/aiReview/rows.test.ts`, `pipeline/src/aiReview/run.ts`, `pipeline/src/aiReview/run.test.ts`
- Modify: `pipeline/src/cli.ts`, `pipeline/README.md`

**Interfaces:**
- Consumes: `pendingItems`, `queueSpecs`, `QueueItem` from `../queues`; `readDraft`, `Draft` from `../draft`; `Decisions` from `../decisions`; `readConfig`, `AiReviewConfig` (Task 1); `reviewRequest`, `queueKind`, `ReviewRow`, `RowVerdict`, `AI_REVIEW_VERSION` (Task 3); `AiReviewStore`, `rowContent` (Task 4); `mapLimit` from `../mapLimit`; `AnswerDoesNotFit`, `Llm` from `../llm`; `reviewerLlm` (Task 2).
- Produces:
  ```ts
  // rows.ts
  /** The review rows of one queue's open items, with the context the reviewer needs. */
  export function reviewRows(queue: string, items: readonly QueueItem[], draft: Draft, l1s: readonly string[]): ReviewRow[]
  // run.ts
  export interface AiReviewRun { readonly dir: string; readonly reviewer: string; readonly queue?: string; readonly llm: Llm; readonly concurrency: number; readonly now: () => string }
  export interface AiReviewSummary { readonly queue: string; readonly asked: number; readonly flagged: number; readonly alreadyReviewed: number }
  export async function runAiReview(run: AiReviewRun): Promise<AiReviewSummary[]>
  export function aiReviewConfig(dir: string): AiReviewConfig   // throws Error('pipeline.json has no ai_review block') when absent
  ```

- [ ] **Step 1: Write the failing tests**

`rows.test.ts` (uses the fixture draft):

```ts
import { describe, expect, it } from 'vitest'
import { Decisions, QUEUES } from '../decisions'
import { readDraft, runDraft } from '../draft'
import { pendingItems } from '../queues'
import { makeContent, sampleLlm } from '../testing/fixture'
import { reviewRows } from './rows'

describe('reviewRows', () => {
  it('gives a translation row its cells, example, other live senses and learner reports', async () => {
    const dir = makeContent()
    await runDraft({ dir, llm: sampleLlm(), offline: false })
    const draft = readDraft(dir)
    const queue = QUEUES.translation('bg')
    const items = pendingItems(draft, Decisions.read(dir), ['bg']).get(queue)!
    const rows = reviewRows(queue, items, draft, ['bg'])
    const first = rows[0]!
    expect(Object.keys(first.cells)).toEqual(['translation', 'alternates', 'sense'])
    expect(first.context).toMatchObject({ headword: expect.any(String), pos: expect.any(String), sense_en: expect.any(String), example: expect.any(String), learner_reports: '' })
    expect(Array.isArray(first.context['other_live_senses'])).toBe(true)
    // bank has two live senses in the fixture: each lists the other
    const bank = rows.find((r) => r.key === 'bank-1')
    if (bank) expect((bank.context['other_live_senses'] as { key: string }[]).map((s) => s.key)).toContain('bank-2')
  })
})
```

`run.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { writeJson } from '../files'
import { readConfig } from '../config'
import { contentPaths } from '../content'
import { runDraft } from '../draft'
import { AnswerDoesNotFit, type Llm, type LlmRequest } from '../llm'
import { makeContent, sampleLlm } from '../testing/fixture'
import { runAiReview } from './run'

/** A reviewer that objects to every row whose key starts with "bank", and counts its calls. */
function fakeReviewer(opts: { unfitAbove?: number } = {}) {
  const calls: number[] = []
  const llm: Llm = {
    model: 'fake/reviewer',
    spentUsd: () => 0,
    async json<T>(req: LlmRequest<T>): Promise<T> {
      const rows = (req.input as { rows: { key: string }[] }).rows
      calls.push(rows.length)
      if (opts.unfitAbove !== undefined && rows.length > opts.unfitAbove) throw new AnswerDoesNotFit('review: too long')
      return req.parse({
        items: rows.map((r) => ({
          key: r.key,
          // Level rows are the only ones with a band; translation rows carry `level` too, in their context.
          errors: r.key.startsWith('bank') ? [{ field: 'band' in r ? 'level' : 'translation', category: 'band' in r ? 'too-low' : 'other', severity: 'major', reason: 'r', fix: 'band' in r ? 'C1' : 'X' }] : [],
          verdict: 'ok',
          confidence: 1,
        })),
      })
    },
  }
  return { llm, calls }
}

async function content() {
  const dir = makeContent()
  await runDraft({ dir, llm: sampleLlm(), offline: false })
  const config = readConfig(dir)
  writeJson(contentPaths(dir).config, {
    ...config,
    ai_review: { queues: ['translation-bg', 'level'], reviewers: { flash: { provider: 'openrouter', model: 'google/gemini-3.8-flash' } }, default: 'flash', flag_when: 1 },
  })
  return dir
}

describe('runAiReview', () => {
  it('reviews every open row once, stores the verdicts, and asks nothing the second time', async () => {
    const dir = await content()
    const r = fakeReviewer()
    const first = await runAiReview({ dir, reviewer: 'flash', llm: r.llm, concurrency: 2, now: () => '2026-10-05T08:00:00Z' })
    const tr = first.find((s) => s.queue === 'translation-bg')!
    expect(tr.asked).toBeGreaterThan(0)
    expect(tr.flagged).toBeGreaterThan(0)
    expect(r.calls.every((n) => n <= 10)).toBe(true)
    const lines = readFileSync(contentPaths(dir).aiReview('translation-bg'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { reviewer: string; model: string; prompt_version: number })
    expect(lines[0]).toMatchObject({ reviewer: 'flash', model: 'fake/reviewer', prompt_version: 1 })
    const again = await runAiReview({ dir, reviewer: 'flash', llm: r.llm, concurrency: 2, now: () => '2026-10-05T09:00:00Z' })
    expect(again.map((s) => s.asked)).toEqual([0, 0])
    expect(again.find((s) => s.queue === 'translation-bg')!.alreadyReviewed).toBe(tr.asked)
  })

  it('reviews one queue with --queue, and refuses one AI review does not cover', async () => {
    const dir = await content()
    const out = await runAiReview({ dir, reviewer: 'flash', queue: 'level', llm: fakeReviewer().llm, concurrency: 1, now: () => 'n' })
    expect(out.map((s) => s.queue)).toEqual(['level'])
    await expect(runAiReview({ dir, reviewer: 'flash', queue: 'english', llm: fakeReviewer().llm, concurrency: 1, now: () => 'n' })).rejects.toThrow(/english is not in ai_review.queues/)
    await expect(runAiReview({ dir, reviewer: 'nobody', llm: fakeReviewer().llm, concurrency: 1, now: () => 'n' })).rejects.toThrow(/nobody is not a reviewer/)
  })

  it('asks a batch whose answer never fits again in halves', async () => {
    const dir = await content()
    const r = fakeReviewer({ unfitAbove: 4 })
    const out = await runAiReview({ dir, reviewer: 'flash', queue: 'translation-bg', llm: r.llm, concurrency: 1, now: () => 'n' })
    expect(out[0]!.asked).toBeGreaterThan(4)
    expect(r.calls.some((n) => n > 4)).toBe(true)
    expect(r.calls.filter((n) => n <= 4).length).toBeGreaterThan(0)
  })

  it('says plainly when pipeline.json has no ai_review block', async () => {
    const dir = makeContent()
    await runDraft({ dir, llm: sampleLlm(), offline: false })
    await expect(runAiReview({ dir, reviewer: 'flash', llm: fakeReviewer().llm, concurrency: 1, now: () => 'n' })).rejects.toThrow('pipeline.json has no ai_review block')
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @wordado/pipeline exec vitest run src/aiReview/rows.test.ts src/aiReview/run.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement**

`rows.ts`:

```ts
import { norm } from '@wordado/core'
import type { Draft } from '../draft'
import { queueSpecs, type QueueItem } from '../queues'
import { queueKind, type ReviewRow } from './prompts'

export function reviewRows(queue: string, items: readonly QueueItem[], draft: Draft, l1s: readonly string[]): ReviewRow[] {
  const kind = queueKind(queue)
  const spec = queueSpecs(l1s).get(queue)
  if (!kind || !spec) throw new Error(`${queue} is not a queue AI review covers`)
  const live = new Set(draft.live)
  const byId = new Map(draft.entries.map((e) => [e.entry_id, e]))
  const l1 = queue.split('-')[1] ?? ''
  const siblings = new Map<string, string[]>()
  for (const e of draft.entries) {
    if (!live.has(e.entry_id)) continue
    const k = `${norm(e.headword)}|${e.pos}`
    siblings.set(k, [...(siblings.get(k) ?? []), e.entry_id])
  }
  return items.map((item) => {
    const cells = spec.toCells(item.proposed)
    const learner_reports = item.context['reopened'] ?? ''
    if (kind === 'title') return { key: item.key, cells, context: { level: item.context['level'] ?? '', words: item.context['words'] ?? '', learner_reports } }
    const e = byId.get(item.key)
    const example = e?.english.examples[0] ?? item.context['example'] ?? ''
    if (kind === 'level') {
      return { key: item.key, cells, context: { headword: item.context['headword'] ?? '', pos: item.context['pos'] ?? '', sense_en: item.context['sense_en'] ?? '', example, band: item.context['band'] ?? '', learner_reports } }
    }
    const others = e ? (siblings.get(`${norm(e.headword)}|${e.pos}`) ?? []).filter((id) => id !== item.key) : []
    return {
      key: item.key,
      cells,
      context: {
        headword: item.context['headword'] ?? '',
        pos: item.context['pos'] ?? '',
        sense_en: item.context['sense_en'] ?? '',
        level: item.context['level'] ?? '',
        example,
        other_live_senses: others.map((id) => ({ key: id, translation: byId.get(id)?.l1[l1]?.translation ?? '', sense_en: byId.get(id)?.sense_en ?? '' })),
        learner_reports,
      },
    }
  })
}
```

`run.ts`:

```ts
import { readConfig, type AiReviewConfig } from '../config'
import { Decisions } from '../decisions'
import { readDraft } from '../draft'
import { AnswerDoesNotFit, type Llm } from '../llm'
import { mapLimit } from '../mapLimit'
import { pendingItems } from '../queues'
import { AI_REVIEW_VERSION, queueKind, reviewRequest, type ReviewRow } from './prompts'
import { reviewRows } from './rows'
import { AiReviewStore, rowContent, type AiVerdict } from './store'

export interface AiReviewRun {
  readonly dir: string
  readonly reviewer: string
  readonly queue?: string
  readonly llm: Llm
  readonly concurrency: number
  readonly now: () => string
}
export interface AiReviewSummary {
  readonly queue: string
  readonly asked: number
  readonly flagged: number
  readonly alreadyReviewed: number
}

const BATCH = 10

export function aiReviewConfig(dir: string): AiReviewConfig {
  const cfg = readConfig(dir).ai_review
  if (!cfg) throw new Error('pipeline.json has no ai_review block')
  return cfg
}

/** `corpus ai-review`: every open row of the AI-reviewed queues that this reviewer has not judged in its current form. */
export async function runAiReview(run: AiReviewRun): Promise<AiReviewSummary[]> {
  const config = readConfig(run.dir)
  const cfg = aiReviewConfig(run.dir)
  if (!(run.reviewer in cfg.reviewers)) throw new Error(`${run.reviewer} is not a reviewer in ai_review.reviewers`)
  if (run.queue !== undefined && !cfg.queues.includes(run.queue)) throw new Error(`${run.queue} is not in ai_review.queues`)
  const queues = run.queue !== undefined ? [run.queue] : cfg.queues
  const draft = readDraft(run.dir)
  const pending = pendingItems(draft, Decisions.read(run.dir), config.l1s)
  const store = AiReviewStore.read(run.dir)
  const out: AiReviewSummary[] = []
  for (const queue of queues) {
    const kind = queueKind(queue)!
    const items = pending.get(queue) ?? []
    const contentOf = new Map(items.map((i) => [i.key, rowContent(queue, i.proposed, i.context['reopened'] ?? '')]))
    const todo = items.filter((i) => !store.current(queue, i.key, run.reviewer, contentOf.get(i.key)!))
    const rows = reviewRows(queue, todo, draft, config.l1s)
    let flagged = 0
    const ask = async (batch: readonly ReviewRow[]): Promise<void> => {
      let verdicts
      try {
        verdicts = await run.llm.json(reviewRequest(queue, batch))
      } catch (err) {
        if (!(err instanceof AnswerDoesNotFit) || batch.length < 2) throw err
        const half = Math.ceil(batch.length / 2)
        await ask(batch.slice(0, half))
        await ask(batch.slice(half))
        return
      }
      const at = run.now()
      const lines: AiVerdict[] = verdicts.map((v) => ({
        key: v.key,
        reviewer: run.reviewer,
        model: run.llm.model,
        prompt_version: AI_REVIEW_VERSION[kind],
        content: contentOf.get(v.key)!,
        verdict: v.verdict,
        objections: v.objections,
        at,
      }))
      flagged += lines.filter((l) => l.verdict !== 'ok').length
      store.append(queue, lines)
    }
    const batches: ReviewRow[][] = []
    for (let i = 0; i < rows.length; i += BATCH) batches.push(rows.slice(i, i + BATCH))
    await mapLimit(batches, run.concurrency, ask)
    out.push({ queue, asked: rows.length, flagged, alreadyReviewed: items.length - todo.length })
  }
  return out
}
```

Check `mapLimit`'s signature in `pipeline/src/mapLimit.ts` (it is used by `cachedBatch` as `mapLimit(items, limit, fn)`); adapt the call if its argument order differs.

In `pipeline/src/cli.ts`:
- import `runAiReview`, `aiReviewConfig` from `./aiReview/run` and `reviewerLlm` from `./aiReview/reviewers`;
- add `'--queue', '--reviewer'` to `VALUED`;
- add to `USAGE` after the `compare` lines:
  ```
      ai-review <dir> [--queue <q>] [--reviewer <name>]
                                     a second model reviews the open rows of ai_review.queues (pipeline.json)
  ```
- add the handler:

```ts
async function aiReview(dir: string): Promise<void> {
  const config = readConfig(dir)
  const cfg = aiReviewConfig(dir)
  const name = option('--reviewer') ?? cfg.default
  const reviewer = cfg.reviewers[name]
  if (!reviewer) {
    console.error(`${name} is not a reviewer in ai_review.reviewers`)
    process.exit(2)
  }
  const llm = reviewerLlm(reviewer, { maxUsd: config.llm.max_usd_per_run, apiKey })
  const queue = option('--queue')
  const out = await runAiReview({ dir, reviewer: name, ...(queue !== undefined ? { queue } : {}), llm, concurrency: llmConcurrency() ?? config.llm.concurrency, now })
  for (const s of out) console.log(`${s.queue}: ${s.asked} reviewed by ${name}, ${s.flagged} with objections; ${s.alreadyReviewed} already reviewed`)
  console.log(`spend ${spendNote(llm)}`)
}
```

- and the case: `case 'ai-review': await aiReview(arg(first)); break`.

In `pipeline/README.md`, add a section after "A second review":

```markdown
## AI review

The beta's review tiers (spec §5.4, and `docs/superpowers/specs/2026-10-04-ai-review-and-review-app-design.md`): a
model from another family than the one that wrote the corpus checks every open row of the queues in
`ai_review.queues`, and a native speaker decides the rows it flags.

    "ai_review": {
      "queues": ["translation-bg", "title-bg", "level"],
      "reviewers": { "flash": { "provider": "openrouter", "model": "google/gemini-3.8-flash" },
                     "bggpt": { "provider": "local", "url": "http://127.0.0.1:8091", "model": "bggpt" } },
      "default": "flash",
      "flag_when": 1
    }

`corpus ai-review "$PWD/content" [--queue <q>] [--reviewer <name>]` reviews every open row the reviewer has not judged
in its current form, and appends the verdicts to `ai-review/<queue>.jsonl`. A row whose proposal or learner note
changes is reviewed again. `required` (default: the default reviewer) lists whose verdicts every row needs; a row is
flagged when `flag_when` of them object. A `local` reviewer is any OpenAI-compatible server, for example llama.cpp's
`llama-server -m <model.gguf> --port 8091 --jinja`; start it first.

`status` lists, per AI-reviewed queue, the rows not yet AI-reviewed and the flagged rows awaiting a decision;
`release` refuses while either is open, even for queues in `accept_unreviewed`. Decide the flagged rows in the review
app (`review-app/README.md`), then `corpus import`.
```

- [ ] **Step 4: Run them to see them pass, and the whole pipeline suite**

Run: `pnpm --filter @wordado/pipeline exec vitest run src/aiReview` then `pnpm --filter @wordado/pipeline test` and `pnpm --filter @wordado/pipeline typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/aiReview/rows.ts pipeline/src/aiReview/rows.test.ts pipeline/src/aiReview/run.ts pipeline/src/aiReview/run.test.ts pipeline/src/cli.ts pipeline/README.md
git commit -m "feat(pipeline): corpus ai-review"
```

---

### Task 6: The release gate

**Files:**
- Create: `pipeline/src/aiReview/gate.ts`, `pipeline/src/aiReview/gate.test.ts`
- Modify: `pipeline/src/release.ts`, `pipeline/src/release.test.ts`

**Interfaces:**
- Consumes: `pendingItems`, `QueueItem` (queues), `AiReviewStore`, `rowContent` (Task 4), `aiState` (Task 4), `AiReviewConfig` (Task 1).
- Produces:
  ```ts
  /** Lines for planRelease's pending list, per AI-reviewed queue: "<key>: not yet AI-reviewed (<queue>)" and "<key>: flagged by AI review, awaiting a decision (<queue>)". */
  export function aiGate(cfg: AiReviewConfig | undefined, pending: ReadonlyMap<string, readonly QueueItem[]>, store: AiReviewStore): string[]
  ```

- [ ] **Step 1: Write the failing tests**

`gate.test.ts`:

```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AiReviewConfig } from '../config'
import type { QueueItem } from '../queues'
import { aiGate } from './gate'
import { AiReviewStore, rowContent } from './store'

const cfg: AiReviewConfig = { queues: ['level'], reviewers: { flash: { provider: 'openrouter', model: 'f' } }, default: 'flash', flag_when: 1 }
const item = (key: string, proposed: string, reopened = ''): QueueItem => ({ key, proposed, context: { reopened } })

describe('aiGate', () => {
  it('says nothing without an ai_review block', () => {
    expect(aiGate(undefined, new Map([['level', [item('a-1', 'A1')]]]), AiReviewStore.read(mkdtempSync(join(tmpdir(), 'g-'))))).toEqual([])
  })
  it('lists unreviewed and flagged rows, and passes reviewed ok rows', () => {
    const store = AiReviewStore.read(mkdtempSync(join(tmpdir(), 'g-')))
    const v = (key: string, proposed: string, verdict: 'ok' | 'major') => ({ key, reviewer: 'flash', model: 'f', prompt_version: 1, content: rowContent('level', proposed, ''), verdict, objections: [], at: 'n' })
    store.append('level', [v('a-1', 'A1', 'ok'), v('b-1', 'A2', 'major'), v('c-1', 'B1', 'ok')])
    const pending = new Map([['level', [item('a-1', 'A1'), item('b-1', 'A2'), item('c-1', 'B2'), item('d-1', 'A1')]], ['english', [item('e-1', 'x')]]])
    expect(aiGate(cfg, pending, store)).toEqual([
      'b-1: flagged by AI review, awaiting a decision (level)',
      'c-1: not yet AI-reviewed (level)',
      'd-1: not yet AI-reviewed (level)',
    ])
  })
  it('treats a new learner report as a change that needs review again', () => {
    const store = AiReviewStore.read(mkdtempSync(join(tmpdir(), 'g-')))
    store.append('level', [{ key: 'a-1', reviewer: 'flash', model: 'f', prompt_version: 1, content: rowContent('level', 'A1', ''), verdict: 'ok', objections: [], at: 'n' }])
    expect(aiGate(cfg, new Map([['level', [item('a-1', 'A1', '1 report: too easy')]]]), store)).toEqual(['a-1: not yet AI-reviewed (level)'])
  })
})
```

In `release.test.ts`, add:

```ts
it('blocks a release on AI review, even for a queue in accept_unreviewed, and passes once it is done', async () => {
  const dir = await reviewed()            // existing helper: drafted, audio, everything approved
  const config = JSON.parse(readFileSync(join(dir, 'pipeline.json'), 'utf8'))
  // Reopen one level row so it is open again, and put the level queue under AI review and accept_unreviewed.
  const draft = readDraft(dir)
  const decisions = Decisions.read(dir)
  const key = draft.live[0]!
  decisions.append(QUEUES.level, [{ key, at: '2026-10-03T00:00:00Z', verdict: 'reopen', by: 'reports', note: '1 report: too easy' }])
  writeJson(join(dir, 'pipeline.json'), { ...config, accept_unreviewed: ['level'], ai_review: { queues: ['level'], reviewers: { flash: { provider: 'openrouter', model: 'f' } }, default: 'flash', flag_when: 1 } })
  const blocked = planRelease(dir, { draft: false, now: NOW })
  expect(blocked.pending.some((l) => l.endsWith('not yet AI-reviewed (level)'))).toBe(true)
})
```

If no live entry of the fixture has a level row (level rows exist only for flagged or sampled entries), pick `key` from `pendingItems(...)` before approving instead: the test must reopen a key the level queue actually covers. Use `levelSampled`/`level_flagged` from the draft to choose it, or fall back to the `translation-bg` queue with the same assertions.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @wordado/pipeline exec vitest run src/aiReview/gate.test.ts src/release.test.ts`
Expected: FAIL (gate module missing; release test finds no AI line).

- [ ] **Step 3: Implement**

`gate.ts`:

```ts
import type { AiReviewConfig } from '../config'
import type { QueueItem } from '../queues'
import { rowContent, type AiReviewStore } from './store'
import { aiState } from './vote'

export function aiGate(cfg: AiReviewConfig | undefined, pending: ReadonlyMap<string, readonly QueueItem[]>, store: AiReviewStore): string[] {
  if (!cfg) return []
  const lines: string[] = []
  for (const queue of cfg.queues) {
    for (const item of pending.get(queue) ?? []) {
      const state = aiState(store, cfg, queue, item.key, rowContent(queue, item.proposed, item.context['reopened'] ?? ''))
      if (state.status === 'unreviewed') lines.push(`${item.key}: not yet AI-reviewed (${queue})`)
      else if (state.status === 'flagged') lines.push(`${item.key}: flagged by AI review, awaiting a decision (${queue})`)
    }
  }
  return lines
}
```

In `release.ts` `planRelease`, after `pending.push(...audio.missing)` and the `unheard` lines, add:

```ts
  // AI review gates every release (spec §5.4), whether or not its queue is in accept_unreviewed.
  pending.push(...aiGate(config.ai_review, pendingItems(draft, decisions, config.l1s), AiReviewStore.read(dir)))
```

with imports `import { aiGate } from './aiReview/gate'`, `import { AiReviewStore } from './aiReview/store'`, `import { pendingItems } from './queues'`.

`status` and `release` in `cli.ts` already print `pending` through `summarise()`, which groups "N × not yet AI-reviewed (level)". No change there.

- [ ] **Step 4: Run them to see them pass, and the whole suite**

Run: `pnpm --filter @wordado/pipeline test` and `pnpm --filter @wordado/pipeline typecheck`
Expected: PASS. The existing release tests still pass: the fixture has no `ai_review` block.

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/aiReview/gate.ts pipeline/src/aiReview/gate.test.ts pipeline/src/release.ts pipeline/src/release.test.ts
git commit -m "feat(pipeline): AI review gates a release"
```

---

### Task 7: The `ai-review` Corpus action

**Files:**
- Modify: `pipeline/template/.github/workflows/corpus.yml`

The content repository's own `.github/workflows/corpus.yml` is a copy of this template; copying it there is a separate, approved step after merge (it touches the content repository).

- [ ] **Step 1: Add the action**

In the `workflow_dispatch.inputs.action.options` list add `ai-review` after `audio`. In the `work` job's `Run ${{ inputs.action }}` step, add to the `case`:

```yaml
            ai-review) $CORPUS draft "$content" --offline && $CORPUS ai-review "$content" ;;
```

(`--offline`: the review needs the current draft, not new LLM answers; a draft that needs new answers fails here, and the operator runs `draft` first.)

- [ ] **Step 2: Lint it**

Run: `docker run --rm -v "$PWD:/repo" --workdir /repo rhysd/actionlint:1.7.7 -color pipeline/template/.github/workflows/corpus.yml`
Expected: no output. If Docker is unavailable locally, CI's `static` job runs the same check.

- [ ] **Step 3: Commit**

```bash
git add pipeline/template/.github/workflows/corpus.yml
git commit -m "ci(content template): the ai-review Corpus action"
```

---

### Task 8: The review app's package and its server model

**Files:**
- Create: `review-app/package.json`, `review-app/tsconfig.json`, `review-app/vitest.config.ts`, `review-app/server/types.ts`, `review-app/server/model.ts`, `review-app/server/model.test.ts`, `review-app/server/fixture.ts`
- Modify: `pnpm-workspace.yaml`, `pipeline/package.json`

**Interfaces:**
- Consumes (pipeline, via `@wordado/pipeline/<module>`): `readConfig`, `contentPaths`, `csvRecords`, `readJson`, `readDraft`, `queueSpecs`, `AiReviewStore`, `rowContent`, `aiState`, `allVerdicts`, `queueKind`, `FIELDS`.
- Produces (`server/types.ts`, no Node imports, shared with the UI):
  ```ts
  export type Source = 'report' | 'ai'
  export interface ObjectionView { reviewer: string; model: string; field: string; category: string; severity: 'minor' | 'major'; reason: string; fix: string }
  export interface RowView {
    queue: string; file: string; version: string; key: string
    kind: 'translation' | 'title' | 'level'
    cells: Record<string, string>; fields: string[]
    context: Record<string, string>          // headword, pos, sense_en, level, example, band, words, as the CSV holds them
    otherSenses: { key: string; translation: string; sense_en: string }[]
    reports: string                           // the reopened column
    ai: 'unreviewed' | 'passed' | 'flagged'
    severity: 'major' | 'minor' | null        // the worst objection among required verdicts
    objections: ObjectionView[]               // every configured reviewer's current objections
    decided: { verdict: string; note: string } | null   // a verdict already written in the CSV, not yet imported
  }
  export interface QueueSummary { queue: string; open: number; flagged: number; reported: number; decided: number }
  ```
  and `server/model.ts`:
  ```ts
  export function listQueues(dir: string): QueueSummary[]
  /** Rows of one queue, open ones in order: reported, then major, minor, then (when withUnflagged) the rest. */
  export function listRows(dir: string, queue: string, opts: { withUnflagged: boolean }): RowView[]
  export function fileVersion(text: string): string   // sha256 hex of the file's text
  ```
  and `server/fixture.ts` (tests only): `export async function reviewFixture(): Promise<string>` — a drafted content dir with `ai_review` for `translation-bg` and `level`, review files exported, and one fake verdict per row (major on `bank-*`, ok on the rest), plus one reopened row.

- [ ] **Step 1: Scaffold the package**

`pipeline/package.json`: add `"exports": { "./*": "./src/*.ts" }` (other packages import `@wordado/pipeline/queues` etc.; `tsx` and Vitest resolve TypeScript sources directly). Run the pipeline suite once to see nothing changed.

`pnpm-workspace.yaml`: add `  - review-app` under `packages`.

`review-app/package.json`:

```json
{
  "name": "@wordado/review-app",
  "private": true,
  "type": "module",
  "scripts": {
    "review": "vite build && tsx server/main.ts",
    "dev": "tsx server/main.ts --dev",
    "build": "vite build",
    "test": "vitest run",
    "e2e": "playwright test",
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@wordado/core": "workspace:*",
    "@wordado/pipeline": "workspace:*",
    "react": "^19.3.0",
    "react-dom": "^19.3.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.63.0",
    "@testing-library/react": "^16.3.3",
    "@types/node": "^24.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^6.1.1",
    "happy-dom": "^20.14.5",
    "tsx": "^4.19.0",
    "vite": "^8.3.0"
  }
}
```

(Versions copied from `web/package.json` and `pipeline/package.json`, so the lockfile adds nothing new.)

`review-app/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "types": ["node", "vite/client"], "lib": ["ES2022", "DOM", "DOM.Iterable"], "jsx": "react-jsx" },
  "include": ["server", "src", "e2e", "vite.config.ts", "vitest.config.ts", "playwright.config.ts"]
}
```

`review-app/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'server', include: ['server/**/*.test.ts'], environment: 'node' } },
      { test: { name: 'ui', include: ['src/**/*.test.tsx'], environment: 'happy-dom' } },
    ],
  },
})
```

Run `pnpm install` at the root.

- [ ] **Step 2: Write the failing test** `review-app/server/model.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { reviewFixture } from './fixture'
import { listQueues, listRows } from './model'

describe('listRows', () => {
  it('puts reported rows first, then majors; hides passed rows unless asked', async () => {
    const dir = await reviewFixture()
    const rows = listRows(dir, 'translation-bg', { withUnflagged: false })
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0]!.reports).not.toBe('')
    expect(rows.every((r) => r.reports !== '' || r.ai === 'flagged')).toBe(true)
    const all = listRows(dir, 'translation-bg', { withUnflagged: true })
    expect(all.length).toBeGreaterThan(rows.length)
    expect(all.some((r) => r.ai === 'passed')).toBe(true)
  })

  it('shows a flagged row its cells, the field the objection targets, and other live senses', async () => {
    const dir = await reviewFixture()
    const bank = listRows(dir, 'translation-bg', { withUnflagged: false }).find((r) => r.key.startsWith('bank-'))!
    expect(bank.fields).toEqual(['translation', 'alternates', 'sense'])
    expect(bank.objections[0]).toMatchObject({ reviewer: 'flash', field: 'translation', severity: 'major' })
    expect(bank.severity).toBe('major')
    expect(bank.otherSenses.map((s) => s.key).some((k) => k.startsWith('bank-'))).toBe(true)
    expect(bank.file).toMatch(/^review\/translation-bg\/.+\.csv$/)
    expect(bank.version).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('listQueues', () => {
  it('counts open, flagged and reported rows per AI-reviewed queue', async () => {
    const dir = await reviewFixture()
    const q = listQueues(dir).find((x) => x.queue === 'translation-bg')!
    expect(q.flagged).toBeGreaterThan(0)
    expect(q.reported).toBe(1)
    expect(q.open).toBeGreaterThanOrEqual(q.flagged)
  })
})
```

`review-app/server/fixture.ts`:

```ts
import { readConfig } from '@wordado/pipeline/config'
import { contentPaths } from '@wordado/pipeline/content'
import { Decisions, QUEUES } from '@wordado/pipeline/decisions'
import { readDraft, runDraft } from '@wordado/pipeline/draft'
import { writeJson } from '@wordado/pipeline/files'
import { exportQueues, pendingItems, queueSpecs } from '@wordado/pipeline/queues'
import { makeContent, sampleLlm } from '@wordado/pipeline/testing/fixture'
import { AiReviewStore, rowContent } from '@wordado/pipeline/aiReview/store'

/** A drafted content dir with AI review on translation-bg and level: Flash objects to bank-*, passes the rest; one row reopened. */
export async function reviewFixture(): Promise<string> {
  const dir = makeContent()
  await runDraft({ dir, llm: sampleLlm(), offline: false })
  const config = readConfig(dir)
  writeJson(contentPaths(dir).config, {
    ...config,
    ai_review: { queues: ['translation-bg', 'level'], reviewers: { flash: { provider: 'openrouter', model: 'google/gemini-3.8-flash' } }, default: 'flash', flag_when: 1 },
  })
  const draft = readDraft(dir)
  const decisions = Decisions.read(dir)
  const reopenKey = draft.live.find((k) => !k.startsWith('bank-'))!
  decisions.append(QUEUES.translation('bg'), [{ key: reopenKey, at: '2026-10-04T00:00:00Z', verdict: 'reopen', by: 'reports', note: '1 report (translation): odd word' }])
  const items = pendingItems(draft, Decisions.read(dir), config.l1s)
  exportQueues(dir, items, queueSpecs(config.l1s), { stamp: '2026-10-04' })
  const store = AiReviewStore.read(dir)
  for (const queue of ['translation-bg', 'level']) {
    store.append(
      queue,
      (items.get(queue) ?? []).map((i) => {
        const bad = i.key.startsWith('bank-')
        const field = queue === 'level' ? 'level' : 'translation'
        return {
          key: i.key, reviewer: 'flash', model: 'google/gemini-3.8-flash', prompt_version: 1,
          content: rowContent(queue, i.proposed, i.context['reopened'] ?? ''),
          verdict: bad ? ('major' as const) : ('ok' as const),
          objections: bad ? [{ field, category: queue === 'level' ? 'too-low' : 'wrong-sense', severity: 'major' as const, reason: 'wrong meaning', fix: queue === 'level' ? 'B2' : 'брег' }] : [],
          at: '2026-10-04T01:00:00Z',
        }
      }),
    )
  }
  return dir
}
```

(The fixture's `pendingItems` already reflects the reopen, so the reopened row's content hash includes its note. `pipeline/src/testing/fixture.ts` is reachable as `@wordado/pipeline/testing/fixture` through the `exports` map.)

- [ ] **Step 3: Run it to see it fail**

Run: `pnpm --filter @wordado/review-app exec vitest run --project server`
Expected: FAIL (`./model` not found).

- [ ] **Step 4: Implement** `server/types.ts` (the types in Interfaces, exported) and `server/model.ts`:

```ts
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { norm } from '@wordado/core'
import { aiReviewRequired, readConfig, type AiReviewConfig } from '@wordado/pipeline/config'
import { contentPaths } from '@wordado/pipeline/content'
import { csvRecords } from '@wordado/pipeline/csv'
import { readDraft } from '@wordado/pipeline/draft'
import { readJson } from '@wordado/pipeline/files'
import { FIELDS, queueKind } from '@wordado/pipeline/aiReview/prompts'
import { AiReviewStore, rowContent } from '@wordado/pipeline/aiReview/store'
import { aiState, allVerdicts } from '@wordado/pipeline/aiReview/vote'
import type { QueueSummary, RowView } from './types'

export const fileVersion = (text: string) => createHash('sha256').update(text).digest('hex')

interface Sidecar { readonly items: readonly { readonly key: string; readonly proposed: unknown }[] }

function aiConfig(dir: string): AiReviewConfig {
  const cfg = readConfig(dir).ai_review
  if (!cfg) throw new Error('pipeline.json has no ai_review block: add one (pipeline/README.md, "AI review")')
  return cfg
}

/** Every row of every open file of one queue, as the app shows it. */
function rowsOf(dir: string, queue: string): RowView[] {
  const kind = queueKind(queue)
  if (!kind) return []
  const cfg = aiConfig(dir)
  const qdir = contentPaths(dir).queueDir(queue)
  if (!existsSync(qdir)) return []
  const store = AiReviewStore.read(dir)
  const draft = readDraft(dir)
  const live = new Set(draft.live)
  const byId = new Map(draft.entries.map((e) => [e.entry_id, e]))
  const l1 = queue.split('-')[1] ?? ''
  const required = new Set(aiReviewRequired(cfg))
  const out: RowView[] = []
  for (const name of readdirSync(qdir).filter((f) => f.endsWith('.csv')).sort()) {
    const file = join('review', queue, name)
    const text = readFileSync(join(dir, file), 'utf8')
    const version = fileVersion(text)
    const sidecar = readJson<Sidecar>(join(dir, file.replace(/\.csv$/, '.json')))
    const proposals = new Map(sidecar.items.map((i) => [i.key, i.proposed]))
    for (const row of csvRecords(text).rows) {
      const key = (row['key'] ?? '').trim()
      if (!proposals.has(key)) continue
      const reports = row['reopened'] ?? ''
      const content = rowContent(queue, proposals.get(key), reports)
      const state = aiState(store, cfg, queue, key, content)
      const verdicts = allVerdicts(store, cfg, queue, key, content)
      const requiredObjections = verdicts.filter((v) => required.has(v.reviewer)).flatMap((v) => v.objections)
      const e = byId.get(key)
      const otherSenses =
        kind === 'translation' && e
          ? draft.entries
              .filter((o) => o.entry_id !== key && live.has(o.entry_id) && norm(o.headword) === norm(e.headword) && o.pos === e.pos)
              .map((o) => ({ key: o.entry_id, translation: o.l1[l1]?.translation ?? '', sense_en: o.sense_en }))
          : []
      const verdict = (row['verdict'] ?? '').trim()
      out.push({
        queue, file, version, key, kind,
        cells: Object.fromEntries(FIELDS[kind].map((f) => [f, row[f] ?? ''])),
        fields: [...FIELDS[kind]],
        context: Object.fromEntries(['headword', 'pos', 'sense_en', 'level', 'example', 'band', 'words'].filter((c) => c in row).map((c) => [c, row[c] ?? ''])),
        otherSenses,
        reports,
        ai: state.status,
        severity: requiredObjections.some((o) => o.severity === 'major') ? 'major' : requiredObjections.length > 0 ? 'minor' : null,
        objections: verdicts.flatMap((v) => v.objections.map((o) => ({ reviewer: v.reviewer, model: v.model, ...o }))),
        decided: verdict === '' ? null : { verdict, note: row['note'] ?? '' },
      })
    }
  }
  return out
}

const rank = (r: RowView) => (r.reports !== '' ? 0 : r.severity === 'major' ? 1 : r.severity === 'minor' ? 2 : r.ai === 'unreviewed' ? 3 : 4)

export function listRows(dir: string, queue: string, opts: { withUnflagged: boolean }): RowView[] {
  return rowsOf(dir, queue)
    .filter((r) => opts.withUnflagged || r.reports !== '' || r.ai === 'flagged')
    .sort((a, b) => rank(a) - rank(b))
}

export function listQueues(dir: string): QueueSummary[] {
  return aiConfig(dir).queues.map((queue) => {
    const rows = rowsOf(dir, queue)
    return {
      queue,
      open: rows.length,
      flagged: rows.filter((r) => r.ai === 'flagged').length,
      reported: rows.filter((r) => r.reports !== '').length,
      decided: rows.filter((r) => r.decided !== null).length,
    }
  })
}
```

(`Array.prototype.sort` is stable, so within a rank rows keep file order.)

- [ ] **Step 5: Run it to see it pass; typecheck**

Run: `pnpm --filter @wordado/review-app exec vitest run --project server` and `pnpm --filter @wordado/review-app typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add pnpm-workspace.yaml pnpm-lock.yaml pipeline/package.json review-app
git commit -m "feat(review-app): the package, and the rows a reviewer sees"
```

---

### Task 9: Saving decisions, importing, and the reviewer's name

**Files:**
- Create: `review-app/server/decisions.ts`, `review-app/server/decisions.test.ts`, `review-app/server/settings.ts`, `review-app/server/settings.test.ts`
- Modify: `review-app/server/types.ts`

**Interfaces:**
- Consumes: `fileVersion`, `listRows` (Task 8); `csvRecords`, `formatCsv` (pipeline csv); `importQueues`, `queueSpecs` (pipeline queues); `readConfig`.
- Produces (`types.ts`):
  ```ts
  export type Action = 'accept' | 'keep' | 'edit' | 'drop'
  export interface DecisionRequest { queue: string; file: string; version: string; key: string; action: Action; cells?: Record<string, string>; note?: string }
  export type DecisionResult = { ok: true; version: string } | { ok: false; reason: 'changed' | 'gone' | 'invalid'; message: string }
  export interface ImportResult { applied: number; pending: number; errors: string[] }
  ```
  `decisions.ts`:
  ```ts
  export function saveDecision(dir: string, req: DecisionRequest): DecisionResult
  export function runImport(dir: string, by: string, now: string): ImportResult
  ```
  `settings.ts`:
  ```ts
  export function settingsFile(home?: string): string        // <home>/.config/wordado/review-app.json
  export function readReviewer(file: string): string | null
  export function writeReviewer(file: string, name: string): void
  ```

Semantics of `saveDecision` (spec §5.3): the client sends the cells to write (`accept`: the row's cells with ticked fixes applied; `edit`: the reviewer's values; `keep`: unchanged; `drop`: unchanged). The server writes `verdict` = `ok` (or `drop`), the given cells for the row's editable fields only, and `note`; every other cell and every other row keeps its text. `drop` is refused (`invalid`) for a queue whose spec has no `drop`.

- [ ] **Step 1: Write the failing tests** `decisions.test.ts`

```ts
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { csvRecords } from '@wordado/pipeline/csv'
import { Decisions } from '@wordado/pipeline/decisions'
import { describe, expect, it } from 'vitest'
import { runImport, saveDecision } from './decisions'
import { reviewFixture } from './fixture'
import { listRows } from './model'

async function flagged() {
  const dir = await reviewFixture()
  const row = listRows(dir, 'translation-bg', { withUnflagged: false }).find((r) => r.key.startsWith('bank-'))!
  return { dir, row }
}
const rowIn = (dir: string, file: string, key: string) => csvRecords(readFileSync(join(dir, file), 'utf8')).rows.find((r) => r['key'] === key)!

describe('saveDecision', () => {
  it('writes an accepted fix as ok with the new cells, keeping quotes, commas and lists', async () => {
    const { dir, row } = await flagged()
    const cells = { ...row.cells, translation: 'брег', alternates: 'бряг | "речен" бряг, край' }
    const res = saveDecision(dir, { queue: row.queue, file: row.file, version: row.version, key: row.key, action: 'accept', cells, note: 'река' })
    expect(res.ok).toBe(true)
    const r = rowIn(dir, row.file, row.key)
    expect([r['verdict'], r['translation'], r['alternates'], r['note']]).toEqual(['ok', 'брег', 'бряг | "речен" бряг, край', 'река'])
    const result = runImport(dir, 'tester', '2026-10-05T00:00:00Z')
    expect(result.errors).toEqual([])
    const events = Decisions.read(dir).for('translation-bg', row.key)
    expect(events.at(-1)).toMatchObject({ verdict: 'fix', by: 'tester', value: { translation: 'брег', alternates: ['бряг', '"речен" бряг, край'] } })
  })

  it('writes keep as ok and drop as drop, and leaves every other row as it was', async () => {
    const { dir, row } = await flagged()
    const before = csvRecords(readFileSync(join(dir, row.file), 'utf8')).rows.filter((r) => r['key'] !== row.key)
    saveDecision(dir, { queue: row.queue, file: row.file, version: row.version, key: row.key, action: 'drop', cells: row.cells })
    expect(rowIn(dir, row.file, row.key)['verdict']).toBe('drop')
    expect(csvRecords(readFileSync(join(dir, row.file), 'utf8')).rows.filter((r) => r['key'] !== row.key)).toEqual(before)
  })

  it('refuses to overwrite a file that changed since it was loaded', async () => {
    const { dir, row } = await flagged()
    writeFileSync(join(dir, row.file), readFileSync(join(dir, row.file), 'utf8') + '')  // same text: same version, allowed
    expect(saveDecision(dir, { queue: row.queue, file: row.file, version: row.version, key: row.key, action: 'keep', cells: row.cells }).ok).toBe(true)
    const res = saveDecision(dir, { queue: row.queue, file: row.file, version: row.version, key: row.key, action: 'keep', cells: row.cells })
    expect(res).toMatchObject({ ok: false, reason: 'changed' })
  })

  it('answers gone for a file import deleted, and invalid for a drop of a level', async () => {
    const { dir, row } = await flagged()
    const level = listRows(dir, 'level', { withUnflagged: true })[0]
    expect(saveDecision(dir, { queue: row.queue, file: 'review/translation-bg/none.csv', version: 'x', key: row.key, action: 'keep', cells: row.cells })).toMatchObject({ ok: false, reason: 'gone' })
    if (level) expect(saveDecision(dir, { queue: 'level', file: level.file, version: level.version, key: level.key, action: 'drop', cells: level.cells })).toMatchObject({ ok: false, reason: 'invalid' })
  })
})
```

(The second save in "refuses to overwrite" fails because the first save changed the file: its version is no longer `row.version`.)

`settings.test.ts`:

```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readReviewer, settingsFile, writeReviewer } from './settings'

describe('settings', () => {
  it('remembers the reviewer name outside any repository', () => {
    const home = mkdtempSync(join(tmpdir(), 'home-'))
    const file = settingsFile(home)
    expect(file).toBe(join(home, '.config', 'wordado', 'review-app.json'))
    expect(readReviewer(file)).toBeNull()
    writeReviewer(file, '  Мария ')
    expect(readReviewer(file)).toBe('Мария')
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @wordado/review-app exec vitest run --project server`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement**

`decisions.ts`:

```ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { readConfig } from '@wordado/pipeline/config'
import { csvRecords, formatCsv } from '@wordado/pipeline/csv'
import { importQueues, queueSpecs } from '@wordado/pipeline/queues'
import { fileVersion } from './model'
import type { DecisionRequest, DecisionResult, ImportResult } from './types'

export function saveDecision(dir: string, req: DecisionRequest): DecisionResult {
  const rel = normalize(req.file)
  if (!rel.startsWith(join('review', req.queue) + '/') || !rel.endsWith('.csv')) return { ok: false, reason: 'invalid', message: `${req.file} is not a file of ${req.queue}` }
  const path = join(dir, rel)
  if (!existsSync(path)) return { ok: false, reason: 'gone', message: `${req.file} is gone (imported, or a new draft replaced it)` }
  const spec = queueSpecs(readConfig(dir).l1s).get(req.queue)
  if (!spec) return { ok: false, reason: 'invalid', message: `no queue ${req.queue}` }
  if (req.action === 'drop' && !spec.verdicts.includes('drop')) return { ok: false, reason: 'invalid', message: `${req.queue} has no drop` }
  const text = readFileSync(path, 'utf8')
  if (fileVersion(text) !== req.version) return { ok: false, reason: 'changed', message: `${req.file} changed since it was loaded` }
  const { header, rows } = csvRecords(text)
  const row = rows.find((r) => (r['key'] ?? '').trim() === req.key)
  if (!row) return { ok: false, reason: 'gone', message: `${req.key} is no longer in ${req.file}` }
  for (const col of spec.columns) if (req.cells && col in req.cells) row[col] = req.cells[col] ?? ''
  row['verdict'] = req.action === 'drop' ? 'drop' : 'ok'
  row['note'] = req.note ?? row['note'] ?? ''
  const next = formatCsv([header, ...rows.map((r) => header.map((c) => r[c] ?? ''))])
  writeFileSync(path, next)
  return { ok: true, version: fileVersion(next) }
}

export function runImport(dir: string, by: string, now: string): ImportResult {
  return importQueues(dir, queueSpecs(readConfig(dir).l1s), { by, now })
}
```

`settings.ts`:

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const settingsFile = (home = homedir()) => join(home, '.config', 'wordado', 'review-app.json')

export function readReviewer(file: string): string | null {
  if (!existsSync(file)) return null
  const name = (JSON.parse(readFileSync(file, 'utf8')) as { reviewer?: unknown }).reviewer
  return typeof name === 'string' && name.trim() !== '' ? name.trim() : null
}

export function writeReviewer(file: string, name: string): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify({ reviewer: name.trim() }, null, 2)}\n`)
}
```

Add the `Action`, `DecisionRequest`, `DecisionResult`, `ImportResult` types to `server/types.ts`.

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm --filter @wordado/review-app exec vitest run --project server` and `pnpm --filter @wordado/review-app typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add review-app/server
git commit -m "feat(review-app): save decisions into the review CSV, import them, remember the reviewer"
```

---

### Task 10: The HTTP server and the launcher

**Files:**
- Create: `review-app/server/http.ts`, `review-app/server/http.test.ts`, `review-app/server/main.ts`, `review-app/vite.config.ts`, `review-app/index.html`

**Interfaces:**
- Consumes: `listQueues`, `listRows` (Task 8); `saveDecision`, `runImport`, `readReviewer`, `writeReviewer`, `settingsFile` (Task 9).
- Produces: the JSON API the UI uses —
  - `GET /api/queues` → `QueueSummary[]`
  - `GET /api/rows?queue=<q>&all=1` → `RowView[]`
  - `POST /api/decision` (body `DecisionRequest`) → `DecisionResult` (HTTP 200 when ok, 409 `changed`, 410 `gone`, 400 `invalid`)
  - `GET /api/reviewer` → `{ reviewer: string | null }`; `POST /api/reviewer` `{ reviewer }` → `{ reviewer }`
  - `POST /api/import` → `ImportResult` (400 when no reviewer is set)
  - anything else: files from `dist/` (the built UI), `index.html` for unknown paths.
  ```ts
  export function createReviewServer(opts: { dir: string; staticDir: string | null; settings: string; now: () => string }): import('node:http').Server
  ```

- [ ] **Step 1: Write the failing test** `http.test.ts`

```ts
import type { AddressInfo } from 'node:net'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { reviewFixture } from './fixture'
import { createReviewServer } from './http'
import type { RowView } from './types'

let close: (() => void) | null = null
afterEach(() => close?.())

async function start() {
  const dir = await reviewFixture()
  const server = createReviewServer({ dir, staticDir: null, settings: join(mkdtempSync(join(tmpdir(), 'home-')), 'review-app.json'), now: () => '2026-10-05T00:00:00Z' })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  close = () => server.close()
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const json = async (path: string, init?: RequestInit) => {
    const res = await fetch(base + path, init ? { ...init, headers: { 'content-type': 'application/json' } } : undefined)
    return { status: res.status, body: (await res.json()) as unknown }
  }
  return { base, json }
}

describe('the review server', () => {
  it('lists queues and rows, saves a decision, and refuses a stale save with 409', async () => {
    const s = await start()
    expect((await s.json('/api/queues')).status).toBe(200)
    const rows = (await s.json('/api/rows?queue=translation-bg')).body as RowView[]
    const row = rows.find((r) => r.key.startsWith('bank-'))!
    const save = (version: string) => s.json('/api/decision', { method: 'POST', body: JSON.stringify({ queue: row.queue, file: row.file, version, key: row.key, action: 'keep', cells: row.cells }) })
    expect((await save(row.version)).status).toBe(200)
    expect((await save(row.version)).status).toBe(409)
  })

  it('imports under the stored reviewer, and refuses without one', async () => {
    const s = await start()
    expect((await s.json('/api/import', { method: 'POST', body: '{}' })).status).toBe(400)
    await s.json('/api/reviewer', { method: 'POST', body: JSON.stringify({ reviewer: 'tester' }) })
    expect((await s.json('/api/reviewer')).body).toEqual({ reviewer: 'tester' })
    const res = await s.json('/api/import', { method: 'POST', body: '{}' })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ errors: [] })
  })

  it('answers 404 for an unknown API path', async () => {
    const s = await start()
    expect((await fetch(`${s.base}/api/nothing`)).status).toBe(404)
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @wordado/review-app exec vitest run --project server server/http.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`http.ts`:

```ts
import { existsSync, readFileSync, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { runImport, saveDecision } from './decisions'
import { listQueues, listRows } from './model'
import { readReviewer, writeReviewer } from './settings'
import type { DecisionRequest } from './types'

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }
const STATUS = { changed: 409, gone: 410, invalid: 400 } as const

async function body(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  const text = Buffer.concat(chunks).toString('utf8')
  return text === '' ? {} : (JSON.parse(text) as unknown)
}

export function createReviewServer(opts: { dir: string; staticDir: string | null; settings: string; now: () => string }): Server {
  const send = (res: ServerResponse, status: number, value: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(value))
  }
  return createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      try {
        if (url.pathname === '/api/queues' && req.method === 'GET') return send(res, 200, listQueues(opts.dir))
        if (url.pathname === '/api/rows' && req.method === 'GET') return send(res, 200, listRows(opts.dir, url.searchParams.get('queue') ?? '', { withUnflagged: url.searchParams.get('all') === '1' }))
        if (url.pathname === '/api/decision' && req.method === 'POST') {
          const result = saveDecision(opts.dir, (await body(req)) as DecisionRequest)
          return send(res, result.ok ? 200 : STATUS[result.reason], result)
        }
        if (url.pathname === '/api/reviewer') {
          if (req.method === 'POST') {
            const name = String(((await body(req)) as { reviewer?: unknown }).reviewer ?? '').trim()
            if (name === '') return send(res, 400, { message: 'a name is needed' })
            writeReviewer(opts.settings, name)
          }
          return send(res, 200, { reviewer: readReviewer(opts.settings) })
        }
        if (url.pathname === '/api/import' && req.method === 'POST') {
          const by = readReviewer(opts.settings)
          if (!by) return send(res, 400, { message: 'set your name first' })
          return send(res, 200, runImport(opts.dir, by, opts.now()))
        }
        if (url.pathname.startsWith('/api/')) return send(res, 404, { message: 'no such API' })
        if (!opts.staticDir) return send(res, 404, { message: 'no UI built' })
        const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '')
        let file = join(opts.staticDir, rel)
        if (!file.startsWith(opts.staticDir) || !existsSync(file) || statSync(file).isDirectory()) file = join(opts.staticDir, 'index.html')
        res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
        res.end(readFileSync(file))
      } catch (err) {
        send(res, 500, { message: err instanceof Error ? err.message : String(err) })
      }
    })()
  })
}
```

`main.ts`:

```ts
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createReviewServer } from './http'
import { settingsFile } from './settings'

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const dir = resolve(args[0] ?? '')
if (!args[0] || !existsSync(join(dir, 'pipeline.json'))) {
  console.error('usage: pnpm --filter @wordado/review-app review <content-dir>  (a content checkout: it has pipeline.json)')
  process.exit(2)
}
const staticDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
const server = createReviewServer({ dir, staticDir: existsSync(staticDir) ? staticDir : null, settings: settingsFile(), now: () => new Date().toISOString() })
server.listen(Number(process.env['REVIEW_PORT'] ?? 0), '127.0.0.1', () => {
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
  console.log(`review app: ${url} (content: ${dir}); Ctrl-C to stop`)
  if (!process.argv.includes('--no-open')) execFile(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], () => undefined)
})
```

`vite.config.ts`:

```ts
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({ plugins: [react()], build: { outDir: 'dist', emptyOutDir: true } })
```

`index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Wordado review</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Add `review-app/dist/` to the root `.gitignore`.

- [ ] **Step 4: Run it to see it pass**

Run: `pnpm --filter @wordado/review-app exec vitest run --project server` and `pnpm --filter @wordado/review-app typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add review-app/server/http.ts review-app/server/http.test.ts review-app/server/main.ts review-app/vite.config.ts review-app/index.html .gitignore
git commit -m "feat(review-app): the local HTTP server and launcher"
```

---

### Task 11: The UI — list, row view, actions and keys

**Files:**
- Create: `review-app/src/main.tsx`, `review-app/src/App.tsx`, `review-app/src/api.ts`, `review-app/src/RowList.tsx`, `review-app/src/RowView.tsx`, `review-app/src/Objections.tsx`, `review-app/src/useKeys.ts`, `review-app/src/app.css`, `review-app/src/RowView.test.tsx`, `review-app/src/App.test.tsx`

**Interfaces:**
- Consumes: the API of Task 10 and the types of `server/types.ts`.
- Produces:
  ```ts
  // api.ts
  export const api = {
    queues(): Promise<QueueSummary[]>,
    rows(queue: string, all: boolean): Promise<RowView[]>,
    decide(req: DecisionRequest): Promise<DecisionResult>,   // resolves for 409/410/400 too, with ok:false
    reviewer(): Promise<string | null>,
    setReviewer(name: string): Promise<string>,
    importDecisions(): Promise<ImportResult>,
  }
  // RowView.tsx
  export function RowViewPanel(props: { row: RowView; onDecide: (action: Action, cells: Record<string, string>, note: string) => void }): JSX.Element
  /** The cells after applying the ticked objections' fixes (the first ticked fix per field wins). */
  export function applyFixes(cells: Record<string, string>, objections: readonly ObjectionView[], ticked: ReadonlySet<number>): Record<string, string>
  ```

Layout (spec §5.2, mockup B): a header (queue picker with counts; progress "N of M decided"; reviewer name; **Import decisions**), a left list (key, level, a badge for report/major/minor; filters for level and severity; "show unflagged" toggle), a right panel (English side with other senses; the current cells, the targeted fields highlighted, editable in edit mode; objections with ticks; learner reports; note field; buttons **Accept fix (1)**, **Keep (2)**, **Edit (3)**, **Drop (4)** (translations only), **Skip (S)**). After a decision the next undecided row is selected. A 409 or 410 reloads the rows and shows "This file changed; reloaded."

- [ ] **Step 1: Write the failing tests**

`RowView.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { RowView } from '../server/types'
import { applyFixes, RowViewPanel } from './RowView'

const row: RowView = {
  queue: 'translation-bg', file: 'review/translation-bg/2026-10-04-01.csv', version: 'v', key: 'hour-2', kind: 'translation',
  cells: { translation: 'работно време', alternates: 'часове', sense: 'определен период' }, fields: ['translation', 'alternates', 'sense'],
  context: { headword: 'hour', pos: 'noun', sense_en: 'specific time period', level: 'A2', example: 'The office hours are from nine to five.' },
  otherSenses: [{ key: 'hour-1', translation: 'час', sense_en: 'sixty minutes' }], reports: '', ai: 'flagged', severity: 'major',
  objections: [{ reviewer: 'flash', model: 'google/gemini-3.8-flash', field: 'translation', category: 'wrong-sense', severity: 'major', reason: 'hour means час', fix: 'час' }],
  decided: null,
}

describe('applyFixes', () => {
  it('applies ticked fixes only', () => {
    expect(applyFixes(row.cells, row.objections, new Set([0]))).toEqual({ ...row.cells, translation: 'час' })
    expect(applyFixes(row.cells, row.objections, new Set())).toEqual(row.cells)
  })
})

describe('RowViewPanel', () => {
  it('shows the sense, the other senses, the objection and its fix', () => {
    render(<RowViewPanel row={row} onDecide={() => {}} />)
    expect(screen.getByText('specific time period')).toBeTruthy()
    expect(screen.getByText(/hour-1/)).toBeTruthy()
    expect(screen.getByText('hour means час')).toBeTruthy()
  })
  it('accepts the fix with the button and with key 1, keeps with key 2', () => {
    const onDecide = vi.fn()
    render(<RowViewPanel row={row} onDecide={onDecide} />)
    fireEvent.click(screen.getByRole('button', { name: /Accept fix/ }))
    expect(onDecide).toHaveBeenLastCalledWith('accept', { ...row.cells, translation: 'час' }, '')
    fireEvent.keyDown(window, { key: '2' })
    expect(onDecide).toHaveBeenLastCalledWith('keep', row.cells, '')
  })
  it('has no Drop for a level row', () => {
    render(<RowViewPanel row={{ ...row, kind: 'level', queue: 'level', fields: ['level'], cells: { level: 'B1' }, objections: [] }} onDecide={() => {}} />)
    expect(screen.queryByRole('button', { name: /Drop/ })).toBeNull()
  })
})
```

`App.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { api } from './api'

describe('App', () => {
  it('filters the list by level and severity', async () => {
    const base = { queue: 'translation-bg', file: 'f', version: 'v', kind: 'translation' as const, cells: {}, fields: [], otherSenses: [], ai: 'flagged' as const, objections: [], decided: null }
    vi.spyOn(api, 'reviewer').mockResolvedValue('Tester')
    vi.spyOn(api, 'queues').mockResolvedValue([{ queue: 'translation-bg', open: 2, flagged: 2, reported: 0, decided: 0 }])
    vi.spyOn(api, 'rows').mockResolvedValue([
      { ...base, key: 'a-1', context: { level: 'A1' }, reports: '', severity: 'major' },
      { ...base, key: 'b-1', context: { level: 'B2' }, reports: '', severity: 'minor' },
    ])
    render(<App />)
    await waitFor(() => expect(screen.getByRole('button', { name: /b-1/ })).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Level'), { target: { value: 'A1' } })
    expect(screen.queryByRole('button', { name: /b-1/ })).toBeNull()
    fireEvent.change(screen.getByLabelText('Level'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Severity'), { target: { value: 'minor' } })
    expect(screen.queryByRole('button', { name: /a-1/ })).toBeNull()
  })

  it('asks for the reviewer name first, then lists the queues', async () => {
    vi.spyOn(api, 'reviewer').mockResolvedValue(null)
    vi.spyOn(api, 'queues').mockResolvedValue([{ queue: 'translation-bg', open: 3, flagged: 2, reported: 1, decided: 0 }])
    render(<App />)
    await waitFor(() => expect(screen.getByLabelText(/Your name/)).toBeTruthy())
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @wordado/review-app exec vitest run --project ui`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement**

`api.ts`:

```ts
import type { Action, DecisionRequest, DecisionResult, ImportResult, QueueSummary, RowView } from '../server/types'

export type { Action, DecisionRequest, DecisionResult, ImportResult, QueueSummary, RowView }

const get = async <T,>(path: string): Promise<T> => (await fetch(path)).json() as Promise<T>
const post = async <T,>(path: string, body: unknown): Promise<T> =>
  (await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json() as Promise<T>

export const api = {
  queues: () => get<QueueSummary[]>('/api/queues'),
  rows: (queue: string, all: boolean) => get<RowView[]>(`/api/rows?queue=${encodeURIComponent(queue)}${all ? '&all=1' : ''}`),
  decide: (req: DecisionRequest) => post<DecisionResult>('/api/decision', req),
  reviewer: async () => (await get<{ reviewer: string | null }>('/api/reviewer')).reviewer,
  setReviewer: async (name: string) => (await post<{ reviewer: string }>('/api/reviewer', { reviewer: name })).reviewer,
  importDecisions: () => post<ImportResult>('/api/import', {}),
}
```

`useKeys.ts`:

```ts
import { useEffect } from 'react'

/** Calls handlers[key] on a keydown outside text fields. */
export function useKeys(handlers: Readonly<Record<string, () => void>>): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      const h = handlers[e.key] ?? handlers[e.key.toLowerCase()]
      if (h) {
        e.preventDefault()
        h()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handlers])
}
```

`Objections.tsx`:

```tsx
import type { ObjectionView } from '../server/types'

export function Objections(props: { objections: readonly ObjectionView[]; reports: string; ticked: ReadonlySet<number>; onTick: (i: number) => void }) {
  return (
    <section className="objections" aria-label="Objections">
      {props.reports !== '' && (
        <div className="report">
          <h3>Learner reports</h3>
          <p>{props.reports}</p>
        </div>
      )}
      {props.objections.length === 0 && <p className="muted">No AI objections.</p>}
      {props.objections.map((o, i) => (
        <label key={i} className={`objection ${o.severity}`}>
          <input type="checkbox" checked={props.ticked.has(i)} onChange={() => props.onTick(i)} />
          <span className="badge">{o.reviewer} · {o.severity} · {o.category}</span>
          <span className="reason">{o.reason}</span>
          <span className="fix">
            {o.field} → <b>{o.fix === '' ? '(empty)' : o.fix}</b>
          </span>
        </label>
      ))}
    </section>
  )
}
```

`RowView.tsx`:

```tsx
import { useMemo, useState } from 'react'
import type { Action, ObjectionView, RowView } from '../server/types'
import { Objections } from './Objections'
import { useKeys } from './useKeys'

export function applyFixes(cells: Record<string, string>, objections: readonly ObjectionView[], ticked: ReadonlySet<number>): Record<string, string> {
  const out = { ...cells }
  const done = new Set<string>()
  objections.forEach((o, i) => {
    if (ticked.has(i) && !done.has(o.field)) {
      out[o.field] = o.fix
      done.add(o.field)
    }
  })
  return out
}

export function RowViewPanel(props: { row: RowView; onDecide: (action: Action, cells: Record<string, string>, note: string) => void }) {
  const { row } = props
  const [ticked, setTicked] = useState<ReadonlySet<number>>(() => new Set(row.objections.map((_, i) => i)))
  const [editing, setEditing] = useState(false)
  const [cells, setCells] = useState<Record<string, string>>(row.cells)
  const [note, setNote] = useState('')
  const targeted = useMemo(() => new Set(row.objections.map((o) => o.field)), [row.objections])
  const canDrop = row.kind === 'translation'
  const accept = () => props.onDecide('accept', applyFixes(row.cells, row.objections, ticked), note)
  const keep = () => props.onDecide('keep', row.cells, note)
  const edit = () => (editing ? props.onDecide('edit', cells, note) : (setCells(applyFixes(row.cells, row.objections, ticked)), setEditing(true)))
  const drop = () => canDrop && props.onDecide('drop', row.cells, note)
  const keys = useMemo(() => ({ '1': accept, '2': keep, '3': edit, ...(canDrop ? { '4': drop } : {}) }), [accept, keep, edit, drop, canDrop])
  useKeys(keys)
  const c = row.context
  return (
    <article className="row" aria-label={`Row ${row.key}`}>
      <section className="english">
        <h2>
          {c['headword'] ?? row.key} <small>{[c['pos'], c['level']].filter(Boolean).join(' · ')}</small>
        </h2>
        {c['sense_en'] && <p className="sense">{c['sense_en']}</p>}
        {c['example'] && <p className="example">“{c['example']}”</p>}
        {c['words'] && <p className="words">{c['words']}</p>}
        {c['band'] && <p className="muted">frequency band {c['band']}</p>}
        {row.otherSenses.length > 0 && (
          <ul className="others">
            {row.otherSenses.map((s) => (
              <li key={s.key}>
                {s.key}: {s.translation} ({s.sense_en})
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="cells" aria-label="Current row">
        {row.fields.map((f) => (
          <label key={f} className={targeted.has(f) ? 'targeted' : ''}>
            <span>{f}</span>
            {editing ? <input value={cells[f] ?? ''} onChange={(e) => setCells({ ...cells, [f]: e.target.value })} /> : <output>{row.cells[f] || '—'}</output>}
          </label>
        ))}
      </section>
      <Objections objections={row.objections} reports={row.reports} ticked={ticked} onTick={(i) => setTicked((t) => (t.has(i) ? new Set([...t].filter((x) => x !== i)) : new Set([...t, i])))} />
      <label className="note">
        Note <input value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="actions">
        <button onClick={accept} disabled={row.objections.length === 0}>Accept fix (1)</button>
        <button onClick={keep}>Keep (2)</button>
        <button onClick={edit}>{editing ? 'Save edit (3)' : 'Edit (3)'}</button>
        {canDrop && <button onClick={drop}>Drop (4)</button>}
      </div>
    </article>
  )
}
```

`RowList.tsx`:

```tsx
import type { RowView } from '../server/types'

export function RowList(props: { rows: readonly RowView[]; selected: string | null; onSelect: (key: string) => void }) {
  return (
    <ol className="list" aria-label="Rows">
      {props.rows.map((r) => (
        <li key={r.key}>
          <button className={`${r.key === props.selected ? 'selected' : ''} ${r.decided ? 'decided' : ''}`} onClick={() => props.onSelect(r.key)}>
            <span>{r.key}</span>
            <span className="muted">{r.context['level'] ?? ''}</span>
            {r.reports !== '' && <span className="badge report">report</span>}
            {r.severity && <span className={`badge ${r.severity}`}>{r.severity}</span>}
            {r.decided && <span className="badge">{r.decided.verdict}</span>}
          </button>
        </li>
      ))}
    </ol>
  )
}
```

`App.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type Action, type ImportResult, type QueueSummary, type RowView } from './api'
import { RowList } from './RowList'
import { RowViewPanel } from './RowView'
import { useKeys } from './useKeys'

export function App() {
  const [reviewer, setReviewer] = useState<string | null | undefined>(undefined)
  const [name, setName] = useState('')
  const [queues, setQueues] = useState<QueueSummary[]>([])
  const [queue, setQueue] = useState<string | null>(null)
  const [all, setAll] = useState(false)
  const [rows, setRows] = useState<RowView[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [level, setLevel] = useState('')
  const [severity, setSeverity] = useState('')

  useEffect(() => void api.reviewer().then(setReviewer), [])
  useEffect(() => void api.queues().then((q) => (setQueues(q), setQueue((cur) => cur ?? q[0]?.queue ?? null))), [])
  const load = useCallback(async () => {
    if (!queue) return
    const r = await api.rows(queue, all)
    setRows(r)
    setSelected((cur) => (cur && r.some((x) => x.key === cur) ? cur : (r.find((x) => !x.decided)?.key ?? null)))
  }, [queue, all])
  useEffect(() => void load(), [load])

  const shown = rows.filter((r) => (level === '' || r.context['level'] === level) && (severity === '' || (severity === 'report' ? r.reports !== '' : r.severity === severity)))
  const row = shown.find((r) => r.key === selected) ?? null
  const next = () => setSelected(shown.find((r) => !r.decided && r.key !== selected)?.key ?? null)
  const decide = async (action: Action, cells: Record<string, string>, note: string) => {
    if (!row) return
    const res = await api.decide({ queue: row.queue, file: row.file, version: row.version, key: row.key, action, cells, note })
    if (!res.ok) setNotice(res.reason === 'invalid' ? res.message : 'This file changed; reloaded.')
    else setNotice('')
    await load()
    if (res.ok) next()
  }
  const keys = useMemo(() => ({ s: next, ArrowDown: next }), [shown, selected])
  useKeys(keys)

  if (reviewer === undefined) return <p>Loading…</p>
  if (reviewer === null)
    return (
      <form className="name" onSubmit={(e) => (e.preventDefault(), void api.setReviewer(name).then(setReviewer))}>
        <label>
          Your name, as decisions record it <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <button type="submit">Start</button>
      </form>
    )
  const summary = queues.find((q) => q.queue === queue)
  const decided = rows.filter((r) => r.decided).length
  const importNow = async () => {
    const r: ImportResult = await api.importDecisions()
    setNotice(`Imported ${r.applied}; ${r.pending} still open${r.errors.length ? `; ${r.errors.length} rejected: ${r.errors.join('; ')}` : ''}`)
    await load()
    setQueues(await api.queues())
  }
  return (
    <div className="app">
      <header>
        <select value={queue ?? ''} onChange={(e) => setQueue(e.target.value)} aria-label="Queue">
          {queues.map((q) => (
            <option key={q.queue} value={q.queue}>
              {q.queue} · {q.flagged} flagged · {q.reported} reported
            </option>
          ))}
        </select>
        <label>
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> show unflagged
        </label>
        <select value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Level">
          <option value="">all levels</option>
          {['A1', 'A2', 'B1', 'B2', 'C1'].map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
        <select value={severity} onChange={(e) => setSeverity(e.target.value)} aria-label="Severity">
          <option value="">all objections</option>
          <option value="report">learner reports</option>
          <option value="major">major</option>
          <option value="minor">minor</option>
        </select>
        <span>
          {decided} of {rows.length} decided{summary ? ` · ${summary.open} open in all` : ''}
        </span>
        <span className="muted">{reviewer}</span>
        <button onClick={() => void importNow()}>Import decisions</button>
      </header>
      {notice && <p role="status" className="notice">{notice}</p>}
      <main>
        <RowList rows={shown} selected={selected} onSelect={setSelected} />
        {row ? <RowViewPanel key={`${row.key}:${row.version}`} row={row} onDecide={(a, c, n) => void decide(a, c, n)} /> : <p className="muted">Nothing left to decide here.</p>}
      </main>
    </div>
  )
}
```

`main.tsx`:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './app.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

`app.css`: a plain two-column layout — `main { display: grid; grid-template-columns: 22rem 1fr; gap: 1rem; height: calc(100vh - 4rem) }`, `.list { overflow: auto }`, `.targeted output, .targeted input { background: #fde2e2 }`, `.badge.major { background: #c0392b; color: #fff }`, `.badge.minor { background: #e67e22; color: #fff }`, `.badge.report { background: #2c7be5; color: #fff }`, `.selected { outline: 2px solid #2c7be5 }`, `.decided { opacity: .55 }`, and dark-mode equivalents under `@media (prefers-color-scheme: dark)`. Keep it under 120 lines.

The `useMemo` dependency lists for `keys` include functions recreated each render; if oxlint or React warns, wrap `accept`/`keep`/`edit`/`drop`/`next` in `useCallback` with the right dependencies rather than silencing the rule.

- [ ] **Step 4: Run them to see them pass; typecheck, lint, build**

Run: `pnpm --filter @wordado/review-app exec vitest run --project ui`, `pnpm --filter @wordado/review-app typecheck`, `pnpm lint`, `pnpm --filter @wordado/review-app build`
Expected: PASS; `dist/` built.

- [ ] **Step 5: Commit**

```bash
git add review-app/src review-app/package.json
git commit -m "feat(review-app): the review screen: list, row, objections, actions and keys"
```

---

### Task 12: End to end, CI and the README

**Files:**
- Create: `review-app/e2e/review.spec.ts`, `review-app/playwright.config.ts`, `review-app/e2e/start.ts`, `review-app/README.md`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `reviewFixture` (Task 8), `createReviewServer` (Task 10), the built UI (Task 11).

- [ ] **Step 1: Write the end-to-end test**

`review-app/e2e/start.ts` (Playwright's `webServer` runs it):

```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { reviewFixture } from '../server/fixture'
import { createReviewServer } from '../server/http'

const dir = await reviewFixture()
const settings = join(mkdtempSync(join(tmpdir(), 'home-')), 'review-app.json')
const staticDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
createReviewServer({ dir, staticDir, settings, now: () => new Date().toISOString() }).listen(4180, '127.0.0.1', () => console.log(`fixture ${dir}`))
```

`review-app/playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  use: { baseURL: 'http://127.0.0.1:4180', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: 'pnpm build && tsx e2e/start.ts', url: 'http://127.0.0.1:4180/api/queues', reuseExistingServer: false, timeout: 120_000 },
})
```

`review-app/e2e/review.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

test('a reviewer accepts a fix, keeps a row and imports', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel(/Your name/).fill('Tester')
  await page.getByRole('button', { name: 'Start' }).click()
  const list = page.getByRole('list', { name: 'Rows' })
  await expect(list.getByRole('button').first()).toBeVisible()
  await expect(page.getByText(/report/).first()).toBeVisible()
  await page.keyboard.press('2')                          // keep the reported row
  await list.getByRole('button', { name: /bank-/ }).first().click()
  await page.getByRole('button', { name: /Accept fix/ }).click()
  await page.getByRole('button', { name: 'Import decisions' }).click()
  await expect(page.getByRole('status')).toContainText(/Imported 2/)
})
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @wordado/review-app exec playwright install chromium` (once, locally) then `pnpm --filter @wordado/review-app e2e`
Expected: 1 passed.

- [ ] **Step 3: Wire it into CI**

In `.github/workflows/ci.yml`, job `test`, after `- run: pnpm test` (Chromium is already installed in that job), add:

```yaml
      - name: The review app, end to end
        run: pnpm --filter @wordado/review-app e2e
```

`pnpm test` already runs the review app's Vitest suites through `pnpm -r test`; `pnpm typecheck` covers it in the `static` job.

- [ ] **Step 4: Write `review-app/README.md`**

```markdown
# Review app

A local web app for deciding the rows `corpus ai-review` flags (spec
`docs/superpowers/specs/2026-10-04-ai-review-and-review-app-design.md`).

    pnpm --filter @wordado/review-app review "$PWD/content"

builds the UI, starts a server on 127.0.0.1 and opens the browser. It needs a content checkout whose
`pipeline.json` has an `ai_review` block, review files (`corpus queues`) and verdicts (`corpus ai-review`).

- Pick a queue. Learner-reported rows come first, then major and minor objections; "show unflagged" adds the rest.
- **Accept fix (1)** writes the ticked fixes, **Keep (2)** marks the row ok, **Edit (3)** lets you change the cells,
  **Drop (4)** (translations only) drops the sense, **S** skips. Every decision is written into the review CSV at once.
- **Import decisions** runs `corpus import` under your name. Then commit and push the content repository as usual.
- If a file changed on disk (a new draft, a spreadsheet save), the app reloads instead of overwriting it.

Your name is kept in `~/.config/wordado/review-app.json`. Nothing leaves your machine.
```

- [ ] **Step 5: Run everything once**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm --filter @wordado/review-app e2e`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add review-app/e2e review-app/playwright.config.ts review-app/README.md .github/workflows/ci.yml
git commit -m "test(review-app): end to end in Chromium, in CI; the README"
```

---

## After the plan (operational, each with the product owner's go-ahead)

1. Copy `pipeline/template/.github/workflows/corpus.yml` into the content repository (adds the `ai-review` action).
2. Add the `ai_review` block to the content repository's `pipeline.json` (Flash, the translation and title queues of every L1, and `level`). From then on `status` and `release` enforce the gate.
3. Move `PIPELINE_REF` to the merge commit, run the `ai-review` action (about $27 for three languages with Flash), merge its pull request.
4. Decide the flagged Bulgarian rows in the review app, import, commit, and release.
