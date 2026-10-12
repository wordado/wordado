import { Check } from 'lucide-react'
import { useClientSnapshot } from '@wordado/client-data'
import { ENDONYM, interfaceLocales, useT } from '../i18n/i18n'
import { usePopover } from './usePopover'

/**
 * The interface language (spec §11.2) in the masthead: a circle with the
 * current code that opens the languages, each named in itself. Its
 * accessible name holds the visible code (WCAG 2.5.3). Once a pack is
 * installed it offers only the learner's L1 and English. It stands in the
 * masthead only while the first-run setup is owed; after it the Help menu
 * holds the same choices (#243).
 */
export function LanguageMenu() {
  const { t, locale } = useT()
  const { open, close, root, trigger, onKeyDown, triggerProps, panelId } = usePopover()
  const code = locale.toUpperCase()
  return (
    <div className="language" ref={root} onKeyDown={onKeyDown}>
      <button
        ref={trigger}
        type="button"
        className="language-circle"
        aria-label={t('lang.button', { language: ENDONYM[locale], code })}
        {...triggerProps}
      >
        <span aria-hidden="true">{code}</span>
      </button>
      {open && <LanguageChoices className="popover-panel language-panel" id={panelId} aria-label={t('lang.label')} onChoose={close} />}
    </div>
  )
}

/**
 * The interface languages to choose from, each named in itself, the current one marked: the list the masthead's
 * language button opens, and the last part of the Help menu (#243). `onChoose` runs after the language is set.
 */
export function LanguageChoices(props: {
  readonly className: string
  readonly id?: string
  readonly 'aria-label'?: string
  readonly 'aria-labelledby'?: string
  onChoose(): void
}) {
  const { locale, setLocale } = useT()
  const { corpus } = useClientSnapshot()
  return (
    <ul className={props.className} id={props.id} aria-label={props['aria-label']} aria-labelledby={props['aria-labelledby']}>
      {interfaceLocales(corpus?.l1 ?? null).map((l) => (
        <li key={l}>
          <button
            type="button"
            lang={l}
            aria-current={l === locale ? 'true' : undefined}
            onClick={() => {
              setLocale(l)
              props.onChoose()
            }}
          >
            {ENDONYM[l]}
            {l === locale && <Check aria-hidden="true" size={18} />}
          </button>
        </li>
      ))}
    </ul>
  )
}
