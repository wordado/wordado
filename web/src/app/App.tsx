import { useEffect, useRef } from 'react'
import { ENDONYM, LOCALES, useT, type MessageKey } from '../i18n/i18n'
import { Link, useRoute, type Route } from '../router'
import { Home } from '../screens/Home'
import { Matching } from '../screens/Matching'
import { Path } from '../screens/Path'
import { Placement } from '../screens/Placement'
import { Practice } from '../screens/Practice'
import { Progress } from '../screens/Progress'
import { Settings } from '../screens/Settings'
import { SignIn } from '../screens/SignIn'
import { Study } from '../screens/Study'
import { Themes } from '../screens/Themes'
import { Banners, SyncLine } from './Banners'

const NAV: readonly { readonly route: Route; readonly label: MessageKey }[] = [
  { route: { name: 'home' }, label: 'nav.home' },
  { route: { name: 'path' }, label: 'nav.path' },
  { route: { name: 'themes' }, label: 'nav.themes' },
  { route: { name: 'progress' }, label: 'nav.progress' },
  { route: { name: 'settings' }, label: 'nav.settings' },
]

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
    case 'signin':
      return <SignIn />
    case 'settings':
      return <Settings />
    case 'placement':
      return <Placement />
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
export function App(props: { readonly resumed: boolean }) {
  const { t } = useT()
  const route = useRoute()
  const main = useRef<HTMLElement>(null)
  const first = useRef(true)

  // After an in-app navigation, focus the new screen, as a page load would
  // (spec §11.1). The shell itself also mounts fresh after a take-over or a
  // retry — not on the first load — so it focuses itself right away then too.
  useEffect(() => {
    if (first.current) {
      first.current = false
      if (props.resumed) main.current?.focus()
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
                <Link
                  to={item.route}
                  aria-current={item.route.name === route.name || (item.route.name === 'settings' && route.name === 'placement') ? 'page' : undefined}
                >
                  {t(item.label)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <LanguageSwitch />
        <SyncLine />
      </header>
      <aside aria-label={t('banner.label')}>
        <Banners />
      </aside>
      <main id="main" ref={main} tabIndex={-1}>
        <Screen route={route} />
      </main>
    </div>
  )
}
