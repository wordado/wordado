import { cleanup, screen } from '@testing-library/react'
import { ITEM_SETTLE_MS, MatchingRun, StudyRun, type Client } from '@wordado/client-data'
import { corpusWordId, Grade, themeEntries, type PracticeScope } from '@wordado/core'
import { afterEach, describe, expect, it } from 'vitest'
import type { TestEnv } from '@wordado/client-data/src/testing/testEnv'
import { answerNew, renderWith, setup } from '../test/fixtures'
import { Practice } from './Practice'

afterEach(cleanup)

describe('Practice', () => {
  it('asks for a few new words first when none has been studied', async () => {
    const ctx = await setup()
    renderWith(<Practice />, ctx)
    expect(screen.getByText('Nothing to practise yet. Study a few new words first.')).toBeTruthy()
  })

  it('offers a practice run and the matching game, and says practice leaves the schedule alone', async () => {
    const ctx = await setup()
    await answerNew(ctx.client, ctx.env, 5)
    renderWith(<Practice />, ctx)
    expect(screen.getByText('Practice doesn’t change when words come back for review.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Practise words you know' }).getAttribute('href')).toBe('/practice/words')
    expect(screen.getByRole('link', { name: 'Flashcards' }).getAttribute('href')).toBe('/practice/words?mode=flashcard')
    const matching = screen.getByRole('link', { name: 'Matching' })
    expect(matching.getAttribute('href')).toBe('/practice/matching')
    expect(matching.getAttribute('aria-describedby')).toBeTruthy()
    expect(document.getElementById(matching.getAttribute('aria-describedby')!)?.textContent).toBe('Match words with their translations')
    expect(screen.getByRole('heading', { name: 'Practise one way' })).toBeTruthy()
    expect(screen.getByText('Mixed practice')).toBeTruthy()
  })

  it('practises one unit: names it, carries it in every way to practise, and leads back to the path', async () => {
    const ctx = await setup()
    await answerNew(ctx.client, ctx.env, 5)
    const first = ctx.client.snapshot.corpus!.units[0]!
    renderWith(<Practice unit={first.unitId} />, ctx)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Practice')
    expect(screen.getByText('Unit: People and greetings')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Practise this unit' }).getAttribute('href')).toBe(`/practice/words?unit=${first.unitId}`)
    expect(screen.getByRole('link', { name: 'Flashcards' }).getAttribute('href')).toBe(`/practice/words?unit=${first.unitId}&mode=flashcard`)
    expect(screen.getByRole('link', { name: 'Multiple choice' }).getAttribute('href')).toBe(`/practice/words?unit=${first.unitId}&mode=multiple_choice`)
    expect(screen.getByRole('link', { name: 'Matching' }).getAttribute('href')).toBe(`/practice/matching?unit=${first.unitId}`)
    expect(screen.getByRole('link', { name: 'Back to the path' }).getAttribute('href')).toBe('/path')
  })

  it('names the unit in the interface language', async () => {
    const ctx = await setup()
    await answerNew(ctx.client, ctx.env, 5)
    renderWith(<Practice unit={ctx.client.snapshot.corpus!.units[0]!.unitId} />, { ...ctx, locale: 'bg' })
    expect(screen.getByText('Урок: Хора и поздрави')).toBeTruthy()
  })

  it('falls back to practice over everything for an unknown unit and for a locked one', async () => {
    const ctx = await setup()
    await answerNew(ctx.client, ctx.env, 5)
    const locked = ctx.client.snapshot.corpus!.units[2]!
    for (const unit of ['nowhere', locked.unitId]) {
      renderWith(<Practice unit={unit} />, ctx)
      expect(screen.queryByText(/^Unit:/)).toBeNull()
      expect(screen.queryByRole('link', { name: 'Back to the path' })).toBeNull()
      expect(screen.getByRole('link', { name: 'Practise words you know' }).getAttribute('href')).toBe('/practice/words')
      expect(screen.getByRole('link', { name: 'Matching' }).getAttribute('href')).toBe('/practice/matching')
      cleanup()
    }
  })

  it('says there is nothing to practise in a unit with no started word, whatever is started elsewhere', async () => {
    const ctx = await setup()
    await ctx.client.updateSettings({ newWordLimit: 30 })
    await answerNew(ctx.client, ctx.env, 20)
    renderWith(<Practice unit={ctx.client.snapshot.corpus!.units[1]!.unitId} />, ctx)
    expect(screen.getByText('Unit: Food and drink')).toBeTruthy()
    expect(screen.getByText('Nothing to practise yet. Study a few new words first.')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Matching' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Back to the path' }).getAttribute('href')).toBe('/path')
  })

  it('practises a unit of a skipped level with nothing started, and says where its words are from (spec §7.2, §7.4)', async () => {
    const ctx = await setup()
    await ctx.client.updateSettings({ declaredLevel: 'A2' })
    const second = ctx.client.snapshot.corpus!.units[1]!
    renderWith(<Practice unit={second.unitId} />, ctx)
    expect(screen.getByText('Unit: Food and drink')).toBeTruthy()
    const line = screen.getByText('From a level you skipped: these words may be new to you.')
    expect(line.previousElementSibling?.textContent).toBe('Unit: Food and drink')
    expect(screen.queryByText('Nothing to practise yet. Study a few new words first.')).toBeNull()
    expect(screen.getByRole('link', { name: 'Practise this unit' }).getAttribute('href')).toBe(`/practice/words?unit=${second.unitId}`)
    expect(screen.getByRole('link', { name: 'Matching' }).getAttribute('href')).toBe(`/practice/matching?unit=${second.unitId}`)
    cleanup()
    // Practice over everything still has nothing, and says nothing of skipped levels.
    renderWith(<Practice />, ctx)
    expect(screen.getByText('Nothing to practise yet. Study a few new words first.')).toBeTruthy()
    expect(screen.queryByText('From a level you skipped: these words may be new to you.')).toBeNull()
  })

  it('does not speak of a skipped level on a unit of the learner’s own level, or on a theme', async () => {
    const ctx = await setup()
    await answerNew(ctx.client, ctx.env, 5)
    renderWith(<Practice unit={ctx.client.snapshot.corpus!.units[0]!.unitId} />, ctx)
    expect(screen.queryByText('From a level you skipped: these words may be new to you.')).toBeNull()
    cleanup()
    await ctx.client.updateSettings({ declaredLevel: 'A2' })
    renderWith(<Practice theme="daily-life" />, ctx)
    expect(screen.getByText(/^Theme:/)).toBeTruthy()
    expect(screen.queryByText('From a level you skipped: these words may be new to you.')).toBeNull()
  })

  it('practises one theme: names it, carries it in every way to practise, and leads back to the themes', async () => {
    const ctx = await setup()
    await ctx.client.updateSettings({ activeTheme: 'daily-life' })
    await answerNew(ctx.client, ctx.env, 5)
    await ctx.client.updateSettings({ activeTheme: null })
    renderWith(<Practice theme="daily-life" />, ctx)
    expect(screen.getByText('Theme: Daily life')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Practise this theme' }).getAttribute('href')).toBe('/practice/words?theme=daily-life')
    expect(screen.getByRole('link', { name: 'Flashcards' }).getAttribute('href')).toBe('/practice/words?theme=daily-life&mode=flashcard')
    expect(screen.getByRole('link', { name: 'Matching' }).getAttribute('href')).toBe('/practice/matching?theme=daily-life')
    expect(screen.getByRole('link', { name: 'Back to themes' }).getAttribute('href')).toBe('/themes')
    expect(ctx.client.snapshot.settings.activeTheme).toBeNull()
    cleanup()
    renderWith(<Practice theme="daily-life" />, { ...ctx, locale: 'bg' })
    expect(screen.getByText('Тема: Всекидневие')).toBeTruthy()
  })

  it('falls back to practice over everything for an unknown theme, and lets a unit win over a theme', async () => {
    const ctx = await setup()
    await answerNew(ctx.client, ctx.env, 5)
    renderWith(<Practice theme="nowhere" />, ctx)
    expect(screen.queryByText(/^Theme:/)).toBeNull()
    expect(screen.getByRole('link', { name: 'Matching' }).getAttribute('href')).toBe('/practice/matching')
    cleanup()
    const first = ctx.client.snapshot.corpus!.units[0]!
    renderWith(<Practice unit={first.unitId} theme="daily-life" />, ctx)
    expect(screen.getByText('Unit: People and greetings')).toBeTruthy()
    expect(screen.queryByText(/^Theme:/)).toBeNull()
    expect(screen.getByRole('link', { name: 'Matching' }).getAttribute('href')).toBe(`/practice/matching?unit=${first.unitId}`)
  })

  it('practises a theme with no started word, and says it covers the whole theme (spec §7.4)', async () => {
    const ctx = await setup()
    await answerNew(ctx.client, ctx.env, 5)
    const theme = new Set(themeEntries(ctx.client.snapshot.corpus!, 'daily-life').map((e) => corpusWordId(e.entryId)))
    expect([...ctx.client.snapshot.states.keys()].some((wordId) => theme.has(wordId))).toBe(false)
    renderWith(<Practice theme="daily-life" />, ctx)
    const line = screen.getByText('This covers the whole theme, including words you have not started.')
    expect(line.previousElementSibling?.textContent).toBe('Theme: Daily life')
    expect(screen.queryByText('Nothing to practise yet. Study a few new words first.')).toBeNull()
    expect(screen.getByRole('link', { name: 'Practise this theme' }).getAttribute('href')).toBe('/practice/words?theme=daily-life')
    expect(screen.getByRole('link', { name: 'Matching' }).getAttribute('href')).toBe('/practice/matching?theme=daily-life')
    cleanup()
    renderWith(<Practice theme="daily-life" />, { ...ctx, locale: 'bg' })
    expect(screen.getByText('Обхваща цялата тема, включително думи, които още не сте започнали.')).toBeTruthy()
  })

  it('says nothing of unstarted words once every word of the theme that can be practised is started', async () => {
    const ctx = await setup()
    await ctx.client.updateSettings({ activeTheme: 'daily-life', newWordLimit: 30 })
    await answerNew(ctx.client, ctx.env, 24)
    await ctx.client.updateSettings({ activeTheme: null })
    renderWith(<Practice theme="daily-life" />, ctx)
    // One word of the twenty-five is still to be started.
    expect(screen.getByText('This covers the whole theme, including words you have not started.')).toBeTruthy()
    cleanup()
    const last = themeEntries(ctx.client.snapshot.corpus!, 'daily-life').map((e) => corpusWordId(e.entryId)).find((wordId) => !ctx.client.snapshot.states.has(wordId))!
    await ctx.client.setFlag(last, 'suspended')
    renderWith(<Practice theme="daily-life" />, ctx)
    expect(screen.getByText('Theme: Daily life')).toBeTruthy()
    expect(screen.queryByText('This covers the whole theme, including words you have not started.')).toBeNull()
    expect(screen.getByRole('link', { name: 'Practise this theme' })).toBeTruthy()
  })

  it('says there is nothing to practise in a theme whose words are all set aside', async () => {
    const ctx = await setup()
    await answerNew(ctx.client, ctx.env, 5)
    for (const e of themeEntries(ctx.client.snapshot.corpus!, 'daily-life')) await ctx.client.setFlag(corpusWordId(e.entryId), 'known')
    renderWith(<Practice theme="daily-life" />, ctx)
    expect(screen.getByText('Theme: Daily life')).toBeTruthy()
    expect(screen.getByText('Nothing to practise yet. Study a few new words first.')).toBeTruthy()
    expect(screen.queryByText('This covers the whole theme, including words you have not started.')).toBeNull()
    expect(screen.queryByText(/words seen$/)).toBeNull()
    expect(screen.getByRole('link', { name: 'Back to themes' })).toBeTruthy()
  })

  it('counts only words practice can use: with every started word set aside there is nothing to practise', async () => {
    const ctx = await setup()
    await answerNew(ctx.client, ctx.env, 2)
    for (const wordId of ctx.client.snapshot.states.keys()) await ctx.client.setFlag(wordId, 'known')
    renderWith(<Practice />, ctx)
    expect(screen.getByText('Nothing to practise yet. Study a few new words first.')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Matching' })).toBeNull()
  })

  describe('how far the visit has gone through a unit or theme (spec §7.4)', () => {
    /** One flashcard round of the scope, answered to the end. */
    async function round(client: Client, env: TestEnv, scope: PracticeScope): Promise<void> {
      const run = await StudyRun.start(client, env, { kind: 'practice', mode: 'flashcard', scope, cachedClips: () => new Set(), online: () => false })
      for (let guard = 0; guard < 20 && run.snapshot.item; guard += 1) {
        env.advance(ITEM_SETTLE_MS)
        run.reveal()
        env.advance(ITEM_SETTLE_MS)
        await run.rate(Grade.Good)
      }
    }

    it('counts the words seen since the app was opened, round after round, and starts over when all are seen', async () => {
      const ctx = await setup()
      const scope = { kind: 'theme', id: 'daily-life' } as const
      for (const seen of [0, 10, 20, 25, 10]) {
        renderWith(<Practice theme="daily-life" />, ctx)
        const line = screen.getByText(`${seen} of 25 words seen`)
        // Quiet, between the mixed run and the ways to practise one kind.
        expect(line.className).toBe('note practice-visit')
        expect(line.nextElementSibling?.textContent).toBe('Practise one way')
        cleanup()
        await round(ctx.client, ctx.env, scope)
      }
    })

    it('counts a matching board’s words too, and each unit and theme by itself', async () => {
      const ctx = await setup()
      await ctx.client.updateSettings({ declaredLevel: 'A2' })
      const unit = ctx.client.snapshot.corpus!.units[0]!
      MatchingRun.start(ctx.client, ctx.env, { kind: 'theme', id: 'daily-life' })
      await round(ctx.client, ctx.env, { kind: 'unit', id: unit.unitId })
      renderWith(<Practice theme="daily-life" />, ctx)
      expect(screen.getByText('5 of 25 words seen')).toBeTruthy()
      cleanup()
      renderWith(<Practice unit={unit.unitId} />, ctx)
      expect(screen.getByText(`10 of ${unit.wordIds.length} words seen`)).toBeTruthy()
      cleanup()
      renderWith(<Practice unit={unit.unitId} />, { ...ctx, locale: 'bg' })
      expect(screen.getByText(`Видени 10 от ${unit.wordIds.length} думи`)).toBeTruthy()
    })

    it('says nothing of it for practice over everything', async () => {
      const ctx = await setup()
      await answerNew(ctx.client, ctx.env, 5)
      renderWith(<Practice />, ctx)
      expect(screen.getByRole('link', { name: 'Practise words you know' })).toBeTruthy()
      expect(screen.queryByText(/words seen$/)).toBeNull()
    })
  })
})
