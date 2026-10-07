import { useClientSnapshot, type RunKind, type RunSnapshot, type StudyRun } from '@wordado/client-data'
import { entryClips, Grade, isAboveLevel, type ChoiceItem, type CorpusEntry } from '@wordado/core'
import { Check, Clock, Ellipsis, Flag, Flame, LockOpen, Play, Volume2, X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useApp } from '../app/context'
import { usePopover } from '../app/usePopover'
import { ClipSuperseded } from '../content/audio'
import { localized, useT } from '../i18n/i18n'
import { GRADE_LABEL } from '../labels'
import { Link } from '../router'
import type { PracticeScopeView } from '../screens/practiceScope'
import { useStore } from '../useStore'
import { Headword, Translation } from './Headword'
import { keyAction } from './keys'
import { ReportDialog } from './ReportDialog'

const GRADES: readonly Grade[] = [Grade.Again, Grade.Hard, Grade.Good, Grade.Easy]

/** Renders a StudyRun and forwards the learner's input to it (spec §8.1, §11.1). */
export function RunView(props: { readonly run: StudyRun; readonly kind: RunKind; /** The unit or theme a practice run keeps to, if any. */ readonly scope?: PracticeScopeView | null }) {
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

  if (snapshot.phase === 'done') return <Done snapshot={snapshot} kind={props.kind} scope={props.scope ?? null} />
  if (!item) return null

  const total = snapshot.answered + snapshot.remaining
  const settingAside = snapshot.phase === 'prompt' || snapshot.phase === 'revealed'
  /** The card: the prompt's frame, with its ⋯ menu; each mode fills it and adds its actions below. */
  const frame = (children: ReactNode) => (
    <div className="card" ref={card} tabIndex={-1} data-mode={item.mode} data-phase={snapshot.phase}>
      <MoreMenu
        onKnown={settingAside ? () => void run.setAside('known') : null}
        onNotNow={settingAside ? () => void run.setAside('suspended') : null}
        onReport={() => setReporting(true)}
      />
      {isAboveLevel(item.entry.level, settings.declaredLevel) && <p className="note above-level">{t('study.aboveLevel', { level: item.entry.level })}</p>}
      {children}
      {snapshot.error !== null && <p role="alert">{t('study.error', { message: snapshot.error })}</p>}
    </div>
  )

  return (
    <section className="study" aria-label={t('app.name')}>
      <div className="study-bar">
        <button type="button" className="study-close" aria-label={t('study.finish')} onClick={() => run.finish()}>
          <X aria-hidden="true" size={20} strokeWidth={2} />
        </button>
        <div
          className="study-progress"
          role="progressbar"
          aria-label={t('study.progressLabel')}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={snapshot.answered}
          aria-valuetext={t('study.progress', { answered: snapshot.answered, remaining: snapshot.remaining })}
        >
          <span style={{ width: `${total === 0 ? 0 : (100 * snapshot.answered) / total}%` }} />
        </div>
        <p className="study-count" aria-hidden="true">
          {snapshot.answered} / {total}
        </p>
      </div>
      {item.mode === 'flashcard' ? <Flashcard run={run} snapshot={snapshot} entry={item.entry} frame={frame} /> : <Choice run={run} snapshot={snapshot} item={item} frame={frame} />}
      <p className="note keys-hint">{t('study.keysHint')}</p>
      {reporting && <ReportDialog wordId={item.wordId} entry={item.entry} onClose={() => setReporting(false)} />}
    </section>
  )
}

/** Setting the word aside and reporting it: rarer than answering, so behind the card's ⋯ button. */
function MoreMenu(props: { readonly onKnown: (() => void) | null; readonly onNotNow: (() => void) | null; readonly onReport: () => void }) {
  const { t } = useT()
  const { open, close, root, trigger, onKeyDown, triggerProps, panelId } = usePopover()
  const choose = (action: () => void) => () => {
    close()
    action()
  }
  return (
    <div className="card-more" ref={root} onKeyDown={onKeyDown}>
      <button ref={trigger} type="button" className="card-more-button" aria-label={t('study.more')} {...triggerProps}>
        <Ellipsis aria-hidden="true" size={22} />
      </button>
      {open && (
        <ul className="popover-panel menu-panel" id={panelId}>
          {props.onKnown && (
            <li>
              <button type="button" onClick={choose(props.onKnown)}>
                <Check aria-hidden="true" size={18} className="menu-icon-known" />
                {t('study.known')}
              </button>
            </li>
          )}
          {props.onNotNow && (
            <li>
              <button type="button" onClick={choose(props.onNotNow)}>
                <Clock aria-hidden="true" size={18} />
                {t('study.notNow')}
              </button>
            </li>
          )}
          <li className="menu-separated">
            <button type="button" onClick={choose(props.onReport)}>
              <Flag aria-hidden="true" size={18} />
              {t('report.open')}
            </button>
          </li>
        </ul>
      )}
    </div>
  )
}

/** Plays the word on a flashcard, offered only when its clip can play now (spec §11.1). */
function PlayWord(props: { readonly entry: CorpusEntry }) {
  const { t } = useT()
  const { audio } = useApp()
  const { corpus, settings } = useClientSnapshot()
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [props.entry])
  const clip = corpus ? entryClips(corpus, props.entry)[0] : undefined
  if (!settings.audio || !clip || !(audio.streamable() || audio.cachedClips().has(clip.clipId))) return null
  const play = () => {
    setFailed(false)
    audio.play(clip).catch((err: unknown) => {
      if (!(err instanceof ClipSuperseded)) setFailed(true)
    })
  }
  return (
    <>
      <button type="button" className="play-word" aria-label={t('study.play')} onClick={play}>
        <Volume2 aria-hidden="true" size={24} strokeWidth={2} />
      </button>
      {failed && <p className="note">{t('study.audioFailed')}</p>}
    </>
  )
}

function Flashcard(props: { readonly run: StudyRun; readonly snapshot: RunSnapshot; readonly entry: CorpusEntry; readonly frame: (children: ReactNode) => ReactNode }) {
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
      {props.frame(
        <>
          <Headword entry={entry} />
          <PlayWord entry={entry} />
          {snapshot.phase !== 'prompt' && (
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
          )}
        </>,
      )}
      <div className="study-actions">
        {snapshot.phase === 'prompt' ? (
          <button type="button" className="button primary study-main" onClick={() => run.reveal()}>
            {t('study.reveal')}
          </button>
        ) : (
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
        )}
      </div>
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

function Choice(props: { readonly run: StudyRun; readonly snapshot: RunSnapshot; readonly item: ChoiceItem; readonly frame: (children: ReactNode) => ReactNode }) {
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
      {props.frame(
        listening ? (
          <>
            <button type="button" className="button play" onClick={replay}>
              <Play aria-hidden="true" size={20} />
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
        ),
      )}

      <div className="study-actions">
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
                  <span className="option-text">{showsTranslations ? <Translation entry={option} lang={l1} /> : <span lang="en">{option.headword}</span>}</span>
                  {isAnswer && <span aria-hidden="true"> ✓</span>}
                  {isWrong && <span aria-hidden="true"> ✗</span>}
                </button>
              </li>
            )
          })}
        </ol>

        <div className={`feedback-sheet${feedback ? (feedback.correct ? ' is-correct' : ' is-incorrect') : ''}`}>
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
            <button type="button" ref={continueButton} className="button study-main study-continue" onClick={() => run.next()}>
              {t('study.continue')}
            </button>
          )}
        </div>
      </div>
    </>
  )
}

function Done(props: { readonly snapshot: RunSnapshot; readonly kind: RunKind; readonly scope: PracticeScopeView | null }) {
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
    // No corpus yet: packL1 can't match any locale, so `localized` falls back to English.
    return unit ? localized(unit.title, locale, corpus?.l1 ?? '') : unitId
  }
  return (
    <section className="done" aria-labelledby="done-title">
      <div className="panel done-card">
        <span className="done-badge" aria-hidden="true">
          <Check size={42} strokeWidth={2.25} />
        </span>
        <h1 id="done-title" ref={heading} tabIndex={-1}>
          {t(props.kind === 'practice' ? 'done.practice' : 'done.session')}
        </h1>
        <p>{snapshot.answered === 0 ? t('done.nothing') : t('done.answered', { count: snapshot.answered })}</p>
      </div>
      {snapshot.dayCompleted && (
        <p className="done-line">
          <span className="done-icon done-icon-streak" aria-hidden="true">
            <Flame size={22} strokeWidth={1.75} />
          </span>
          {t('done.dayComplete')}
        </p>
      )}
      {snapshot.unlocked.map((unitId) => (
        <p key={unitId} className="done-line">
          <span className="done-icon done-icon-unit" aria-hidden="true">
            <LockOpen size={22} strokeWidth={1.75} />
          </span>
          {t('done.unlocked', { title: unitTitle(unitId) })}
        </p>
      ))}
      {snapshot.setAside > 0 && <p className="done-line done-note">{t('done.setAside', { count: snapshot.setAside })}</p>}
      <div className="done-actions">
        {/* A unit's or a theme's practice began on the path or the themes, so that is the way back; its "Practise more" stays in the scope. */}
        {props.scope ? (
          <Link className="button primary study-main" to={props.scope.back}>
            {t(props.scope.backLabel)}
          </Link>
        ) : (
          <Link className="button primary study-main" to={{ name: 'home' }}>
            {t('done.home')}
          </Link>
        )}
        <Link className="button study-main" to={{ name: 'practice', ...props.scope?.params }}>
          {t('done.practiceMore')}
        </Link>
      </div>
    </section>
  )
}
