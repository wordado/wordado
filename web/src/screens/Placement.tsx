import { PlacementRun, placementSource, useClient, useClientSnapshot, type PlacementSource } from '@wordado/client-data'
import { useEffect, useRef, useState } from 'react'
import { useApp } from '../app/context'
import { useT } from '../i18n/i18n'
import { Link } from '../router'
import { Headword, Translation } from '../study/Headword'
import { useStore } from '../useStore'

/**
 * The optional placement test (spec §7.2). Questions carry no feedback, since
 * the test measures rather than teaches. Nothing changes until the learner
 * takes the result.
 */
export function Placement(props: { readonly source?: PlacementSource }) {
  const { t } = useT()
  const client = useClient()
  const { env } = useApp()
  const { corpus, settings } = useClientSnapshot()
  const [run] = useState(() => PlacementRun.start(props.source ?? placementSource(client), env))
  const s = useStore(run.store)
  const card = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)

  // 1–4 answer, 0 is "I don't know" (spec §11.1); a held key answers nothing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return
      if ((event.target as HTMLElement | null)?.closest('input, textarea, select')) return
      if (run.snapshot.phase !== 'question') return
      if (event.key === '0') {
        event.preventDefault()
        run.dontKnow()
      } else if (/^[1-4]$/.test(event.key)) {
        event.preventDefault()
        run.choose(Number(event.key) - 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [run])

  // Each question takes focus, so a screen reader reads it; the result's heading likewise.
  useEffect(() => {
    if (s.phase === 'question') card.current?.focus()
    else heading.current?.focus()
  }, [s.item, s.phase])

  if (s.phase === 'unavailable') {
    return (
      <section aria-labelledby="placement-title">
        <h1 id="placement-title" ref={heading} tabIndex={-1}>
          {t('placement.unavailableTitle')}
        </h1>
        <p>{t('placement.unavailableNote')}</p>
        <Link className="button" to={{ name: 'settings' }}>
          {t('placement.back')}
        </Link>
      </section>
    )
  }

  if (s.phase === 'result' || s.phase === 'accepted') {
    const level = s.result!
    return (
      <section className="done" aria-labelledby="placement-title">
        <h1 id="placement-title" ref={heading} tabIndex={-1}>
          {s.phase === 'accepted' ? t('placement.acceptedTitle', { level }) : t('placement.resultTitle', { level })}
        </h1>
        {s.phase === 'result' ? (
          <>
            <p>{t('placement.resultBody', { level })}</p>
            {/* `s.error` is the failure's own English message: the learner sees a translated one (spec §11.2). */}
            {s.error !== null && <p role="alert">{t('settings.saveFailed', { message: t('error.unknown') })}</p>}
            <div className="actions">
              <button type="button" className="button primary" onClick={() => void run.accept()}>
                {t('placement.accept', { level })}
              </button>
              <Link className="button" to={{ name: 'settings' }}>
                {t('placement.keep', { level: settings.declaredLevel })}
              </Link>
            </div>
          </>
        ) : (
          <Link className="button primary" to={{ name: 'home' }}>
            {t('placement.home')}
          </Link>
        )}
      </section>
    )
  }

  const item = s.item!
  const l1 = (props.source?.corpus ?? corpus)?.l1 ?? 'bg'
  return (
    <section className="study" aria-labelledby="placement-title">
      <h1 id="placement-title">{t('placement.title')}</h1>
      <p className="note">{t('placement.intro')}</p>
      <div className="study-bar">
        <p>{t('placement.progress', { count: s.asked })}</p>
      </div>
      <div className="card" ref={card} tabIndex={-1} data-mode="placement">
        <Headword entry={item.entry} />
        <p className="instruction">{t('study.chooseTranslation')}</p>
        <ol className="options">
          {item.options.map((option, index) => (
            <li key={option.entryId}>
              <button type="button" className="option" onClick={() => run.choose(index)}>
                <span className="option-key" aria-hidden="true">
                  {index + 1}
                </span>{' '}
                <Translation entry={option} lang={l1} />
              </button>
            </li>
          ))}
        </ol>
        <button type="button" className="button" onClick={() => run.dontKnow()}>
          <span className="option-key" aria-hidden="true">
            0
          </span>{' '}
          {t('placement.dontKnow')}
        </button>
      </div>
      <p className="note keys-hint">{t('placement.keysHint')}</p>
    </section>
  )
}
