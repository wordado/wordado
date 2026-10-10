import { useClientSnapshot } from '@wordado/client-data'
import type { FixedField } from '@wordado/core'
import { useEffect, useState } from 'react'
import type { AccountNotice } from '../account/controller'
import { useT, type MessageKey } from '../i18n/i18n'
import { Link, useFeedbackRoute } from '../router'
import { useOnline } from '../useOnline'
import { useStore } from '../useStore'
import { ConfirmDialog } from './Confirm'
import { useApp } from './context'
import { ProgressBar } from './ProgressBar'
import { syncMessage, type SyncMessage } from './syncMessage'

const NOTICE: Readonly<Record<AccountNotice, MessageKey>> = {
  'carried-over': 'notice.carried-over',
  'demo-discarded': 'notice.demo-discarded',
  'demo-left': 'notice.demo-left',
  'signed-in': 'notice.signed-in',
  'signed-out': 'notice.signed-out',
  deleted: 'notice.deleted',
  'other-account': 'notice.other-account',
  'google-failed': 'notice.google-failed',
}

/** The shell's banners (spec §8.6, §9.1): the demo, storage, an expired sign-in, and the last account notice. */
export function Banners() {
  const { t } = useT()
  const { backend, account, accounts } = useApp()
  const { expired } = useStore(accounts.store)
  const [leaving, setLeaving] = useState(false)
  const feedback = useFeedbackRoute()
  return (
    <div className="banners">
      <UpdateBanner />
      <UpdatedLine />
      <InstallBanner />
      <NoticeLine />
      <FixBanner />
      {account === null ? (
        <div className={`banner${backend === 'memory' ? ' warning' : ''}`}>
          <p>{t(backend === 'memory' ? 'banner.memory' : 'banner.demo')}</p>
          <p className="banner-actions">
            <Link to={{ name: 'signin' }}>{t('banner.demoCreate')}</Link>
            <button type="button" className="link-button" onClick={() => setLeaving(true)}>
              {t('banner.demoLeave')}
            </button>
            {/* The demo has no account menu to hold it (spec §8.12: feedback is one tap from any screen, signed in or not). */}
            <Link className="banner-feedback" to={feedback}>
              {t('feedback.open')}
            </Link>
          </p>
        </div>
      ) : (
        backend === 'memory' && <p className="banner warning">{t('banner.memoryOnline')}</p>
      )}
      {account !== null && expired && (
        <div className="banner warning">
          <p>{t('banner.expired')}</p>
          <p className="banner-actions">
            <Link to={{ name: 'signin' }}>{t('banner.signInAgain')}</Link>
          </p>
        </div>
      )}
      {leaving && (
        <ConfirmDialog
          title={t('leave.title')}
          body={<p>{t('leave.body')}</p>}
          confirmLabel={t('leave.confirm')}
          onConfirm={() => accounts.leaveDemo()}
          onClose={() => setLeaving(false)}
        />
      )}
    </div>
  )
}

/**
 * The last account notice, alone: also all the shell shows of the banners during the first-run setup (plan 11),
 * since signing out, deleting the account or leaving the demo each start a new demo, which opens in the setup.
 */
export function NoticeLine() {
  const { t } = useT()
  const { account, accounts } = useApp()
  const { notice } = useStore(accounts.store)
  if (notice === null) return null
  return (
    <div className="banner notice-line" role="status">
      <p>{t(NOTICE[notice], { email: account?.email ?? '' })}</p>
      <button type="button" className="link-button" onClick={() => accounts.dismissNotice()}>
        {t('notice.dismiss')}
      </button>
    </div>
  )
}

/** "Something you reported has been fixed" (spec §8.10): one banner, dismissed once. */
function FixBanner() {
  const { t } = useT()
  const { fixNotices } = useApp()
  const notices = useStore(fixNotices.store)
  if (notices.length === 0) return null
  const only = notices.length === 1 ? notices[0]! : null
  return (
    <div className="banner notice-line" role="status">
      <p>
        {only?.headword
          ? t('fixed.one', { field: t(FIELD[only.field]), word: only.headword })
          : t('fixed.some', { count: notices.length })}
      </p>
      <button type="button" className="link-button" onClick={() => fixNotices.dismiss()}>
        {t('notice.dismiss')}
      </button>
    </div>
  )
}

const FIELD: Readonly<Record<FixedField, MessageKey>> = {
  translation: 'fixed.field.translation',
  example: 'fixed.field.example',
  audio: 'fixed.field.audio',
  level: 'fixed.field.level',
}

/**
 * A newer version is waiting, or this one is too old for the packs or the server (spec §4.3, §9.3); and what an
 * update is doing (spec §9.1): downloading, by the files its worker says it has cached, or taking over, which
 * nothing measures.
 */
function UpdateBanner() {
  const { t } = useT()
  const { lifecycle } = useApp()
  const { updateReady, appTooOld, applying, download } = useStore(lifecycle.store)
  const { sync } = useClientSnapshot()
  if (applying) {
    return (
      <div className="banner update-progress" role="status">
        <p>{t('update.applying')}</p>
        <ProgressBar label={t('update.applying')} />
      </div>
    )
  }
  const offered = updateReady || appTooOld || sync.upgradeRequired
  const downloading = !updateReady && download !== null
  if (!offered && !downloading) return null
  return (
    <>
      {offered && (
        <div className="banner warning">
          <p>{t(updateReady ? 'update.ready' : 'update.needed')}</p>
          <p className="banner-actions">
            <button type="button" className="link-button" onClick={() => lifecycle.applyUpdate()}>
              {t('update.now')}
            </button>
          </p>
        </div>
      )}
      {downloading && (
        <div className="banner update-progress" role="status">
          <p>{t('update.downloading')}</p>
          <ProgressBar label={t('update.downloading')} value={download.done} max={download.total} />
        </div>
      )}
    </>
  )
}

/**
 * "Wordado was updated." (spec §9.1): once, after the app updated itself, until it is dismissed or the page is left.
 * It is true from the page's first render, and a status region that arrives already filled is not announced: the
 * region is there first, empty, and the line is put into it afterwards (spec §11.1).
 */
function UpdatedLine() {
  const { t } = useT()
  const { lifecycle } = useApp()
  const { updated } = useStore(lifecycle.store)
  const [said, setSaid] = useState(false)
  useEffect(() => setSaid(updated), [updated])
  return (
    <div role="status">
      {said && updated && (
        <div className="banner notice-line">
          <p>{t('update.done')}</p>
          <button type="button" className="link-button" onClick={() => lifecycle.dismissUpdated()}>
            {t('notice.dismiss')}
          </button>
        </div>
      )}
    </div>
  )
}

/** The installation prompt, from the second day of use (spec §9.1). */
function InstallBanner() {
  const { t } = useT()
  const { lifecycle } = useApp()
  const { installOffer } = useStore(lifecycle.store)
  if (installOffer === null) return null
  return (
    <div className="banner">
      <p>{t(installOffer === 'ios' ? 'install.ios' : 'install.prompt')}</p>
      <p className="banner-actions">
        {installOffer === 'prompt' && (
          <button type="button" className="link-button" onClick={() => void lifecycle.install()}>
            {t('install.button')}
          </button>
        )}
        <button type="button" className="link-button" onClick={() => lifecycle.dismissInstall()}>
          {t('install.later')}
        </button>
      </p>
    </div>
  )
}

/** What sync is doing for the signed-in learner (spec §9.2); null in the demo or when there is nothing to say. */
export function useSyncMessage(): SyncMessage | null {
  const { account, accounts } = useApp()
  const { expired } = useStore(accounts.store)
  const { sync } = useClientSnapshot()
  const online = useOnline()
  return syncMessage(sync, { online, expired, signedIn: account !== null })
}

/** One line saying what sync is doing (spec §9.2), in the account menu; nothing in the demo. */
export function SyncLine() {
  const { t } = useT()
  const message = useSyncMessage()
  if (!message) return null
  return (
    <p className={`sync-line${message.tone === 'warning' ? ' warning' : ''}`} role="status">
      {t(message.key, message.vars)}
    </p>
  )
}
