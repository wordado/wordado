import { placementAvailable, useClient } from '@wordado/client-data'
import { isTarget, offeredThemes, type CefrLevel, type Corpus, type Target } from '@wordado/core'
import { useEffect, useState } from 'react'
import { OFFERED_TARGETS } from '../content/packs'
import { Placement } from '../screens/Placement'
import { languageInSentence, useT } from '../i18n/i18n'
import { CourseStep } from './CourseStep'
import { GoalStep } from './GoalStep'
import { LanguageStep } from './LanguageStep'
import { hasLevels } from './LevelAsk'
import { LevelStep } from './LevelStep'
import { ThemeStep } from './ThemeStep'

export type StepName = 'course' | 'language' | 'level' | 'theme' | 'goal'

/**
 * The steps before the words are known: the course first when the build offers more than one (spec §8.6), except in a
 * setup a course switch opened, whose course is already chosen; then the language.
 */
function leadSteps(offered: readonly Target[], newCourse: boolean): readonly StepName[] {
  return offered.length > 1 && !newCourse ? ['course', 'language'] : ['language']
}

/** The steps that show for `corpus`: the lead steps; Level only when its units span more than one level, Theme only when one is offered, and never in a trial, whose one theme is the open one (#290). */
function stepsFor(corpus: Corpus | null, offered: readonly Target[] = OFFERED_TARGETS, newCourse = false): readonly StepName[] {
  return [
    ...leadSteps(offered, newCourse),
    ...(hasLevels(corpus) ? (['level'] as const) : []),
    ...(corpus !== null && corpus.trial === null && offeredThemes(corpus).length > 0 ? (['theme'] as const) : []),
    'goal',
  ]
}

/** The step a setup reports (`onStep`) and resumes at (`resumeAt`): `new:` before it says a course switch opened it. */
function parseMark(mark: string | null | undefined): { readonly step: string | null; readonly newCourse: boolean } {
  if (mark == null) return { step: null, newCourse: false }
  return mark.startsWith('new:') ? { step: mark.slice(4), newCourse: true } : { step: mark, newCourse: false }
}

/**
 * The first-run setup (plan 11): Course → Language → Level → Theme → Goal. The course shows only when the build offers
 * more than one (spec §8.6), and not in a new course's setup (a switch in Settings, or a reload during it: another
 * course's words are installed), which starts at the language. The language is the one step that
 * cannot be skipped, since nothing can be studied without its words; which of the others show is decided once those
 * words are installed (the corpus is null before), and the counter counts only those. Every later step has Skip and
 * Start studying, which calls `onFinish`. This owns the page's h1, above the one card the steps take turns on (in
 * Settings' look: `form-section` shares `settings-section`'s rules); each step's h2 takes focus as it appears.
 *
 * The level step offers the placement test, which takes the whole screen while it runs, as it does from Settings
 * (`onFocus` tells the shell); leaving it or taking its result comes back to the level step. Reached by the test's
 * address (`startWithTest`, #213), the test opens by itself after the language, where it can run.
 *
 * Each step after the language is told to `onStep`, so that a reload can come back to it (`resumeAt`, #234): the words
 * being installed by then, the setup starts there instead of at the language.
 */
export function Setup(props: {
  onFinish(): void
  onFocus?(on: boolean): void
  /** Reached by the test's address (#213): the test starts once the language is installed, where it can run. */
  readonly startWithTest?: boolean
  /** The step a reload left the setup on (#234), as `onStep` gave it: with the words installed, the setup goes on there. */
  readonly resumeAt?: string | null
  /** The step shown, from the one after the language on; `new:` before it when a course switch opened the setup. */
  onStep?(mark: string): void
}) {
  const { t, locale } = useT()
  const client = useClient()
  const { onStep } = props
  const resume = parseMark(props.resumeAt)
  /**
   * Opened by a course switch: another course's words are installed (`previous`, the course to go back to), or the
   * mark a reload kept says so. Decided once, as the language step installs the new course's words.
   */
  const [{ newCourse, previous }] = useState(() => {
    const { corpus, settings } = client.snapshot
    const switched = corpus !== null && corpus.target !== settings.course
    return { newCourse: switched || resume.newCourse, previous: switched && isTarget(corpus.target) ? corpus.target : null }
  })
  const lead = leadSteps(OFFERED_TARGETS, newCourse)
  /** Null until the language is installed: until then nobody knows which steps will show, so there is no counter. */
  const [steps, setSteps] = useState<readonly StepName[] | null>(() =>
    resume.step !== null && client.snapshot.corpus !== null ? stepsFor(client.snapshot.corpus, OFFERED_TARGETS, newCourse) : null,
  )
  const [index, setIndex] = useState(() => (steps === null ? 0 : Math.max(lead.length, steps.indexOf(resume.step as StepName))))
  const step = (steps ?? lead)[index] ?? 'language'
  useEffect(() => {
    if (steps !== null) onStep?.(newCourse ? `new:${step}` : step)
  }, [steps, step, onStep, newCourse])
  /** The language step's way back: out to the course before (no new course installed), or to the course question. */
  const back =
    previous !== null
      ? {
          label: t('setup.language.backToCourse', { language: languageInSentence(previous, locale) }),
          go: async () => {
            await client.switchCourse(previous)
            props.onFinish()
          },
        }
      : lead[0] === 'course'
        ? { label: t('common.back'), go: () => setIndex(0) }
        : null
  const last = steps !== null && index === steps.length - 1
  const next = () => setIndex((i) => (steps === null ? i : Math.min(i + 1, steps.length - 1)))
  const stepProps = { last, next, finish: () => props.onFinish() }
  const [testing, setTesting] = useState(false)
  /** The level the test gave, once the learner took it. */
  const [placed, setPlaced] = useState<CefrLevel | null>(null)
  const test = (on: boolean) => {
    setTesting(on)
    props.onFocus?.(on)
  }

  if (testing) {
    return (
      <Placement
        setup={{
          leave: () => test(false),
          taken: () => {
            setPlaced(client.snapshot.settings.declaredLevel)
            test(false)
          },
        }}
      />
    )
  }

  return (
    <section className="setup" aria-labelledby="setup-title">
      <div className="setup-head">
        <h1 id="setup-title">{t('setup.title')}</h1>
        {steps !== null && <p className="eyebrow">{t('setup.step', { n: index + 1, count: steps.length })}</p>}
      </div>
      {/* One card in the Settings look, as a Settings section page is. */}
      <div className="panel form-section">
        {step === 'course' && <CourseStep onDone={() => setIndex(lead.indexOf('language'))} />}
        {step === 'language' && (
          <LanguageStep
            mode="setup"
            {...(back ? { back } : {})}
            onDone={() => {
              const shown = stepsFor(client.snapshot.corpus, OFFERED_TARGETS, newCourse)
              setSteps(shown)
              setIndex(shown.indexOf('language') + 1)
              // Leaving the test, or taking its result, comes back to the level step, which is the next one.
              if (props.startWithTest && shown.includes('level') && placementAvailable(client.snapshot.corpus)) test(true)
            }}
          />
        )}
        {step === 'level' && <LevelStep key="level" {...stepProps} placed={placed} onTest={() => test(true)} />}
        {step === 'theme' && <ThemeStep key="theme" {...stepProps} />}
        {step === 'goal' && <GoalStep key="goal" {...stepProps} />}
      </div>
    </section>
  )
}
