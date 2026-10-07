import { StudyRun, useClient, type RunKind } from '@wordado/client-data'
import type { Mode } from '@wordado/core'
import { useEffect, useState } from 'react'
import { useApp } from '../app/context'
import { errorMessageKey } from '../errors'
import { useT } from '../i18n/i18n'
import { Link } from '../router'
import { RunView } from '../study/RunView'
import { usePracticeUnit } from './practiceUnit'

/** A session or a practice run (spec §7.4), in one mode or mixed; practice may keep to one unit of the path (`unit`). */
export function Study(props: { readonly kind: RunKind; readonly mode: Mode | null; readonly unit?: string | undefined }) {
  const { t } = useT()
  const client = useClient()
  const { env, audio } = useApp()
  const [run, setRun] = useState<StudyRun | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { kind, mode } = props
  const unitId = usePracticeUnit(kind === 'practice' ? props.unit : undefined)?.unitId

  useEffect(() => {
    let live = true
    setRun(null)
    setError(null)
    void StudyRun.start(client, env, {
      kind,
      mode,
      ...(unitId !== undefined && { unitId }),
      cachedClips: () => audio.cachedClips(),
      online: () => audio.streamable(),
    }).then(
      (started) => {
        if (live) setRun(started)
      },
      (err: unknown) => {
        if (live) setError(t(errorMessageKey(err)))
      },
    )
    return () => {
      live = false
    }
  }, [client, env, audio, kind, mode, unitId])

  // Focus mode hides the navigation, so a run that cannot start offers the way back itself.
  if (error !== null)
    return (
      <section className="study">
        <p role="alert">{t('study.error', { message: error })}</p>
        <Link className="button" to={{ name: 'home' }}>
          {t('done.home')}
        </Link>
      </section>
    )
  if (!run) return <p role="status">{t('study.loading')}</p>
  return <RunView key={`${kind}:${mode ?? 'mixed'}:${unitId ?? ''}`} run={run} kind={kind} unit={unitId} />
}
