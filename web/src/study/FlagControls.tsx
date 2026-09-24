import { useClient, useClientSnapshot } from '@wordado/client-data'
import { masteryTier, type WordId } from '@wordado/core'
import { useState } from 'react'
import { useT } from '../i18n/i18n'
import { TIER_LABEL } from '../labels'

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/**
 * A word's standing and the buttons that change it (spec §7.4): set aside as
 * known or for later, or brought back. Each button's name says which word it
 * acts on, beginning with its visible text (WCAG 2.5.3). A failed change is
 * announced beside the controls and cleared on the next success (spec §11.1).
 */
export function FlagControls(props: { readonly wordId: WordId; readonly headword: string }) {
  const { t } = useT()
  const client = useClient()
  const { flags, states } = useClientSnapshot()
  const [error, setError] = useState<string | null>(null)
  const flag = flags.get(props.wordId)
  const state = states.get(props.wordId)
  const status = flag === 'known' ? t('flag.known') : flag === 'suspended' ? t('flag.suspended') : state ? t(TIER_LABEL[masteryTier(state)]) : t('path.wordNew')
  const setFlag = async (next: 'known' | 'suspended' | null) => {
    try {
      await client.setFlag(props.wordId, next)
      setError(null)
    } catch (err) {
      setError(t('settings.saveFailed', { message: messageOf(err) }))
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
      <span className="word-actions">
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
