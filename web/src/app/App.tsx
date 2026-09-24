import { useEffect, useRef } from 'react'
import { LOCALES, useT, type Locale, type MessageKey } from '../i18n/i18n'
import { Link, useRoute, type Route } from '../router'
import { Home } from '../screens/Home'
import { Matching } from '../screens/Matching'
import { Path } from '../screens/Path'
import { Practice } from '../screens/Practice'
import { Progress } from '../screens/Progress'
import { Study } from '../screens/Study'
import { Themes } from '../screens/Themes'
import { useApp } from './context'

const NAV: readonly { readonly route: Route; readonly label: MessageKey }[] = [
  { route: { name: 'home' }, label: 'nav.home' },
  { route: { name: 'path' }, label: 'nav.path' },
  { route: { name: 'themes' }, label: 'nav.themes' },
  { route: { name: 'progress' }, label: 'nav.progress' },
]

/** Each language named in itself, as language pickers do. The visible name is the accessible name (WCAG 2.5.3). */
const ENDONYM: Readonly<Record<Locale, string>> = { bg: 'Български', en: 'English' }

function Screen(props: { readonly route: Route }) {
  const { route } = props
  switch (route.name) {
    case 'study':
      return <Study kind="session" mode={route.mode} />
    case 'practice':
      return <Practice />
    case 'practice-words':
      return <Study kind="practice" mode={route.mode} />
    case 'matching':
      return <Matching />
    case 'path':
      return <Path />
    case 'themes':
      return <Themes />
    case 'progress':
      return <Progress />
    default:
      return <Home />
  }
}

function LanguageSwitch() {
  const { t, locale, setLocale } = useT()
  return (
    <div className="lang" role="group" aria-label={t('lang.label')}>
      {LOCALES.map((l) => (
        <button key={l} type="button" lang={l} aria-pressed={l === locale} onClick={() => setLocale(l)}>
          {ENDONYM[l]}
        </button>
      ))}
    </div>
  )
}

/** The shell: wordmark, navigation, language, banner, and the routed screen. */
export function App() {
  const { t } = useT()
  const { backend } = useApp()
  const route = useRoute()
  const main = useRef<HTMLElement>(null)
  const first = useRef(true)

  // After an in-app navigation, focus the new screen, as a page load would (spec §11.1).
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    main.current?.focus()
  }, [route])

  return (
    <div className="app">
      <a className="skip" href="#main">
        {t('nav.skip')}
      </a>
      <header className="masthead">
        <Link className="wordmark" to={{ name: 'home' }}>
          {t('app.name')}
        </Link>
        <nav className="nav" aria-label={t('nav.label')}>
          <ul>
            {NAV.map((item) => (
              <li key={item.label}>
                <Link to={item.route} aria-current={item.route.name === route.name ? 'page' : undefined}>
                  {t(item.label)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <LanguageSwitch />
      </header>
      {backend === 'memory' ? <p className="banner warning">{t('banner.memory')}</p> : <p className="banner">{t('banner.demo')}</p>}
      <main id="main" ref={main} tabIndex={-1}>
        <Screen route={route} />
      </main>
    </div>
  )
}
