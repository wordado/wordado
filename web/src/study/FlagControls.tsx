import { useClient, useClientSnapshot } from '@wordado/client-data'
import { masteryTier, type WordId } from '@wordado/core'
import { Check, Clock, Ellipsis, Undo2 } from 'lucide-react'
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
 */
export function FlagControls(props: {
  readonly wordId: WordId
  readonly headword: string
  readonly menu?: boolean
  onChange?(next: 'known' | 'suspended' | null): void
}) {
  const { t } = useT()
  const client = useClient()
  const { flags, states } = useClientSnapshot()
  const [error, setError] = useState<string | null>(null)
  const actions = useRef<HTMLSpanElement>(null)
  const changed = useRef(false)
  const flag = flags.get(props.wordId)
  const state = states.get(props.wordId)
  const tier = state ? masteryTier(state) : null
  const status = flag === 'known' ? t('flag.known') : flag === 'suspended' ? t('flag.suspended') : tier ? t(TIER_LABEL[tier]) : t('path.wordNew')
  /** For the status's colour: set aside, not started, or the tier of a word being learned. */
  const kind = flag ?? tier ?? 'new'
  // The pressed button is gone once the flag changes: its replacement takes focus (spec §11.1).
  useEffect(() => {
    if (!changed.current) return
    changed.current = false
    actions.current?.querySelector('button')?.focus()
  }, [flag])
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
  const button = (label: string, next: 'known' | 'suspended' | null, icon?: ReactNode) => (
    <button
      type="button"
      className={props.menu ? undefined : 'link-button'}
      aria-label={t('flag.action', { action: label, word: props.headword })}
      onClick={() => void setFlag(next)}
    >
      {icon}
      {label}
    </button>
  )
  const statusTag = (
    <span className="word-status" data-status={kind}>
      {status}
    </span>
  )
  const errorLine = error && (
    <p className="field-error" role="alert">
      {error}
    </p>
  )
  if (props.menu) return <FlagMenu headword={props.headword} status={statusTag} error={errorLine} flagged={flag !== undefined} button={button} />
  return (
    <>
      {statusTag}
      <span className="word-actions" ref={actions}>
        {flag ? (
          button(t('flag.bringBack'), null)
        ) : (
          <>
            {button(t('flag.markKnown'), 'known')}
            {button(t('flag.markLater'), 'suspended')}
          </>
        )}
      </span>
      {errorLine}
    </>
  )
}

/** The menu form: the status, then a ⋯ button naming the word, and the choices behind it. */
function FlagMenu(props: {
  readonly headword: string
  readonly status: ReactNode
  readonly error: ReactNode
  readonly flagged: boolean
  readonly button: (label: string, next: 'known' | 'suspended' | null, icon?: ReactNode) => ReactNode
}) {
  const { t } = useT()
  const { open, close, root, trigger, onKeyDown, triggerProps, panelId } = usePopover()
  const flagged = useRef(props.flagged)
  // A change closes the menu and puts focus back on its button (spec §11.1).
  useEffect(() => {
    if (flagged.current !== props.flagged) close()
    flagged.current = props.flagged
  }, [props.flagged])
  return (
    <>
      {props.status}
      <div className="word-menu" ref={root} onKeyDown={onKeyDown}>
        <button ref={trigger} type="button" className="word-menu-button" aria-label={t('path.wordActions', { word: props.headword })} {...triggerProps}>
          <Ellipsis aria-hidden="true" size={20} />
        </button>
        {open && (
          <div className="popover-panel menu-panel" id={panelId}>
            {props.flagged ? (
              props.button(t('flag.bringBack'), null, <Undo2 aria-hidden="true" size={18} />)
            ) : (
              <>
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
