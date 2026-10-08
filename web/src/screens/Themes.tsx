import { useClient, useClientSnapshot } from '@wordado/client-data'
import { corpusWordId, levelIndex, offeredThemes, themeEntries, type Theme } from '@wordado/core'
import { useEffect, useRef, useState } from 'react'
import { localized, useT, type MessageKey } from '../i18n/i18n'
import { Link } from '../router'
import { ThemeIcon } from '../themes/icons'
import { scopeWords } from './practiceScope'

/** Where a theme stands for the learner: the one chosen, one with a started word, or one not started. */
type ThemeGroup = 'now' | 'studied' | 'new'

const GROUP_TITLE: Readonly<Record<ThemeGroup, MessageKey>> = { now: 'themes.active', studied: 'themes.groupStudied', new: 'themes.groupNew' }

/**
 * Theme collections (spec §8.9): choosing one puts its words first; nothing else changes. The themes stand in three
 * groups — the one being studied, those with a started word, the rest — so the learner sees which is chosen, which
 * are under way, and that choosing another replaces the choice. The groups are about the plan; any theme can be
 * practised whole, whichever group it stands in.
 */
export function Themes() {
  const { t, locale } = useT()
  const client = useClient()
  const { corpus, settings, states } = useClientSnapshot()
  // What the last choice did, for a screen reader: the card it concerns has just moved to another group.
  const [announcement, setAnnouncement] = useState('')
  // The theme whose card moved and takes the focus its button had.
  const [moved, setMoved] = useState<string | null>(null)
  if (!corpus) return null
  const offered = offeredThemes(corpus)
  const active = settings.activeTheme
  const choose = (theme: Theme | null, movedId: string | null) =>
    void client.updateSettings({ activeTheme: theme?.themeId ?? null }).then(() => {
      setAnnouncement(theme ? t('themes.nowStudying', { name: localized(theme.name, locale, corpus.l1) }) : t('themes.noneChosen'))
      setMoved(movedId)
    })
  // The same count as each card's bar: every started word, set aside or not.
  const started = (theme: Theme) => themeEntries(corpus, theme.themeId).some((e) => states.has(corpusWordId(e.entryId)))
  const groupOf = (theme: Theme): ThemeGroup => (theme.themeId === active ? 'now' : started(theme) ? 'studied' : 'new')
  // Within a group the themes keep the pack's order.
  const inGroup = (group: ThemeGroup) => offered.filter((theme) => groupOf(theme) === group)

  const section = (group: ThemeGroup) => {
    const themes = inGroup(group)
    // The first group is always there, to say when no theme is chosen; the others only with themes in them.
    if (themes.length === 0 && group !== 'now') return null
    return (
      <section className={`theme-group theme-group-${group}`} aria-labelledby={`themes-${group}`}>
        <h2 id={`themes-${group}`}>{t(GROUP_TITLE[group])}</h2>
        {themes.length === 0 ? (
          <p className="note theme-none-chosen">{t('themes.noneChosen')}</p>
        ) : (
          <ul className="theme-grid">
            {themes.map((theme) => (
              <ThemeCard
                key={theme.themeId}
                theme={theme}
                group={group}
                focus={moved === theme.themeId}
                onFocused={() => setMoved(null)}
                onChoose={() => choose(theme, theme.themeId)}
                onClear={() => choose(null, theme.themeId)}
              />
            ))}
          </ul>
        )}
      </section>
    )
  }

  return (
    <section className="themes-page" aria-labelledby="themes-title">
      <div className="themes-head">
        <h1 id="themes-title">{t('themes.title')}</h1>
        <p className="lede">{t('themes.intro')}</p>
      </div>
      <p className="visually-hidden" role="status">
        {announcement}
      </p>
      {active !== null && !offered.some((theme) => theme.themeId === active) && (
        <button type="button" className="button" onClick={() => choose(null, null)}>
          {t('themes.clear')}
        </button>
      )}
      {offered.length === 0 ? (
        <p className="panel">{t('themes.none')}</p>
      ) : (
        <>
          {section('now')}
          {section('studied')}
          {section('new')}
        </>
      )}
    </section>
  )
}

function ThemeCard(props: {
  readonly theme: Theme
  readonly group: ThemeGroup
  /** The card has just moved here by the learner's choice: its title takes focus, once. */
  readonly focus: boolean
  onFocused(): void
  onChoose(): void
  onClear(): void
}) {
  const { t, locale } = useT()
  const { corpus, settings, states, flags } = useClientSnapshot()
  const { theme, group, focus, onFocused } = props
  const title = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (!focus) return
    title.current?.focus()
    onFocused()
  }, [focus, onFocused])
  const entries = themeEntries(corpus!, theme.themeId)
  const started = entries.filter((e) => states.has(corpusWordId(e.entryId))).length
  const aboveLevel = entries.some((e) => levelIndex(e.level) > levelIndex(settings.declaredLevel))
  const name = localized(theme.name, locale, corpus!.l1)
  // Practice draws on every word of the theme that is not set aside, started or not (spec §7.4); the bar counts the started ones.
  const canPractise = scopeWords({ corpus, settings, states, flags }, { kind: 'theme', id: theme.themeId }).words > 0
  const startedText = t('themes.started', { started, count: entries.length })
  const practise = canPractise && (
    <Link className={`button theme-practise${group === 'new' ? ' is-quiet' : ''}`} to={{ name: 'practice', theme: theme.themeId }} aria-label={t('themes.practiseNamed', { name })}>
      {t('themes.practise')}
    </Link>
  )
  return (
    <li className={`panel theme-card is-${group === 'now' ? 'active' : group}${group === 'new' && canPractise ? ' has-practise' : ''}`}>
      <span className="theme-icon" aria-hidden="true">
        <ThemeIcon themeId={theme.themeId} size={24} />
      </span>
      <div className="theme-text">
        {group === 'now' && (
          <p className="theme-active">
            <span aria-hidden="true">✓ </span>
            {t('themes.active')}
          </p>
        )}
        <h3 ref={title} tabIndex={-1}>
          {name}
        </h3>
        <p className="note">{localized(theme.description, locale, corpus!.l1)}</p>
        {aboveLevel && <p className="note">{t('themes.aboveLevel')}</p>}
      </div>
      <div className="theme-progress">
        <div
          className="bar"
          role="progressbar"
          aria-label={`${name}: ${startedText}`}
          aria-valuemin={0}
          aria-valuemax={entries.length}
          aria-valuenow={started}
        >
          <span style={{ width: `${entries.length > 0 ? (100 * started) / entries.length : 0}%` }} />
        </div>
        <p className="note">{startedText}</p>
      </div>
      {group === 'now' && (
        <div className="theme-actions">
          {practise}
          <button type="button" className="button theme-clear" onClick={props.onClear}>
            {t('themes.clear')}
          </button>
        </div>
      )}
      {group === 'studied' && (
        <div className="theme-actions">
          {practise}
          {/* The quieter of the two: practising is what a studied theme is mostly for. */}
          <button type="button" className="button theme-next is-quiet" aria-label={t('themes.nextNamed', { name })} onClick={props.onChoose}>
            {t('themes.next')}
          </button>
        </div>
      )}
      {group === 'new' && (
        <>
          {/* On a phone the button sits beside the title, under its short label. */}
          <button type="button" className="button theme-action theme-next" aria-label={t('themes.nextNamed', { name })} onClick={props.onChoose}>
            <span className="label-long">{t('themes.next')}</span>
            <span className="label-short">{t('themes.chooseShort')}</span>
          </button>
          {/* The quieter of the two here: a theme not started is mostly there to be chosen, and can be practised whole all the same. */}
          {practise}
        </>
      )}
    </li>
  )
}
