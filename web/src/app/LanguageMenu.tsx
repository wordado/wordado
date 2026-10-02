import { Check } from 'lucide-react'
import { useClientSnapshot } from '@wordado/client-data'
import { ENDONYM, interfaceLocales, useT } from '../i18n/i18n'
import { usePopover } from './usePopover'

/**
 * The interface language (spec §11.2) in the masthead: a circle with the
 * current code that opens the languages, each named in itself. Its
 * accessible name holds the visible code (WCAG 2.5.3). Once a pack is
 * installed it offers only the learner's L1 and English.
 */
export function LanguageMenu() {
  const { t, locale, setLocale } = useT()
  const { open, close, root, trigger, onKeyDown, triggerProps, panelId } = usePopover()
  const { corpus } = useClientSnapshot()
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
      {open && (
        <ul className="popover-panel language-panel" id={panelId} aria-label={t('lang.label')}>
          {interfaceLocales(corpus?.l1 ?? null).map((l) => (
            <li key={l}>
              <button
                type="button"
                lang={l}
                aria-current={l === locale ? 'true' : undefined}
                onClick={() => {
                  setLocale(l)
                  close()
                }}
              >
                {ENDONYM[l]}
                {l === locale && <Check aria-hidden="true" size={18} />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
