import { useClientSnapshot } from '@wordado/client-data'
import { offeredThemes, pathUnits, searchWordIndex, studyUnits, type CorpusEntry } from '@wordado/core'
import { Lock, Search as SearchIcon, X } from 'lucide-react'
import { Fragment, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../app/context'
import { localized, useT } from '../i18n/i18n'
import { Link, navigate, onNavigation, parseRoute } from '../router'
import { courseIndex } from '../study/wordIndex'
import { WordRow } from '../study/WordRow'

/** How many results the list shows at first, and how many "Show more" adds. */
export const RESULTS_STEP = 30

/**
 * The search for the whole course (issue #144): any word, by its headword or a variant, a translation or its
 * sense note, best match first. Each result is the path's word row with a line saying where the word is: its
 * level, its unit (a link to the path, opened there) and its themes. The query lives in the address, so coming
 * back from a unit or a theme finds the same results. A trial finds the words of every level's unit, but only its
 * own unit is a place to go and to learn from (spec 2026-10-12 §4.4): another level's is named, no more.
 */
export function Search(props: { readonly q: string }) {
  const { t, locale } = useT()
  const { account } = useApp()
  const { corpus, path, settings } = useClientSnapshot()
  const [query, setQuery] = useState(props.q)
  const [shown, setShown] = useState(RESULTS_STEP)
  // Opened with nothing to search for, the field takes focus; opened on a query, the page does, as on any arrival.
  const [fresh] = useState(props.q === '')
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const added = useRef<number | null>(null)
  // What the screen itself last wrote to the address: any other change of it comes from outside.
  const written = useRef(props.q)
  // The address changed without typing (back or forward between two searches, the magnifier pressed again): the
  // field follows it, and takes focus when the search starts over.
  useEffect(() => {
    const outside = props.q !== written.current
    written.current = props.q
    setQuery(props.q)
    setShown(RESULTS_STEP)
    if (outside && props.q === '') input.current?.focus()
  }, [props.q])
  // The magnifier pressed on a search that is already empty changes nothing in the address: the field takes focus
  // all the same.
  useEffect(
    () =>
      onNavigation(() => {
        const route = parseRoute(window.location.pathname, window.location.search)
        if (route.name === 'search' && route.q === '') input.current?.focus()
      }),
    [],
  )
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
  // The units study keeps to: every unit of a course, a trial's one.
  const studied = useMemo(() => new Set(corpus ? studyUnits(corpus, settings.declaredLevel).map((unit) => unit.unitId) : []), [corpus, settings.declaredLevel])
  // Of those, the units the path screen lists, which a link can open: not one with no word the course teaches (#288).
  const listed = useMemo(() => new Set(corpus ? pathUnits(corpus, settings.declaredLevel).map((unit) => unit.unitId) : []), [corpus, settings.declaredLevel])
  if (!corpus || !index || !places) return null
  const onPath = (entry: CorpusEntry) => corpus.trial === null || studied.has(entry.unitId) || (corpus.trial.openTheme !== null && entry.themes.includes(corpus.trial.openTheme))

  const search = (next: string) => {
    setQuery(next)
    setShown(RESULTS_STEP)
    written.current = next
    navigate({ name: 'search', q: next }, { replace: true })
  }
  const typed = deferred.trim()
  const statusText = found === null ? (typed === '' ? '' : t('search.tooShort')) : found.length === 0 ? t('search.none', { query: typed }) : t('search.found', { count: found.length })

  const where = (entry: CorpusEntry) => {
    const unit = places.units.get(entry.unitId)
    const title = unit && localized(unit.title, locale, corpus.l1)
    const locked = unit !== undefined && path !== null && !path.unlocked.has(unit.unitId)
    const linked = unit !== undefined && listed.has(unit.unitId)
    const themes = entry.themes.flatMap((themeId) => {
      const theme = places.themes.get(themeId)
      return theme ? [{ themeId, name: localized(theme.name, locale, corpus.l1) }] : []
    })
    // The labels and the commas are for a screen reader, which would otherwise read the line as one run of words.
    return (
      <>
        <span className="word-level">
          <span className="visually-hidden">{t('search.whereLevel')} </span>
          {entry.level}
        </span>
        {unit && <span className="visually-hidden">{t('search.whereUnit')} </span>}
        {unit && !linked && <span>{title}</span>}
        {unit && linked && (
          <Link to={{ name: 'path', unit: unit.unitId }} {...(locked ? { className: 'is-locked', 'aria-label': t('search.unitLocked', { title: title! }) } : {})}>
            {locked && <Lock aria-hidden="true" size={14} />}
            {title}
          </Link>
        )}
        {themes.map(({ themeId, name }, i) => (
          <Fragment key={themeId}>
            <span className="visually-hidden">{i === 0 ? `${t('search.whereThemes')} ` : ', '}</span>
            {places.offered.has(themeId) ? <Link to={{ name: 'theme', themeId }}>{name}</Link> : <span>{name}</span>}
          </Fragment>
        ))}
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
      <p className="visually-hidden" role="status">
        {statusText}
      </p>
      {statusText !== '' && (
        <p className="search-status" aria-hidden="true">
          {statusText}
        </p>
      )}
      {typed === '' && <p className="note">{t('search.hint')}</p>}
      {found !== null && found.length === 0 && account === null && <p className="note">{t(corpus.trial === null ? 'search.sample' : 'search.trial', { count: index.words.length })}</p>}
      {found !== null && found.length > 0 && (
        <>
          <ul className="panel unit-words search-words" ref={list}>
            {found.slice(0, shown).map((entryId) => {
              const entry = corpus.entries.get(entryId)
              return entry ? <WordRow key={entryId} entry={entry} lang={corpus.l1} learn={onPath(entry)} where={where(entry)} /> : null
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
