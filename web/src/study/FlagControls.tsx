import { useClient, useClientSnapshot } from '@wordado/client-data'
import { masteryTier, type WordId } from '@wordado/core'
import { useEffect, useRef, useState } from 'react'
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
 */
export function FlagControls(props: { readonly wordId: WordId; readonly headword: string; onChange?(next: 'known' | 'suspended' | null): void }) {
  const { t } = useT()
  const client = useClient()
  const { flags, states } = useClientSnapshot()
  const [error, setError] = useState<string | null>(null)
  const actions = useRef<HTMLSpanElement>(null)
  const changed = useRef(false)
  const flag = flags.get(props.wordId)
  const state = states.get(props.wordId)
  const status = flag === 'known' ? t('flag.known') : flag === 'suspended' ? t('flag.suspended') : state ? t(TIER_LABEL[masteryTier(state)]) : t('path.wordNew')
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
  const button = (label: string, next: 'known' | 'suspended' | null) => (
    <button type="button" className="link-button" aria-label={t('flag.action', { action: label, word: props.headword })} onClick={() => void setFlag(next)}>
      {label}
    </button>
  )
  return (
    <>
      <span className="word-status">{status}</span>
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
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </>
  )
}
