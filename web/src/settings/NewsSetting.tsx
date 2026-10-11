import { newsConsentText, type NewsConsent } from '@wordado/core'
import { useEffect, useId, useState } from 'react'
import { useApp } from '../app/context'
import { errorMessageKey } from '../errors'
import { useT } from '../i18n/i18n'
import { useOnline } from '../useOnline'

/**
 * News by email (#186): the consent asked for at sign-up, given or withdrawn here as easily. The switch carries the
 * same wording as the sign-up box, so one wording is what a learner agrees to wherever they do. The account's choice
 * is the server's to know, so the switch waits for it, and shows a change only once the server has taken it.
 */
export function NewsSetting() {
  const { t, locale } = useT()
  const { api } = useApp()
  const online = useOnline()
  const hintId = useId()
  /** Null until the server has said how the account stands. */
  const [consent, setConsent] = useState<NewsConsent | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!online) return
    let live = true
    api.me().then(
      (me) => {
        if (live && me) setConsent(me.newsConsent ?? null)
      },
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [api, online])

  const change = async (wanted: boolean) => {
    setError(null)
    setSaved(false)
    setSaving(true)
    try {
      setConsent(await api.setNewsConsent(wanted, newsConsentText(locale)))
      setSaved(true)
    } catch (err) {
      setError(t(errorMessageKey(err)))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="field switch-field">
      <label className="check">
        <input
          type="checkbox"
          checked={consent === 'given'}
          disabled={consent === null || saving || !online}
          aria-describedby={hintId}
          onChange={(e) => void change(e.target.checked)}
        />
        {t('news.consent')}
      </label>
      <p className="note" id={hintId}>
        {t('settings.newsHint')}
      </p>
      {!online && <p className="note">{t('settings.newsOffline')}</p>}
      <p className="note" role="status">
        {saved ? t('settings.saved') : ''}
      </p>
      {error !== null && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
