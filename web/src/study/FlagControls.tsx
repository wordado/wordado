import { useClient, useClientSnapshot } from '@wordado/client-data'
import { masteryTier, type WordId } from '@wordado/core'
import { BookMinus, BookPlus, Check, Clock, Ellipsis, Undo2 } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { usePopover } from '../app/usePopover'
import { errorMessageKey } from '../errors'
import { useT } from '../i18n/i18n'
import { TIER_LABEL } from '../labels'

/**
 * A word's standing and the buttons that change it (spec §7.4): set aside as
 * known or for later, or brought back. Each button's name says which word it
 * acts on, beginning with its visible text (WCAG 2.5.3). A failed change is
 * announced beside the controls and cleared on the next success (spec §11.1).
 * A change replaces the button that made it, so focus moves to the button
 * that replaced it; `onChange`, called as a change starts, tells a list
 * that may drop the row instead.
 *
 * With `menu`, the buttons sit behind a ⋯ button that says which word it is
 * for; a change closes the menu and focus returns to that button.
 *
 * A word marked with "Learn this word" (spec §7.4) can have the mark taken
 * back here; with `learn`, a word that is not started can be marked here too.
 */
export function FlagControls(props: {
  readonly wordId: WordId
  readonly headword: string
  readonly menu?: boolean
  /** Offer "Learn this word" on a word that was never started: the path's list of a skipped level's unit. */
  readonly learn?: boolean
  onChange?(next: 'known' | 'suspended' | null): void
}) {
  const { t } = useT()
  const client = useClient()
  const { flags, states, toLearn } = useClientSnapshot()
  const [error, setError] = useState<string | null>(null)
  const actions = useRef<HTMLSpanElement>(null)
  const changed = useRef(false)
  const flag = flags.get(props.wordId)
  const state = states.get(props.wordId)
  const tier = state ? masteryTier(state) : null
  // Chosen with "Learn this word" and not yet started (spec §7.4): the daily session will bring it.
  const chosen = !flag && !tier && toLearn.includes(props.wordId)
  const status = flag === 'known' ? t('flag.known') : flag === 'suspended' ? t('flag.suspended') : tier ? t(TIER_LABEL[tier]) : chosen ? t('path.wordToLearn') : t('path.wordNew')
  /** For the status's colour: set aside, to learn, not started, or the tier of a word being learned. */
  const kind = flag ?? tier ?? (chosen ? 'to-learn' : 'new')
  const canLearn = props.learn === true && !flag && !tier && !chosen
  // The pressed button is gone once the flag or the mark changes: its replacement takes focus (spec §11.1).
  useEffect(() => {
    if (!changed.current) return
    changed.current = false
    actions.current?.querySelector('button')?.focus()
  }, [flag, chosen])
  const setFlag = async (next: 'known' | 'suspended' | null) => {
    try {
      changed.current = true
      props.onChange?.(next)
      await client.setFlag(props.wordId, next)
      setError(null)
    } catch (err) {
      changed.current = false
      setError(t('settings.saveFailed', { message: t(errorMessageKey(err)) }))
    }
  }
  const setLearn = async (on: boolean) => {
    try {
      changed.current = true
      await client.setToLearn(props.wordId, on)
      setError(null)
    } catch (err) {
      changed.current = false
      setError(t('settings.saveFailed', { message: t(errorMessageKey(err)) }))
    }
  }
  /** One choice: a flag to set or clear, or the mark to make or take back. */
  const action = (label: string, change: { readonly flag: 'known' | 'suspended' | null } | { readonly learn: boolean }, icon?: ReactNode) => (
    <button
      type="button"
      className={props.menu ? undefined : 'link-button'}
      aria-label={t('flag.action', { action: label, word: props.headword })}
      onClick={() => void ('learn' in change ? setLearn(change.learn) : setFlag(change.flag))}
    >
      {icon}
      {label}
    </button>
  )
  const button = (label: string, next: 'known' | 'suspended' | null, icon?: ReactNode) => action(label, { flag: next }, icon)
  // Marking the word to learn, or taking the mark back: above the ways to set it aside.
  const learnButton = chosen
    ? action(t('flag.dontLearn'), { learn: false }, props.menu && <BookMinus aria-hidden="true" size={18} />)
    : canLearn
      ? action(t('study.learn'), { learn: true }, props.menu && <BookPlus aria-hidden="true" size={18} />)
      : null
  // Behind a menu (the path's list) a word's own standing is a small mark, a shape and a colour, so the row keeps
  // its room for the translation; its words are the mark's name, and the menu's first line. A word that was never
  // started has none: its unit already says so.
  const statusTag = props.menu ? (
    kind === 'new' ? null : (
      <span className="word-status is-mark" data-status={kind}>
        <StandingMark kind={kind} />
        <span className="visually-hidden">{status}</span>
      </span>
    )
  ) : (
    <span className="word-status" data-status={kind}>
      {status}
    </span>
  )
  const errorLine = error && (
    <p className="field-error" role="alert">
      {error}
    </p>
  )
  if (props.menu) return <FlagMenu headword={props.headword} status={statusTag} standingLabel={kind === 'new' ? null : status} error={errorLine} flagged={flag !== undefined} standing={`${flag ?? ''}:${chosen}`} learn={learnButton} button={button} />
  return (
    <>
      {statusTag}
      <span className="word-actions" ref={actions}>
        {flag ? (
          button(t('flag.bringBack'), null)
        ) : (
          <>
            {learnButton}
            {button(t('flag.markKnown'), 'known')}
            {button(t('flag.markLater'), 'suspended')}
          </>
        )}
      </span>
      {errorLine}
    </>
  )
}

/** A standing as a shape (spec §7.4): a ring that fills with the mastery tier, or the icon of the choice that set the word aside or marked it. */
function StandingMark(props: { readonly kind: string }) {
  const { kind } = props
  if (kind === 'known') return <Check aria-hidden="true" size={20} strokeWidth={2.5} />
  if (kind === 'suspended') return <Clock aria-hidden="true" size={20} />
  if (kind === 'to-learn') return <BookPlus aria-hidden="true" size={20} />
  // A third, two thirds, the whole ring: 2πr of r = 7 is about 44.
  const share = kind === 'learning' ? 1 / 3 : kind === 'young' ? 2 / 3 : 1
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none" strokeWidth="3">
      <circle className="mark-track" cx="10" cy="10" r="7" />
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeLinecap="round" strokeDasharray={`${share * 43.98} 43.98`} transform="rotate(-90 10 10)" />
    </svg>
  )
}

/** The menu form: the status, then a ⋯ button naming the word, and the choices behind it. */
function FlagMenu(props: {
  readonly headword: string
  readonly status: ReactNode
  /** The standing in words, for the menu's first line; null for a word that has none. */
  readonly standingLabel: string | null
  readonly error: ReactNode
  readonly flagged: boolean
  /** The word's flag and mark, as one value: when it changes, a choice was made. */
  readonly standing: string
  /** "Learn this word" or its taking back, when either applies. */
  readonly learn: ReactNode
  readonly button: (label: string, next: 'known' | 'suspended' | null, icon?: ReactNode) => ReactNode
}) {
  const { t } = useT()
  const { open, close, root, trigger, onKeyDown, triggerProps, panelId } = usePopover()
  const standing = useRef(props.standing)
  // A change closes the menu and puts focus back on its button (spec §11.1).
  useEffect(() => {
    if (standing.current !== props.standing) close()
    standing.current = props.standing
  }, [props.standing])
  return (
    <>
      {props.status}
      <div className="word-menu" ref={root} onKeyDown={onKeyDown}>
        <button ref={trigger} type="button" className="word-menu-button" aria-label={t('path.wordActions', { word: props.headword })} {...triggerProps}>
          <Ellipsis aria-hidden="true" size={20} />
        </button>
        {open && (
          <div className="popover-panel menu-panel" id={panelId}>
            {props.standingLabel !== null && <p className="menu-standing">{props.standingLabel}</p>}
            {props.flagged ? (
              props.button(t('flag.bringBack'), null, <Undo2 aria-hidden="true" size={18} />)
            ) : (
              <>
                {props.learn}
                {props.button(t('flag.markKnown'), 'known', <Check aria-hidden="true" size={18} className="menu-icon-known" />)}
                {props.button(t('flag.markLater'), 'suspended', <Clock aria-hidden="true" size={18} />)}
              </>
            )}
          </div>
        )}
      </div>
      {props.error}
    </>
  )
}
