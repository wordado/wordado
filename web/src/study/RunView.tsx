import { useClientSnapshot, type RunKind, type RunSnapshot, type StudyRun } from '@wordado/client-data'
import { entryClips, Grade, isAboveLevel, type ChoiceItem, type CorpusEntry } from '@wordado/core'
import { useEffect, useId, useRef, useState } from 'react'
import { useApp } from '../app/context'
import { ClipSuperseded } from '../content/audio'
import { localized, useT } from '../i18n/i18n'
import { GRADE_LABEL } from '../labels'
import { Link } from '../router'
import { useStore } from '../useStore'
import { Headword, Translation } from './Headword'
import { keyAction } from './keys'
import { ReportDialog } from './ReportDialog'

const GRADES: readonly Grade[] = [Grade.Again, Grade.Hard, Grade.Good, Grade.Easy]

/** Renders a StudyRun and forwards the learner's input to it (spec §8.1, §11.1). */
export function RunView(props: { readonly run: StudyRun; readonly kind: RunKind }) {
  const { run } = props
  const { t } = useT()
  const snapshot = useStore(run.store)
  const { settings } = useClientSnapshot()
  const [reporting, setReporting] = useState(false)
  const card = useRef<HTMLDivElement>(null)

  // Keys work anywhere on the page, except in a form field or while the report dialog is open.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (reporting || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select')) return
      // A focused button already answers Enter and Space itself.
      if ((event.key === 'Enter' || event.key === ' ') && target?.closest('button, a')) return
      const s = run.snapshot
      const action = keyAction(event.key, s.phase, s.item)
      if (!action) return
      event.preventDefault()
      if (action.kind === 'choose') void run.choose(action.index)
      else if (action.kind === 'rate') void run.rate(action.grade)
      else if (action.kind === 'reveal') run.reveal()
      else run.next()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [run, reporting])

  // Each new prompt takes focus, so a screen reader reads it (spec §11.1).
  const item = snapshot.item
  useEffect(() => {
    if (item && snapshot.phase === 'prompt') card.current?.focus()
  }, [item, snapshot.phase])

  // The dialog moves focus onto itself while open; once it closes, focus returns to the card.
  const wasReporting = useRef(false)
  useEffect(() => {
    if (wasReporting.current && !reporting) card.current?.focus()
    wasReporting.current = reporting
  }, [reporting])

  // Time in the report dialog doesn't count as thinking time (spec §8.10).
  useEffect(() => {
    if (reporting) run.pause()
    else run.resume()
  }, [reporting, run])

  if (snapshot.phase === 'done') return <Done snapshot={snapshot} kind={props.kind} />
  if (!item) return null

  return (
    <section className="study" aria-label={t('app.name')}>
      <div className="study-bar">
        <p>{t('study.progress', { answered: snapshot.answered, remaining: snapshot.remaining })}</p>
        <button type="button" className="link-button" onClick={() => run.finish()}>
          {t('study.finish')}
        </button>
      </div>
      <div className="card" ref={card} tabIndex={-1} data-mode={item.mode} data-phase={snapshot.phase}>
        {isAboveLevel(item.entry.level, settings.declaredLevel) && (
          <p className="note above-level">{t('study.aboveLevel', { level: item.entry.level })}</p>
        )}
        {item.mode === 'flashcard' ? <Flashcard run={run} snapshot={snapshot} entry={item.entry} /> : <Choice run={run} snapshot={snapshot} item={item} />}
        {snapshot.error !== null && <p role="alert">{t('study.error', { message: snapshot.error })}</p>}
        <button type="button" className="link-button report-open" onClick={() => setReporting(true)}>
          {t('report.open')}
        </button>
      </div>
      <p className="note keys-hint">{t('study.keysHint')}</p>
      {reporting && <ReportDialog wordId={item.wordId} entry={item.entry} onClose={() => setReporting(false)} />}
    </section>
  )
}

function Flashcard(props: { readonly run: StudyRun; readonly snapshot: RunSnapshot; readonly entry: CorpusEntry }) {
  const { t } = useT()
  const { corpus } = useClientSnapshot()
  const { entry, snapshot, run } = props
  const answerId = useId()
  const rateLabelId = useId()
  const answer = useRef<HTMLDivElement>(null)
  // The "Show answer" button that had focus unmounts on reveal; the answer takes focus instead, so a screen reader reads it (spec §11.1).
  useEffect(() => {
    if (snapshot.phase === 'revealed') answer.current?.focus()
  }, [snapshot.phase, entry])
  return (
    <>
      <Headword entry={entry} />
      {snapshot.phase === 'prompt' ? (
        <button type="button" className="button primary" onClick={() => run.reveal()}>
          {t('study.reveal')}
        </button>
      ) : (
        <>
          <div className="revealed" role="region" ref={answer} tabIndex={-1} aria-labelledby={answerId}>
            <p className="prompt-text" id={answerId}>
              <Translation entry={entry} lang={corpus?.l1 ?? 'bg'} />
            </p>
            {entry.examples[0] !== undefined && (
              <p className="example" lang="en">
                {entry.examples[0]}
              </p>
            )}
          </div>
          <div className="ratings" role="group" aria-labelledby={rateLabelId}>
            <p id={rateLabelId}>{t('study.rateLabel')}</p>
            {GRADES.map((grade) => (
              <button key={grade} type="button" className={`rating rating-${grade}`} onClick={() => void run.rate(grade)}>
                <span className="option-key" aria-hidden="true">
                  {grade}
                </span>{' '}
                {t(GRADE_LABEL[grade])}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  )
}

function useListening(item: ChoiceItem, run: StudyRun): { replay: () => void; failed: boolean } {
  const { audio } = useApp()
  const { corpus } = useClientSnapshot()
  const [failed, setFailed] = useState(false)
  const clip = corpus ? entryClips(corpus, item.entry)[0] : undefined
  // Every play() claims a token; a result whose token has moved on is stale and ignored, whichever
  // setup or playback finishes last (a superseding "Play again", or the learner moving to the next
  // item while an old clip is still winding down) — mirrors AudioStore's own generation guard.
  const token = useRef(0)
  const play = () => {
    const mine = ++token.current
    if (!clip) {
      setFailed(true)
      run.presented()
      return
    }
    setFailed(false)
    audio.play(clip).then(
      () => {
        if (token.current !== mine) return
        run.presented()
      },
      (err: unknown) => {
        if (token.current !== mine) return
        if (err instanceof ClipSuperseded) return
        setFailed(true)
        run.presented()
      },
    )
  }
  useEffect(() => {
    // Once per item: `play` is rebuilt every render, and the item is what matters.
    if (item.mode === 'listening_select') play()
    return () => {
      // Moving to another item (or unmounting) invalidates any play still in flight for this one.
      token.current += 1
    }
  }, [item])
  return { replay: play, failed }
}

function Choice(props: { readonly run: StudyRun; readonly snapshot: RunSnapshot; readonly item: ChoiceItem }) {
  const { t } = useT()
  const { corpus } = useClientSnapshot()
  const { run, snapshot, item } = props
  const l1 = corpus?.l1 ?? 'bg'
  const listening = item.mode === 'listening_select'
  const { replay, failed } = useListening(item, run)
  const feedback = snapshot.phase === 'feedback' ? snapshot.feedback : null
  const continueButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (feedback) continueButton.current?.focus()
  }, [feedback])
  const showsTranslations = !listening && item.direction === 'en_to_l1'
  const answerText = showsTranslations ? item.entry.translations[0] : item.entry.headword

  return (
    <>
      {listening ? (
        <>
          <button type="button" className="button play" onClick={replay}>
            <span aria-hidden="true">▶ </span>
            {t('study.playAgain')}
          </button>
          <p className="instruction">{t('study.listenPrompt')}</p>
          {failed && <p className="note">{t('study.audioFailed')}</p>}
        </>
      ) : item.direction === 'en_to_l1' ? (
        <>
          <Headword entry={item.entry} />
          <p className="instruction">{t('study.chooseTranslation')}</p>
        </>
      ) : (
        <>
          <p className="prompt-text">
            <Translation entry={item.entry} lang={l1} />
          </p>
          <p className="instruction">{t('study.chooseWord')}</p>
        </>
      )}

      <ol className="options">
        {item.options.map((option, index) => {
          const isAnswer = feedback !== null && index === item.answerIndex
          const isWrong = feedback !== null && !feedback.correct && index === feedback.chosen
          return (
            <li key={option.entryId}>
              <button
                type="button"
                className={`option${isAnswer ? ' is-answer' : ''}${isWrong ? ' is-wrong' : ''}`}
                disabled={feedback !== null}
                onClick={() => void run.choose(index)}
              >
                <span className="option-key" aria-hidden="true">
                  {index + 1}
                </span>{' '}
                {showsTranslations ? <Translation entry={option} lang={l1} /> : <span lang="en">{option.headword}</span>}
                {isAnswer && <span aria-hidden="true"> ✓</span>}
                {isWrong && <span aria-hidden="true"> ✗</span>}
              </button>
            </li>
          )
        })}
      </ol>

      <div className="feedback" role="status">
        {feedback && (
          <p className={feedback.correct ? 'correct' : 'incorrect'}>
            <span aria-hidden="true">{feedback.correct ? '✓' : '✗'}</span>{' '}
            {feedback.correct
              ? `${t('study.correct')}${feedback.grade === Grade.Hard ? `. ${t('study.slow')}` : ''}`
              : t('study.incorrect', { answer: answerText ?? '' })}
          </p>
        )}
      </div>
      {feedback && (
        <button type="button" ref={continueButton} className="button primary" onClick={() => run.next()}>
          {t('study.continue')}
        </button>
      )}
    </>
  )
}

function Done(props: { readonly snapshot: RunSnapshot; readonly kind: RunKind }) {
  const { t, locale } = useT()
  const { afterRun } = useApp()
  const { corpus } = useClientSnapshot()
  const { snapshot } = props
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    heading.current?.focus()
    afterRun()
  }, [afterRun])
  const unitTitle = (unitId: string) => {
    const unit = corpus?.units.find((u) => u.unitId === unitId)
    return unit ? localized(unit.title, locale) : unitId
  }
  return (
    <section className="done" aria-labelledby="done-title">
      <h1 id="done-title" ref={heading} tabIndex={-1}>
        {t(props.kind === 'practice' ? 'done.practice' : 'done.session')}
      </h1>
      <p>{snapshot.answered === 0 ? t('done.nothing') : t('done.answered', { count: snapshot.answered })}</p>
      {snapshot.dayCompleted && <p>{t('done.dayComplete')}</p>}
      {snapshot.unlocked.map((unitId) => (
        <p key={unitId}>{t('done.unlocked', { title: unitTitle(unitId) })}</p>
      ))}
      <div className="actions">
        <Link className="button primary" to={{ name: 'practice' }}>
          {t('done.practiceMore')}
        </Link>
        <Link className="button" to={{ name: 'home' }}>
          {t('done.home')}
        </Link>
      </div>
    </section>
  )
}
