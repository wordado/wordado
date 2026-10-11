# Global Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A search for the whole learner app (issue #144): a magnifier in the top row opens `/search`, which finds any word of the course, ranked, and links each result to its unit on the Path and to its themes.

**Architecture:** `core/src/search.ts` gains a flat word index and a ranked search; the Themes search reads the same tokens. The web app gets a `Search` screen built from the existing `WordRow` (with a new `where` slot), a `search` route, a `unit` parameter on the `path` route that makes the Path open at a unit, and a button in the masthead.

**Tech Stack:** TypeScript, React 19, the app's own router (`web/src/router.tsx`), Vitest with Testing Library, Playwright, plain CSS (`web/src/styles.css`), lucide-react icons.

**Spec:** `docs/superpowers/specs/2026-10-11-global-search-design.md` (mock pictures in `docs/superpowers/specs/2026-10-11-global-search-mockups/`).

## Global Constraints

- No server change, no pack-format change, no new dependency.
- The shortest query is `MIN_QUERY_LENGTH` (2); matching is unchanged: folded text, every query word starts a token.
- A retired word is never found.
- The list shows 30 results; "Show more" adds 30.
- The query lives in the address: `/search?q=<query>`, written with `navigate(…, { replace: true })` while typing.
- A theme is a link only when `offeredThemes(corpus)` holds it; other themes are plain text.
- Every new string exists in `en.ts`, `bg.ts`, `de.ts` and `es.ts` (the parity test enforces it).
- This repository is public: no corpus text beyond the bundled sample, no names, no dates of plans, nothing about keys or accounts, in code, tests, commits or the pull request.
- Commit as `git -c user.email=11029931+danchom@users.noreply.github.com -c user.name=danchom commit`; every commit message ends with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Match the surrounding code: its comment density, names and idiom. Run commands from the worktree root, `.worktrees/global-search`.
- Before the pull request: `pnpm --filter @wordado/core test`, `pnpm --filter @wordado/web test`, `pnpm -r typecheck`, `pnpm lint`, `pnpm --filter @wordado/web e2e`.

## Review Focus

1. **Typing must not lose focus.** Each letter changes the route (`replace`), and `App` focuses `<main>` after every route change. The field must keep focus while typing (Task 5, test in Task 4 and Task 7).
2. **A unit the short view hides.** The studied level shows only the current unit and two more, and folds finished units into one line. Arriving at a hidden or finished unit must show it (Task 3).
3. **A query with regex or URL characters** (`a+b`, `c&d`, `%`, `“`): it must round-trip through the address and never throw (Task 2).
4. **A word whose unit or theme the corpus does not hold** (a theme too small to offer, a unit ID that is gone): the row still renders; the theme is text, the unit link is left out (Task 4).
5. **Signed out at 360px:** no control of the top row wraps or is clipped (Task 5, Task 7).

---

### Task 1: The word index and the ranked search in `core`

**Files:**
- Modify: `core/src/search.ts`
- Modify: `core/src/index.ts` (the export line for `./search`, near line 25)
- Test: `core/src/search.test.ts`

**Interfaces:**
- Consumes: `Corpus`, `CorpusEntry`, `levelIndex`, the file's own `tokens`, `matches`, `searchWords`, `foldText`.
- Produces:
  - `export interface WordIndex { readonly words: readonly IndexedWord[] }`
  - `export function wordIndex(corpus: Corpus): WordIndex`
  - `export function searchWordIndex(index: WordIndex, query: string): readonly string[] | null` (entry IDs, best first; `null` under two letters)

- [ ] **Step 1: Write the failing tests**

Append to `core/src/search.test.ts` (add `searchWordIndex, wordIndex` to the import from `./search`):

```ts
describe('searchWordIndex', () => {
  const find = (entries: PackEntry[], query: string) => {
    const ids = searchWordIndex(wordIndex(corpus(entries)), query)
    // The fillers that make the themes big enough are not what these tests are about.
    return ids && ids.filter((id) => !id.includes('x'))
  }

  it('takes a query under two letters as no query', () => {
    expect(find(bank, 'b')).toBeNull()
    expect(find(bank, '  ')).toBeNull()
  })

  it('puts the word itself first, then words that begin with it, then matches in a translation or note', () => {
    const entries = [
      entry({ entry_id: 'flow-1', translation: 'тека', sense: 'run' }),
      entry({ entry_id: 'runway-1' }),
      entry({ entry_id: 'run-1' }),
      entry({ entry_id: 'jog-1', translation: 'run slowly' }),
    ]
    expect(find(entries, 'run')).toEqual(['run-1', 'runway-1', 'flow-1', 'jog-1'])
  })

  it('orders a group by level, then by the word, then by the ID', () => {
    const entries = [
      entry({ entry_id: 'runner-1', level: 'B1' }),
      entry({ entry_id: 'runway-1', level: 'A2' }),
      entry({ entry_id: 'rune-2', headword: 'rune', level: 'A2' }),
      entry({ entry_id: 'rune-1', headword: 'rune', level: 'A2' }),
    ]
    expect(find(entries, 'run')).toEqual(['rune-1', 'rune-2', 'runway-1', 'runner-1'])
  })

  it('finds a word by a variant, a translation or the sense note, whatever the accents and the case', () => {
    const entries = [
      entry({ entry_id: 'cafe-1', headword: 'café' }),
      entry({ entry_id: 'colour-1', variants: ['color'] }),
      entry({ entry_id: 'may-1', translation: 'Май' }),
    ]
    expect(find(entries, 'CAFE')).toEqual(['cafe-1'])
    expect(find(entries, 'color')).toEqual(['colour-1'])
    expect(find(entries, 'маи')).toEqual(['may-1'])
  })

  it('wants every word of the query, each at the start of a word', () => {
    const entries = [entry({ entry_id: 'ice-1', headword: 'ice cream' }), entry({ entry_id: 'cream-1' }), entry({ entry_id: 'scream-1' })]
    expect(find(entries, 'ice cr')).toEqual(['ice-1'])
    expect(find(entries, 'cream')).toEqual(['cream-1', 'ice-1'])
  })

  it('ranks a headword of several words as the word itself when the query is that headword', () => {
    const entries = [entry({ entry_id: 'thanks-1', headword: 'thank you' }), entry({ entry_id: 'thank-1' })]
    expect(find(entries, ' Thank  you ')).toEqual(['thanks-1'])
    expect(find(entries, 'thank')).toEqual(['thank-1', 'thanks-1'])
  })

  it('does not find a retired word', () => {
    expect(find([entry({ entry_id: 'old-1', retired: true }), entry({ entry_id: 'older-1' })], 'old')).toEqual(['older-1'])
  })

  it('takes punctuation in a query as a space, and never throws on it', () => {
    const entries = [entry({ entry_id: 'run-1' })]
    expect(find(entries, 'ru+n')).toEqual([])
    expect(find(entries, '(run)')).toEqual(['run-1'])
    expect(find(entries, '%&?')).toBeNull()
  })
})
```

Check the fixture first: `filler` gives headwords `zz<theme><i>` with IDs containing `x`, so `find` drops them. If an existing helper name differs, read the top of the test file and adapt the helper, not the assertions.

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @wordado/core test -- search`
Expected: FAIL, `searchWordIndex` is not exported.

- [ ] **Step 3: Implement**

In `core/src/search.ts`, replace the `entryTokens` definition with the split form, and keep `entryTokens` for the callers that want one list:

```ts
/** The words of an entry's headword. */
const headTokens = (entry: CorpusEntry): string[] => tokens(entry.headword)

/** The words an entry is also found by: its variants, its translations and its sense note. */
const otherTokens = (entry: CorpusEntry): string[] => [...entry.variants, ...entry.translations, entry.sense].flatMap(tokens)

/** What a word is found by: its headword and variants, its translations and its sense note. */
const entryTokens = (entry: CorpusEntry): string[] => [...headTokens(entry), ...otherTokens(entry)]
```

Add, after `searchEntries`:

```ts
/** One word of the course, ready to be matched. */
interface IndexedWord {
  readonly entryId: string
  readonly level: number
  /** The folded headword, whole: for the exact match and the alphabetical order. */
  readonly head: string
  readonly headTokens: readonly string[]
  readonly otherTokens: readonly string[]
}

/** Every word of a corpus that is not retired, folded once: what the search for the whole course looks through. */
export interface WordIndex {
  readonly words: readonly IndexedWord[]
}

export function wordIndex(corpus: Corpus): WordIndex {
  const words = [...corpus.entries.values()]
    .filter((entry) => !entry.retired)
    .map((entry) => {
      const head = headTokens(entry)
      return { entryId: entry.entryId, level: levelIndex(entry.level), head: head.join(' '), headTokens: head, otherTokens: otherTokens(entry) }
    })
  return { words }
}

/** Code-point order: the same on every device and in every interface language. */
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/**
 * The words a query finds, as entry IDs, best match first (null: no query): the word itself, then words whose
 * headword holds every word of the query, then words found by a variant, a translation or the sense note.
 * Within each, by level, then by the word, then by the ID.
 */
export function searchWordIndex(index: WordIndex, query: string): readonly string[] | null {
  const words = searchWords(query)
  if (!words) return null
  const whole = words.join(' ')
  const found: { readonly word: IndexedWord; readonly rank: number }[] = []
  for (const word of index.words) {
    if (word.head === whole) found.push({ word, rank: 0 })
    else if (matches(words, word.headTokens)) found.push({ word, rank: 1 })
    else if (matches(words, [...word.headTokens, ...word.otherTokens])) found.push({ word, rank: 2 })
  }
  found.sort((a, b) => a.rank - b.rank || a.word.level - b.word.level || byText(a.word.head, b.word.head) || byText(a.word.entryId, b.word.entryId))
  return found.map(({ word }) => word.entryId)
}
```

`matches` and `searchWords` are declared lower in the file as `const`/`function`; move `matches` above its first use if the order needs it. In `core/src/index.ts`, add `searchWordIndex`, `wordIndex` and `type WordIndex` to what is exported from `./search` (keep the line's existing style: if it is `export * from './search'`, nothing to do).

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @wordado/core test -- search`
Expected: PASS, including every earlier `searchThemes`/`searchEntries` test unchanged.

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm --filter @wordado/core typecheck`
```bash
git add core/src/search.ts core/src/search.test.ts core/src/index.ts
git commit -m "feat(core): a word index and a ranked search over every word of the course (#144)"
```

---

### Task 2: The routes: `/search?q=` and `/path?unit=`

**Files:**
- Modify: `web/src/router.tsx`
- Modify: `web/src/app/App.tsx` (only what the changed `Route` type forces: see Step 3)
- Test: `web/src/router.test.tsx`

**Interfaces:**
- Produces:
  - `Route` member `{ readonly name: 'search'; readonly q: string }`
  - `Route` member `{ readonly name: 'path'; readonly unit?: string | undefined }` (replaces `{ name: 'path' }`)
  - `parseRoute('/search', '?q=run')` → `{ name: 'search', q: 'run' }`; `/search` → `q: ''`
  - `routeHref({ name: 'search', q: '' })` → `/search`; with a query → `/search?q=…`
  - `routeHref({ name: 'path', unit: 'a1-02' })` → `/path?unit=a1-02`

- [ ] **Step 1: Write the failing tests**

Read `web/src/router.test.tsx` and add, in its style:

```ts
describe('the search route', () => {
  it('reads and writes the query', () => {
    expect(parseRoute('/search', '')).toEqual({ name: 'search', q: '' })
    expect(parseRoute('/search/', '?q=run')).toEqual({ name: 'search', q: 'run' })
    expect(routeHref({ name: 'search', q: '' })).toBe('/search')
    expect(routeHref({ name: 'search', q: 'thank you' })).toBe('/search?q=thank+you')
  })

  it('carries any text through the address unchanged', () => {
    for (const q of ['a+b', 'c&d=e', '100%', '“run”', 'бягам', ' two  spaces ']) {
      const url = new URL(routeHref({ name: 'search', q }), 'http://local')
      expect(parseRoute(url.pathname, url.search)).toEqual({ name: 'search', q })
    }
  })
})

describe('the path route', () => {
  it('reads and writes the unit it opens at', () => {
    expect(parseRoute('/path', '')).toEqual({ name: 'path' })
    expect(parseRoute('/path', '?unit=a1-02')).toEqual({ name: 'path', unit: 'a1-02' })
    expect(routeHref({ name: 'path' })).toBe('/path')
    expect(routeHref({ name: 'path', unit: 'a1-02' })).toBe('/path?unit=a1-02')
  })
})
```

- [ ] **Step 2: Run to see them fail**

Run: `pnpm --filter @wordado/web test -- router`
Expected: FAIL (type errors or wrong values).

- [ ] **Step 3: Implement**

In `web/src/router.tsx`:

```ts
  /** The level path; `unit` is the unit it opens at (`?unit=<unitId>`), as a search result links to it. */
  | { readonly name: 'path'; readonly unit?: string | undefined }
```
```ts
  /** The search for the whole course (`/search`); `q` is the query (`?q=`), empty when there is none. */
  | { readonly name: 'search'; readonly q: string }
```

In `parseRoute`:

```ts
    case '/path': {
      const unit = new URLSearchParams(search).get('unit')
      return unit ? { name: 'path', unit } : { name: 'path' }
    }
    case '/search':
      return { name: 'search', q: new URLSearchParams(search).get('q') ?? '' }
```

In `routeHref`:

```ts
    case 'path':
      return withQuery('/path', { unit: route.unit })
    case 'search':
      return route.q === '' ? '/search' : `/search?${new URLSearchParams({ q: route.q }).toString()}`
```

`App.tsx` has `Screen` with a `default:` case, so the new route name compiles and shows `Home` until Task 4 registers the screen. `routePath` splits at `?`, so the feedback form's `from` stays `/search` and `/path`: no change.

- [ ] **Step 4: Run the tests, typecheck, commit**

Run: `pnpm --filter @wordado/web test -- router` (PASS), `pnpm --filter @wordado/web typecheck`
```bash
git add web/src/router.tsx web/src/router.test.tsx
git commit -m "feat(web): routes for the search and for the path opening at a unit (#144)"
```

---

### Task 3: The Path opens at a unit

**Files:**
- Modify: `web/src/screens/pathFolding.ts`, `web/src/screens/Path.tsx`
- Modify: `web/src/app/App.tsx` (the `Screen` case for `path`, and the focus target)
- Modify: `web/src/styles.css` (one rule)
- Test: `web/src/screens/pathFolding.test.ts`, `web/src/screens/Path.test.tsx`

**Interfaces:**
- Consumes: `Route` `path.unit` (Task 2).
- Produces:
  - `unitReveal(levels, studied, unitId): { level: string; done: boolean; all: boolean } | null` in `pathFolding.ts`
  - `Path` takes `{ unit?: string | undefined }`
  - every unit's `<li>` has `id="unit-<unitId>"`
  - the convention **`data-route-focus`**: after a navigation, `App` focuses the first element in `<main>` that carries this attribute, else `<main>`. Task 4 uses it for the search field.

- [ ] **Step 1: Write the failing test for `unitReveal`**

Add to `web/src/screens/pathFolding.test.ts`:

```ts
describe('unitReveal', () => {
  const level = (name: string, statuses: UnitStatus[]) => ({ level: name, units: statuses.map((_, i) => ({ unitId: `${name}-${i}` })), statuses })
  const levels = [
    level('A1', ['complete', 'mastered', 'current', 'locked', 'locked', 'locked', 'locked']),
    level('A2', ['locked', 'locked']),
  ]

  it('opens another level with nothing more to unfold: an opened level shows every unit', () => {
    expect(unitReveal(levels, 'A1', 'A2-1')).toEqual({ level: 'A2', done: false, all: false })
  })

  it('needs nothing unfolded for a unit the short view shows', () => {
    expect(unitReveal(levels, 'A1', 'A1-2')).toEqual({ level: 'A1', done: false, all: false })
    expect(unitReveal(levels, 'A1', 'A1-4')).toEqual({ level: 'A1', done: false, all: false })
  })

  it('unfolds the finished units for one of them', () => {
    expect(unitReveal(levels, 'A1', 'A1-0')).toEqual({ level: 'A1', done: true, all: false })
  })

  it('shows every unit for one beyond the next few', () => {
    expect(unitReveal(levels, 'A1', 'A1-6')).toEqual({ level: 'A1', done: false, all: true })
  })

  it('knows no unit by an ID the path does not hold', () => {
    expect(unitReveal(levels, 'A1', 'nope')).toBeNull()
  })
})
```

Import `unitReveal` and `type UnitStatus` beside the file's existing imports.

- [ ] **Step 2: Run to see it fail**

Run: `pnpm --filter @wordado/web test -- pathFolding`
Expected: FAIL, `unitReveal` is not exported.

- [ ] **Step 3: Implement `unitReveal`**

Append to `web/src/screens/pathFolding.ts`:

```ts
/**
 * What the path must open to show one unit: its level, and, in the level being studied (the only one shown
 * short), the finished units when it is one of them, or every unit when it lies beyond the next few. Null for
 * an ID no unit has.
 */
export function unitReveal(
  levels: readonly { readonly level: string; readonly units: readonly { readonly unitId: string }[]; readonly statuses: readonly UnitStatus[] }[],
  studied: string | undefined,
  unitId: string,
): { readonly level: string; readonly done: boolean; readonly all: boolean } | null {
  for (const { level, units, statuses } of levels) {
    const i = units.findIndex((unit) => unit.unitId === unitId)
    if (i < 0) continue
    if (level !== studied) return { level, done: false, all: false }
    const view = unitsAtFirst(statuses)
    const done = view.done.includes(i)
    return { level, done, all: !done && !view.shown.includes(i) }
  }
  return null
}
```

Run: `pnpm --filter @wordado/web test -- pathFolding` → PASS.

- [ ] **Step 4: Write the failing tests for the Path**

Add to `web/src/screens/Path.test.tsx` (the sample has one level, A1, with the units "People and greetings", current, and "Food and drink", locked; its unit IDs come from the snapshot):

```tsx
describe('Path, opened at a unit', () => {
  const unitId = (ctx: Awaited<ReturnType<typeof setup>>, title: string) => ctx.client.snapshot.corpus!.units.find((u) => u.title.en === title)!.unitId

  it('opens the unit’s word list and marks its heading as where focus goes', async () => {
    const ctx = await setup()
    const id = unitId(ctx, 'Food and drink')
    renderWith(<Path unit={id} />, ctx)
    const item = unit('Food and drink')
    expect(item.id).toBe(`unit-${id}`)
    expect(item.querySelector('details')!.open).toBe(true)
    expect(within(item).getAllByRole('listitem').length).toBeGreaterThan(0)
    expect(within(item).getByRole('heading', { name: 'Food and drink' }).hasAttribute('data-route-focus')).toBe(true)
    // The unit is still locked: arriving at it unlocks nothing.
    expect(within(item).getByText('Locked')).toBeTruthy()
  })

  it('lets the learner fold the unit again: it opens once, on arrival', async () => {
    const ctx = await setup()
    renderWith(<Path unit={unitId(ctx, 'Food and drink')} />, ctx)
    const details = unit('Food and drink').querySelector('details')!
    details.open = false
    fireEvent(details, new Event('toggle'))
    expect(unit('Food and drink').querySelector('details')!.open).toBe(false)
  })

  it('opens as usual for an ID no unit has', async () => {
    const ctx = await setup()
    renderWith(<Path unit="no-such-unit" />, ctx)
    expect(document.querySelector('details[open]')).toBeNull()
    expect(document.querySelector('[data-route-focus]')).toBeNull()
    expect(within(unit('People and greetings')).getByText('Current')).toBeTruthy()
  })

  it('gives every unit an ID and marks none without a unit to open at', async () => {
    const ctx = await setup()
    renderWith(<Path />, ctx)
    expect(unit('People and greetings').id).toBe(`unit-${unitId(ctx, 'People and greetings')}`)
    expect(document.querySelector('[data-route-focus]')).toBeNull()
  })
})
```

If the existing tests toggle `<details>` another way, use that way in the second test.

Run: `pnpm --filter @wordado/web test -- Path` → FAIL (`unit` prop unknown, no IDs).

- [ ] **Step 5: Implement in `Path.tsx`**

Signature and state (keep the existing state lines; add `arrived`):

```tsx
export function Path(props: { readonly unit?: string | undefined }) {
  …
  // The unit a search result led to, once the path has opened at it; the learner folds and unfolds freely afterwards.
  const [arrived, setArrived] = useState<string | null>(null)
```

After `const studied = levelToOpen(levels)`:

```tsx
  // Opened at a unit (`?unit=`): open what hides it, once per arrival. State set while rendering, so the unit is
  // in the first paint and the shell can focus it.
  if (props.unit !== undefined && arrived !== props.unit) {
    setArrived(props.unit)
    const reveal = unitReveal(levels, studied, props.unit)
    if (reveal) {
      const unitId = props.unit
      setLevelChoice((prev) => new Map(prev).set(reveal.level, true))
      if (reveal.done) setDoneOpen((prev) => new Set(prev).add(reveal.level))
      if (reveal.all) setShowAll((prev) => new Set(prev).add(reveal.level))
      setOpenUnits((prev) => new Set(prev).add(unitId))
    }
  }
  const target = props.unit !== undefined && levels.some((l) => l.units.some((u) => u.unitId === props.unit)) ? props.unit : null
```

The `if (!corpus || !progress || !path) return null` stays above this, so nothing is revealed before the data is there. Add an effect **above** that early return (hooks keep their order), which scrolls once the unit is in the page:

```tsx
  // The unit comes into view without animation, so reduced motion needs no special case.
  useEffect(() => {
    if (arrived !== null) document.getElementById(`unit-${arrived}`)?.scrollIntoView?.({ block: 'start', behavior: 'instant' })
  }, [arrived])
```

Pass `arrived={units[i]!.unitId === target}` to `UnitItem`, add `readonly arrived: boolean` to its props with the comment `/** A search result led here: the heading takes focus on arrival. */`, and in `UnitItem`:

```tsx
    <li id={`unit-${unit.unitId}`} className={`unit unit-${status}`}>
    …
          <h3 tabIndex={-1} {...(props.arrived ? { 'data-route-focus': '' } : {})}>
            {title}
          </h3>
```

Import `useEffect` and `unitReveal`.

- [ ] **Step 6: `App.tsx`: pass the unit, and focus what a screen names**

```tsx
    case 'path':
      return <Path unit={route.unit} />
```

In the focus effect, replace the `target` function:

```tsx
    // A screen may name what takes focus on arrival (`data-route-focus`): the unit a search led to, the search
    // field. The setup names its step's heading. Otherwise the screen itself.
    const target = (): HTMLElement | null =>
      main.current?.querySelector<HTMLElement>(inSetup ? '.setup h2[tabindex="-1"]' : '[data-route-focus]') ?? main.current
```

Update the comment above the effect only where it stops being true.

- [ ] **Step 7: Style**

In `web/src/styles.css`, next to the `.unit` rules, add:

```css
/* A search result leads to a unit: it comes to rest a little below the top of the screen. */
.unit {
  scroll-margin-top: var(--space-4);
}
```

If a `.unit { … }` rule already exists, add the property and comment there instead. Check that `h3:focus` inside `.unit-head` shows the app's usual focus ring for `tabindex="-1"` headings (the theme page's `h1` does the same); reuse that rule's selector list if the ring is missing.

- [ ] **Step 8: Run, typecheck, commit**

Run: `pnpm --filter @wordado/web test -- Path pathFolding` (PASS), `pnpm --filter @wordado/web typecheck`
```bash
git add web/src/screens/pathFolding.ts web/src/screens/pathFolding.test.ts web/src/screens/Path.tsx web/src/screens/Path.test.tsx web/src/app/App.tsx web/src/styles.css
git commit -m "feat(web): the path opens at the unit its address names (#144)"
```

---

### Task 4: The search screen, the row's `where` line, and the strings

**Files:**
- Create: `web/src/study/wordIndex.ts`, `web/src/screens/Search.tsx`, `web/src/screens/Search.test.tsx`
- Modify: `web/src/study/WordRow.tsx`, `web/src/app/App.tsx` (the `Screen` case), `web/src/styles.css`
- Modify: `web/src/i18n/en.ts`, `bg.ts`, `de.ts`, `es.ts`

**Interfaces:**
- Consumes: `wordIndex`, `searchWordIndex`, `WordIndex` (Task 1); `Route` `search` and `path.unit` (Task 2); `data-route-focus` (Task 3).
- Produces:
  - `courseIndex(corpus: Corpus): WordIndex` in `web/src/study/wordIndex.ts`
  - `WordRow` prop `where?: ReactNode`
  - `Search(props: { readonly q: string })`, with `export const RESULTS_STEP = 30`
  - message keys `search.open`, `search.title`, `search.label`, `search.placeholder`, `search.clear`, `search.hint`, `search.tooShort`, `search.found`, `search.none`, `search.sample`, `search.more`, `search.unitLocked`

- [ ] **Step 1: The strings**

Add after the `theme.find*` keys in each file.

`en.ts`:
```ts
  'search.open': 'Search',
  'search.title': 'Search',
  'search.label': 'Search the course',
  'search.placeholder': 'A word, a translation or a note',
  'search.clear': 'Clear',
  'search.hint': 'Find any word of the course: by the word, its translation or its note.',
  'search.tooShort': 'Type at least two letters.',
  'search.found': { one: '{count} word', other: '{count} words' },
  'search.none': 'No word in the course matches “{query}”.',
  'search.sample': { one: 'The sample has {count} word. Sign in to search the whole course.', other: 'The sample has {count} words. Sign in to search the whole course.' },
  'search.more': 'Show more',
  'search.unitLocked': '{title}, locked',
```

`bg.ts`:
```ts
  'search.open': 'Търсене',
  'search.title': 'Търсене',
  'search.label': 'Търсене в курса',
  'search.placeholder': 'Дума, превод или бележка',
  'search.clear': 'Изчисти',
  'search.hint': 'Намерете всяка дума от курса: по думата, по превода ѝ или по бележката към нея.',
  'search.tooShort': 'Въведете поне две букви.',
  'search.found': { one: '{count} дума', other: '{count} думи' },
  'search.none': 'Няма дума в курса, която да съвпада с „{query}“.',
  'search.sample': { one: 'Примерът има {count} дума. Влезте, за да търсите в целия курс.', other: 'Примерът има {count} думи. Влезте, за да търсите в целия курс.' },
  'search.more': 'Покажи още',
  'search.unitLocked': '{title}, заключен',
```

`de.ts`:
```ts
  'search.open': 'Suche',
  'search.title': 'Suche',
  'search.label': 'Im Kurs suchen',
  'search.placeholder': 'Ein Wort, eine Übersetzung oder ein Hinweis',
  'search.clear': 'Leeren',
  'search.hint': 'Finde jedes Wort des Kurses: über das Wort, seine Übersetzung oder seinen Hinweis.',
  'search.tooShort': 'Gib mindestens zwei Buchstaben ein.',
  'search.found': { one: '{count} Wort', other: '{count} Wörter' },
  'search.none': 'Kein Wort im Kurs passt zu „{query}“.',
  'search.sample': { one: 'Das Beispiel hat {count} Wort. Melde dich an, um im ganzen Kurs zu suchen.', other: 'Das Beispiel hat {count} Wörter. Melde dich an, um im ganzen Kurs zu suchen.' },
  'search.more': 'Mehr anzeigen',
  'search.unitLocked': '{title}, gesperrt',
```

`es.ts`:
```ts
  'search.open': 'Buscar',
  'search.title': 'Buscar',
  'search.label': 'Buscar en el curso',
  'search.placeholder': 'Una palabra, una traducción o una nota',
  'search.clear': 'Borrar',
  'search.hint': 'Encuentra cualquier palabra del curso: por la palabra, su traducción o su nota.',
  'search.tooShort': 'Escribe al menos dos letras.',
  'search.found': { one: '{count} palabra', other: '{count} palabras' },
  'search.none': 'Ninguna palabra del curso coincide con «{query}».',
  'search.sample': { one: 'La muestra tiene {count} palabra. Inicia sesión para buscar en todo el curso.', other: 'La muestra tiene {count} palabras. Inicia sesión para buscar en todo el curso.' },
  'search.more': 'Mostrar más',
  'search.unitLocked': '{title}, sin desbloquear',
```

Before writing, read ten neighbouring keys in each file and match that file's form of address (formal or informal "you") and its quotation marks; change these texts where they differ. Run `pnpm --filter @wordado/web test -- i18n` → PASS.

- [ ] **Step 2: The shared index**

Create `web/src/study/wordIndex.ts`:

```ts
import { wordIndex, type Corpus, type WordIndex } from '@wordado/core'

const built = new WeakMap<Corpus, WordIndex>()

/** The corpus's words as the search for the whole course looks through them, folded once per corpus. */
export function courseIndex(corpus: Corpus): WordIndex {
  let index = built.get(corpus)
  if (!index) {
    index = wordIndex(corpus)
    built.set(corpus, index)
  }
  return index
}
```

- [ ] **Step 3: The `where` slot**

In `web/src/study/WordRow.tsx`, add `readonly where?: ReactNode` to the props (import `type ReactNode` from `react`), extend the doc comment with "With `where`, a line under the word says where it is in the course (the search).", and render it last in the `<li>`:

```tsx
      <FlagControls wordId={corpusWordId(entry.entryId)} headword={entry.headword} menu learn={props.learn} />
      {props.where !== undefined && <span className="word-where">{props.where}</span>}
```

- [ ] **Step 4: Write the failing tests**

Create `web/src/screens/Search.test.tsx`. The sample: 60 words in three A1 units; "teacher" (учител) is in no offered theme; "key" (ключ) is in "Daily life"; "People and greetings" is the current unit, "Food and drink" is locked.

```tsx
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { corpusWordId } from '@wordado/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { renderWith, setup } from '../test/fixtures'
import { RESULTS_STEP, Search } from './Search'

afterEach(cleanup)
beforeEach(() => window.history.replaceState(null, '', '/search'))

const field = () => screen.getByRole('searchbox', { name: 'Search the course' })
const type = (text: string) => fireEvent.change(field(), { target: { value: text } })
const rows = () => within(screen.getByRole('list')).getAllByRole('listitem')
const words = () => rows().map((row) => row.querySelector('.word-head')!.textContent)
const status = () => document.querySelector('.search-page [role="status"]')!.textContent
const account = { email: 'learner@example.com' } as never

describe('Search', () => {
  it('opens with a hint and the field marked to take focus', async () => {
    renderWith(<Search q="" />, await setup())
    expect(screen.getByRole('heading', { level: 1, name: 'Search' })).toBeTruthy()
    expect(screen.getByText('Find any word of the course: by the word, its translation or its note.')).toBeTruthy()
    expect(field().hasAttribute('data-route-focus')).toBe(true)
    expect(screen.queryByRole('list')).toBeNull()
    expect(status()).toBe('')
  })

  it('asks for two letters', async () => {
    renderWith(<Search q="" />, await setup())
    type('t')
    expect(status()).toBe('Type at least two letters.')
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('finds a word by its start, by its translation, and puts the word itself first', async () => {
    renderWith(<Search q="" />, await setup())
    type('teach')
    expect(words()).toEqual(['teacher'])
    expect(status()).toBe('1 word')
    type('учител')
    expect(words()).toEqual(['teacher'])
  })

  it('says where a word is: its level, its unit as a link to the path, its themes', async () => {
    const ctx = await setup()
    renderWith(<Search q="key" />, ctx)
    const corpus = ctx.client.snapshot.corpus!
    const entry = [...corpus.entries.values()].find((e) => e.headword === 'key')!
    const unit = corpus.units.find((u) => u.unitId === entry.unitId)!
    const row = rows().find((r) => r.querySelector('.word-head')!.textContent === 'key')!
    const where = row.querySelector<HTMLElement>('.word-where')!
    expect(within(where).getByText('A1')).toBeTruthy()
    expect(where.querySelector(`a[href="/path?unit=${unit.unitId}"]`)!.textContent).toContain(unit.title.en)
    expect(within(where).getByRole('link', { name: 'Daily life' }).getAttribute('href')).toBe('/themes/daily-life')
  })

  it('names a theme too small to offer without linking to it, and says a locked unit is locked', async () => {
    const ctx = await setup()
    renderWith(<Search q="teacher" />, ctx)
    const corpus = ctx.client.snapshot.corpus!
    const entry = [...corpus.entries.values()].find((e) => e.headword === 'teacher')!
    const where = rows()[0]!.querySelector<HTMLElement>('.word-where')!
    for (const themeId of entry.themes) expect(where.querySelector(`a[href="/themes/${themeId}"]`)).toBeNull()
    const locked = [...corpus.entries.values()].find((e) => !ctx.client.snapshot.path!.unlocked.has(e.unitId))!
    cleanup()
    renderWith(<Search q={locked.headword} />, ctx)
    const title = corpus.units.find((u) => u.unitId === locked.unitId)!.title.en
    expect(screen.getAllByRole('link', { name: `${title}, locked` }).length).toBeGreaterThan(0)
  })

  it('offers Learn this word on any word found, and marks it', async () => {
    const ctx = await setup()
    renderWith(<Search q="teacher" />, ctx)
    fireEvent.click(screen.getByRole('button', { name: 'Word actions: teacher' }))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Learn this word: teacher' })))
    const entry = [...ctx.client.snapshot.corpus!.entries.values()].find((e) => e.headword === 'teacher')!
    expect(ctx.client.snapshot.toLearn).toContain(corpusWordId(entry.entryId))
  })

  it('keeps the query in the address, in one history entry', async () => {
    renderWith(<Search q="" />, await setup())
    const before = window.history.length
    type('te')
    type('tea')
    expect(window.location.pathname + window.location.search).toBe('/search?q=tea')
    expect(window.history.length).toBe(before)
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(window.location.pathname + window.location.search).toBe('/search')
    expect(document.activeElement).toBe(field())
  })

  it('clears with Escape', async () => {
    renderWith(<Search q="teacher" />, await setup())
    fireEvent.keyDown(field(), { key: 'Escape' })
    expect((field() as HTMLInputElement).value).toBe('')
  })

  it('starts from the address, without taking focus from the page', async () => {
    renderWith(<Search q="teacher" />, await setup())
    expect((field() as HTMLInputElement).value).toBe('teacher')
    expect(field().hasAttribute('data-route-focus')).toBe(false)
    expect(words()).toEqual(['teacher'])
  })

  it('shows thirty results, and thirty more on request, with focus on the first new one', async () => {
    const ctx = await setup()
    // Every word of the sample gets a sense note that one query finds.
    const snapshot = ctx.client.snapshot
    const entries = new Map([...snapshot.corpus!.entries].map(([id, e]) => [id, { ...e, sense: 'qqfind' }]))
    ctx.client.store.set({ ...snapshot, corpus: { ...snapshot.corpus!, entries } })
    renderWith(<Search q="qqfind" />, ctx)
    expect(RESULTS_STEP).toBe(30)
    expect(rows()).toHaveLength(30)
    expect(status()).toBe('60 words')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Show more' })))
    expect(rows()).toHaveLength(60)
    expect(rows()[30]!.contains(document.activeElement)).toBe(true)
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull()
  })

  it('says nothing was found, and signed out, that the sample is small', async () => {
    const ctx = await setup()
    renderWith(<Search q="zzzz" />, ctx)
    expect(status()).toBe('No word in the course matches “zzzz”.')
    expect(screen.getByText('The sample has 60 words. Sign in to search the whole course.')).toBeTruthy()
    cleanup()
    renderWith(<Search q="zzzz" />, { ...ctx, account })
    expect(screen.queryByText(/The sample has/)).toBeNull()
  })

  it('does not find a retired word', async () => {
    const ctx = await setup()
    const snapshot = ctx.client.snapshot
    const entries = new Map([...snapshot.corpus!.entries].map(([id, e]) => [id, e.headword === 'teacher' ? { ...e, retired: true } : e]))
    ctx.client.store.set({ ...snapshot, corpus: { ...snapshot.corpus!, entries } })
    renderWith(<Search q="teacher" />, ctx)
    expect(screen.queryByRole('list')).toBeNull()
  })
})
```

Read `web/src/account/storage.ts` for the real shape of `AccountRecord` and build `account` properly instead of the cast. Read how `Themes.test.tsx` and `Theme.test.tsx` tweak the corpus (`client.store.set`) and copy that exact form if it differs. If a sample fact above is wrong (a word's theme, a unit's status), fix the fixture choice, keep the behaviour asserted.

Run: `pnpm --filter @wordado/web test -- Search` → FAIL (no module).

- [ ] **Step 5: Implement `Search.tsx`**

```tsx
import { useClientSnapshot } from '@wordado/client-data'
import { offeredThemes, searchWordIndex, searchWords, type CorpusEntry } from '@wordado/core'
import { Lock, Search as SearchIcon, X } from 'lucide-react'
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../app/context'
import { localized, useT } from '../i18n/i18n'
import { Link, navigate } from '../router'
import { courseIndex } from '../study/wordIndex'
import { WordRow } from '../study/WordRow'

/** How many results the list shows at first, and how many "Show more" adds. */
export const RESULTS_STEP = 30

/**
 * The search for the whole course (issue #144): any word, by its headword or a variant, a translation or its
 * sense note, best match first. Each result is the path's word row with a line saying where the word is: its
 * level, its unit (a link to the path, opened there) and its themes. The query lives in the address, so coming
 * back from a unit or a theme finds the same results.
 */
export function Search(props: { readonly q: string }) {
  const { t, locale } = useT()
  const { account } = useApp()
  const { corpus, path } = useClientSnapshot()
  const [query, setQuery] = useState(props.q)
  const [shown, setShown] = useState(RESULTS_STEP)
  // Opened with nothing to search for, the field takes focus; opened on a query, the page does, as on any arrival.
  const [fresh] = useState(props.q === '')
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const added = useRef<number | null>(null)
  // The address changed without typing (back or forward between two searches): the field follows it.
  useEffect(() => {
    setQuery(props.q)
    setShown(RESULTS_STEP)
  }, [props.q])
  // "Show more" puts focus on the first of the rows it added (spec §11.1).
  useEffect(() => {
    if (added.current === null) return
    list.current?.children[added.current]?.querySelector<HTMLElement>('button, a')?.focus()
    added.current = null
  }, [shown])
  // The list follows the field a moment behind, so typing stays quick while the rows redraw.
  const deferred = useDeferredValue(query)
  const index = useMemo(() => (corpus ? courseIndex(corpus) : null), [corpus])
  const found = useMemo(() => (index ? searchWordIndex(index, deferred) : null), [index, deferred])
  const places = useMemo(() => {
    if (!corpus) return null
    return {
      units: new Map(corpus.units.map((unit) => [unit.unitId, unit])),
      themes: new Map(corpus.themes.map((theme) => [theme.themeId, theme])),
      offered: new Set(offeredThemes(corpus).map((theme) => theme.themeId)),
    }
  }, [corpus])
  if (!corpus || !index || !places) return null

  const search = (next: string) => {
    setQuery(next)
    setShown(RESULTS_STEP)
    navigate({ name: 'search', q: next }, { replace: true })
  }
  const typed = deferred.trim()
  const statusText = found === null ? (typed === '' ? '' : t('search.tooShort')) : found.length === 0 ? t('search.none', { query: typed }) : t('search.found', { count: found.length })

  const where = (entry: CorpusEntry) => {
    const unit = places.units.get(entry.unitId)
    const title = unit && localized(unit.title, locale, corpus.l1)
    const locked = unit !== undefined && path !== null && !path.unlocked.has(unit.unitId)
    return (
      <>
        <span className="word-level">{entry.level}</span>
        {unit && (
          <Link to={{ name: 'path', unit: unit.unitId }} {...(locked ? { className: 'is-locked', 'aria-label': t('search.unitLocked', { title: title! }) } : {})}>
            {locked && <Lock aria-hidden="true" size={14} />}
            {title}
          </Link>
        )}
        {entry.themes.map((themeId) => {
          const theme = places.themes.get(themeId)
          if (!theme) return null
          const name = localized(theme.name, locale, corpus.l1)
          return places.offered.has(themeId) ? (
            <Link key={themeId} to={{ name: 'theme', themeId }}>
              {name}
            </Link>
          ) : (
            <span key={themeId}>{name}</span>
          )
        })}
      </>
    )
  }

  return (
    <section className="search-page" aria-labelledby="search-title">
      <h1 id="search-title">{t('search.title')}</h1>
      <form role="search" className="search-field" onSubmit={(e) => e.preventDefault()}>
        <label className="visually-hidden" htmlFor="search-field">
          {t('search.label')}
        </label>
        <SearchIcon aria-hidden="true" size={18} />
        <input
          id="search-field"
          ref={input}
          type="search"
          value={query}
          placeholder={t('search.placeholder')}
          autoComplete="off"
          {...(fresh ? { 'data-route-focus': '' } : {})}
          onChange={(e) => search(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Escape' || query === '') return
            e.preventDefault()
            search('')
          }}
        />
        {query !== '' && (
          <button
            type="button"
            className="search-clear"
            aria-label={t('search.clear')}
            onClick={() => {
              search('')
              input.current?.focus()
            }}
          >
            <X aria-hidden="true" size={18} />
          </button>
        )}
      </form>
      <p className="search-status" role="status">
        {statusText}
      </p>
      {typed === '' && <p className="note">{t('search.hint')}</p>}
      {found !== null && found.length === 0 && account === null && <p className="note">{t('search.sample', { count: index.words.length })}</p>}
      {found !== null && found.length > 0 && (
        <>
          <ul className="panel unit-words search-words" ref={list}>
            {found.slice(0, shown).map((entryId) => {
              const entry = corpus.entries.get(entryId)
              return entry ? <WordRow key={entryId} entry={entry} lang={corpus.l1} learn where={where(entry)} /> : null
            })}
          </ul>
          {found.length > shown && (
            <button
              type="button"
              className="button search-more"
              onClick={() => {
                added.current = shown
                setShown(shown + RESULTS_STEP)
              }}
            >
              {t('search.more')}
            </button>
          )}
        </>
      )}
    </section>
  )
}
```

Notes for the implementer:
- `searchWords` is imported only if you use it; drop the import otherwise (lint denies unused imports).
- Check the types of `corpus.entries` keys (`entryId`) and of `path` in the snapshot (`PathView | null`); adapt the null checks to the real types.
- `type="search"` shows a native clear button in some browsers. Hide it in the styles (Step 7) so there is one clear control.
- The first effect runs on mount with the same value: harmless. Do not key the component on `q` (it would remount on every letter and lose focus).
- `useDeferredValue` in tests resolves within `act`; if an assertion right after `type()` sees the old list, wrap `type` in `act`.

- [ ] **Step 6: Register the screen**

`web/src/app/App.tsx`: import `Search` from `'../screens/Search'` and add

```tsx
    case 'search':
      return <Search q={route.q} />
```

- [ ] **Step 7: Styles**

Add to `web/src/styles.css`, after the theme page's rules (near `ul.theme-words.panel`). The mock's values are in `docs/superpowers/specs/2026-10-11-global-search-mockups/`:

```css
/* The search for the whole course */

.search-page {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  max-width: 46rem;
  margin-inline: auto;
}

.search-page h1 {
  margin: 0;
}

.search-field {
  position: relative;
}

.search-field > svg {
  position: absolute;
  top: 50%;
  left: var(--space-3);
  color: var(--ink-soft);
  transform: translateY(-50%);
  pointer-events: none;
}

.search-field input {
  display: block;
  width: 100%;
  min-height: 3rem;
  padding: var(--space-2) 3rem var(--space-2) 2.5rem;
  font: inherit;
  color: var(--ink);
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: var(--radius);
}

/* One way to clear the field: the app's own button. */
.search-field input::-webkit-search-cancel-button {
  display: none;
}

.search-clear {
  position: absolute;
  top: 50%;
  right: 0.125rem;
  display: grid;
  place-items: center;
  width: 2.75rem;
  height: 2.75rem;
  color: var(--ink-soft);
  background: none;
  border: 0;
  border-radius: 50%;
  transform: translateY(-50%);
  cursor: pointer;
}

.search-status {
  margin: 0;
  font-weight: 600;
}

/* Nothing to say yet: the line keeps no room. */
.search-status:empty {
  display: none;
}

ul.search-words.panel {
  padding: 0 1.25rem;
}

ul.search-words > li:first-child {
  border-top: 0;
}

.search-more {
  align-self: center;
}

/* Where a found word is in the course: its level, its unit, its themes; a line of its own under the word. */
.word-where {
  display: flex;
  flex-basis: 100%;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1) var(--space-4);
  padding-bottom: var(--space-2);
  padding-left: 3.5rem;
  font-size: var(--step--1);
  color: var(--ink-soft);
}

.word-where a {
  color: var(--ink);
}

.word-where .is-locked {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.word-level {
  padding: 0.0625rem 0.5rem;
  font-weight: 600;
  color: var(--paper);
  background: var(--ink);
  border-radius: 999px;
}
```

Inside the existing phone block `@media (max-width: 39.99rem)` that holds `.unit-words li:has(> .word-menu)`, add:

```css
  .unit-words li:has(> .word-menu) > .word-where {
    grid-area: 3 / 2 / auto / -1;
    padding-top: var(--space-1);
    padding-left: 0;
  }
```

Then look at it: `pnpm --filter @wordado/web dev`, open `/search?q=<a sample word>` at 360px and at 1100px, in light and dark, and compare with the mock pictures. Fix what differs: the left padding of `.word-where` when a row has no listen button (the word then starts at the row's edge: set `padding-left: 0` for `li:not(:has(> .play-word)) > .word-where`), the focus ring on the field and on the clear button (reuse the app's focus rule), and the links' touch height on a phone (WCAG 2.5.8 wants 24px: give `.word-where a` `padding-block` so its box is at least 1.5rem high).

- [ ] **Step 8: Run, typecheck, lint, commit**

Run: `pnpm --filter @wordado/web test` (all PASS), `pnpm -r typecheck`, `pnpm lint`
```bash
git add web/src/study/wordIndex.ts web/src/study/WordRow.tsx web/src/screens/Search.tsx web/src/screens/Search.test.tsx web/src/app/App.tsx web/src/styles.css web/src/i18n
git commit -m "feat(web): the search screen: any word of the course, ranked, with where it is (#144)"
```

---

### Task 5: The top-bar button, focus while typing, and the narrow signed-out row

**Files:**
- Modify: `web/src/app/App.tsx`, `web/src/styles.css`
- Create: `web/src/app/App.test.tsx` (if a test of `App` already exists under another name, add to it instead)

**Interfaces:**
- Consumes: `Route` `search` (Task 2), `search.open` (Task 4), `data-route-focus` (Task 3).
- Produces: a link named "Search" in `.masthead-actions`; `App` does not move focus when the route goes from `search` to `search`.

- [ ] **Step 1: Write the failing tests**

Create `web/src/app/App.test.tsx`:

```tsx
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { navigate } from '../router'
import { renderWith, setup } from '../test/fixtures'
import { App } from './App'

afterEach(cleanup)
beforeEach(() => window.history.replaceState(null, '', '/'))

const app = (over: { readonly setup?: boolean } = {}) => <App resumed={false} setup={over.setup ?? false} onFinishSetup={() => undefined} />

describe('the search button', () => {
  it('stands in the top row and leads to the search', async () => {
    renderWith(app(), await setup())
    const link = screen.getByRole('link', { name: 'Search' })
    expect(link.getAttribute('href')).toBe('/search')
    expect(link.closest('.masthead-actions')).toBeTruthy()
    expect(link.getAttribute('aria-current')).toBeNull()
    await act(async () => fireEvent.click(link))
    expect(screen.getByRole('heading', { level: 1, name: 'Search' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Search' }).getAttribute('aria-current')).toBe('page')
  })

  it('is not offered during the first-run setup', async () => {
    renderWith(app({ setup: true }), await setup())
    expect(screen.queryByRole('link', { name: 'Search' })).toBeNull()
  })

  it('is not there while studying: the masthead steps aside', async () => {
    window.history.replaceState(null, '', '/study')
    renderWith(app(), await setup())
    expect(screen.queryByRole('link', { name: 'Search' })).toBeNull()
  })
})

describe('focus on the search screen', () => {
  it('goes to the field on arrival, and stays there while the address follows the typing', async () => {
    renderWith(app(), await setup())
    await act(async () => navigate({ name: 'search', q: '' }))
    const field = screen.getByRole('searchbox', { name: 'Search the course' })
    expect(document.activeElement).toBe(field)
    await act(async () => fireEvent.change(field, { target: { value: 'te' } }))
    await act(async () => fireEvent.change(field, { target: { value: 'tea' } }))
    expect(window.location.search).toBe('?q=tea')
    expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: 'Search the course' }))
  })

  it('goes to the page when it arrives with a query, as on any screen', async () => {
    renderWith(app(), await setup())
    await act(async () => navigate({ name: 'search', q: 'teacher' }))
    expect(document.activeElement).toBe(document.getElementById('main'))
  })

  it('goes to the unit when the path opens at one', async () => {
    const ctx = await setup()
    renderWith(app(), ctx)
    const unit = ctx.client.snapshot.corpus!.units.find((u) => u.title.en === 'Food and drink')!
    await act(async () => navigate({ name: 'path', unit: unit.unitId }))
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Food and drink' }))
  })
})
```

Read `Root.test.tsx` first for how the shell is rendered in tests (providers, any hook `App` needs that `renderWith` does not give); follow it.

Run: `pnpm --filter @wordado/web test -- App.test` → FAIL.

- [ ] **Step 2: Implement in `App.tsx`**

Add the button, first in `.masthead-actions`:

```tsx
            <div className="masthead-actions">
              {/* Not while the setup is owed, on its Sign in and Feedback pages either: there is no course to search yet. */}
              {!props.setup && (
                <Link className="search-circle" to={{ name: 'search', q: '' }} aria-label={t('search.open')} aria-current={route.name === 'search' ? 'page' : undefined}>
                  <SearchIcon aria-hidden="true" size={20} />
                </Link>
              )}
              <LanguageMenu />
              <AccountMenu />
            </div>
```

Import `Search as SearchIcon` from `lucide-react` (the screen is already imported as `Search`). Update the doc comment of `App` ("the masthead's first row (the icon and wordmark, the search, the language, the account)").

Keep focus while typing. In the focus effect, remember the previous route name:

```tsx
  const before = useRef(route.name)
  …
  useEffect(() => {
    const from = before.current
    before.current = route.name
    // The search rewrites its own address as the learner types: that is not an arrival, and the field keeps focus.
    if (from === 'search' && route.name === 'search') return
    …the existing body…
  }, [route])
```

Place the early return after the `first.current` handling only if that keeps the first-load rule intact; the simplest correct order is: update `before`, handle `first.current` as today, then the search-to-search return, then `target()?.focus()`.

- [ ] **Step 3: Styles**

Beside `.language-circle` in `web/src/styles.css`:

```css
/* The way to the search: a circle like the language's, with a magnifier. */
.search-circle {
  display: grid;
  place-items: center;
  width: 2.75rem;
  height: 2.75rem;
  color: var(--ink);
  background: var(--paper-raised);
  border: 1.5px solid var(--rule);
  border-radius: 50%;
}

.search-circle[aria-current='page'] {
  border-color: var(--ink);
}
```

And for the signed-out row:

```css
.account-signin {
  min-height: 2.75rem;
  white-space: nowrap;
}

/* Signed out on a narrow phone, the search, the language and "Sign in" leave no room for the name: the icon
   stands alone. The link keeps its name for a screen reader. */
@media (max-width: 24.99rem) {
  .masthead-top:has(.account-signin) .wordmark-name {
    display: none;
  }
}
```

(`.account-signin` exists: add `white-space` to it, do not duplicate the rule.) Check in the browser at 360px signed out, in English and in German (the longest "Sign in" text): nothing wraps and nothing is clipped. If German still overflows, lower `.masthead-actions`' gap to `var(--space-2)` inside the same media query.

- [ ] **Step 4: Run, typecheck, lint, commit**

Run: `pnpm --filter @wordado/web test` (PASS), `pnpm -r typecheck`, `pnpm lint`
```bash
git add web/src/app/App.tsx web/src/app/App.test.tsx web/src/styles.css
git commit -m "feat(web): a search button in the top row of every screen (#144)"
```

---

### Task 6: The Themes search links to the whole-course search

**Files:**
- Modify: `web/src/screens/Themes.tsx`
- Test: `web/src/screens/Themes.test.tsx`

**Interfaces:**
- Consumes: `Route` `search` (Task 2).

- [ ] **Step 1: Write the failing test**

In `web/src/screens/Themes.test.tsx`, extend the test "lists a matching word of no theme though no theme matches":

```tsx
    const line = screen.getByRole('link', { name: /^Also in the course, in no theme:/ })
    expect(line.getAttribute('href')).toBe('/search?q=teach')
    expect(line.textContent).toBe('Also in the course, in no theme: teacher учител')
```

Run: `pnpm --filter @wordado/web test -- Themes.test` → FAIL (no such link).

- [ ] **Step 2: Implement**

In `Themes.tsx`, wrap the content of `<p className="note theme-unthemed">` in a link, the text unchanged:

```tsx
            <p className="note theme-unthemed">
              {/* The words of no theme are found by the search for the whole course, with the same query. */}
              <Link to={{ name: 'search', q: query.trim() }}>
                {t('themes.searchNoTheme')}{' '}
                …the existing words and "+N more", unchanged…
              </Link>
            </p>
```

The existing assertions on this line's `textContent` must still pass (`getByText(/^Also in the course/)` may now return the link; its text is the same). In `styles.css`, make sure `.theme-unthemed a` keeps the note's colour for the words and is recognisably a link (underline): add a rule only if it does not look right.

- [ ] **Step 3: Run and commit**

Run: `pnpm --filter @wordado/web test -- Themes` (PASS)
```bash
git add web/src/screens/Themes.tsx web/src/screens/Themes.test.tsx web/src/styles.css
git commit -m "feat(web): the Themes search leads to the whole-course search for words of no theme (#144)"
```

---

### Task 7: Browser tests

**Files:**
- Modify: `web/e2e/demo.spec.ts`
- Read first: `web/e2e/helpers.ts` (`finishSetup`, `heading`, `expectAccessible`, `serveTwoLevelSample`), the Themes search test around line 413, and `web/e2e/projects.ts` for the phone and desktop projects.

- [ ] **Step 1: Write the tests**

Add after the Themes tests, in the file's style:

```ts
test('searches the whole course from the top row, and goes from a result to its unit and back', async ({ page }) => {
  await page.goto('/')
  await finishSetup(page)
  await page.getByRole('link', { name: 'Search', exact: true }).click()
  await expect(heading(page)).toHaveText('Search')
  const field = page.getByRole('searchbox', { name: 'Search the course' })
  await expect(field).toBeFocused()
  // Typing rewrites the address and never takes the cursor from the field.
  await field.pressSequentially('teach')
  await expect(field).toBeFocused()
  await expect(page).toHaveURL(/\/search\?q=teach$/)
  await expect(page.locator('.search-page [role="status"]')).toHaveText('1 word')
  const row = page.locator('.search-words > li').filter({ hasText: 'teacher' })
  await expect(row).toHaveCount(1)
  await expectAccessible(page, { dark: true })
  // The unit link opens the path at that unit, its words open and its heading focused.
  const unitLink = row.locator('.word-where a').first()
  const title = (await unitLink.textContent())!.trim()
  await unitLink.click()
  await expect(heading(page)).toHaveText('Path')
  await expect(page).toHaveURL(/\/path\?unit=/)
  const unit = page.getByRole('heading', { level: 3, name: title })
  await expect(unit).toBeFocused()
  await expect(page.locator('li.unit', { has: unit }).locator('details')).toHaveAttribute('open', '')
  // Back: the same query and the same result.
  await page.goBack()
  await expect(field).toHaveValue('teach')
  await expect(row).toHaveCount(1)
})

test('marks a found word to learn, follows its theme, and says when the sample has no such word', async ({ page }) => {
  await page.goto('/')
  await finishSetup(page)
  await page.goto('/search?q=key')
  const row = page.locator('.search-words > li').filter({ hasText: 'ключ' })
  await row.getByRole('button', { name: 'Word actions: key' }).click()
  await row.getByRole('button', { name: 'Learn this word: key' }).click()
  await row.getByRole('button', { name: 'Word actions: key' }).click()
  await expect(row.getByRole('button', { name: /^Don’t learn|^Do not learn|: key$/ }).first()).toBeVisible()
  await page.keyboard.press('Escape')
  await row.getByRole('link', { name: 'Daily life' }).click()
  await expect(heading(page)).toHaveText('Daily life')
  await page.goto('/search?q=zebra')
  await expect(page.locator('.search-page [role="status"]')).toHaveText('No word in the course matches “zebra”.')
  await expect(page.getByText('The sample has 60 words. Sign in to search the whole course.')).toBeVisible()
})

test('fits the top row on a narrow phone while signed out', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 720 })
  await page.goto('/')
  await finishSetup(page)
  const row = page.locator('.masthead-top')
  const box = (await row.boundingBox())!
  // One line of controls: the row is no taller than a control and its padding, and nothing reaches past its edge.
  expect(box.height).toBeLessThan(80)
  for (const control of [page.getByRole('link', { name: 'Search', exact: true }), page.getByRole('link', { name: 'Sign in' })]) {
    const b = (await control.boundingBox())!
    expect(b.x).toBeGreaterThanOrEqual(box.x)
    expect(b.x + b.width).toBeLessThanOrEqual(box.x + box.width + 0.5)
    expect(b.height).toBeLessThan(50)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  await page.goto('/search?q=te')
  await expectAccessible(page)
})
```

Replace the loose `name` regex of the "taken back" button with the exact English text of the key `flag.dontLearn` (read it in `web/src/i18n/en.ts`) in the form `'<text>: key'`. If "key" is not a word of "Daily life" in the sample, the Themes search test at line 413 says which word is; use that one.

- [ ] **Step 2: Run**

Run: `pnpm --filter @wordado/web e2e -- demo.spec.ts` (start whatever the Playwright config's `webServer` needs: it starts by itself).
Expected: the three new tests PASS on every project; no other test of `demo.spec.ts` fails. A test that fails because the top row is now taller or holds one more link is fixed in the test only when the new behaviour is the intended one; otherwise fix the code.

- [ ] **Step 3: Commit**

```bash
git add web/e2e/demo.spec.ts
git commit -m "test(web): the search in the browser: results, the way to a unit and back, the narrow top row (#144)"
```

---

### Task 8: The parent spec, the timing, the issue, the pull request

**Files:**
- Modify: `docs/superpowers/specs/2026-09-20-vocabulary-learning-app-design.md`

- [ ] **Step 1: The parent spec**

Read §7.4 (the word-list row, near lines 751-762), §8.9 (themes) and the end of §8, and the last entries of §16. Then:

1. In §7.4, correct the sentence that limits "Learn this word" in a list to a skipped level's unit: the Path's own list keeps that limit; a theme's page and the search offer it for any word that is not started.
2. Add a subsection at the end of §8, numbered after the last one there, titled "Search". In about 25 lines of the spec's own style, say: the Themes search (what it matches, best match first, the line for words of no offered theme) and the theme page with its word filter (issue #142); the search for the whole course (issue #144): the button in the top row, `/search?q=`, what is matched, the three ranking groups and the order inside them, thirty results at a time, what a result shows and links to, the same actions as the theme page, that a retired word is not found, that it works offline from the pack in memory; the Path opening at a unit (`/path?unit=`). Point to `2026-10-11-global-search-design.md` for the detail.
3. In §16, add a revision-log entry dated 2026-10-11, "a search for the whole course", decided by the product owner (issue #144), with three bullets (search; the Path opens at a unit; "Learn this word" for any found word), and a row in the approval table in the form of the latest rows.

No corpus text beyond the sample's words, no dates of plans.

- [ ] **Step 2: Time the index on the real pack**

If an installed real pack is available to the dev app (signed in locally), open `/search` and run in the console of the dev build a timing of `wordIndex` and of one two-letter `searchWordIndex` (for example through a temporary `console.time` in `courseIndex` and around the `useMemo` of `found`, removed before committing). If no real pack is at hand, build a synthetic corpus of 9,000 entries in a throwaway Vitest file, time both there, and delete the file. Put the numbers in the pull request, and say which of the two was measured.

- [ ] **Step 3: The whole check**

Run, from the worktree root:
```bash
pnpm --filter @wordado/core test
pnpm --filter @wordado/web test
pnpm -r typecheck
pnpm lint
pnpm --filter @wordado/web e2e
```
Expected: all pass. `web/e2e/accounts.spec.ts` runs only in CI: read it for anything that asserts the top row's links or the Path's markup, and say in the pull request that it was read, not run.

- [ ] **Step 4: Commit, issue, pull request**

```bash
git add docs/superpowers/specs/2026-09-20-vocabulary-learning-app-design.md
git commit -m "docs: the design describes the two searches and the path opening at a unit (#144)"
```

- Tick the checklist on issue #144.
- Comment on issue #102 with the list of the twelve `search.*` keys whose Bulgarian, German and Spanish texts wait for a native reader.
- Push and open the pull request: title "feat: a search for the whole app: find any word of the course", body with what it does, what was checked and what was not (the accounts browser tests; the list at full pack size beyond the timing), the timing numbers, `Closes #144`, ending with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. The owner merges.
