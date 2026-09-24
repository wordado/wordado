import { useClient, useClientSnapshot } from '@wordado/client-data'
import { useState } from 'react'
import { useApp } from '../app/context'
import { useT } from '../i18n/i18n'
import { useOnline } from '../useOnline'

/** The whole-level audio download (spec §9.3): the learner chooses when, for example on Wi-Fi. */
export function AudioDownload() {
  const { t } = useT()
  const client = useClient()
  const { settings } = useClientSnapshot()
  const { audio } = useApp()
  const online = useOnline()
  const [busy, setBusy] = useState(false)
  const [, rerender] = useState(0)
  const level = settings.declaredLevel
  const clips = client.levelClips(level)
  if (!settings.audio || clips.length === 0) return null
  const cached = audio.cachedClips()
  const done = clips.filter((c) => cached.has(c.clipId)).length
  const download = async () => {
    setBusy(true)
    try {
      await audio.prefetch(clips)
    } finally {
      setBusy(false)
      rerender((n) => n + 1)
    }
  }
  return (
    <section aria-labelledby="settings-audio">
      <h2 id="settings-audio">{t('settings.audioDownload')}</h2>
      <p className="note">{t('settings.audioDownloadHint', { level })}</p>
      <button type="button" className="button" disabled={!online || busy || done === clips.length} onClick={() => void download()}>
        {t('settings.audioDownloadButton', { level })}
      </button>
      <p className="note" role="status">
        {online ? t('settings.audioDownloaded', { done, total: clips.length }) : t('settings.audioOffline')}
      </p>
    </section>
  )
}
