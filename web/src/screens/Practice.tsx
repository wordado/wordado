import { useClientSnapshot } from '@wordado/client-data'
import { ChevronLeft, ChevronRight, Layers, ListChecks, Repeat, Shuffle, type LucideIcon } from 'lucide-react'
import { useId } from 'react'
import { localized, useT, type MessageKey } from '../i18n/i18n'
import { MODE_LABEL } from '../labels'
import { Link, type Route } from '../router'
import { practisableCount, usePracticeScope, type ScopeParams } from './practiceScope'

/** The ways to practise one kind at a time, each with a line on what it is. */
const ONE_WAY: readonly { route(scope: ScopeParams): Route; readonly label: MessageKey; readonly hint: MessageKey; readonly icon: LucideIcon }[] = [
  { route: (scope) => ({ name: 'practice-words', mode: 'flashcard', ...scope }), label: MODE_LABEL.flashcard, hint: 'practice.flashcardHint', icon: Layers },
  { route: (scope) => ({ name: 'practice-words', mode: 'multiple_choice', ...scope }), label: MODE_LABEL.multiple_choice, hint: 'practice.choiceHint', icon: ListChecks },
  { route: (scope) => ({ name: 'matching', ...scope }), label: MODE_LABEL.matching, hint: 'practice.matching', icon: Shuffle },
]

/**
 * Extra practice (spec §7.4): outside the schedule, at reduced XP, never touching review state. Over every started
 * word, or over one unit's or one theme's when the path or the themes sent the learner here (`unit`, `theme`); a
 * unit or theme that cannot be practised is ignored. A unit of a skipped level is practised whole, and says so.
 */
export function Practice(props: ScopeParams) {
  const { t, locale } = useT()
  const { states, flags, corpus } = useClientSnapshot()
  const scope = usePracticeScope(props)
  const params = scope?.params ?? {}
  // Words practice may use, in the scope or over everything: with none, no way to practise is offered.
  const none = (scope ? scope.words : practisableCount(states.keys(), { states, flags, retired: corpus?.retired ?? new Set() })) === 0
  return (
    <section className="practice" aria-labelledby="practice-title">
      {scope && (
        <Link className="back-link" to={scope.back}>
          <ChevronLeft aria-hidden="true" size={18} />
          {t(scope.backLabel)}
        </Link>
      )}
      <div className="practice-head">
        <h1 id="practice-title">{t('practice.title')}</h1>
        {scope && <p className="practice-scope">{t(scope.label, { title: localized(scope.title, locale, corpus?.l1 ?? '') })}</p>}
        {scope?.skipped && <p className="note practice-skipped">{t('practice.skippedLevel')}</p>}
        <p className="lede">{t('practice.intro')}</p>
      </div>
      {none ? (
        <p className="panel">{t('practice.noneYet')}</p>
      ) : (
        <>
          <div className="panel practice-mixed">
            <div className="practice-mixed-head">
              <span className="practice-icon is-rose" aria-hidden="true">
                <Repeat size={24} strokeWidth={1.75} />
              </span>
              <p>
                <span className="practice-row-title">{t('practice.mixed')}</span>
                <span className="note">{t('practice.mixedHint')}</span>
              </p>
            </div>
            <Link className="button primary study-main" to={{ name: 'practice-words', mode: null, ...params }}>
              {t(scope?.start ?? 'home.practice')}
            </Link>
          </div>
          <h2 className="practice-one-way">{t('practice.oneWay')}</h2>
          <ul className="practice-list">
            {ONE_WAY.map((way) => (
              <PracticeRow key={way.label} {...way} route={way.route(params)} />
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

/** One way to practise: the whole row is the link, named by its title and described by its line. */
function PracticeRow(props: { readonly route: Route; readonly label: MessageKey; readonly hint: MessageKey; readonly icon: LucideIcon }) {
  const { t } = useT()
  const hintId = useId()
  const Icon = props.icon
  return (
    <li className="practice-row">
      <span className="practice-icon" aria-hidden="true">
        <Icon size={22} strokeWidth={1.75} />
      </span>
      <span className="practice-row-text">
        <Link className="practice-row-link" to={props.route} aria-describedby={hintId}>
          {t(props.label)}
        </Link>
        <span className="note" id={hintId}>
          {t(props.hint)}
        </span>
      </span>
      <ChevronRight aria-hidden="true" size={18} className="practice-chevron" />
    </li>
  )
}
