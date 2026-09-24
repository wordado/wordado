import { useId, useState } from 'react'
import { useApp } from '../app/context'
import { useT, type MessageKey } from '../i18n/i18n'
import { DEFAULT_REMINDER_MINUTE, type ReminderPrefs } from '../reminders/reminders'

const toTime = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
const fromTime = (value: string): number | null => {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const minute = Number(match[1]) * 60 + Number(match[2])
  return minute >= 0 && minute <= 1439 ? minute : null
}

/** Opt-in reminders (spec §8.11); says plainly what stands in the way when they cannot work. */
export function ReminderSettings() {
  const { t } = useT()
  const { account, reminders } = useApp()
  const timeId = useId()
  const [prefs, setPrefs] = useState<ReminderPrefs | null>(() => reminders.prefs())
  const [status, setStatus] = useState<MessageKey | null>(null)
  const [busy, setBusy] = useState(false)
  const support = reminders.support()

  const blocked: MessageKey | null =
    account === null
      ? 'reminders.needAccount'
      : support === 'unsupported'
        ? 'reminders.unsupported'
        : support === 'needs-install'
          ? 'reminders.needsInstall'
          : support === 'denied'
            ? 'reminders.denied'
            : null

  const apply = async (next: ReminderPrefs | null) => {
    setBusy(true)
    try {
      if (next === null) {
        await reminders.disable()
        setPrefs(null)
        setStatus('reminders.off')
      } else {
        const outcome = await reminders.enable(next)
        if (outcome === 'on') {
          setPrefs(next)
          setStatus('reminders.saved')
        } else setStatus(outcome === 'denied' ? 'reminders.denied' : 'reminders.unavailable')
      }
    } catch {
      setStatus('reminders.unavailable')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="settings-reminders">
      <h2 id="settings-reminders">{t('reminders.title')}</h2>
      {blocked !== null ? (
        <p>{t(blocked)}</p>
      ) : (
        <>
          <p className="note">{t('reminders.hint')}</p>
          <div className="field">
            <label className="check">
              <input
                type="checkbox"
                checked={prefs !== null}
                disabled={busy}
                onChange={(e) => void apply(e.target.checked ? { minute: DEFAULT_REMINDER_MINUTE, streakNudge: false } : null)}
              />
              {t('reminders.on')}
            </label>
          </div>
          {prefs !== null && (
            <>
              <div className="field">
                <label htmlFor={timeId}>{t('reminders.time')}</label>
                <input
                  id={timeId}
                  type="time"
                  value={toTime(prefs.minute)}
                  disabled={busy}
                  onChange={(e) => {
                    const minute = fromTime(e.target.value)
                    if (minute !== null) void apply({ ...prefs, minute })
                  }}
                />
              </div>
              <div className="field">
                <label className="check">
                  <input type="checkbox" checked={prefs.streakNudge} disabled={busy} onChange={(e) => void apply({ ...prefs, streakNudge: e.target.checked })} />
                  {t('reminders.nudge')}
                </label>
              </div>
            </>
          )}
          <p className="note" role="status">
            {status !== null ? t(status) : null}
          </p>
        </>
      )}
    </section>
  )
}
