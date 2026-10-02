import { useClientSnapshot } from '@wordado/client-data'
import { useEffect } from 'react'
import { interfaceLocales, useT, type Locale } from '../i18n/i18n'

/**
 * The interface languages on offer for the installed pack (spec §11.2), and the rule that keeps the interface among
 * them: an interface outside the pair (a choice saved before this rule, or one the learner's change of L1 left behind)
 * moves to the L1. Called once, by the shell, so it holds on every screen, the focus-mode ones too.
 */
export function useInterfaceLocales(): readonly Locale[] {
  const { locale, setLocale } = useT()
  const { corpus } = useClientSnapshot()
  const choices = interfaceLocales(corpus?.l1 ?? null)
  const first = choices[0]!
  const outside = !choices.includes(locale)
  useEffect(() => {
    if (outside) setLocale(first)
  }, [outside, first, setLocale])
  return choices
}
