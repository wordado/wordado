import { useClient, useClientSnapshot } from '@wordado/client-data'
import { masteryTier, type WordId } from '@wordado/core'
import { useT } from '../i18n/i18n'
import { TIER_LABEL } from '../labels'

/**
 * A word's standing and the buttons that change it (spec §7.4): set aside as
 * known or for later, or brought back. Each button's name says which word it
 * acts on, beginning with its visible text (WCAG 2.5.3).
 */
export function FlagControls(props: { readonly wordId: WordId; readonly headword: string }) {
  const { t } = useT()
  const client = useClient()
  const { flags, states } = useClientSnapshot()
  const flag = flags.get(props.wordId)
  const state = states.get(props.wordId)
  const status = flag === 'known' ? t('flag.known') : flag === 'suspended' ? t('flag.suspended') : state ? t(TIER_LABEL[masteryTier(state)]) : t('path.wordNew')
  const button = (label: string, next: 'known' | 'suspended' | null) => (
    <button type="button" className="link-button" aria-label={t('flag.action', { action: label, word: props.headword })} onClick={() => void client.setFlag(props.wordId, next)}>
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
    </>
  )
}
