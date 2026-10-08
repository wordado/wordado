import { StudyRun, useClient, type RunKind } from '@wordado/client-data'
import type { Mode } from '@wordado/core'
import { useEffect, useState } from 'react'
import { useApp } from '../app/context'
import { ProgressBar } from '../app/ProgressBar'
import { errorMessageKey } from '../errors'
import { useT } from '../i18n/i18n'
import { Link } from '../router'
import { RunView } from '../study/RunView'
import { usePracticeScope, type ScopeParams } from './practiceScope'

/** A session or a practice run (spec §7.4), in one mode or mixed; practice may keep to one unit of the path or one theme (`unit`, `theme`). */
export function Study(props: { readonly kind: RunKind; readonly mode: Mode | null } & ScopeParams) {
  const { t } = useT()
  const client = useClient()
  const { env, audio } = useApp()
  const [run, setRun] = useState<StudyRun | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { kind, mode } = props
  const scope = usePracticeScope(kind === 'practice' ? { unit: props.unit, theme: props.theme } : {})
  // The scope by its parts: the run restarts when the learner moves to another unit or theme, not on every answer.
  const scopeKind = scope?.scope.kind
  const scopeId = scope?.scope.id

  useEffect(() => {
    let live = true
    setRun(null)
    setError(null)
    void StudyRun.start(client, env, {
      kind,
      mode,
      ...(scopeKind !== undefined && scopeId !== undefined && { scope: { kind: scopeKind, id: scopeId } }),
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
  }, [client, env, audio, kind, mode, scopeKind, scopeId])

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
  // Starting a run swaps in a pack that was fetched earlier and plans the day: nothing here has a size to measure.
  if (!run)
    return (
      <section className="study study-loading">
        <p role="status">{t('study.loading')}</p>
        <ProgressBar label={t('study.loading')} />
      </section>
    )
  return <RunView key={`${kind}:${mode ?? 'mixed'}:${scopeKind ?? ''}:${scopeId ?? ''}`} run={run} kind={kind} scope={scope} />
}
