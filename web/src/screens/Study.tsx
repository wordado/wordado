import { StudyRun, useClient, type RunKind } from '@wordado/client-data'
import type { Mode } from '@wordado/core'
import { useEffect, useState } from 'react'
import { useApp } from '../app/context'
import { useT } from '../i18n/i18n'
import { RunView } from '../study/RunView'

/** A session or a practice run (spec §7.4), in one mode or mixed. */
export function Study(props: { readonly kind: RunKind; readonly mode: Mode | null }) {
  const { t } = useT()
  const client = useClient()
  const { env, audio } = useApp()
  const [run, setRun] = useState<StudyRun | null>(null)
  const { kind, mode } = props

  useEffect(() => {
    let live = true
    setRun(null)
    void StudyRun.start(client, env, {
      kind,
      mode,
      cachedClips: () => audio.cachedClips(),
      online: () => audio.streamable(),
    }).then((started) => {
      if (live) setRun(started)
    })
    return () => {
      live = false
    }
  }, [client, env, audio, kind, mode])

  if (!run) return <p role="status">{t('study.loading')}</p>
  return <RunView key={`${kind}:${mode ?? 'mixed'}`} run={run} kind={kind} />
}
