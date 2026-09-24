import { useClientSnapshot } from '@wordado/client-data'
import { useState } from 'react'
import type { AccountNotice } from '../account/controller'
import { useT, type MessageKey } from '../i18n/i18n'
import { Link } from '../router'
import { useOnline } from '../useOnline'
import { useStore } from '../useStore'
import { ConfirmDialog } from './Confirm'
import { useApp } from './context'
import { syncMessage } from './syncMessage'

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
  const { expired, notice } = useStore(accounts.store)
  const [leaving, setLeaving] = useState(false)
  return (
    <div className="banners">
      <UpdateBanner />
      <InstallBanner />
      {notice !== null && (
        <div className="banner notice-line" role="status">
          <p>{t(NOTICE[notice], { email: account?.email ?? '' })}</p>
          <button type="button" className="link-button" onClick={() => accounts.dismissNotice()}>
            {t('notice.dismiss')}
          </button>
        </div>
      )}
      {account === null ? (
        <div className={`banner${backend === 'memory' ? ' warning' : ''}`}>
          <p>{t(backend === 'memory' ? 'banner.memory' : 'banner.demo')}</p>
          <p className="banner-actions">
            <Link to={{ name: 'signin' }}>{t('banner.demoCreate')}</Link>
            <button type="button" className="link-button" onClick={() => setLeaving(true)}>
              {t('banner.demoLeave')}
            </button>
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

/** A newer version is waiting, or this one is too old for the packs or the server (spec §4.3, §9.3). */
function UpdateBanner() {
  const { t } = useT()
  const { lifecycle } = useApp()
  const { updateReady, appTooOld } = useStore(lifecycle.store)
  const { sync } = useClientSnapshot()
  if (!updateReady && !appTooOld && !sync.upgradeRequired) return null
  return (
    <div className="banner warning">
      <p>{t(updateReady ? 'update.ready' : 'update.needed')}</p>
      <p className="banner-actions">
        <button type="button" className="link-button" onClick={() => lifecycle.applyUpdate()}>
          {t('update.now')}
        </button>
      </p>
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

/** One line in the masthead saying what sync is doing (spec §9.2); nothing in the demo. */
export function SyncLine() {
  const { t } = useT()
  const { account, accounts } = useApp()
  const { expired } = useStore(accounts.store)
  const { sync } = useClientSnapshot()
  const online = useOnline()
  const message = syncMessage(sync, { online, expired, signedIn: account !== null })
  if (!message) return null
  return (
    <p className={`sync-line${message.tone === 'warning' ? ' warning' : ''}`} role="status">
      {t(message.key, message.vars)}
    </p>
  )
}
