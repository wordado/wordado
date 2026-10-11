import { useClient, useSettings } from '@wordado/client-data'
import { useEffect, useState } from 'react'
import { useT, type MessageKey } from '../i18n/i18n'
import { useStore } from '../useStore'
import { useApp } from './context'
import { changedLegalDocs } from './legalNotice'
import { legalUrl, type LegalDoc } from './site'

const TEXT: Readonly<Record<LegalDoc, { readonly changed: MessageKey; readonly link: MessageKey; readonly setting: 'termsSeen' | 'privacySeen' }>> = {
  terms: { changed: 'legal.terms.changed', link: 'legal.terms.link', setting: 'termsSeen' },
  privacy: { changed: 'legal.privacy.changed', link: 'legal.privacy.link', setting: 'privacySeen' },
}

/**
 * "The terms of use have changed." (#184): once for each document whose page on the website is newer than the
 * learner has seen, with a link to the page in the interface language, until it is dismissed. Dismissing keeps the
 * date on this device, and in a learner's settings, which carry it to their other devices. A notice may wait from an
 * earlier visit and so be true from the page's first render: as with "Wordado was updated.", the status region is
 * there first, empty, and the lines are put into it afterwards, so that they are announced (spec §11.1).
 */
export function LegalBanner() {
  const { t, locale } = useT()
  const { legalNotice, account } = useApp()
  const client = useClient()
  const { termsSeen, privacySeen } = useSettings()
  const state = useStore(legalNotice.store)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const changes = mounted ? changedLegalDocs(state, locale, { terms: termsSeen, privacy: privacySeen }) : []
  const dismiss = (doc: LegalDoc, date: string) => {
    legalNotice.dismiss(doc, date)
    // The demo has no account to keep it in. A write that fails leaves the device's own record, which is enough here.
    if (account === null) return
    void client
      .updateSettings({ [TEXT[doc].setting]: date })
      .then(() => client.sync())
      .catch(() => undefined)
  }
  return (
    <div role="status" className="legal-notices">
      {changes.map(({ doc, date }) => (
        <div key={doc} className="banner notice-line">
          <p id={`legal-${doc}-changed`}>{t(TEXT[doc].changed)}</p>
          <p className="banner-actions">
            <a href={legalUrl(doc, locale)}>{t(TEXT[doc].link)}</a>
            {/* Two documents can change together: each Dismiss is described by the line it closes. */}
            <button type="button" className="link-button" aria-describedby={`legal-${doc}-changed`} onClick={() => dismiss(doc, date)}>
              {t('notice.dismiss')}
            </button>
          </p>
        </div>
      ))}
    </div>
  )
}
