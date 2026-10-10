import { useClient, useClientSnapshot } from '@wordado/client-data'
import { corpusWordId, levelIndex, MIN_THEME_SIZE, searchEntries, themeEntries, type CefrLevel, type CorpusEntry } from '@wordado/core'
import { ChevronDown, ChevronLeft, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { localized, useT } from '../i18n/i18n'
import { Link } from '../router'
import { WordRow } from '../study/WordRow'
import { ThemeIcon } from '../themes/icons'
import { scopeWords } from './practiceScope'
import { Themes } from './Themes'

/**
 * One theme's words (spec §8.9): what choosing the theme brings forward, shown before or after choosing it. The
 * words stand by level, in path order; the levels up to the learner's own are open, the higher ones folded, and a
 * folded level mounts no rows. A search keeps the matching words in one list. Any word not yet started can be
 * marked "Learn this word" here, whatever its level: choosing the theme would bring it forward all the same.
 *
 * An address that names no offered theme shows the themes, as a practice address falls back to practice.
 */
export function ThemeWords(props: { readonly themeId: string; /** What the word search starts with: a Themes search carried over. */ readonly query: string }) {
  const { t, locale } = useT()
  const client = useClient()
  const { corpus, settings, states, flags } = useClientSnapshot()
  const [query, setQuery] = useState(props.query)
  // What the last choice or search did, for a screen reader.
  const [announcement, setAnnouncement] = useState('')
  // Levels the learner opened or folded, over the default.
  const [levelChoice, setLevelChoice] = useState<ReadonlyMap<CefrLevel, boolean>>(new Map())
  const title = useRef<HTMLHeadingElement>(null)
  // Choosing the theme replaces the button that did it: the title takes the focus the button had.
  const chosen = useRef(false)
  const active = settings.activeTheme === props.themeId
  useEffect(() => {
    if (!chosen.current) return
    chosen.current = false
    title.current?.focus()
  }, [active])
  const theme = corpus?.themes.find((candidate) => candidate.themeId === props.themeId)
  const entries = useMemo(() => (corpus && theme ? themeEntries(corpus, theme.themeId) : []), [corpus, theme])
  if (!corpus) return null
  if (!theme || entries.length < MIN_THEME_SIZE) return <Themes />

  const name = localized(theme.name, locale, corpus.l1)
  const isStarted = (e: CorpusEntry) => states.has(corpusWordId(e.entryId))
  const started = entries.filter(isStarted).length
  const startedText = t('themes.started', { started, count: entries.length })
  const aboveLevel = entries.some((e) => levelIndex(e.level) > levelIndex(settings.declaredLevel))
  const canPractise = scopeWords({ corpus, settings, states, flags }, { kind: 'theme', id: theme.themeId }).words > 0
  const choose = (on: boolean) => {
    chosen.current = true
    void client.updateSettings({ activeTheme: on ? theme.themeId : null }).then(() => setAnnouncement(on ? t('themes.nowStudying', { name }) : t('themes.noneChosen')))
  }

  const found = searchEntries(entries, query)
  const foundText = (list: readonly CorpusEntry[], typed: string) => (list.length === 0 ? t('theme.findNone', { query: typed.trim() }) : t('theme.findFound', { count: list.length }))
  const search = (next: string) => {
    setQuery(next)
    const list = searchEntries(entries, next)
    setAnnouncement(list ? foundText(list, next) : '')
  }

  // The theme's levels in order, each with its words; the entries already stand by level, then by the path.
  const levels = [...new Set(entries.map((e) => e.level))].map((level) => ({ level, words: entries.filter((e) => e.level === level) }))
  const reached = levels.filter(({ level }) => levelIndex(level) <= levelIndex(settings.declaredLevel))
  // A theme that starts above the learner's level opens at its first level, so the page is never all folded.
  const openAtFirst = new Set((reached.length > 0 ? reached : levels.slice(0, 1)).map(({ level }) => level))
  const rows = (words: readonly CorpusEntry[]) => words.map((entry) => <WordRow key={entry.entryId} entry={entry} lang={corpus.l1} learn />)

  return (
    <section className="theme-page" aria-labelledby="theme-title">
      <Link className="back-link" to={{ name: 'themes' }}>
        <ChevronLeft aria-hidden="true" size={18} />
        {t('practice.toThemes')}
      </Link>
      <div className={`panel theme-top${active ? ' is-active' : ''}`}>
        <span className="theme-icon" aria-hidden="true">
          <ThemeIcon themeId={theme.themeId} size={24} />
        </span>
        <div className="theme-text">
          {active && (
            <p className="theme-active">
              <span aria-hidden="true">✓ </span>
              {t('themes.active')}
            </p>
          )}
          <h1 id="theme-title" ref={title} tabIndex={-1}>
            {name}
          </h1>
          <p className="note">{localized(theme.description, locale, corpus.l1)}</p>
          {aboveLevel && <p className="note">{t('themes.aboveLevel')}</p>}
        </div>
        <div className="theme-progress">
          <div className="bar" role="progressbar" aria-label={`${name}: ${startedText}`} aria-valuemin={0} aria-valuemax={entries.length} aria-valuenow={started}>
            <span style={{ width: `${(100 * started) / entries.length}%` }} />
          </div>
          <p className="note">{startedText}</p>
        </div>
        <div className="theme-actions">
          {active ? (
            <button type="button" className="button theme-clear" onClick={() => choose(false)}>
              {t('themes.clear')}
            </button>
          ) : (
            <button type="button" className="button theme-next" onClick={() => choose(true)}>
              {t('themes.next')}
            </button>
          )}
          {canPractise && (
            <Link className="button theme-practise is-quiet" to={{ name: 'practice', theme: theme.themeId }}>
              {t('themes.practise')}
            </Link>
          )}
        </div>
      </div>
      <p className="visually-hidden" role="status">
        {announcement}
      </p>
      <form role="search" className="themes-search theme-find" onSubmit={(e) => e.preventDefault()}>
        <label className="visually-hidden" htmlFor="theme-find">
          {t('theme.find')}
        </label>
        <Search aria-hidden="true" size={18} />
        <input
          id="theme-find"
          type="search"
          value={query}
          placeholder={t('theme.find')}
          autoComplete="off"
          onChange={(e) => search(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Escape' || query === '') return
            e.preventDefault()
            search('')
          }}
        />
      </form>
      {found ? (
        <section className="theme-found" aria-labelledby="theme-found">
          <h2 id="theme-found">{foundText(found, query)}</h2>
          {found.length === 0 ? (
            <button type="button" className="button" onClick={() => search('')}>
              {t('theme.findClear')}
            </button>
          ) : (
            <ul className="panel unit-words theme-words">{rows(found)}</ul>
          )}
        </section>
      ) : (
        levels.map(({ level, words }) => {
          const isOpen = levelChoice.get(level) ?? openAtFirst.has(level)
          return (
            <section key={level} className={`panel level-card${isOpen ? ' is-open' : ''}`} aria-labelledby={`theme-level-${level}`}>
              <h2 id={`theme-level-${level}`} className="level-heading">
                <button
                  type="button"
                  className="level-toggle"
                  aria-expanded={isOpen}
                  aria-controls={`theme-words-${level}`}
                  onClick={() => setLevelChoice((prev) => new Map(prev).set(level, !isOpen))}
                >
                  <span className="level-code">{level}</span>
                  <span className="level-summary">
                    <span className="note">{t('themes.started', { started: words.filter(isStarted).length, count: words.length })}</span>
                  </span>
                  <ChevronDown aria-hidden="true" size={20} className="level-chevron" />
                </button>
              </h2>
              {isOpen && (
                <ul id={`theme-words-${level}`} className="unit-words theme-words">
                  {rows(words)}
                </ul>
              )}
            </section>
          )
        })
      )}
    </section>
  )
}
