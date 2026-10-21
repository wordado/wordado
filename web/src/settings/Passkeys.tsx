import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, PasskeyCancelled, type PasskeyInfo } from '../account/api'
import { platformAuthenticator } from '../account/passkeys'
import { ConfirmDialog } from '../app/Confirm'
import { useApp } from '../app/context'
import { errorMessageKey } from '../errors'
import { useT } from '../i18n/i18n'
import { Link } from '../router'
import { useOnline } from '../useOnline'

/**
 * The learner's passkeys (#287, spec §5.3): listed by the day each was added, removable, and one more can be added on
 * this device. Rendered by the account settings only where the browser can do passkeys at all.
 */
export function Passkeys() {
  const { t, locale } = useT()
  const { api } = useApp()
  const online = useOnline()
  const heading = useRef<HTMLHeadingElement>(null)
  /** Null until the server has listed them. */
  const [passkeys, setPasskeys] = useState<readonly PasskeyInfo[] | null>(null)
  const [canAdd, setCanAdd] = useState(false)
  const [removing, setRemoving] = useState<PasskeyInfo | null>(null)
  const [removed, setRemoved] = useState(false)
  const [adding, setAdding] = useState(false)
  const [added, setAdded] = useState(false)
  const [notFresh, setNotFresh] = useState(false)
  /** Set once a passkey is removed: focus goes to the heading when the dialog has closed (its opener is gone). */
  const [focusHeading, setFocusHeading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dateFormat = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: 'long' }), [locale])
  const date = (at: number) => dateFormat.format(new Date(at))

  const refresh = useCallback(async () => setPasskeys(await api.listPasskeys()), [api])

  useEffect(() => {
    let live = true
    void platformAuthenticator().then((yes) => {
      if (live) setCanAdd(yes)
    })
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    if (!online) return
    let live = true
    api.listPasskeys().then(
      (list) => {
        if (live) setPasskeys(list)
      },
      (err: unknown) => {
        if (live) setError(t(errorMessageKey(err)))
      },
    )
    return () => {
      live = false
    }
    // The message is only for a failure; the language changing must not list them again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, online])

  useEffect(() => {
    if (focusHeading && removing === null) {
      heading.current?.focus()
      setFocusHeading(false)
    }
  }, [focusHeading, removing])

  const add = async () => {
    setError(null)
    setAdded(false)
    setRemoved(false)
    setNotFresh(false)
    setAdding(true)
    try {
      await api.passkeyRegister()
    } catch (err) {
      setAdding(false)
      if (err instanceof PasskeyCancelled) return
      if (err instanceof ApiError && err.status === 403 && err.code === 'SESSION_NOT_FRESH') setNotFresh(true)
      else setError(t('passkey.addFailed'))
      return
    }
    setAdded(true)
    // The passkey is added whatever the list says next; a list that cannot be fetched keeps the success message.
    try {
      await refresh()
    } catch {
      // The list is out of date until the next visit; nothing more to say.
    }
    // Only now, so the button cannot be pressed again before the new passkey is listed.
    setAdding(false)
  }

  const remove = async (passkey: PasskeyInfo) => {
    await api.deletePasskey(passkey.id)
    // The passkey is gone from the server whatever else happens; the device is told, but nothing waits for it.
    void api.signalGone(passkey.credentialId)
    setAdded(false)
    setNotFresh(false)
    setRemoved(true)
    try {
      await refresh()
    } catch {
      setPasskeys((list) => list?.filter((p) => p.id !== passkey.id) ?? null)
    }
    setFocusHeading(true)
  }

  return (
    <div className="passkeys" aria-labelledby="settings-passkeys" role="group">
      <h3 id="settings-passkeys" ref={heading} tabIndex={-1}>
        {t('passkey.title')}
      </h3>
      {passkeys !== null && passkeys.length === 0 && <p>{t('passkey.none')}</p>}
      {passkeys !== null && passkeys.length > 0 && (
        <ul className="passkey-list">
          {passkeys.map((p) => (
            <li key={p.id}>
              <span>{t('passkey.item', { date: date(p.createdAt) })}</span>{' '}
              <button type="button" className="button" disabled={!online} aria-label={t('passkey.removeLabel', { date: date(p.createdAt) })} onClick={() => setRemoving(p)}>
                {t('passkey.remove')}
              </button>
            </li>
          ))}
        </ul>
      )}
      {canAdd && (
        <button type="button" className="button" disabled={!online || adding} onClick={() => void add()}>
          {t('passkey.add')}
        </button>
      )}
      {!online && <p className="note">{t('passkey.offline')}</p>}
      {/* One region, always there, so whatever fills it is announced (#302). */}
      <p className="note" role="status">
        {added ? (
          t('passkey.added')
        ) : removed ? (
          t('passkey.removedNote')
        ) : notFresh ? (
          <>
            {t('passkey.notFresh')} <Link to={{ name: 'signin', back: 'account' }}>{t('passkey.notFreshLink')}</Link>
          </>
        ) : null}
      </p>
      {error !== null && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {removing !== null && (
        <ConfirmDialog
          title={t('passkey.remove')}
          body={<p>{t('passkey.removeConfirm')}</p>}
          confirmLabel={t('passkey.remove')}
          onConfirm={() => remove(removing)}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  )
}
