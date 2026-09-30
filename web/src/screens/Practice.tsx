import { useClientSnapshot } from '@wordado/client-data'
import { ChevronRight, Layers, ListChecks, Repeat, Shuffle, type LucideIcon } from 'lucide-react'
import { useId } from 'react'
import { useT, type MessageKey } from '../i18n/i18n'
import { MODE_LABEL } from '../labels'
import { Link, type Route } from '../router'

/** The ways to practise one kind at a time, each with a line on what it is. */
const ONE_WAY: readonly { readonly route: Route; readonly label: MessageKey; readonly hint: MessageKey; readonly icon: LucideIcon }[] = [
  { route: { name: 'practice-words', mode: 'flashcard' }, label: MODE_LABEL.flashcard, hint: 'practice.flashcardHint', icon: Layers },
  { route: { name: 'practice-words', mode: 'multiple_choice' }, label: MODE_LABEL.multiple_choice, hint: 'practice.choiceHint', icon: ListChecks },
  { route: { name: 'matching' }, label: MODE_LABEL.matching, hint: 'practice.matching', icon: Shuffle },
]

/** Extra practice (spec §7.4): outside the schedule, at reduced XP, never touching review state. */
export function Practice() {
  const { t } = useT()
  const { states } = useClientSnapshot()
  return (
    <section className="practice" aria-labelledby="practice-title">
      <div className="practice-head">
        <h1 id="practice-title">{t('practice.title')}</h1>
        <p className="lede">{t('practice.intro')}</p>
      </div>
      {states.size === 0 ? (
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
            <Link className="button primary study-main" to={{ name: 'practice-words', mode: null }}>
              {t('home.practice')}
            </Link>
          </div>
          <h2 className="practice-one-way">{t('practice.oneWay')}</h2>
          <ul className="practice-list">
            {ONE_WAY.map((way) => (
              <PracticeRow key={way.label} {...way} />
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

/** One way to practise: the whole row is the link, named by its title and described by its line. */
function PracticeRow(props: (typeof ONE_WAY)[number]) {
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
