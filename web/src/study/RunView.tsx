import { useClient, useClientSnapshot, type RunKind, type RunSnapshot, type StudyRun } from '@wordado/client-data'
import { entryClips, Grade, isAboveLevel, type ChoiceItem, type CorpusEntry, type StudyItem } from '@wordado/core'
import { BookPlus, Check, Clock, Ellipsis, Flag, Flame, LockOpen, Play, Volume2, X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useApp } from '../app/context'
import { usePopover } from '../app/usePopover'
import { ClipSuperseded } from '../content/audio'
import { errorMessageKey } from '../errors'
import { localized, useT } from '../i18n/i18n'
import { GRADE_LABEL } from '../labels'
import { Link } from '../router'
import type { PracticeScopeView } from '../screens/practiceScope'
import { useStore } from '../useStore'
import { AUTO_CONTINUE_MS, readAutoContinue } from './autoContinue'
import { Headword, Translation } from './Headword'
import { keyAction } from './keys'
import { ReportDialog } from './ReportDialog'

const GRADES: readonly Grade[] = [Grade.Again, Grade.Hard, Grade.Good, Grade.Easy]

/** Renders a StudyRun and forwards the learner's input to it (spec §8.1, §11.1). */
export function RunView(props: { readonly run: StudyRun; readonly kind: RunKind; /** The unit or theme a practice run keeps to, if any. */ readonly scope?: PracticeScopeView | null }) {
  const { run } = props
  const { t } = useT()
  const snapshot = useStore(run.store)
  const { settings, states, toLearn } = useClientSnapshot()
  const [reporting, setReporting] = useState(false)
  // The item whose ⋯ menu the learner opened: it does not move on by itself, or a report would be about the next word.
  const [held, setHeld] = useState<StudyItem | null>(null)
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
  // A practised word that was never started (a theme, or a unit of a skipped level, spec §7.4): the card says so.
  const newToLearner = props.kind === 'practice' && !states.has(item.wordId)
  const aboveLevel = isAboveLevel(item.entry.level, settings.declaredLevel)
  // "Learn this word": on such a word, once its answer is on screen.
  const canLearn = newToLearner && (snapshot.phase === 'feedback' || snapshot.phase === 'revealed')
  /** The card: the prompt's frame, with its ⋯ menu; each mode fills it and adds its actions below. */
  const frame = (children: ReactNode) => (
    <div className="card" ref={card} tabIndex={-1} data-mode={item.mode} data-phase={snapshot.phase}>
      <MoreMenu
        onOpen={() => setHeld(item)}
        onKnown={settingAside ? () => void run.setAside('known') : null}
        onNotNow={settingAside ? () => void run.setAside('suspended') : null}
        onReport={() => setReporting(true)}
      />
      {(newToLearner || aboveLevel) && (
        <div className="card-labels">
          {newToLearner && <p className="note new-to-you">{t('study.newToYou')}</p>}
          {aboveLevel && <p className="note above-level">{t('study.aboveLevel', { level: item.entry.level })}</p>}
        </div>
      )}
      {children}
      {canLearn && <LearnToggle headword={item.entry.headword} on={toLearn.includes(item.wordId)} onChange={(on) => void run.setLearn(on)} />}
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
      {item.mode === 'flashcard' ? <Flashcard run={run} snapshot={snapshot} entry={item.entry} frame={frame} /> : <Choice run={run} snapshot={snapshot} item={item} frame={frame} stays={held === item || canLearn} />}
      <p className="note keys-hint">{t('study.keysHint')}</p>
      {reporting && <ReportDialog wordId={item.wordId} entry={item.entry} onClose={() => setReporting(false)} />}
    </section>
  )
}

/**
 * "Learn this word" (spec §7.4): a button on the card, beside the word's other controls. Pressed, it reads "Will
 * be learned" and the daily session serves the word as a new one; pressing it again takes that back. The state is
 * said once, by the name, which changes with the visible text and begins with it (WCAG 2.5.3), then says which word.
 */
function LearnToggle(props: { readonly headword: string; readonly on: boolean; onChange(on: boolean): void }) {
  const { t } = useT()
  const label = t(props.on ? 'study.willLearn' : 'study.learn')
  return (
    <button
      type="button"
      className={`button learn-toggle${props.on ? ' is-on' : ''}`}
      aria-label={t('flag.action', { action: label, word: props.headword })}
      onClick={() => props.onChange(!props.on)}
    >
      {props.on ? <Check aria-hidden="true" size={18} /> : <BookPlus aria-hidden="true" size={18} />}
      {label}
    </button>
  )
}

/** Setting the word aside and reporting it: rarer than answering, so behind the card's ⋯ button. */
function MoreMenu(props: { readonly onOpen: () => void; readonly onKnown: (() => void) | null; readonly onNotNow: (() => void) | null; readonly onReport: () => void }) {
  const { t } = useT()
  const { open, close, root, trigger, onKeyDown, triggerProps, panelId } = usePopover()
  const choose = (action: () => void) => () => {
    close()
    action()
  }
  return (
    <div className="card-more" ref={root} onKeyDown={onKeyDown}>
      <button
        ref={trigger}
        type="button"
        className="card-more-button"
        aria-label={t('study.more')}
        {...triggerProps}
        onClick={() => {
          if (!open) props.onOpen()
          triggerProps.onClick()
        }}
      >
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

/**
 * Plays the word on a flashcard, or beside the headword of a multiple-choice question; offered only when its clip
 * can play now (spec §11.1). `inList`, it is one of many (the path's word list): smaller, and its name says which word.
 */
export function PlayWord(props: { readonly entry: CorpusEntry; readonly inList?: boolean }) {
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
      <button
        type="button"
        className={props.inList ? 'play-word in-list' : 'play-word'}
        aria-label={props.inList ? t('flag.action', { action: t('study.play'), word: props.entry.headword }) : t('study.play')}
        onClick={play}
      >
        <Volume2 aria-hidden="true" size={props.inList ? 20 : 24} strokeWidth={2} />
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

function Choice(props: {
  readonly run: StudyRun
  readonly snapshot: RunSnapshot
  readonly item: ChoiceItem
  readonly frame: (children: ReactNode) => ReactNode
  /** The feedback has something to act on (the ⋯ menu was opened, or "Learn this word" is offered): it waits for Continue. */
  readonly stays: boolean
}) {
  const { t } = useT()
  const { corpus } = useClientSnapshot()
  const { run, snapshot, item } = props
  const l1 = corpus?.l1 ?? 'bg'
  const listening = item.mode === 'listening_select'
  const { replay, failed } = useListening(item, run)
  const feedback = snapshot.phase === 'feedback' ? snapshot.feedback : null
  // This device's choice, as it was when the run reached its first question.
  const [autoContinue] = useState(() => readAutoContinue())
  // A right answer moves on by itself (spec §8.1); a wrong one waits, so the learner can read the answer.
  const movesOn = feedback !== null && feedback.correct && autoContinue && !props.stays
  useEffect(() => {
    if (!movesOn) return
    // `next` only leaves the feedback: the answer was recorded when it was chosen. Cleared when the learner moves on first.
    const timer = setTimeout(() => run.next(), AUTO_CONTINUE_MS)
    return () => clearTimeout(timer)
  }, [movesOn, feedback, run])
  const sheet = useRef<HTMLDivElement>(null)
  const continueButton = useRef<HTMLButtonElement>(null)
  // The option that had focus is disabled now: Continue takes it, or the feedback itself when there is no button.
  useEffect(() => {
    if (feedback) (continueButton.current ?? sheet.current)?.focus()
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
            <PlayWord entry={item.entry} />
            <p className="instruction">{t('study.chooseTranslation')}</p>
          </>
        ) : (
          <>
            <p className="prompt-text">
              <Translation entry={item.entry} lang={l1} stacked />
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
                  <span className="option-text">{showsTranslations ? <Translation entry={option} lang={l1} stacked /> : <span lang="en">{option.headword}</span>}</span>
                  {/* Its place is kept before the answer, so a gloss does not wrap anew when the mark comes. */}
                  <span className="option-mark" aria-hidden="true">
                    {isAnswer ? '✓' : isWrong ? '✗' : ''}
                  </span>
                </button>
              </li>
            )
          })}
        </ol>

        {/* While a right answer waits to move on, a tap here moves on at once; Enter and Space do the same (keys.ts). */}
        <div
          ref={sheet}
          tabIndex={-1}
          className={`feedback-sheet${feedback ? (feedback.correct ? ' is-correct' : ' is-incorrect') : ''}${movesOn ? ' moves-on' : ''}`}
          onClick={movesOn ? () => run.next() : undefined}
        >
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
          {feedback && !movesOn && (
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
  const client = useClient()
  const { corpus, settings } = useClientSnapshot()
  const { snapshot, scope } = props
  const heading = useRef<HTMLHeadingElement>(null)
  const studyingLine = useRef<HTMLParagraphElement>(null)
  // The theme this screen has just made the study theme, by name: said in a line once the button is gone.
  const [studying, setStudying] = useState<string | null>(null)
  useEffect(() => {
    heading.current?.focus()
    afterRun()
  }, [afterRun])
  // The button that had focus is gone once the theme is chosen: the line that says so takes it, and is read.
  useEffect(() => {
    if (studying !== null) studyingLine.current?.focus()
  }, [studying])
  // "Study this theme" (spec §8.9): after practising a theme that is not the one being studied and still has words to start.
  const studyTheme = scope?.scope.kind === 'theme' && scope.scope.id !== settings.activeTheme && scope.unstarted > 0 ? scope : null
  const themeName = studyTheme ? localized(studyTheme.title, locale, corpus?.l1 ?? '') : ''
  const [studyError, setStudyError] = useState<string | null>(null)
  const study = (themeId: string) =>
    void client.updateSettings({ activeTheme: themeId }).then(
      () => {
        setStudyError(null)
        setStudying(themeName)
      },
      // Not saved: the offer stays, with the reason, as a setting that fails to save says it anywhere.
      (err: unknown) => setStudyError(t('settings.saveFailed', { message: t(errorMessageKey(err)) })),
    )
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
      {snapshot.toLearn > 0 && <p className="done-line done-note">{t('done.toLearn', { count: snapshot.toLearn })}</p>}
      {snapshot.setAside > 0 && <p className="done-line done-note">{t('done.setAside', { count: snapshot.setAside })}</p>}
      {studying !== null && (
        <p className="done-line done-note done-studying" ref={studyingLine} tabIndex={-1}>
          {t('themes.nowStudying', { name: studying })}
        </p>
      )}
      {studyError !== null && (
        <p className="field-error" role="alert">
          {studyError}
        </p>
      )}
      <div className="done-actions">
        {/* A unit's or a theme's practice began on the path or the themes, so that is the way back; its "Practise more" stays in the scope. */}
        {scope ? (
          <Link className="button primary study-main" to={scope.back}>
            {t(scope.backLabel)}
          </Link>
        ) : (
          <Link className="button primary study-main" to={{ name: 'home' }}>
            {t('done.home')}
          </Link>
        )}
        <Link className="button study-main" to={{ name: 'practice', ...scope?.params }}>
          {t('done.practiceMore')}
        </Link>
        {/* The same choice as "Study this next" on the themes screen; the learner stays here, and a line says it is done. */}
        {studyTheme && (
          <button type="button" className="button study-main done-study-theme" aria-label={t('done.studyThemeNamed', { name: themeName })} onClick={() => study(studyTheme.scope.id)}>
            {t('done.studyTheme')}
          </button>
        )}
      </div>
    </section>
  )
}
