import { useClient } from '@wordado/client-data'
import type { CefrLevel, Corpus } from '@wordado/core'
import { useState } from 'react'
import { useT, type MessageKey } from '../i18n/i18n'
import { Placement } from '../screens/Placement'
import { LevelStep } from './LevelStep'

/** Whether `corpus` has a level to choose: its units span more than one, as for the setup's level step. */
export function hasLevels(corpus: Corpus | null): boolean {
  return new Set(corpus?.units.map((u) => u.level) ?? []).size > 1
}

/**
 * The setup's level step on its own, once, for a learner who came through the demo: the trial's level (if the visitor
 * chose one) is already selected, so the learner confirms it or takes the test again on the whole course; a demo on the
 * old one-level sample never asked at all, and the account's course starts at A1 unless somebody does. Shown in place
 * of Today the first time the whole course is there (`App`); Continue ends it, whatever was chosen. The placement test runs inside it,
 * over the whole screen (`onFocus`), as in the setup.
 */
export function LevelAsk(props: { onDone(): void; onFocus?(on: boolean): void; /** Why it is asked; an account's reason unless told otherwise. */ readonly lead?: MessageKey }) {
  const { t } = useT()
  const client = useClient()
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
    <section className="setup" aria-labelledby="level-ask-title">
      <div className="setup-head">
        <h1 id="level-ask-title">{t('levelAsk.title')}</h1>
        <p className="note">
          {t(props.lead ?? 'levelAsk.lead')} {t('settings.levelHint')}
        </p>
      </div>
      <div className="panel form-section">
        <LevelStep alone last next={props.onDone} finish={props.onDone} placed={placed} onTest={() => test(true)} />
      </div>
    </section>
  )
}
