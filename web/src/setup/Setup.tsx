import { useClient } from '@wordado/client-data'
import { offeredThemes, type CefrLevel, type Corpus } from '@wordado/core'
import { useState } from 'react'
import { Placement } from '../screens/Placement'
import { useT } from '../i18n/i18n'
import { GoalStep } from './GoalStep'
import { LanguageStep } from './LanguageStep'
import { LevelStep } from './LevelStep'
import { ThemeStep } from './ThemeStep'

type StepName = 'language' | 'level' | 'theme' | 'goal'

/** The steps that show for `corpus`: Level only when its units span more than one level, Theme only when one is offered. */
function stepsFor(corpus: Corpus | null): readonly StepName[] {
  const levels = new Set(corpus?.units.map((u) => u.level) ?? [])
  return [
    'language',
    ...(levels.size > 1 ? (['level'] as const) : []),
    ...(corpus !== null && offeredThemes(corpus).length > 0 ? (['theme'] as const) : []),
    'goal',
  ]
}

/**
 * The first-run setup (plan 11): Language → Level → Theme → Goal. The language comes first and is the one step that
 * cannot be skipped, since nothing can be studied without its words; which of the others show is decided once those
 * words are installed (the corpus is null before), and the counter counts only those. Every later step has Skip and
 * Start studying, which calls `onFinish`. This owns the page's h1, above the one card the steps take turns on (in
 * Settings' look: `form-section` shares `settings-section`'s rules); each step's h2 takes focus as it appears.
 *
 * The level step offers the placement test, which takes the whole screen while it runs, as it does from Settings
 * (`onFocus` tells the shell); leaving it or taking its result comes back to the level step.
 */
export function Setup(props: { onFinish(): void; onFocus?(on: boolean): void }) {
  const { t } = useT()
  const client = useClient()
  /** Null until the language is installed: until then nobody knows which steps will show, so there is no counter. */
  const [steps, setSteps] = useState<readonly StepName[] | null>(null)
  const [index, setIndex] = useState(0)
  const step = steps?.[index] ?? 'language'
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
        {step === 'language' && (
          <LanguageStep
            mode="setup"
            onDone={() => {
              setSteps(stepsFor(client.snapshot.corpus))
              setIndex(1)
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
